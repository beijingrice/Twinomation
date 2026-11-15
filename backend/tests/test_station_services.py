import pytest
from fastapi.testclient import TestClient

from backend.db import connect
from backend.main import create_app
from backend.weather_briefings import parse_briefing, sample_briefing


@pytest.fixture
def env(tmp_path):
    app=create_app(tmp_path/'services.db')
    with TestClient(app,headers={'X-Twinomation-Client':'local-demo'}) as client:
        def login(role,station='KIX'):
            result=client.post('/api/session',json={'role':role,'station':station})
            return {'Authorization':'Bearer '+result.json()['token']}
        yield app,client,login


def send(client,who,scope='regions',targets=None,key='broadcast-test',**changes):
    body={'title':'Synthetic OCC coordination','body':'Internal station message only','scope':scope,'targets':targets if targets is not None else ['JP'],'priority':'important',**changes}
    return client.post('/api/broadcasts',headers={**who,'Idempotency-Key':key},json=body)


@pytest.mark.parametrize('scope,targets,expected',[
    ('all',[],{'KIX','NRT','PVG','PEK','TPE','KHH','ICN','BKK','SYX','PKX','CRK'}),
    ('regions',[' jp ','TW'],{'KIX','NRT','TPE','KHH'}),
    ('stations',['ICN','KIX'],{'KIX','ICN'}),
])
def test_broadcast_resolves_and_scopes_actual_recipients(env,scope,targets,expected):
    _,client,login=env
    occ=login('occ')
    response=send(client,occ,scope,targets)
    assert response.status_code==201,response.text
    broadcast=response.json()
    assert {r['station'] for r in broadcast['recipients']}==expected
    for station in ['KIX','NRT','PVG','PEK','TPE','KHH','ICN']:
        who=login('outport',station)
        listed=client.get('/api/broadcasts',headers=who).json()
        detail=client.get(f'/api/broadcasts/{broadcast["id"]}',headers=who)
        if station in expected:
            assert len(listed)==1 and detail.status_code==200
            assert listed[0]['recipients']==[{'station':station,'acknowledged_at':None}]
        else:
            assert listed==[] and detail.status_code==404
            assert client.post(f'/api/broadcasts/{broadcast["id"]}/acknowledge',headers=who,json={}).status_code==404


def test_explicit_receipt_is_station_scoped_and_repeat_safe(env):
    app,client,login=env
    occ,kix,nrt=login('occ'),login('outport'),login('outport','NRT')
    broadcast=send(client,occ).json();path=f'/api/broadcasts/{broadcast["id"]}/acknowledge'
    assert client.post(path,headers=occ,json={}).status_code==403
    # Fetching a message does not acknowledge it.
    assert client.get('/api/broadcasts',headers=kix).json()[0]['recipients'][0]['acknowledged_at'] is None
    assert client.post(path,headers=kix,json={}).status_code==200
    assert client.post(path,headers=kix,json={}).status_code==200
    recipients=client.get('/api/broadcasts',headers=occ).json()[0]['recipients']
    assert [r['station'] for r in recipients if r['acknowledged_at']]==['KIX']
    assert client.get('/api/broadcasts',headers=nrt).json()[0]['recipients'][0]['acknowledged_at'] is None
    with connect(app.state.db_path) as db:
        assert db.execute("SELECT count(*) FROM case_events WHERE type='BROADCAST_ACKNOWLEDGED'").fetchone()[0]==1


def test_broadcast_replay_permissions_validation_and_passenger_isolation(env):
    app,client,login=env
    occ=login('occ')
    public_before=client.get('/api/demo/passenger/2').json()
    first=send(client,occ)
    assert send(client,occ).json()==first.json()
    assert send(client,occ,title='Changed body on same key').json()['error']['code']=='IDEMPOTENCY_CONFLICT'
    assert send(client,login('outport')).status_code==403
    assert send(client,login('cs')).status_code==403
    assert send(client,{}).status_code==401
    for scope,targets in [('all',['KIX']),('regions',[]),('regions',['XX']),('stations',[]),('stations',['JP']),('stations',['kix','KIX'])]:
        assert send(client,occ,scope,targets,key='invalid-'+scope).status_code==422
    assert client.get('/api/demo/passenger/2').json()==public_before
    assert not any(e['type']=='BROADCAST_SENT' for e in client.get('/api/cases/2',headers=occ).json()['events'])
    with connect(app.state.db_path) as db:
        assert db.execute('SELECT count(*) FROM broadcasts').fetchone()[0]==1


