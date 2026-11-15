"""Local-only coordination demo. No production identity or external email service."""
import asyncio
import hashlib
import html
import re
import json
import os
import secrets
import sqlite3
import time
import logging
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

from .db import BLOCK_MINUTES, CONDITION_KEYS, DELAY_CAUSES, PRESET_ITEMS, PRESET_OPTIONS, ROOT, STATIONS, connect, draft, encode, event, init_db, now, preset_items, transaction
from .extended_ops import operations, store_operations, ensure_workspace, install_extended, message, public_journey, run_due, workspace

STATION_CODES = {s['code'] for s in STATIONS}
LOCAL_HOSTS = {'127.0.0.1', '::1', 'localhost', 'testclient'}
PRESET_KEYS = tuple(k for k, _ in PRESET_ITEMS)
ACTIVE_WO = ('SENT', 'RECEIVED', 'RESPONDED')
FILE_LIMIT = 5 * 1024 * 1024
FILE_TYPES = {'pdf': 'application/pdf', 'doc': 'application/msword', 'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              'xls': 'application/vnd.ms-excel', 'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              'ppt': 'application/vnd.ms-powerpoint', 'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
              'txt': 'text/plain', 'csv': 'text/csv', 'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg'}
UPLOAD_PATH = re.compile(r'^/api/cases/\d+/files$')
CONNECTIONS = {'LHR': 'London', 'SYD': 'Sydney', 'SIN': 'Singapore', 'BKK': 'Bangkok', 'YVR': 'Vancouver'}


def fail(code, message, status=409):
    raise HTTPException(status, {'code': code, 'message': message})


class Input(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)


class SessionInput(Input):
    role: Literal['occ', 'outport', 'care', 'cs']
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
    flight_no: str = Field(default='', max_length=60, pattern=r'^[^\x00-\x1f\x7f]*$')
    flight_date: date
    station: str
    reason: str = Field(default='', max_length=500)
    original_departure: datetime
    direction:Literal['inbound','outbound']='inbound'

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
    text: str = Field(default='', max_length=2000)
    suggest_for_passengers: StrictBool = False


class ScheduleInput(VersionInput):
    proposed_departure: datetime
    note: str = Field(default='', max_length=500)

    @field_validator('proposed_departure')
    @classmethod
    def aware(cls, value):
        if value.utcoffset() is None:
            raise ValueError('Timezone required')
        return value


class PublishInput(VersionInput):
    final_text: str | None = Field(default=None, max_length=3000)
    send_email: StrictBool = False
    corrects_id: int | None = Field(default=None, ge=1)


class PassengerNoticeInput(VersionInput):
    text_zh: str = Field(default='', max_length=3000)
    text_en: str = Field(default='', max_length=3000)
    template: Literal['flight_update', 'waiting', 'connection', 'care', 'custom'] = 'custom'

    @field_validator('text_zh', 'text_en')
    @classmethod
    def clean_text(cls, value):
        return value.strip()


class RejectInput(VersionInput):
    review_note: str = Field(default='', max_length=1000)


class SwitchInput(VersionInput):
    active: StrictBool


class LinkInput(Input):
    # Issuance is separate from idempotent publication. It returns the raw token once.
    case_id: int = Field(ge=1)
    connection: str | None = None

    @field_validator('connection')
    @classmethod
    def known_connection(cls, value):
        if value is not None and value not in CONNECTIONS:
            raise ValueError('Unknown connection')
        return value


def aware_datetime(value):
    if value is not None and value.utcoffset() is None:
        raise ValueError('Timezone required')
    return value


def iso(value):
    return value.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z') if value else None


class WorkOrderInput(Input):
    items: list[str] = Field(min_length=1, max_length=len(PRESET_KEYS))
    proposed_departure: datetime | None = None
    note: str = Field(default='', max_length=1000)
    operator_checked: StrictBool

    @field_validator('items')
    @classmethod
    def known_items(cls, value):
        if len(set(value)) != len(value) or not set(value) <= set(PRESET_KEYS):
            raise ValueError('Unknown or repeated item')
        return [k for k in PRESET_KEYS if k in value]

    _aware = field_validator('proposed_departure')(classmethod(lambda cls, v: aware_datetime(v)))


class ItemReply(Input):
    key: str = Field(min_length=1, max_length=40)
    label: str = Field(min_length=1, max_length=60)
    kind: Literal['preset', 'custom']
    options: list[str] = Field(min_length=2, max_length=6)
    status: str = Field(min_length=1, max_length=30)
    note: str = Field(default='', max_length=240)

    @field_validator('options')
    @classmethod
    def clean_options(cls, value):
        value = [v.strip() for v in value]
        if any(not v or len(v) > 30 or any(ord(c) < 32 for c in v) for v in value) or len(set(value)) != len(value):
            raise ValueError('Options must be unique, 1–30 characters')
        return value


class RespondInput(VersionInput):
    items: list[ItemReply] = Field(min_length=1, max_length=20)
    note: str = Field(default='', max_length=1000)


class AuthorizeInput(VersionInput):
    flight_status: Literal['DELAYED', 'BOARDING','ON_TIME']
    departure: datetime | None = None
    cause: Literal[DELAY_CAUSES] | None = None
    gate: str = Field(default='', max_length=12)
    terminal: str = Field(default='', max_length=12)
    custom_items_reviewed: StrictBool = False

    _aware = field_validator('departure')(classmethod(lambda cls, v: aware_datetime(v)))


