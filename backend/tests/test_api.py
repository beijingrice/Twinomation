import hashlib
import json
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient

from backend.db import CONDITION_KEYS, connect, transaction
from backend.main import create_app


@pytest.fixture
def env(tmp_path):
    app = create_app(tmp_path / 'demo.db')
    with TestClient(app, headers={'X-Twinomation-Client': 'local-demo'}) as client:
        def login(role, station='KIX'):
            response = client.post('/api/session', json={'role': role, 'station': station})
            assert response.status_code == 200
            return {'Authorization': 'Bearer ' + response.json()['token']}
        yield client, app, login


def create_case(client, occ, key='create-case'):
    body = {'flight_no': 'TW999', 'station': 'KIX', 'flight_date': '2026-11-15', 'reason': 'Synthetic test disruption', 'original_departure': '2026-11-15T10:00:00+08:00'}
    response = client.post('/api/cases', headers={**occ, 'Idempotency-Key': key}, json=body)
    assert response.status_code == 201, response.text
    return response.json(), body


def pending(client, cs, case_id):
    return client.get(f'/api/updates?case_id={case_id}&status=PENDING', headers=cs).json()


def enable(client, occ):
    state = client.get('/api/kill-switch', headers=occ).json()
    return client.put('/api/kill-switch', headers=occ, json={'active': False, 'version': state['version']})


def publish(client, cs, update, key='publish', **body):
    return client.post(f'/api/updates/{update["id"]}/publish', headers={**cs, 'Idempotency-Key': key}, json={'version': update['version'], **body})


def readiness(version, gate='18', counters=None):
    return {'version': version, 'gates': [gate] if gate else [], 'counters': counters or [], 'note': 'Internal note that must not leak', 'conditions': {k: {'status': 'CONFIRMED' if k == 'gate' and gate else 'PENDING', 'note': ''} for k in CONDITION_KEYS}}


def link(client, occ, case_id):
    response = client.post('/api/demo/passenger-link', headers=occ, json={'case_id': case_id})
    assert response.status_code == 200
    return response.json()['path'].split('#')[1]


@pytest.mark.parametrize('path', ['/api/cases', '/api/cases/1', '/api/stations', '/api/updates', '/api/stream', '/api/kill-switch'])
def test_employee_routes_require_identity(env, path):
    client, _, _ = env
    response = client.get(path, headers={'X-Role': 'occ'})
    assert response.status_code == 401


def test_local_mode_rejects_remote_clients_and_foreign_origins(env):
    client, app, _ = env
    response = client.post('/api/session', json={'role': 'occ'}, headers={'Origin': 'https://example.invalid'})
    assert response.status_code == 403
    with TestClient(app, client=('10.0.0.50', 1234)) as remote:
        assert remote.get('/api/health').status_code == 403
    assert client.get('/api/health', headers={'Host': 'untrusted.invalid'}).status_code == 400


def test_station_scoping_applies_to_lists_details_writes_and_updates(env):
    client, _, login = env
    outport = login('outport', 'NRT')
    assert {c['station'] for c in client.get('/api/cases', headers=outport).json()} == {'NRT'}
    assert {s['code'] for s in client.get('/api/stations', headers=outport).json()} == {'NRT'}
    assert {u['station'] for u in client.get('/api/updates', headers=outport).json()} <= {'NRT'}
    assert client.get('/api/cases/1', headers=outport).status_code == 404
    assert client.get('/api/cases?station=KIX', headers=outport).status_code == 404
    assert client.put('/api/cases/1/readiness', headers=outport, json=readiness(1)).status_code == 404
    assert client.get('/api/updates?case_id=1', headers=outport).status_code == 404


def test_occ_and_outport_cannot_publish(env):
    client, _, login = env
    for role in ('occ', 'outport'):
        response = client.post('/api/updates/2/publish', headers=login(role), json={'version': 1})
        assert response.status_code == 403