def test_seeded_weather_has_source_fields_for_each_station_and_survives_restart(env):
    app,client,login=env
    occ=login('occ')
    before={}
    for station in ['KIX','NRT','PVG','PEK','TPE','KHH','ICN']:
        record=client.get(f'/api/stations/{station}/weather-briefings/latest',headers=occ).json()
        assert record['demo'] and record['parsed']['demo']
        assert record['parsed']['route']=={'departure':station,'destination':'HKG'}
        assert not record['parsed']['missing_fields']
        assert record['parsed']==parse_briefing(record['raw_text'],station)
        before[station]=record
    with TestClient(create_app(app.state.db_path),headers={'X-Twinomation-Client':'local-demo'}) as restarted:
        token=restarted.post('/api/session',json={'role':'occ'}).json()['token']
        for station,record in before.items():
            assert restarted.get(f'/api/stations/{station}/weather-briefings/latest',headers={'Authorization':'Bearer '+token}).json()==record


def test_weather_parser_preserves_zero_units_and_missing_or_invalid_values():
    raw=sample_briefing('KIX')
    parsed=parse_briefing(raw.replace('3500 m','0 m').replace('Wind speed: 12 kt','Wind speed: 0 kt').replace('Temperature: 16 C','Temperature: -4 C'),'KIX')
    assert parsed['departure']['visibility_m']==0 and parsed['departure']['wind_speed_kt']==0
    assert parsed['departure']['temperature_c']==-4
    assert parse_briefing(raw.replace('3500 m','3.5 km'),'KIX')['departure']['visibility_m']==3500
    bad=parse_briefing(raw.replace('3500 m','unknown').replace('QNH: 1008 hPa','QNH: 1 hPa').replace('Cloud base: 1200 ft','Cloud base: unavailable'),'KIX')
    for key in ['visibility_m','qnh_hpa','cloud_base_ft']:
        assert bad['departure'][key] is None and 'departure.'+key in bad['missing_fields']
    with pytest.raises(ValueError): parse_briefing(raw,'NRT')
    minimal=parse_briefing('Route: KIX -> HKG\nIssued: invalid\nValid from: 2026-11-15\nValid until: 2026-11-14\n','KIX')
    assert minimal['issued_at'] is None and minimal['valid_from'] is None
    assert 'validity' in minimal['missing_fields']
    # Different UTC spellings must compare chronologically, not alphabetically.
    period=parse_briefing('Route: KIX -> HKG\nValid from: 2026-11-15T00:00:00.123Z\nValid until: 2026-11-15T00:00:00Z\n','KIX')
    assert period['valid_to'] is None
    assert parse_briefing('Route: KIX -> HKG\nIssued: 0001-01-01T00:00:00+01:00\n','KIX')['issued_at'] is None


def test_weather_preview_save_conflict_replay_and_scope(env):
    app,client,login=env
    occ,kix,nrt,cs=login('occ'),login('outport'),login('outport','NRT'),login('cs')
    base='/api/stations/KIX/weather-briefings'
    original=client.get(base+'/latest',headers=kix).json()
    public_before=client.get('/api/demo/passenger/2').json()
    raw=original['raw_text'].replace('3500 m','800 m')
    body={'source_name':'Edited synthetic sample','raw_text':raw}
    assert client.post(base+'/parse',headers=kix,json=body).json()['departure']['visibility_m']==800
    assert client.get(base+'/sample',headers=kix).json()['demo']
    assert client.get(base+'/latest',headers=kix).json()==original
    for suffix in ['/latest','/sample']:
        assert client.get(base+suffix,headers=nrt).status_code==404
        assert client.get(base+suffix,headers=cs).status_code==403
        assert client.get(base+suffix).status_code==401
    assert client.post(base+'/parse',headers=nrt,json=body).status_code==404
    assert client.post(base+'/parse',headers=kix,json={'raw_text':sample_briefing('ICN')}).status_code==422
    payload={**body,'previous_id':original['id']}
    headers={**kix,'Idempotency-Key':'save-weather-test'}
    saved=client.post(base,headers=headers,json=payload)
    assert saved.status_code==201,saved.text
    assert saved.json()['parsed']['departure']['visibility_m']==800
    assert client.post(base,headers=headers,json=payload).json()==saved.json()
    stale=client.post(base,headers={**occ,'Idempotency-Key':'other-editor'},json=payload)
    assert stale.status_code==409 and stale.json()['error']['code']=='VERSION_CONFLICT'
    assert client.get(base+'/latest',headers=occ).json()==saved.json()
    assert client.get('/api/demo/passenger/2').json()==public_before
    with connect(app.state.db_path) as db:
        assert db.execute("SELECT count(*) FROM weather_briefings WHERE station='KIX'").fetchone()[0]==2
        assert db.execute('SELECT raw_text FROM weather_briefings WHERE id=?',(original['id'],)).fetchone()[0]==original['raw_text']
        assert db.execute("SELECT count(*) FROM case_events WHERE type='WEATHER_BRIEFING_UPDATED'").fetchone()[0]==1