class ReissueInput(VersionInput):
    note: str = Field(default='', max_length=1000)
    proposed_departure: datetime | None = None

    _aware = field_validator('proposed_departure')(classmethod(lambda cls, v: aware_datetime(v)))


class AbortInput(VersionInput):
    reason: str = Field(default='', max_length=500)


class CancelFlightInput(VersionInput):
    cause: Literal[DELAY_CAUSES]


def case_json(row):
    data = dict(row)
    data['readiness'] = json.loads(data['readiness'])
    data['conditions'] = json.loads(data['conditions'])
    data['acknowledged'] = bool(data['acknowledged'])
    return data


def wo_json(row):
    data = dict(row)
    data['items'] = json.loads(data['items'])
    data['operator_checked'] = bool(data['operator_checked'])
    return data


def file_json(row):
    return {k: row[k] for k in ('id', 'case_id', 'work_order_id', 'name', 'mime', 'size', 'uploaded_by', 'uploaded_role', 'created_at')}


def kill_switch_off(db):
    switch = db.execute("SELECT value FROM settings WHERE key='kill_switch'").fetchone()
    if not switch or switch['value'] != 'false':
        fail('KILL_SWITCH_ACTIVE', 'Passenger publishing is paused. Resume publishing first.')


def supersede_pending(db, case_id, who, topic=None):
    query = "SELECT id FROM passenger_updates WHERE case_id=? AND status='PENDING'"
    for row in db.execute(query + (' AND topic=?' if topic else ''), (case_id, topic) if topic else (case_id,)).fetchall():
        db.execute("UPDATE passenger_updates SET status='SUPERSEDED',version=version+1 WHERE id=?", (row['id'],))
        event(db, case_id, 'UPDATE_SUPERSEDED', who, {'update_id': row['id']})


def stop_work_orders(db, case_id, who, reason):
    rows = db.execute("SELECT id,number FROM work_orders WHERE case_id=? AND status IN ('SENT','RECEIVED','RESPONDED')", (case_id,)).fetchall()
    for row in rows:
        db.execute("UPDATE work_orders SET status='ABORTED',decided_at=?,decision_note=?,version=version+1 WHERE id=?", (now(), reason, row['id']))
        event(db, case_id, 'WORK_ORDER_ABORTED', who, {'summary': f'Work order v{row["number"]} stopped: {reason}', 'work_order_id': row['id']})


def invalidate_gate(db, case_id):
    if db.execute('SELECT public_gate FROM cases WHERE id=?', (case_id,)).fetchone()['public_gate']:
        db.execute('UPDATE cases SET public_gate=NULL,public_terminal=NULL WHERE id=?', (case_id,))
        db.execute("UPDATE passenger_updates SET invalidated_at=? WHERE case_id=? AND topic='flight_status' AND status='PUBLISHED' AND invalidated_at IS NULL", (now(), case_id))
        event(db, case_id, 'PUBLIC_GUIDANCE_INVALIDATED', {'id': 'system', 'role': 'system'}, {'topic': 'gate'})


def publish_feed(db, case_id, who, text, source_event_id):
    """OCC authorisation is the human review in v2: write a published update and notify passenger streams."""
    stamp = now()
    supersede_pending(db, case_id, who)
    uid = db.execute("INSERT INTO passenger_updates(case_id,source_event_id,topic,draft_text,final_text,status,reviewed_by,reviewed_at,published_at,created_at,version) VALUES(?,?,'flight_status',?,?,'PUBLISHED',?,?,?,?,2)",
                     (case_id, source_event_id, text, text, who['id'], stamp, stamp, stamp)).lastrowid
    event(db, case_id, 'UPDATE_PUBLISHED', who, {'summary': 'Passenger feed updated', 'update_id': uid})
    return uid


