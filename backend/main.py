"""Local-only coordination demo. No production identity or external email service."""
import asyncio
import hashlib
import html
import json
import os
import secrets
import sqlite3
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Literal

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, StreamingResponse
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, ConfigDict, Field, StrictBool, field_validator
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .db import CONDITION_KEYS, ROOT, STATIONS, connect, draft, encode, event, init_db, now, transaction

STATION_CODES = {s['code'] for s in STATIONS}
LOCAL_HOSTS = {'127.0.0.1', '::1', 'localhost', 'testclient'}


def fail(code, message, status=409):
    raise HTTPException(status, {'code': code, 'message': message})


class Input(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)


class SessionInput(Input):
    role: Literal['occ', 'outport', 'cs']
    station: str = 'KIX'

    @field_validator('station')
    @classmethod
    def station_known(cls, value):
        if value not in STATION_CODES:
            raise ValueError('Unknown station')
        return value


class VersionInput(Input):
    version: int = Field(ge=1)


class CaseInput(Input):
    flight_no: str = Field(pattern=r'^TW[0-9]{2,4}$')
    flight_date: date
    station: str
    reason: str = Field(min_length=1, max_length=500)
    original_departure: datetime

    @field_validator('station')
    @classmethod
    def station_known(cls, value):
        if value not in STATION_CODES:
            raise ValueError('Unknown station')
        return value

    @field_validator('original_departure')
    @classmethod
    def aware(cls, value):
        if value.utcoffset() is None:
            raise ValueError('Timezone required')
        return value


class Condition(Input):
    status: Literal['PENDING', 'CONFIRMED', 'UNAVAILABLE']
    note: str = Field(default='', max_length=240)


class ReadinessInput(VersionInput):
    counters: list[str] = Field(max_length=12)
    gates: list[str] = Field(max_length=12)
    note: str = Field(default='', max_length=1000)
    conditions: dict[str, Condition]

    @field_validator('counters', 'gates')
    @classmethod
    def locations(cls, value):
        if any(not x.strip() or len(x) > 24 or any(ord(c) < 32 for c in x) for x in value):
            raise ValueError('Invalid location')
        return list(dict.fromkeys(x.strip() for x in value))

    @field_validator('conditions')
    @classmethod
    def known_conditions(cls, value):
        if set(value) != set(CONDITION_KEYS):
            raise ValueError('Exactly five known conditions are required')
        return value


class NoteInput(VersionInput):
    text: str = Field(min_length=1, max_length=2000)
    suggest_for_passengers: StrictBool = False


class ScheduleInput(VersionInput):
    proposed_departure: datetime
    note: str = Field(min_length=1, max_length=500)

    @field_validator('proposed_departure')
    @classmethod
    def aware(cls, value):
        if value.utcoffset() is None:
            raise ValueError('Timezone required')
        return value


class PublishInput(VersionInput):
    final_text: str | None = Field(default=None, min_length=1, max_length=3000)
    send_email: StrictBool = False
    corrects_id: int | None = Field(default=None, ge=1)


class RejectInput(VersionInput):
    review_note: str = Field(default='', max_length=1000)


class SwitchInput(VersionInput):
    active: StrictBool


class LinkInput(Input):
    # Issuance is separate from idempotent publication. It returns the raw token once.
    case_id: int = Field(ge=1)


def case_json(row):
    data = dict(row)
    data['readiness'] = json.loads(data['readiness'])
    data['conditions'] = json.loads(data['conditions'])
    data['acknowledged'] = bool(data['acknowledged'])
    return data


def scope_case(db, case_id, actor):
    row = db.execute('SELECT * FROM cases WHERE id=?', (case_id,)).fetchone()
    if row is None or (actor['role'] == 'outport' and row['station'] != actor['station']):
        fail('NOT_FOUND', 'Case not found.', 404)
    return row


def require_role(actor, *roles):
    if actor['role'] not in roles:
        fail('FORBIDDEN', 'This action is not available for your role.', 403)