def test_create_idempotency_and_conflicting_reuse(env):
    client, app, login = env
    occ = login('occ')
    case, body = create_case(client, occ)
    response = client.post('/api/cases', headers={**occ, 'Idempotency-Key': 'create-case'}, json=body)
    assert response.status_code == 201 and response.json()['id'] == case['id']
    response = client.post('/api/cases', headers={**occ, 'Idempotency-Key': 'create-case'}, json={**body, 'reason': 'Changed reason'})
    assert response.status_code == 409
    assert response.json()['error']['code'] == 'IDEMPOTENCY_CONFLICT'
    with connect(app.state.db_path) as db:
        assert db.execute('SELECT count(*) FROM cases WHERE id=?', (case['id'],)).fetchone()[0] == 1
        assert db.execute("SELECT count(*) FROM case_events WHERE case_id=? AND type='CASE_OPENED'", (case['id'],)).fetchone()[0] == 1


def test_passenger_sees_no_internal_data_before_review(env):
    client, _, login = env
    occ = login('occ')
    case, _ = create_case(client, occ)
    token = link(client, occ, case['id'])
    response = client.get('/api/passenger/' + token)
    assert response.status_code == 200
    assert response.headers['cache-control'] == 'no-store'
    assert response.headers['referrer-policy'] == 'no-referrer'
    data = response.json()
    assert set(data) == {'flight', 'current', 'timeline', 'demo'}
    assert set(data['flight']) == {'flight_no', 'flight_date', 'station', 'destination'}
    assert data['current'] == {} and data['timeline'] == []
    assert all(word not in response.text for word in ('cancelled', 'readiness', 'reason', 'actor', 'draft_text'))


def test_link_hashing_revocation_and_expiry(env):
    client, app, login = env
    occ = login('occ')
    first = link(client, occ, 1)
    second = link(client, occ, 1)
    assert client.get('/api/passenger/' + first).status_code == 404
    assert client.get('/api/passenger/' + second).status_code == 200
    with transaction(app.state.db_path) as db:
        saved = db.execute('SELECT token_hash FROM passengers WHERE token_revoked_at IS NULL').fetchone()[0]
        assert saved == hashlib.sha256(second.encode()).hexdigest() and saved != second
        db.execute("UPDATE passengers SET token_expires_at='2000-01-01T00:00:00+00:00'")
    assert client.get('/api/passenger/' + second).status_code == 404
    assert client.get('/api/passenger/' + second + '/stream').status_code == 404
    assert client.get('/api/passenger/not-a-valid-token').status_code == 404


def test_kill_switch_fail_closed_versioned_and_scoped(env):
    client, app, login = env
    occ, cs, outport = login('occ'), login('cs'), login('outport')
    draft = pending(client, cs, 2)[0]
    assert publish(client, cs, draft).json()['error']['code'] == 'KILL_SWITCH_ACTIVE'
    assert client.put('/api/kill-switch', headers=outport, json={'active': False, 'version': 1}).status_code == 403
    assert enable(client, occ).status_code == 200
    assert client.put('/api/kill-switch', headers=occ, json={'active': True, 'version': 1}).status_code == 409
    with transaction(app.state.db_path) as db:
        db.execute("DELETE FROM settings WHERE key='kill_switch'")
    assert publish(client, cs, draft, key='missing-switch').json()['error']['code'] == 'KILL_SWITCH_ACTIVE'