def hkt(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00')).astimezone(timezone(timedelta(hours=8))).strftime('%H:%M')


def passenger_text_zh(row):
    """Use explicitly reviewed Chinese text, or localise recognised v2 templates.

    Keep arbitrary CS text and user-authored content verbatim. Existing English
    publication history remains unchanged; this is an additional display field.
    """
    if 'final_text_zh' in row.keys() and row['final_text_zh']:
        return row['final_text_zh']
    text = row['final_text']
    if row['source_type'] == 'WORK_ORDER_AUTHORIZED':
        pending = re.fullmatch(r'Flight ((?:TW|UO)\d{2,4}) is delayed\. Departure time is awaiting confirmation\.(?: Gate (.+)\.)?', text)
        if pending:
            return f'航班 {pending[1]} 已延误，起飞时间待确认。' + (f'登机口：{pending[2]}。' if pending[2] else '')
        normal = re.fullmatch(r'Flight ((?:TW|UO)\d{2,4}) is on time\. Departure at (\d{2}:\d{2}) HKT\.(?: Gate (.+)\.)?',text)
        if normal: return f'航班 {normal[1]} 预计按计划运行，起飞时间为香港时间 {normal[2]}。'+(f'登机口：{normal[3]}。' if normal[3] else '')
        delayed = re.fullmatch(r'Flight ((?:TW|UO)\d{2,4}) is delayed\. New departure time (\d{2}:\d{2}) HKT\.(?: Gate (.+)\.)?', text)
        boarding = re.fullmatch(r'Flight ((?:TW|UO)\d{2,4}) is ready\. Boarding for departure at (\d{2}:\d{2}) HKT\.(?: Gate (.+)\.)?', text)
        match = delayed or boarding
        if match:
            flight, departure, gate = match.groups()
            translated = (f'航班 {flight} 已延误，新的起飞时间为香港时间 {departure}。' if delayed
                          else f'航班 {flight} 已准备登机，起飞时间为香港时间 {departure}。')
            return translated + (f'登机口：{gate}。' if gate else '')
    if row['source_type'] == 'FLIGHT_CANCELLED':
        match = re.fullmatch(r'Flight ((?:TW|UO)\d{2,4}) has been cancelled\. Please contact the airline desk for assistance\. \(Demo\.\)', text)
        if match:
            return f'航班 {match[1]} 已取消，请联系航空公司柜台寻求协助。（演示）'
    return None


def scope_case(db, case_id, actor):
    row = db.execute('SELECT * FROM cases WHERE id=?', (case_id,)).fetchone()
    if row is None or (actor['role'] in ('outport','care') and row['station'] != actor['station']):
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
    path = str(db_path or os.getenv('TWINOMATION_DB', ROOT / 'data' / 'demo-v2.sqlite3'))

    @asynccontextmanager
    async def lifespan(app):
        init_db(path, seed)
        async def scheduler():
            while True:
                try: await asyncio.to_thread(run_due,path)
                except Exception: logging.getLogger(__name__).exception('Local notification scheduler failed; retrying')
                await asyncio.sleep(2)
        task=asyncio.create_task(scheduler())
        try: yield
        finally:
            task.cancel()
            try: await task
            except asyncio.CancelledError: pass

    app = FastAPI(title='Twinomation local demo API', version='0.1.0', lifespan=lifespan, docs_url=None, openapi_url='/api/openapi.json', redoc_url=None)
    app.state.db_path = path
    files_dir = Path(path).parent / 'files'
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
            limit = FILE_LIMIT if request.method == 'POST' and UPLOAD_PATH.match(request.url.path) else 16384
            if not length.isdigit() or int(length) > limit:
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
        return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Twinomation API reference</title><style>body{font:15px system-ui;background:#f8f9f7;color:#293a2e;max-width:1000px;padding:40px 24px;margin:auto}h1{font-weight:500}article{background:white;border:1px solid #e1e8dc;border-radius:8px;padding:20px;margin:15px 0}h2{font-size:15px}pre{overflow:auto;font-size:12px}a{color:#265c4b}summary{cursor:pointer;color:#6c7e60}</style><h1>Twinomation API</h1><p>Local demo only. Staff endpoints require a simulated bearer session. Writes require X-Twinomation-Client: local-demo.</p><p>External email is disabled. <a href="/api/openapi.json">OpenAPI schema</a> · <a href="/">Workspaces</a></p>' + ''.join(sections) + '</html>'

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
        identity = {'id': f'demo.{body.role}' + (f'.{body.station}' if body.role in ('outport','care') else ''), 'role': body.role, 'station': body.station if body.role in ('outport','care') else None, 'expires': time.time() + 8 * 3600}
        app.state.sessions[token] = identity
        return {'token': token, 'identity': identity, 'mode': 'local-demo'}

    @app.delete('/api/session')
    def logout(authorization: str = Header(default=''), who=Depends(actor)):
        app.state.sessions.pop(authorization.removeprefix('Bearer '), None)
        return {'ok': True}

    from .station_services import install_station_services
    install_station_services(app,path,actor,require_role,fail,idempotent)
    install_extended(app,path,actor,require_role,scope_case,fail,idempotent,kill_switch_off)
    from .demo_scenarios import install_demo_scenarios
    install_demo_scenarios(app,path,actor,require_role,fail)

    @app.get('/api/stations')
    def stations(who=Depends(actor)):
        with connect(path) as db:
            result = []
            for station in STATIONS:
                if who['role'] in ('outport','care') and station['code'] != who['station']:
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
        if who['role'] in ('outport','care'):
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
                latest = db.execute('SELECT * FROM work_orders WHERE case_id=? ORDER BY number DESC LIMIT 1', (row['id'],)).fetchone()
                item['work_order'] = wo_json(latest) if latest else None
                item['last_collaboration_at']=db.execute('SELECT max(created_at) FROM staff_messages WHERE case_id=?',(row['id'],)).fetchone()[0]
                item['pending_tasks']=db.execute("SELECT count(*) FROM ground_tasks WHERE case_id=? AND status!='done'",(row['id'],)).fetchone()[0]
                item['boarding_recall_active']=bool(public_journey(db,row['id'])['recall'])
                item['file_count'] = db.execute('SELECT count(*) FROM case_files WHERE case_id=?', (row['id'],)).fetchone()[0]
                result.append(item)
            return result

    @app.post('/api/cases')
    def create_case(body: CaseInput, idempotency_key: str = Header(default=''), who=Depends(actor)):
        require_role(who, 'occ')
        with transaction(path) as db:
            def action():
                flight=body.flight_no or f"DEMO{db.execute('SELECT coalesce(max(id),0)+1 FROM cases').fetchone()[0]}"
                conditions = {key: {'status': 'PENDING', 'note': ''} for key in CONDITION_KEYS}
                stamp = now()
                cid = db.execute('''INSERT INTO cases(flight_no,flight_date,station,reason,readiness,conditions,original_departure,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)''', (flight, body.flight_date.isoformat(), body.station, body.reason, encode({'counters': [], 'gates': [], 'note': ''}), encode(conditions), body.original_departure.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z'), stamp, stamp)).lastrowid
                ensure_workspace(db,cid)
                if flight.startswith('UO'): db.execute("UPDATE cases SET operator='HK Express (demo)' WHERE id=?",(cid,))
                db.execute('UPDATE cases SET origin=?,destination=? WHERE id=?',('HKG' if body.direction=='outbound' else body.station,body.station if body.direction=='outbound' else 'HKG',cid))
                eid = event(db, cid, 'CASE_OPENED', who, {'summary': 'Cancellation coordination opened', 'snapshot': snapshot(db, cid)})
                draft(db, cid, eid, 'flight_status', f'Demo update: flight {flight} on {body.flight_date} has been cancelled. Further information will be published here after review.')
                return case_json(db.execute('SELECT * FROM cases WHERE id=?', (cid,)).fetchone()), 201
            return idempotent(db, who, 'POST', '/api/cases', idempotency_key, body.model_dump(mode='json'), action)

    @app.get('/api/cases/{case_id}')
    def case_detail(case_id: int, who=Depends(actor)):
        with connect(path) as db:
            result = case_json(scope_case(db, case_id, who))
            result['events'] = [{**dict(r), 'payload': json.loads(r['payload'])} for r in db.execute('SELECT * FROM case_events WHERE case_id=? ORDER BY id DESC LIMIT 200', (case_id,))]
            result['updates'] = [dict(r) for r in db.execute('SELECT u.*,e.type AS source_type FROM passenger_updates u LEFT JOIN case_events e ON e.id=u.source_event_id WHERE u.case_id=? ORDER BY u.id DESC LIMIT 200', (case_id,))]
            result['work_orders'] = [wo_json(r) for r in db.execute('SELECT * FROM work_orders WHERE case_id=? ORDER BY number DESC', (case_id,))]
            result['files'] = [file_json(r) for r in db.execute('SELECT * FROM case_files WHERE case_id=? ORDER BY id DESC LIMIT 100', (case_id,))]
            result['workspace']=workspace(db,case_id,who)
            result['block_minutes']=BLOCK_MINUTES[result['station']]
            result['destination_timezone']=next((s['timezone'] for s in STATIONS if s['code']==result['destination']),'Asia/Hong_Kong')
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
            stop_work_orders(db, case_id, who, 'Case closed')
            pending = db.execute("SELECT id FROM passenger_updates WHERE case_id=? AND status='PENDING'", (case_id,)).fetchall()
            for update in pending:
                db.execute("UPDATE passenger_updates SET status='SUPERSEDED',version=version+1 WHERE id=?", (update['id'],))
                event(db, case_id, 'UPDATE_SUPERSEDED', who, {'update_id': update['id']})
            db.execute("UPDATE cases SET status='CLOSED' WHERE id=?", (case_id,))
            db.execute("UPDATE passenger_dispatches SET status='CANCELLED' WHERE case_id=? AND status='QUEUED'",(case_id,))
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
            if who['role'] in ('outport','care'):
                clauses.append('c.station=?')
                args.append(who['station'])
            query = '''SELECT u.*,c.flight_no,c.station,c.status AS case_status,e.type AS source_type,e.payload AS source_payload FROM passenger_updates u JOIN cases c ON c.id=u.case_id LEFT JOIN case_events e ON e.id=u.source_event_id'''
            return [dict(r) for r in db.execute(query + (' WHERE ' + ' AND '.join(clauses) if clauses else '') + ' ORDER BY u.created_at,u.id LIMIT 200', args)]

    @app.post('/api/cases/{case_id}/events/{event_id}/passenger-notices', status_code=201)
    def publish_passenger_notice(case_id: int, event_id: int, body: PassengerNoticeInput, idempotency_key: str = Header(default=''), who=Depends(actor)):
        require_role(who, 'outport','care')
        if not (body.text_zh or body.text_en):
            body=body.model_copy(update={'text_zh':'感谢您的等候，请留意本页及机场广播的最新通知。','text_en':'Thank you for waiting. Please watch this page and airport announcements for updates.'})
        with transaction(path) as db:
            case = scope_case(db, case_id, who)
            source = db.execute('SELECT id FROM case_events WHERE id=? AND case_id=?', (event_id, case_id)).fetchone()
            if source is None:
                fail('NOT_FOUND', 'Timeline event not found.', 404)
            def action():
                kill_switch_off(db)
                if case['version'] != body.version:
                    fail('VERSION_CONFLICT', 'The case has changed. Refresh before continuing.')
                stamp = now()
                # A separately reviewed general notice preserves the source event and OCC's operational state.
                text = body.text_en or body.text_zh
                uid = db.execute("INSERT INTO passenger_updates(case_id,source_event_id,topic,draft_text,final_text,final_text_zh,status,reviewed_by,reviewed_at,published_at,created_at,version) VALUES(?,?,'general',?,?,?,'PUBLISHED',?,?,?,?,2)",
                                 (case_id, event_id, text, text, body.text_zh or None, who['id'], stamp, stamp, stamp)).lastrowid
                db.execute('DELETE FROM notice_drafts WHERE case_id=? AND text_zh=? AND text_en=?',(case_id,body.text_zh,body.text_en))
                bump(db, case_id)
                event(db, case_id, 'PASSENGER_NOTICE_PUBLISHED', who, {'summary':'Passenger notice published', 'source_event_id':event_id, 'update_id':uid, 'template':body.template})
                return {'id':uid, 'publication':'PUBLISHED'}, 201
            return idempotent(db, who, 'POST', f'/api/cases/{case_id}/events/{event_id}/passenger-notices', idempotency_key, body.model_dump(mode='json'), action)

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

    # ---------- v2: work orders ----------

    def scope_wo(db, wo_id, who):
        row = db.execute('SELECT * FROM work_orders WHERE id=?', (wo_id,)).fetchone()
        if row is None:
            fail('NOT_FOUND', 'Work order not found.', 404)
        case = scope_case(db, row['case_id'], who)
        if case['status'] != 'OPEN':
            fail('CASE_CLOSED', 'This case is closed.')
        return row, case

    def check_wo(row, version, *allowed):
        if row['status'] not in allowed:
            fail('INVALID_TRANSITION', f'Work order v{row["number"]} is {row["status"].lower()}.')
        if row['version'] != version:
            fail('VERSION_CONFLICT', 'The work order has changed. Refresh before continuing.')

    def send_work_order(db, case, who, items, note, proposed):
        if case['status'] != 'OPEN':
            fail('CASE_CLOSED', 'This case is closed.')
        if db.execute(f"SELECT 1 FROM work_orders WHERE case_id=? AND status IN ({','.join('?' * len(ACTIVE_WO))})", (case['id'], *ACTIVE_WO)).fetchone():
            fail('WORK_ORDER_ACTIVE', 'This flight already has an open work order.')
        number = db.execute('SELECT coalesce(max(number),0)+1 FROM work_orders WHERE case_id=?', (case['id'],)).fetchone()[0]
        wid = db.execute('INSERT INTO work_orders(case_id,number,status,items,note,proposed_departure,operator_checked,created_by,sent_at) VALUES(?,?,?,?,?,?,1,?,?)',
                         (case['id'], number, 'SENT', encode(items), note, proposed, who['id'], now())).lastrowid
        if proposed:
            db.execute('UPDATE cases SET proposed_departure=? WHERE id=?', (proposed, case['id']))
        bump(db, case['id'])
        op=operations(db,case['id']);op['recall']=None;op['recall_sent_for']=None;store_operations(db,case['id'],op)
        event(db, case['id'], 'WORK_ORDER_SENT', who, {'summary': f'Work order v{number} sent', 'work_order_id': wid})
        message(db,case['id'],who,f'Work order v{number}: '+note,'work_order')
        return wo_json(db.execute('SELECT * FROM work_orders WHERE id=?', (wid,)).fetchone())

    @app.post('/api/cases/{case_id}/work-orders', status_code=201)
    def create_work_order(case_id: int, body: WorkOrderInput, who=Depends(actor)):
        require_role(who, 'occ')
        if not body.operator_checked:
            fail('OPERATOR_CHECK_REQUIRED', 'Check the operator information before sending.', 422)
        with transaction(path) as db:
            case = scope_case(db, case_id, who)
            return send_work_order(db, case, who, preset_items(body.items), body.note, iso(body.proposed_departure) or case['proposed_departure'])

    @app.post('/api/work-orders/{wo_id}/receive')
    def receive_work_order(wo_id: int, body: VersionInput, who=Depends(actor)):
        require_role(who, 'outport')
        with transaction(path) as db:
            row, case = scope_wo(db, wo_id, who)
            check_wo(row, body.version, 'SENT')
            db.execute("UPDATE work_orders SET status='RECEIVED',received_at=?,version=version+1 WHERE id=?", (now(), wo_id))
            db.execute('UPDATE cases SET acknowledged=1 WHERE id=?', (case['id'],))
            bump(db, case['id'])
            event(db, case['id'], 'WORK_ORDER_RECEIVED', who, {'summary': f'Work order v{row["number"]} received', 'work_order_id': wo_id})
        return {'ok': True}

    @app.post('/api/work-orders/{wo_id}/respond')
    def respond_work_order(wo_id: int, body: RespondInput, who=Depends(actor)):
        require_role(who, 'outport')
        with transaction(path) as db:
            row, case = scope_wo(db, wo_id, who)
            check_wo(row, body.version, 'RECEIVED', 'RESPONDED')
            requested = {i['key']: i for i in json.loads(row['items']) if i['kind'] == 'preset'}
            replies, seen = [], set()
            for item in body.items:
                if item.key in seen:
                    fail('INVALID_ITEMS', 'Each item can appear once.', 422)
                seen.add(item.key)
                if item.kind == 'preset':
                    if item.key not in requested:
                        fail('INVALID_ITEMS', 'Preset items must match the work order.', 422)
                    options = list(PRESET_OPTIONS)
                    label = requested[item.key]['label']
                else:
                    if not item.key.startswith('custom-'):
                        fail('INVALID_ITEMS', 'Custom item keys start with custom-.', 422)
                    options, label = item.options, item.label
                if item.status not in options:
                    fail('INVALID_ITEMS', f'Choose one of the options for {label}.', 422)
                replies.append({'key': item.key, 'label': label, 'kind': item.kind, 'options': options, 'status': item.status, 'note': item.note})
            if set(requested) - seen:
                fail('INVALID_ITEMS', 'Answer every requested item.', 422)
            previous = db.execute("SELECT items FROM work_orders WHERE case_id=? AND status='AUTHORIZED' ORDER BY number DESC LIMIT 1", (case['id'],)).fetchone()
            if previous:
                gate = lambda items: next(((i.get('status'), i.get('note', '')) for i in items if i['key'] == 'gate'), None)
                if gate(json.loads(previous['items'])) != gate(replies):
                    invalidate_gate(db, case['id'])
            db.execute("UPDATE work_orders SET status='RESPONDED',items=?,response_note=?,responded_at=?,version=version+1 WHERE id=?", (encode(replies), body.note, now(), wo_id))
            bump(db, case['id'])
            event(db, case['id'], 'WORK_ORDER_RESPONDED', who, {'summary': f'Reply to v{row["number"]} sent to OCC', 'work_order_id': wo_id})
            message(db,case['id'],who,f'Work order v{row["number"]} replied. '+body.note,'work_order')
        return {'ok': True}

    @app.post('/api/work-orders/{wo_id}/authorize')
    def authorize_work_order(wo_id: int, body: AuthorizeInput, who=Depends(actor)):
        require_role(who, 'occ')
        if body.flight_status == 'DELAYED' and not body.cause:
            fail('CAUSE_REQUIRED', 'Choose a delay reason for passengers.', 422)
        if body.flight_status in ('BOARDING','ON_TIME') and not body.departure:
            fail('DEPARTURE_REQUIRED', 'Confirm a departure time before publishing boarding.', 422)
        with transaction(path) as db:
            row, case = scope_wo(db, wo_id, who)
            check_wo(row, body.version, 'RESPONDED')
            kill_switch_off(db)
            items = json.loads(row['items'])
            if any(i['kind'] == 'preset' and i.get('status') != 'Ready' for i in items):
                fail('RESOURCES_NOT_READY', 'Resources are not ready. Reissue the work order for confirmation.', 409)
            if any(i['kind'] == 'custom' for i in items) and not body.custom_items_reviewed:
                fail('CUSTOM_REVIEW_REQUIRED', 'Confirm custom item readiness before publishing.', 422)
            departure = iso(body.departure)
            db.execute("UPDATE work_orders SET status='AUTHORIZED',decided_at=?,version=version+1 WHERE id=?", (now(), wo_id))
            db.execute('UPDATE cases SET flight_status=?,public_departure=?,delay_cause=?,public_gate=?,public_terminal=? WHERE id=?',
                       (body.flight_status, departure, body.cause if body.flight_status == 'DELAYED' else None, body.gate or None, body.terminal or None,case['id']))
            bump(db, case['id'])
            source = event(db, case['id'], 'WORK_ORDER_AUTHORIZED', who, {'summary': f'v{row["number"]} authorised and published', 'work_order_id': wo_id, 'custom_items_reviewed': body.custom_items_reviewed})
            gate = f' Gate {body.gate}.' if body.gate else ''
            text = (f'Flight {case["flight_no"]} is on time. Departure at {hkt(departure)} HKT.{gate}' if body.flight_status=='ON_TIME'
                    else f'Flight {case["flight_no"]} is ready. Boarding for departure at {hkt(departure)} HKT.{gate}' if body.flight_status == 'BOARDING'
                    else f'Flight {case["flight_no"]} is delayed. New departure time {hkt(departure)} HKT.{gate}' if departure
                    else f'Flight {case["flight_no"]} is delayed. Departure time is awaiting confirmation.{gate}')
            publish_feed(db, case['id'], who, text, source)
        return {'ok': True}

    @app.post('/api/work-orders/{wo_id}/reissue', status_code=201)
    def reissue_work_order(wo_id: int, body: ReissueInput, who=Depends(actor)):
        require_role(who, 'occ')
        with transaction(path) as db:
            row, case = scope_wo(db, wo_id, who)
            check_wo(row, body.version, 'RESPONDED', 'RECEIVED', 'SENT')
            db.execute("UPDATE work_orders SET status='REISSUED',decided_at=?,decision_note=?,version=version+1 WHERE id=?", (now(), body.note, wo_id))
            event(db, case['id'], 'WORK_ORDER_REISSUED', who, {'summary': f'v{row["number"]} replaced by a new version', 'work_order_id': wo_id})
            # Carry the previous answer so the station sees what changed; statuses must be confirmed again.
            items = [{**i, 'previous': i.get('status'), 'status': None} for i in json.loads(row['items'])]
            case = db.execute('SELECT * FROM cases WHERE id=?', (case['id'],)).fetchone()
            return send_work_order(db, case, who, items, body.note, iso(body.proposed_departure) or row['proposed_departure'])

    @app.post('/api/work-orders/{wo_id}/abort')
    def abort_work_order(wo_id: int, body: AbortInput, who=Depends(actor)):
        require_role(who, 'occ')
        with transaction(path) as db:
            row, case = scope_wo(db, wo_id, who)
            check_wo(row, body.version, *ACTIVE_WO)
            db.execute("UPDATE work_orders SET status='ABORTED',decided_at=?,decision_note=?,version=version+1 WHERE id=?", (now(), body.reason, wo_id))
            bump(db, case['id'])
            event(db, case['id'], 'WORK_ORDER_ABORTED', who, {'summary': f'Work order v{row["number"]} stopped: {body.reason}', 'work_order_id': wo_id})
        return {'ok': True}

    @app.post('/api/cases/{case_id}/cancel-flight')
    def cancel_flight(case_id: int, body: CancelFlightInput, who=Depends(actor)):
        require_role(who, 'occ')
        with transaction(path) as db:
            case = scope_case(db, case_id, who)
            check_open(case, body.version)
            kill_switch_off(db)
            stop_work_orders(db, case_id, who, 'Flight cancelled')
            db.execute("UPDATE passenger_dispatches SET status='CANCELLED' WHERE case_id=? AND status='QUEUED'",(case_id,))
            db.execute("UPDATE case_operations SET data=json_set(data,'$.recall',NULL,'$.stage',''),version=version+1 WHERE case_id=?",(case_id,))
            supersede_pending(db, case_id, who)
            invalidate_gate(db, case_id)
            db.execute("UPDATE passenger_updates SET invalidated_at=? WHERE case_id=? AND topic IN ('gate','counter') AND status='PUBLISHED' AND invalidated_at IS NULL", (now(), case_id))
            db.execute("UPDATE cases SET flight_status='CANCELLED',delay_cause=?,status='CLOSED',public_gate=NULL,public_terminal=NULL,public_departure=NULL WHERE id=?", (body.cause, case_id))
            bump(db, case_id)
            source = event(db, case_id, 'FLIGHT_CANCELLED', who, {'summary': 'Flight cancelled', 'snapshot': snapshot(db, case_id)})
            publish_feed(db, case_id, who, f'Flight {case["flight_no"]} has been cancelled. Please contact the airline desk for assistance. (Demo.)', source)
        return {'ok': True}

    # ---------- v2: file transfer ----------

    @app.post('/api/cases/{case_id}/files', status_code=201)
    async def upload_file(case_id: int, request: Request, name: str, work_order_id: int | None = None, who=Depends(actor)):
        require_role(who, 'occ', 'outport')
        clean = Path(name.replace('\\', '/')).name.strip()
        ext = clean.rsplit('.', 1)[-1].lower() if '.' in clean else ''
        if not clean or len(clean) > 120 or any(ord(c) < 32 for c in clean) or ext not in FILE_TYPES:
            fail('FILE_TYPE', 'Upload PDF, Word, Excel, PowerPoint, text or image files.', 422)
        data = await request.body()
        if not data or len(data) > FILE_LIMIT:
            fail('FILE_SIZE', 'Files must be between 1 byte and 5 MB.', 413)
        stored = secrets.token_hex(16)
        with transaction(path) as db:
            case = scope_case(db, case_id, who)
            if work_order_id is not None and not db.execute('SELECT 1 FROM work_orders WHERE id=? AND case_id=?', (work_order_id, case_id)).fetchone():
                fail('NOT_FOUND', 'Work order not found.', 404)
            files_dir.mkdir(parents=True, exist_ok=True)
            (files_dir / stored).write_bytes(data)
            fid = db.execute('INSERT INTO case_files(case_id,work_order_id,name,mime,size,sha256,stored_name,uploaded_by,uploaded_role,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
                             (case_id, work_order_id, clean, FILE_TYPES[ext], len(data), hashlib.sha256(data).hexdigest(), stored, who['id'], who['role'], now())).lastrowid
            event(db, case['id'], 'FILE_SHARED', who, {'summary': f'File shared: {clean}', 'file_id': fid})
            return file_json(db.execute('SELECT * FROM case_files WHERE id=?', (fid,)).fetchone())

    @app.get('/api/files/{file_id}')
    def download_file(file_id: int, who=Depends(actor)):
        require_role(who, 'occ', 'outport')
        with connect(path) as db:
            row = db.execute('SELECT * FROM case_files WHERE id=?', (file_id,)).fetchone()
            if row is None:
                fail('NOT_FOUND', 'File not found.', 404)
            scope_case(db, row['case_id'], who)
        target = files_dir / row['stored_name']
        if not target.is_file():
            fail('NOT_FOUND', 'File not found.', 404)
        return FileResponse(target, media_type=row['mime'], filename=row['name'], content_disposition_type='attachment')

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
            # One live link per case and passenger type (direct, or connecting to a given city).
            db.execute('UPDATE passengers SET token_revoked_at=? WHERE case_id=? AND coalesce(connection,\'\')=? AND token_revoked_at IS NULL', (now(), body.case_id, body.connection or ''))
            db.execute('INSERT INTO passengers(case_id,token_hash,token_expires_at,connection) VALUES(?,?,?,?)', (body.case_id, hashlib.sha256(token.encode()).hexdigest(), expires, body.connection))
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

    def passenger_payload(db, person):
        case = db.execute('SELECT * FROM cases WHERE id=?', (person['case_id'],)).fetchone()
        row = {k: case[k] for k in ('flight_no', 'flight_date', 'station', 'origin','destination')}
        published = [{'id': r['id'], 'topic': r['topic'], 'text': r['final_text'], 'text_zh': passenger_text_zh(r), 'published_at': r['published_at'], 'invalidated': bool(r['invalidated_at']), 'corrects_id': r['corrects_id']} for r in db.execute("SELECT u.*,e.type AS source_type FROM passenger_updates u LEFT JOIN case_events e ON e.id=u.source_event_id WHERE u.case_id=? AND u.status='PUBLISHED' ORDER BY u.published_at DESC,u.id DESC LIMIT 200", (person['case_id'],))]
        current = {}
        for update in published:
            if update['topic'] != 'general' and update['topic'] not in current:
                current[update['topic']] = update
        # Only facts OCC has authorised reach passengers: status, public time, gate and cause are set at authorisation.
        published_status = case['flight_status'] if case['flight_status'] in ('DELAYED', 'BOARDING', 'ON_TIME','CANCELLED') else 'AWAITING'
        status = {'status': published_status, 'scheduled': case['original_departure'], 'departure': case['public_departure'],
                  'cause': case['delay_cause'] if published_status != 'AWAITING' else None, 'gate': case['public_gate'],'terminal':case['public_terminal'],
                  'airport': 'Hong Kong International Airport' if case['origin']=='HKG' else next(s['airport'] for s in STATIONS if s['code'] == case['station']), 'block_minutes': BLOCK_MINUTES[case['station']]}
        connection = None
        if person['connection'] and case['destination']=='HKG':
            code = person['connection']
            day = datetime.fromisoformat(case['original_departure'].replace('Z', '+00:00'))
            first = day.replace(hour=4, minute=0, second=0, microsecond=0)  # 12:00 HKT
            offset = sum(map(ord, code)) % 50
            flights = [{'flight_no': f'TW{800 + i * 7 + offset % 7}', 'departure': iso(first + timedelta(minutes=offset + i * 105))} for i in range(7)]
            connection = {'destination': code, 'city': CONNECTIONS[code], 'booked': flights[1]['flight_no'], 'min_connection_minutes': 60, 'flights': flights}
        return {'flight': row, 'status': status, 'connection': connection, 'current': current, 'timeline': published, 'journey':public_journey(db,case['id']), 'demo': True}


    @app.get('/api/passenger/{token}/network-connections')
    def private_network(token:str):
        from .demo_scenarios import network_public
        with connect(path) as db: return network_public(db,passenger_record(db,token)['case_id'])

    @app.get('/api/passenger/{token}')
    def passenger_get(token: str):
        with connect(path) as db:
            return passenger_payload(db, passenger_record(db, token))

    # Always-available local demo previews share the published-only passenger model.
    # Unlike private links, these have stable case URLs and never issue/revoke tokens.
    def preview_record(db, case_id, connection=None):
        if connection is not None and connection not in CONNECTIONS:
            fail('VALIDATION_ERROR', 'Unknown connection.', 422)
        if not db.execute('SELECT 1 FROM cases WHERE id=?', (case_id,)).fetchone():
            fail('NOT_FOUND', 'Flight not found.', 404)
        return {'case_id': case_id, 'connection': connection}

    @app.get('/api/demo/passenger/cases')
    def preview_cases():
        with connect(path) as db:
            return [dict(row) for row in db.execute('SELECT id,flight_no,flight_date,station,origin,destination FROM cases ORDER BY id LIMIT 100')]

    @app.get('/api/demo/passenger/{case_id}')
    def preview_passenger(case_id: int, connection: str | None = None):
        with connect(path) as db:
            return passenger_payload(db, preview_record(db, case_id, connection))

    async def stream(request, who=None, token=None, session_token=None, preview_case_id=None):
        ip = request.client.host
        if app.state.streams[ip] >= 4:
            fail('STREAM_LIMIT', 'Live view limit reached. This page can still refresh normally.', 429)
        # Validate before returning StreamingResponse so invalid links return a real 404.
        with connect(path) as db:
            if token:
                passenger_record(db, token)
            elif preview_case_id is not None:
                preview_record(db, preview_case_id)
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
                            case_id = (passenger_record(db, token)['case_id'] if token else
                                       preview_record(db, preview_case_id)['case_id'] if preview_case_id is not None else None)
                            rows = db.execute('SELECT e.id,e.case_id,e.type,e.payload,c.station,c.origin FROM case_events e LEFT JOIN cases c ON c.id=e.case_id WHERE e.id>? ORDER BY e.id LIMIT 100', (cursor,)).fetchall()
                            for row in rows:
                                cursor = row['id']
                                if token or preview_case_id is not None:
                                    accept = (row['case_id'] == case_id or row['origin']=='HKG') and row['type'] in ('UPDATE_PUBLISHED', 'PUBLIC_GUIDANCE_INVALIDATED', 'PASSENGER_NOTICE_PUBLISHED')
                                else:
                                    accept = who['role'] not in ('outport','care') or row['case_id'] is None or row['station'] == who['station']
                                    if who['role'] in ('outport','care') and row['type'] in ('BROADCAST_SENT','BROADCAST_ACKNOWLEDGED','WEATHER_BRIEFING_UPDATED'):
                                        payload=json.loads(row['payload'])
                                        accept=who['station'] in payload.get('recipients',[]) or payload.get('station')==who['station']
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

    @app.get('/api/demo/passenger/{case_id}/stream')
    async def preview_stream(case_id: int, request: Request):
        return await stream(request, preview_case_id=case_id)

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