def check_open(row, version):
    if row['status'] != 'OPEN':
        fail('CASE_CLOSED', 'This case is closed.')
    if row['version'] != version:
        fail('VERSION_CONFLICT', 'The case has changed. Refresh before continuing.')


def snapshot(db, case_id):
    row = case_json(db.execute('SELECT * FROM cases WHERE id=?', (case_id,)).fetchone())
    return {key: row[key] for key in ('version', 'status', 'readiness', 'conditions', 'proposed_departure', 'original_departure')}


def bump(db, case_id):
    db.execute('UPDATE cases SET version=version+1,updated_at=? WHERE id=?', (now(), case_id))


def idempotent(db, actor, method, path, key, body, action):
    if not key or len(key) > 128 or not all(32 < ord(c) < 127 for c in key):
        fail('IDEMPOTENCY_REQUIRED', 'A valid Idempotency-Key is required.', 422)
    digest = hashlib.sha256(json.dumps(body, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    row = db.execute('SELECT * FROM idempotency_keys WHERE actor_id=? AND method=? AND resource_path=? AND key=?', (actor['id'], method, path, key)).fetchone()
    if row:
        if row['request_hash'] != digest:
            fail('IDEMPOTENCY_CONFLICT', 'This key was used with different content.')
        return JSONResponse(json.loads(row['response_body']), status_code=row['http_status'])
    result, status = action()
    db.execute('INSERT INTO idempotency_keys VALUES(?,?,?,?,?,?,?,?,?)', (actor['id'], method, path, key, digest, status, encode(result), now(), (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()))
    return JSONResponse(result, status_code=status)


def create_app(db_path=None, seed=True):
    path = str(db_path or os.getenv('TWINOMATION_DB', ROOT / 'data' / 'demo.sqlite3'))

    @asynccontextmanager
    async def lifespan(app):
        init_db(path, seed)
        yield

    app = FastAPI(title='Twinomation local demo API', version='0.1.0', lifespan=lifespan, docs_url=None, openapi_url='/api/openapi.json', redoc_url=None)
    app.state.db_path = path
    app.state.sessions = {}
    app.state.rates = defaultdict(deque)
    app.state.streams = defaultdict(int)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=['localhost', '127.0.0.1', '[::1]', 'testserver'])

    @app.exception_handler(HTTPException)
    async def http_error(request, exc):
        detail = exc.detail if isinstance(exc.detail, dict) else {'code': 'REQUEST_ERROR', 'message': str(exc.detail)}
        return JSONResponse({'error': detail}, status_code=exc.status_code)

    @app.exception_handler(RequestValidationError)
    async def invalid(request, exc):
        # Do not echo attacker input or internal model details.
        return JSONResponse({'error': {'code': 'VALIDATION_ERROR', 'message': 'Please check the supplied fields.', 'fields': ['.'.join(map(str, e['loc'][1:])) for e in exc.errors()]}}, status_code=422)

    @app.exception_handler(sqlite3.OperationalError)
    async def database_error(request, exc):
        return JSONResponse({'error': {'code': 'SERVICE_BUSY', 'message': 'Storage is temporarily unavailable. Refresh and try again.'}}, status_code=503)

    @app.middleware('http')
    async def local_boundary(request, call_next):
        if not request.client or request.client.host not in LOCAL_HOSTS:
            return JSONResponse({'error': {'code': 'LOCAL_ONLY', 'message': 'This demo accepts local connections only.'}}, status_code=403)
        if request.method not in ('GET', 'HEAD', 'OPTIONS'):
            origin = request.headers.get('origin')
            allowed = {'http://127.0.0.1:8000', 'http://localhost:8000', 'http://127.0.0.1:5173', 'http://localhost:5173'}
            if origin and origin not in allowed:
                return JSONResponse({'error': {'code': 'ORIGIN_REJECTED', 'message': 'Origin not allowed.'}}, status_code=403)
            if request.headers.get('x-twinomation-client') != 'local-demo':
                return JSONResponse({'error': {'code': 'CLIENT_REQUIRED', 'message': 'Use the local demo client.'}}, status_code=403)
            length = request.headers.get('content-length', '')
            if not length.isdigit() or int(length) > 16384:
                return JSONResponse({'error': {'code': 'BODY_LIMIT', 'message': 'A bounded request body is required.'}}, status_code=413)
        bucket = 'session' if request.url.path == '/api/session' else ('write' if request.method != 'GET' else 'read')
        key = (request.client.host, bucket)
        times = app.state.rates[key]
        timestamp = time.monotonic()
        while times and timestamp - times[0] > 60:
            times.popleft()
        limit = {'session': 60, 'write': 120, 'read': 1200}[bucket]
        if len(times) >= limit:
            return JSONResponse({'error': {'code': 'RATE_LIMITED', 'message': 'Too many requests. Please wait.'}}, status_code=429, headers={'Retry-After': '60'})
        times.append(timestamp)
        response = await call_next(request)
        response.headers.update({'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"})
        return response

    def actor(authorization: str = Header(default='')):
        token = authorization.removeprefix('Bearer ')
        identity = app.state.sessions.get(token)
        if not authorization.startswith('Bearer ') or not identity or identity['expires'] < time.time():
            app.state.sessions.pop(token, None)
            fail('UNAUTHENTICATED', 'Choose a local demo workspace to continue.', 401)
        return identity

    @app.get('/api/docs', response_class=HTMLResponse, include_in_schema=False)
    def api_reference():
        schema = app.openapi()
        sections = []
        for route, methods in schema['paths'].items():
            for method, spec in methods.items():
                if method not in ('get', 'post', 'put', 'delete'):
                    continue
                sections.append('<article><h2><code>' + html.escape(method.upper() + ' ' + route) + '</code></h2><p>' + html.escape(spec.get('summary', '')) + '</p><details><summary>Contract</summary><pre>' + html.escape(json.dumps(spec, indent=2)) + '</pre></details></article>')
        return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Twinomation API reference</title><style>body{font:15px system-ui;background:#f8f9f7;color:#293a2e;max-width:1000px;padding:40px 24px;margin:auto}h1{font-weight:500}article{background:white;border:1px solid #e1e8dc;border-radius:8px;padding:20px;margin:15px 0}h2{font-size:15px}pre{overflow:auto;font-size:12px}a{color:#265c4b}summary{cursor:pointer;color:#6c7e60}</style><h1>Twinomation API</h1><p>Local demo only. Staff endpoints require a simulated bearer session. Writes require X-Twinomation-Client: local-demo.</p><p>External email is disabled. <a href="/api/openapi.json">OpenAPI schema</a> · <a href="/">OCC demo</a></p>' + ''.join(sections) + '</html>'

    @app.get('/api/health')
    def health():
        return {'status': 'ok', 'mode': 'local-demo', 'external_email': False}

    @app.post('/api/session')
    def session(body: SessionInput):
        # This is deliberate identity simulation, and cannot be enabled for remote clients.
        for token, identity in list(app.state.sessions.items()):
            if identity['expires'] < time.time():
                del app.state.sessions[token]
        if len(app.state.sessions) >= 100:
            fail('SESSION_LIMIT', 'Too many active demo sessions.', 429)
        token = secrets.token_urlsafe(32)
        identity = {'id': f'demo.{body.role}' + (f'.{body.station}' if body.role == 'outport' else ''), 'role': body.role, 'station': body.station if body.role == 'outport' else None, 'expires': time.time() + 8 * 3600}
        app.state.sessions[token] = identity
        return {'token': token, 'identity': identity, 'mode': 'local-demo'}

    @app.delete('/api/session')
    def logout(authorization: str = Header(default=''), who=Depends(actor)):
        app.state.sessions.pop(authorization.removeprefix('Bearer '), None)
        return {'ok': True}

    @app.get('/api/stations')
    def stations(who=Depends(actor)):
        with connect(path) as db:
            result = []
            for station in STATIONS:
                if who['role'] == 'outport' and station['code'] != who['station']:
                    continue
                rows = db.execute("SELECT * FROM cases WHERE station=? AND status='OPEN'", (station['code'],)).fetchall()
                pending = db.execute("SELECT count(*) FROM passenger_updates u JOIN cases c ON c.id=u.case_id WHERE c.station=? AND u.status='PENDING'", (station['code'],)).fetchone()[0]
                result.append({**station, 'open_cases': len(rows), 'pending_updates': pending, 'unconfirmed': sum(sum(c['status'] != 'CONFIRMED' for c in json.loads(r['conditions']).values()) for r in rows)})
        return result

    @app.get('/api/cases')
    def list_cases(station: str | None = None, status: Literal['OPEN', 'CLOSED'] | None = None, limit: int = 100, who=Depends(actor)):
        if limit < 1 or limit > 100:
            fail('VALIDATION_ERROR', 'Limit must be between 1 and 100.', 422)
        clauses, params = [], []
        if who['role'] == 'outport':
            if station and station != who['station']:
                fail('NOT_FOUND', 'Station not found.', 404)
            station = who['station']
        if station:
            clauses.append('station=?')
            params.append(station)
        if status:
            clauses.append('status=?')
            params.append(status)
        query = 'SELECT * FROM cases' + (' WHERE ' + ' AND '.join(clauses) if clauses else '') + ' ORDER BY id DESC LIMIT ?'
        with connect(path) as db:
            rows = db.execute(query, [*params, limit]).fetchall()
            result = []
            for row in rows:
                item = case_json(row)
                item['pending_updates'] = db.execute("SELECT count(*) FROM passenger_updates WHERE case_id=? AND status='PENDING'", (row['id'],)).fetchone()[0]
                result.append(item)
            return result

    @app.post('/api/cases')
    def create_case(body: CaseInput, idempotency_key: str = Header(default=''), who=Depends(actor)):
        require_role(who, 'occ')
        with transaction(path) as db:
            def action():
                conditions = {key: {'status': 'PENDING', 'note': ''} for key in CONDITION_KEYS}
                stamp = now()
                cid = db.execute('''INSERT INTO cases(flight_no,flight_date,station,reason,readiness,conditions,original_departure,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)''', (body.flight_no, body.flight_date.isoformat(), body.station, body.reason, encode({'counters': [], 'gates': [], 'note': ''}), encode(conditions), body.original_departure.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z'), stamp, stamp)).lastrowid
                eid = event(db, cid, 'CASE_OPENED', who, {'summary': 'Cancellation coordination opened', 'snapshot': snapshot(db, cid)})
                draft(db, cid, eid, 'flight_status', f'Demo update: flight {body.flight_no} on {body.flight_date} has been cancelled. Further information will be published here after review.')
                return case_json(db.execute('SELECT * FROM cases WHERE id=?', (cid,)).fetchone()), 201
            return idempotent(db, who, 'POST', '/api/cases', idempotency_key, body.model_dump(mode='json'), action)

    @app.get('/api/cases/{case_id}')
    def case_detail(case_id: int, who=Depends(actor)):
        with connect(path) as db:
            result = case_json(scope_case(db, case_id, who))
            result['events'] = [{**dict(r), 'payload': json.loads(r['payload'])} for r in db.execute('SELECT * FROM case_events WHERE case_id=? ORDER BY id DESC LIMIT 200', (case_id,))]
            result['updates'] = [dict(r) for r in db.execute('SELECT u.*,e.type AS source_type FROM passenger_updates u LEFT JOIN case_events e ON e.id=u.source_event_id WHERE u.case_id=? ORDER BY u.id DESC LIMIT 200', (case_id,))]
            return result

    @app.post('/api/cases/{case_id}/acknowledge')
    def acknowledge(case_id: int, body: VersionInput, who=Depends(actor)):
        require_role(who, 'outport')
        with transaction(path) as db:
            row = scope_case(db, case_id, who)
            check_open(row, body.version)
            if row['acknowledged']:
                fail('INVALID_TRANSITION', 'This case was already acknowledged.')
            db.execute('UPDATE cases SET acknowledged=1 WHERE id=?', (case_id,))
            bump(db, case_id)
            event(db, case_id, 'ACKNOWLEDGED', who, {'summary': 'Outport acknowledged the case', 'snapshot': snapshot(db, case_id)})
        return {'ok': True}

    @app.put('/api/cases/{case_id}/readiness')
    def readiness(case_id: int, body: ReadinessInput, who=Depends(actor)):
        require_role(who, 'outport')
        with transaction(path) as db:
            row = scope_case(db, case_id, who)
            check_open(row, body.version)
            old = json.loads(row['readiness'])
            new = {'counters': body.counters, 'gates': body.gates, 'note': body.note}
            conditions = {k: v.model_dump() for k, v in body.conditions.items()}
            if conditions['gate']['status'] == 'CONFIRMED' and not body.gates:
                fail('LOCATION_REQUIRED', 'A confirmed gate needs a gate location.', 422)
            if conditions['counter']['status'] == 'CONFIRMED' and not body.counters:
                fail('LOCATION_REQUIRED', 'A confirmed counter needs a counter location.', 422)
            if old == new and json.loads(row['conditions']) == conditions:
                return {'ok': True, 'changed': False}
            db.execute('UPDATE cases SET readiness=?,conditions=? WHERE id=?', (encode(new), encode(conditions), case_id))
            bump(db, case_id)
            eid = event(db, case_id, 'READINESS_UPDATED', who, {'summary': 'Ground readiness updated', 'snapshot': snapshot(db, case_id)})
            for key, topic, label in [('counters', 'counter', 'counter(s)'), ('gates', 'gate', 'gate(s)')]:
                old_status = json.loads(row['conditions'])[topic]['status']
                status = conditions[topic]['status']
                if old[key] == new[key] and old_status == status:
                    continue
                # Published positions become historical at the same commit as a change.
                changed = db.execute("UPDATE passenger_updates SET invalidated_at=? WHERE case_id=? AND topic=? AND status='PUBLISHED' AND invalidated_at IS NULL", (now(), case_id, topic)).rowcount
                if changed:
                    event(db, case_id, 'PUBLIC_GUIDANCE_INVALIDATED', {'id': 'system', 'role': 'system'}, {'topic': topic})
                text = f'Demo update: assistance for flight {row["flight_no"]} is available at {label} {", ".join(new[key])}.' if new[key] and status == 'CONFIRMED' else f'Demo update: the previously announced {label} for flight {row["flight_no"]} should no longer be used. A new location is awaiting confirmation.'
                source = event(db, case_id, f'{topic.upper()}_UPDATED', who, {'summary': f'{topic.title()} information changed', 'version': row['version'] + 1})
                draft(db, case_id, source, topic, text)
        return {'ok': True, 'changed': True}

    @app.post('/api/cases/{case_id}/notes')
    def notes(case_id: int, body: NoteInput, who=Depends(actor)):
        require_role(who, 'occ', 'outport')
        with transaction(path) as db:
            row = scope_case(db, case_id, who)
            check_open(row, body.version)
            bump(db, case_id)
            eid = event(db, case_id, 'NOTE_ADDED', who, {'summary': body.text, 'suggest_for_passengers': body.suggest_for_passengers, 'snapshot': snapshot(db, case_id)})
            if body.suggest_for_passengers:
                draft(db, case_id, eid, 'general', body.text)
        return {'ok': True}

    @app.put('/api/cases/{case_id}/schedule')
    def schedule(case_id: int, body: ScheduleInput, who=Depends(actor)):
        require_role(who, 'occ')
        with transaction(path) as db:
            row = scope_case(db, case_id, who)
            check_open(row, body.version)
            db.execute('UPDATE cases SET proposed_departure=? WHERE id=?', (body.proposed_departure.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z'), case_id))
            bump(db, case_id)
            event(db, case_id, 'SCHEDULE_PROPOSED', who, {'summary': body.note, 'snapshot': snapshot(db, case_id)})
        return {'ok': True}

    @app.post('/api/cases/{case_id}/close')
    def close(case_id: int, body: VersionInput, who=Depends(actor)):
        require_role(who, 'occ')
        with transaction(path) as db:
            row = scope_case(db, case_id, who)
            check_open(row, body.version)
            pending = db.execute("SELECT id FROM passenger_updates WHERE case_id=? AND status='PENDING'", (case_id,)).fetchall()
            for update in pending:
                db.execute("UPDATE passenger_updates SET status='SUPERSEDED',version=version+1 WHERE id=?", (update['id'],))
                event(db, case_id, 'UPDATE_SUPERSEDED', who, {'update_id': update['id']})
            db.execute("UPDATE cases SET status='CLOSED' WHERE id=?", (case_id,))
            bump(db, case_id)
            eid = event(db, case_id, 'CASE_CLOSED', who, {'summary': 'Internal coordination case closed', 'snapshot': snapshot(db, case_id)})
            draft(db, case_id, eid, 'flight_status', f'Demo update: the internal coordination case for flight {row["flight_no"]} has been closed.')
        return {'ok': True}

    @app.get('/api/updates')
    def updates(status: Literal['PENDING', 'PUBLISHED', 'REJECTED', 'SUPERSEDED'] | None = None, case_id: int | None = None, who=Depends(actor)):
        with connect(path) as db:
            if case_id:
                scope_case(db, case_id, who)
            clauses, args = [], []
            if status:
                clauses.append('u.status=?')
                args.append(status)
            if case_id:
                clauses.append('u.case_id=?')
                args.append(case_id)
            if who['role'] == 'outport':
                clauses.append('c.station=?')
                args.append(who['station'])
            query = '''SELECT u.*,c.flight_no,c.station,c.status AS case_status,e.type AS source_type,e.payload AS source_payload FROM passenger_updates u JOIN cases c ON c.id=u.case_id LEFT JOIN case_events e ON e.id=u.source_event_id'''
            return [dict(r) for r in db.execute(query + (' WHERE ' + ' AND '.join(clauses) if clauses else '') + ' ORDER BY u.created_at,u.id LIMIT 200', args)]

    @app.post('/api/updates/{update_id}/publish')
    def publish(update_id: int, body: PublishInput, idempotency_key: str = Header(default=''), who=Depends(actor)):
        require_role(who, 'cs')
        with transaction(path) as db:
            update = db.execute('SELECT * FROM passenger_updates WHERE id=?', (update_id,)).fetchone()
            if update is None:
                fail('NOT_FOUND', 'Update not found.', 404)
            row = scope_case(db, update['case_id'], who)
            def action():
                switch = db.execute("SELECT value FROM settings WHERE key='kill_switch'").fetchone()
                if not switch or switch['value'] != 'false':
                    fail('KILL_SWITCH_ACTIVE', 'Passenger publishing is paused by OCC.')
                if update['status'] != 'PENDING':
                    fail('INVALID_TRANSITION', 'This draft was already handled or superseded.')
                if update['version'] != body.version:
                    fail('VERSION_CONFLICT', 'The draft changed. Refresh before publishing.')
                source = db.execute('SELECT type FROM case_events WHERE id=?', (update['source_event_id'],)).fetchone()
                if row['status'] == 'CLOSED' and (not source or source['type'] != 'CASE_CLOSED'):
                    fail('CASE_CLOSED', 'Only the closing notice can be reviewed after closure.')
                if body.send_email:
                    fail('EMAIL_DISABLED', 'External email is disabled. Publish to the demo page only.', 422)
                if body.corrects_id is not None:
                    previous = db.execute("SELECT * FROM passenger_updates WHERE id=? AND case_id=? AND status='PUBLISHED'", (body.corrects_id, row['id'])).fetchone()
                    if not previous:
                        fail('INVALID_CORRECTION', 'The corrected update must belong to this case.', 422)
                text = body.final_text if body.final_text is not None else update['draft_text']
                stamp = now()
                db.execute("UPDATE passenger_updates SET status='PUBLISHED',final_text=?,reviewed_by=?,reviewed_at=?,published_at=?,corrects_id=?,version=version+1 WHERE id=? AND status='PENDING' AND version=?", (text, who['id'], stamp, stamp, body.corrects_id, update_id, body.version))
                event(db, row['id'], 'UPDATE_PUBLISHED', who, {'summary': f'{update["topic"].replace("_", " ").title()} update approved', 'update_id': update_id})
                return {'id': update_id, 'publication': 'PUBLISHED', 'delivery': 'not_requested'}, 200
            return idempotent(db, who, 'POST', f'/api/updates/{update_id}/publish', idempotency_key, body.model_dump(mode='json'), action)

    @app.post('/api/updates/{update_id}/reject')
    def reject(update_id: int, body: RejectInput, who=Depends(actor)):
        require_role(who, 'cs')
        with transaction(path) as db:
            update = db.execute('SELECT * FROM passenger_updates WHERE id=?', (update_id,)).fetchone()
            if update is None:
                fail('NOT_FOUND', 'Update not found.', 404)
            scope_case(db, update['case_id'], who)
            if update['status'] != 'PENDING':
                fail('INVALID_TRANSITION', 'This draft was already handled or superseded.')
            if update['version'] != body.version:
                fail('VERSION_CONFLICT', 'The draft changed. Refresh before continuing.')
            db.execute("UPDATE passenger_updates SET status='REJECTED',review_note=?,reviewed_by=?,reviewed_at=?,version=version+1 WHERE id=?", (body.review_note, who['id'], now(), update_id))
            event(db, update['case_id'], 'UPDATE_REJECTED', who, {'summary': 'Passenger draft rejected', 'update_id': update_id})
        return {'ok': True}

    @app.get('/api/kill-switch')
    def get_switch(who=Depends(actor)):
        with connect(path) as db:
            row = db.execute("SELECT * FROM settings WHERE key='kill_switch'").fetchone()
            return {'active': not row or row['value'] != 'false', 'version': row['version'] if row else 0}

    @app.put('/api/kill-switch')
    def put_switch(body: SwitchInput, who=Depends(actor)):
        require_role(who, 'occ')
        with transaction(path) as db:
            row = db.execute("SELECT * FROM settings WHERE key='kill_switch'").fetchone()
            if not row or row['version'] != body.version:
                fail('VERSION_CONFLICT', 'The publishing control changed. Refresh first.')
            db.execute("UPDATE settings SET value=?,version=version+1,updated_at=?,updated_by=? WHERE key='kill_switch'", (encode(body.active), now(), who['id']))
            event(db, None, 'KILL_SWITCH_ON' if body.active else 'KILL_SWITCH_OFF', who, {'summary': 'Passenger publishing paused' if body.active else 'Passenger publishing resumed'})
        return {'active': body.active, 'version': body.version + 1}

    @app.post('/api/demo/passenger-link')
    def passenger_link(body: LinkInput, who=Depends(actor)):
        require_role(who, 'occ', 'cs')
        token = secrets.token_urlsafe(32)
        expires = (datetime.now(timezone.utc) + timedelta(hours=8)).isoformat()
        with transaction(path) as db:
            scope_case(db, body.case_id, who)
            db.execute('UPDATE passengers SET token_revoked_at=? WHERE case_id=? AND token_revoked_at IS NULL', (now(), body.case_id))
            db.execute('INSERT INTO passengers(case_id,token_hash,token_expires_at) VALUES(?,?,?)', (body.case_id, hashlib.sha256(token.encode()).hexdigest(), expires))
            event(db, body.case_id, 'PASSENGER_LINK_ISSUED', who, {'summary': 'Eight-hour demo passenger link issued; previous link revoked'})
        # Fragment keeps the browser page's credential out of ordinary URL access logs.
        return {'path': f'/passenger#{token}', 'expires_at': expires}

    def passenger_record(db, token):
        if len(token) > 128:
            fail('NOT_FOUND', 'Link not found.', 404)
        row = db.execute('SELECT * FROM passengers WHERE token_hash=? AND token_revoked_at IS NULL', (hashlib.sha256(token.encode()).hexdigest(),)).fetchone()
        if not row or datetime.fromisoformat(row['token_expires_at']) <= datetime.now(timezone.utc):
            fail('NOT_FOUND', 'This demo link is unavailable or expired.', 404)
        return row

    @app.get('/api/passenger/{token}')
    def passenger_get(token: str):
        with connect(path) as db:
            person = passenger_record(db, token)
            row = db.execute('SELECT flight_no,flight_date,station,destination FROM cases WHERE id=?', (person['case_id'],)).fetchone()
            published = [{'id': r['id'], 'topic': r['topic'], 'text': r['final_text'], 'published_at': r['published_at'], 'invalidated': bool(r['invalidated_at']), 'corrects_id': r['corrects_id']} for r in db.execute("SELECT * FROM passenger_updates WHERE case_id=? AND status='PUBLISHED' ORDER BY published_at DESC,id DESC LIMIT 200", (person['case_id'],))]
            current = {}
            for update in published:
                if update['topic'] != 'general' and update['topic'] not in current:
                    current[update['topic']] = update
            return {'flight': dict(row), 'current': current, 'timeline': published, 'demo': True}

    async def stream(request, who=None, token=None, session_token=None):
        ip = request.client.host
        if app.state.streams[ip] >= 4:
            fail('STREAM_LIMIT', 'Live view limit reached. This page can still refresh normally.', 429)
        # Validate before returning StreamingResponse so invalid links return a real 404.
        with connect(path) as db:
            if token:
                passenger_record(db, token)
            cursor = db.execute('SELECT coalesce(max(id),0) FROM case_events').fetchone()[0]
        app.state.streams[ip] += 1

        async def generate():
            nonlocal cursor
            heartbeat = time.monotonic()
            try:
                yield 'event: ready\ndata: {}\n\n'
                while not await request.is_disconnected():
                    try:
                        if who and (who['expires'] < time.time() or session_token not in app.state.sessions):
                            return
                        with connect(path) as db:
                            case_id = passenger_record(db, token)['case_id'] if token else None
                            rows = db.execute('SELECT e.id,e.case_id,e.type,c.station FROM case_events e LEFT JOIN cases c ON c.id=e.case_id WHERE e.id>? ORDER BY e.id LIMIT 100', (cursor,)).fetchall()
                            for row in rows:
                                cursor = row['id']
                                if token:
                                    accept = row['case_id'] == case_id and row['type'] in ('UPDATE_PUBLISHED', 'PUBLIC_GUIDANCE_INVALIDATED')
                                else:
                                    accept = who['role'] != 'outport' or row['case_id'] is None or row['station'] == who['station']
                                if accept:
                                    yield 'event: refresh\ndata: {}\n\n'
                        if time.monotonic() - heartbeat > 15:
                            heartbeat = time.monotonic()
                            yield ': heartbeat\n\n'
                    except (HTTPException, sqlite3.Error):
                        yield 'event: unavailable\ndata: {}\n\n'
                        return
                    await asyncio.sleep(1)
            finally:
                app.state.streams[ip] -= 1

        return StreamingResponse(generate(), media_type='text/event-stream', headers={'X-Accel-Buffering': 'no'})

    @app.get('/api/stream')
    async def staff_stream(request: Request, authorization: str = Header(default=''), who=Depends(actor)):
        return await stream(request, who=who, session_token=authorization.removeprefix('Bearer '))

    @app.get('/api/passenger/{token}/stream')
    async def passenger_stream(token: str, request: Request):
        return await stream(request, token=token)

    @app.get('/{file_path:path}', include_in_schema=False)
    def frontend(file_path: str):
        if file_path == 'api' or file_path.startswith('api/'):
            fail('NOT_FOUND', 'Endpoint not found.', 404)
        root = (ROOT / 'dist').resolve()
        candidate = (root / file_path).resolve()
        if not candidate.is_relative_to(root):
            fail('NOT_FOUND', 'File not found.', 404)
        if candidate.is_file():
            return FileResponse(candidate)
        index = root / 'index.html'
        if index.exists() and ('.' not in Path(file_path).name):
            return FileResponse(index)
        fail('NOT_FOUND', 'Build the frontend with npm run build, or use the Vite dev server.', 404)

    return app


app = create_app()