def test_publication_exact_content_idempotency_and_email_disabled(env):
    client, app, login = env
    occ, cs = login('occ'), login('cs')
    case, _ = create_case(client, occ)
    token = link(client, occ, case['id'])
    enable(client, occ)
    update = pending(client, cs, case['id'])[0]
    assert publish(client, cs, update, key='email', send_email=True).status_code == 422
    assert pending(client, cs, case['id'])[0]['status'] == 'PENDING'
    text = 'Demo: a reviewed message. <script>ordinary text</script>'
    assert publish(client, cs, update, final_text=text).status_code == 200
    assert publish(client, cs, update, final_text=text).status_code == 200
    assert publish(client, cs, update, final_text='different').status_code == 409
    assert publish(client, cs, update, key='second-click').status_code == 409
    data = client.get('/api/passenger/' + token).json()
    assert len(data['timeline']) == 1 and data['timeline'][0]['text'] == text
    assert 'reviewed_by' not in json.dumps(data)
    with connect(app.state.db_path) as db:
        assert db.execute("SELECT count(*) FROM case_events WHERE case_id=? AND type='UPDATE_PUBLISHED'", (case['id'],)).fetchone()[0] == 1


def test_supersede_stale_publish_and_public_guidance_invalidation(env):
    client, _, login = env
    occ, cs, outport = login('occ'), login('cs'), login('outport')
    case, _ = create_case(client, occ)
    cid = case['id']
    token = link(client, occ, cid)
    enable(client, occ)
    assert client.put(f'/api/cases/{cid}/readiness', headers=outport, json=readiness(1, '15')).status_code == 200
    old = next(u for u in pending(client, cs, cid) if u['topic'] == 'gate')
    assert client.put(f'/api/cases/{cid}/readiness', headers=outport, json=readiness(2, '18')).status_code == 200
    assert publish(client, cs, old, key='stale').status_code == 409
    latest = next(u for u in pending(client, cs, cid) if u['topic'] == 'gate')
    assert '18' in latest['draft_text']
    assert publish(client, cs, latest, key='current').status_code == 200
    assert client.get('/api/passenger/' + token).json()['current']['gate']['invalidated'] is False
    # The stop control does not prevent a stale instruction being marked invalid.
    switch = client.get('/api/kill-switch', headers=occ).json()
    client.put('/api/kill-switch', headers=occ, json={'active': True, 'version': switch['version']})
    assert client.put(f'/api/cases/{cid}/readiness', headers=outport, json=readiness(3, '20')).status_code == 200
    public = client.get('/api/passenger/' + token).json()
    assert public['current']['gate']['invalidated'] is True
    assert '20' not in public['current']['gate']['text']
    assert 'Internal note' not in json.dumps(public)


def test_readiness_validation_and_version_conflicts(env):
    client, _, login = env
    occ, outport = login('occ'), login('outport')
    case, _ = create_case(client, occ)
    cid = case['id']
    invalid = readiness(1, '')
    invalid['conditions']['gate']['status'] = 'CONFIRMED'
    assert client.put(f'/api/cases/{cid}/readiness', headers=outport, json=invalid).status_code == 422
    assert client.put(f'/api/cases/{cid}/readiness', headers=outport, json=readiness(1)).status_code == 200
    assert client.put(f'/api/cases/{cid}/readiness', headers=outport, json=readiness(1, '19')).status_code == 409
    oversized = readiness(2)
    oversized['gates'] = ['x' * 30]
    assert client.put(f'/api/cases/{cid}/readiness', headers=outport, json=oversized).status_code == 422
    assert client.get(f'/api/cases/{cid}', headers=occ).json()['readiness']['gates'] == ['18']


def test_note_rejection_and_closing_exception(env):
    client, _, login = env
    occ, cs, outport = login('occ'), login('cs'), login('outport')
    case, _ = create_case(client, occ)
    cid = case['id']
    token = link(client, occ, cid)
    enable(client, occ)
    assert client.post(f'/api/cases/{cid}/notes', headers=outport, json={'version': 1, 'text': 'Internal only - do not disclose', 'suggest_for_passengers': True}).status_code == 200
    note = next(u for u in pending(client, cs, cid) if u['topic'] == 'general')
    assert client.post(f'/api/updates/{note["id"]}/reject', headers=cs, json={'version': note['version'], 'review_note': 'Internal'}).status_code == 200
    assert 'Internal only' not in client.get('/api/passenger/' + token).text
    assert client.post(f'/api/cases/{cid}/close', headers=occ, json={'version': 2}).status_code == 200
    remaining = pending(client, cs, cid)
    assert len(remaining) == 1 and remaining[0]['source_type'] == 'CASE_CLOSED'
    assert client.put(f'/api/cases/{cid}/readiness', headers=outport, json=readiness(3)).json()['error']['code'] == 'CASE_CLOSED'
    assert publish(client, cs, remaining[0], key='close-notice').status_code == 200
    text = client.get('/api/passenger/' + token).json()['timeline'][0]['text']
    assert 'internal coordination case' in text and 'arrangements are complete' not in text


