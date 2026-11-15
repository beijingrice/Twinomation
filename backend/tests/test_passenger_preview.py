"""Always-available local passenger previews remain read-only and published-only."""
import pytest
from fastapi.testclient import TestClient

from backend.db import connect, transaction
from backend.main import create_app


@pytest.fixture
def env(tmp_path):
    app = create_app(tmp_path / 'preview.db')
    with TestClient(app, headers={'X-Twinomation-Client':'local-demo'}) as client:
        yield app, client


def occ(client):
    response = client.post('/api/session', json={'role':'occ','station':'KIX'})
    return {'Authorization':'Bearer ' + response.json()['token']}


def test_preview_is_available_without_session_or_token_and_never_issues_credentials(env):
    app, client = env
    with connect(app.state.db_path) as db:
        event_count = db.execute('SELECT count(*) FROM case_events').fetchone()[0]
    choices = client.get('/api/demo/passenger/cases').json()
    assert len(choices) == 10
    assert set(choices[0]) == {'id','flight_no','flight_date','station','origin','destination'}
    for _ in range(3):
        response = client.get('/api/demo/passenger/1')
        assert response.status_code == 200
        assert response.headers['cache-control'] == 'no-store'
        payload = response.json()
        assert payload['status']['status'] == 'AWAITING'
        assert payload['status']['departure'] is None and payload['status']['gate'] is None
        assert payload['current'] == {} and payload['timeline'] == []
        assert not any(key in response.text for key in ('draft_text','readiness','response_note','token_hash','actor_id'))
    with connect(app.state.db_path) as db:
        assert db.execute('SELECT count(*) FROM passengers').fetchone()[0] == 0
        assert db.execute('SELECT count(*) FROM case_events').fetchone()[0] == event_count


def test_same_preview_url_receives_publication_and_survives_server_restart(env):
    app, client = env
    url = '/api/demo/passenger/1'
    assert client.get(url).json()['status']['status'] == 'AWAITING'
    headers = occ(client)
    switch = client.get('/api/kill-switch', headers=headers).json()
    client.put('/api/kill-switch', headers=headers, json={'version':switch['version'],'active':False})
    order = client.get('/api/cases/1', headers=headers).json()['work_orders'][0]
    response = client.post(f'/api/work-orders/{order["id"]}/authorize', headers=headers, json={
        'version':order['version'], 'flight_status':'DELAYED', 'departure':'2026-11-15T12:30:00+08:00', 'cause':'WEATHER', 'gate':'18'})
    assert response.status_code == 200
    published = client.get(url).json()
    assert published['status']['status'] == 'DELAYED' and published['status']['gate'] == '18'
    assert len(published['timeline']) == 1
    with TestClient(create_app(app.state.db_path)) as restarted:
        assert restarted.get(url).json() == published


def test_connecting_preview_is_independent_of_expiring_legacy_links(env):
    app, client = env
    headers = occ(client)
    old = client.post('/api/demo/passenger-link', headers=headers, json={'case_id':1}).json()['path'].split('#')[1]
    with transaction(app.state.db_path) as db:
        db.execute("UPDATE passengers SET token_expires_at='2000-01-01T00:00:00+00:00'")
    assert client.get('/api/passenger/' + old).status_code == 404
    for _ in range(2):
        direct = client.get('/api/demo/passenger/1').json()
        connecting = client.get('/api/demo/passenger/1?connection=LHR').json()
        assert direct['connection'] is None
        assert connecting['connection']['destination'] == 'LHR'
        assert len(connecting['connection']['flights']) == 7
    with connect(app.state.db_path) as db:
        assert db.execute('SELECT count(*) FROM passengers').fetchone()[0] == 1
        assert db.execute('SELECT token_revoked_at FROM passengers').fetchone()[0] is None


def test_preview_validation_and_stream_limit_preserve_published_only_access(env):
    app, client = env
    assert client.get('/api/demo/passenger/99999').status_code == 404
    assert client.get('/api/demo/passenger/99999/stream').status_code == 404
    assert client.get('/api/demo/passenger/1?connection=XXX').status_code == 422
    assert client.get('/api/cases/1').status_code == 401
    app.state.streams['testclient'] = 4
    assert client.get('/api/demo/passenger/1/stream').status_code == 429
    assert client.get('/api/demo/passenger/1').status_code == 200