def test_parallel_publication_commits_only_once(env):
    client, app, login = env
    occ, cs = login('occ'), login('cs')
    case, _ = create_case(client, occ)
    enable(client, occ)
    update = pending(client, cs, case['id'])[0]
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda key: publish(client, cs, update, key=key).status_code, ['race-1', 'race-2']))
    assert sorted(results) == [200, 409]
    with connect(app.state.db_path) as db:
        assert db.execute("SELECT count(*) FROM case_events WHERE case_id=? AND type='UPDATE_PUBLISHED'", (case['id'],)).fetchone()[0] == 1


def test_schedule_is_internal_and_snapshot_is_recorded(env):
    client, _, login = env
    occ, cs = login('occ'), login('cs')
    case, _ = create_case(client, occ)
    cid = case['id']
    token = link(client, occ, cid)
    body = {'version': 1, 'proposed_departure': '2026-11-15T19:35:00+08:00', 'note': 'Awaiting resource confirmation'}
    assert client.put(f'/api/cases/{cid}/schedule', headers=cs, json=body).status_code == 403
    assert client.put(f'/api/cases/{cid}/schedule', headers=occ, json=body).status_code == 200
    assert '19:35' not in client.get('/api/passenger/' + token).text
    detail = client.get(f'/api/cases/{cid}', headers=occ).json()
    assert detail['version'] == 2
    assert any(e['payload'].get('snapshot', {}).get('version') == 2 for e in detail['events'])


def test_input_errors_do_not_echo_secrets_and_unknown_api_is_404(env):
    client, _, login = env
    occ = login('occ')
    response = client.post('/api/cases', headers=occ, json={'secret': 'do-not-reflect-me'})
    assert response.status_code == 422 and 'do-not-reflect-me' not in response.text
    assert client.get('/api/does-not-exist').status_code == 404
    assert client.post('/api/session', json={'role': 'admin'}).status_code == 422


def test_api_reference_is_self_contained_and_seed_history_has_snapshot(env):
    client, _, login = env
    reference = client.get('/api/docs')
    assert reference.status_code == 200
    assert '<script src=' not in reference.text and 'cdn.' not in reference.text
    assert 'PUT /api/cases/{case_id}/schedule' in reference.text
    detail = client.get('/api/cases/3', headers=login('occ')).json()
    assert any(e['payload'].get('snapshot', {}).get('version') == 1 for e in detail['events'])


def test_logged_out_identity_cannot_replay_idempotent_response(env):
    client, _, login = env
    occ = login('occ')
    _, body = create_case(client, occ)
    assert client.request('DELETE', '/api/session', headers=occ, json={}).status_code == 200
    response = client.post('/api/cases', headers={**occ, 'Idempotency-Key': 'create-case'}, json=body)
    assert response.status_code == 401


def test_sse_limit_preserves_normal_requests(env):
    client, app, login = env
    occ = login('occ')
    token = link(client, occ, 1)
    app.state.streams['testclient'] = 4
    assert client.get('/api/stream', headers=occ).status_code == 429
    assert client.get(f'/api/passenger/{token}/stream').status_code == 429
    assert client.get('/api/cases', headers=occ).status_code == 200
    assert client.get(f'/api/passenger/{token}').status_code == 200
