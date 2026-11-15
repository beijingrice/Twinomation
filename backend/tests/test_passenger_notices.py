import pytest
from fastapi.testclient import TestClient

from backend.db import connect, transaction, event
from backend.main import create_app


@pytest.fixture
def env(tmp_path):
    app=create_app(tmp_path/'notices.db')
    with TestClient(app,headers={'X-Twinomation-Client':'local-demo'}) as client:
        def login(role,station='KIX'):
            token=client.post('/api/session',json={'role':role,'station':station}).json()['token']
            return {'Authorization':'Bearer '+token}
        yield app,client,login


def resume(client,occ):
    switch=client.get('/api/kill-switch',headers=occ).json()
    assert client.put('/api/kill-switch',headers=occ,json={'active':False,'version':switch['version']}).status_code==200


def notice(client,headers,case,event_id,body=None,key='notice-test-key'):
    return client.post(f'/api/cases/{case["id"]}/events/{event_id}/passenger-notices',headers={**headers,'Idempotency-Key':key},json=body or {'version':case['version'],'text_zh':'感谢您的等候。请留意最新通知。','text_en':'Thank you for waiting. Please watch for updates.','template':'waiting'})


def test_station_publishes_bilingual_notice_preserving_internal_event_and_flight_state(env):
    app,client,login=env
    occ,kix=login('occ'),login('outport')
    resume(client,occ)
    with transaction(app.state.db_path) as db:
        eid=event(db,2,'NOTE_ADDED',{'id':'demo.staff','role':'outport'},{'summary':'Internal logistics only','snapshot':{'secret':'hidden-resource-answer'}})
    case=client.get('/api/cases/2',headers=kix).json()
    before=client.get('/api/demo/passenger/2').json()['status']
    response=notice(client,kix,case,eid)
    assert response.status_code==201,response.text
    public=client.get('/api/demo/passenger/2').json()
    assert public['status']==before
    assert public['timeline'][0]['text']=='Thank you for waiting. Please watch for updates.'
    assert public['timeline'][0]['text_zh']=='感谢您的等候。请留意最新通知。'
    assert not any(value in str(public) for value in ['Internal logistics only','hidden-resource-answer','actor_id'])
    after=client.get('/api/cases/2',headers=kix).json()
    assert after['version']==case['version']+1
    assert after['work_orders']==case['work_orders']
    assert next(e for e in after['events'] if e['id']==eid)==next(e for e in case['events'] if e['id']==eid)
    audit=next(e for e in after['events'] if e['type']=='PASSENGER_NOTICE_PUBLISHED')
    assert audit['payload']['source_event_id']==eid
    assert audit['payload']['update_id']==response.json()['id']
    assert audit['actor_role']=='outport'
    update=next(u for u in after['updates'] if u['id']==response.json()['id'])
    assert update['topic']=='general' and update['source_event_id']==eid and update['reviewed_by']


def test_station_scope_and_role_are_enforced(env):
    _,client,login=env
    occ,kix,nrt,cs=login('occ'),login('outport'),login('outport','NRT'),login('cs')
    case=client.get('/api/cases/2',headers=kix).json()
    eid=case['events'][0]['id']
    for who in [occ,cs]: assert notice(client,who,case,eid).status_code==403
    assert notice(client,nrt,case,eid).status_code==404
    assert notice(client,{},case,eid).status_code==401
    foreign=client.get('/api/cases/1',headers=kix).json()['events'][0]['id']
    assert notice(client,kix,case,foreign).status_code==404


def test_pause_stale_versions_and_idempotency(env):
    _,client,login=env
    occ,kix=login('occ'),login('outport')
    case=client.get('/api/cases/2',headers=kix).json();eid=case['events'][0]['id']
    assert notice(client,kix,case,eid).json()['error']['code']=='KILL_SWITCH_ACTIVE'
    resume(client,occ)
    first=notice(client,kix,case,eid)
    assert first.status_code==201
    replay=notice(client,kix,case,eid)
    assert replay.json()==first.json()
    assert len(client.get('/api/demo/passenger/2').json()['timeline'])==1
    assert notice(client,kix,case,eid,key='new-notice-stale').json()['error']['code']=='VERSION_CONFLICT'
    changed=notice(client,kix,case,eid,body={'version':case['version'],'text_en':'Changed'})
    assert changed.json()['error']['code']=='IDEMPOTENCY_CONFLICT'


@pytest.mark.parametrize('language,text_zh,text_en',[('zh','  仅中文通知  ',''),('en','','  English only notice  ')])
def test_single_language_fallback_and_validation(env,language,text_zh,text_en):
    _,client,login=env
    occ,kix=login('occ'),login('outport');resume(client,occ)
    case=client.get('/api/cases/2',headers=kix).json();eid=case['events'][0]['id']
    assert notice(client,kix,case,eid,body={'version':case['version'],'text_en':'x'*3001}).status_code==422
    assert notice(client,kix,case,eid,body={'version':case['version'],'text_en':'Test','template':'fake'}).status_code==422
    response=notice(client,kix,case,eid,body={'version':case['version'],'text_zh':text_zh,'text_en':text_en})
    assert response.status_code==201
    public=client.get('/api/demo/passenger/2').json()['timeline'][0]
    assert public['text']==(text_en or text_zh).strip()
    assert public['text_zh']==(text_zh.strip() or None)


def test_post_cancellation_notice_does_not_reopen_or_change_the_flight(env):
    _,client,login=env
    occ,kix=login('occ'),login('outport');resume(client,occ)
    case=client.get('/api/cases/2',headers=kix).json()
    assert client.post('/api/cases/2/cancel-flight',headers=occ,json={'version':case['version'],'cause':'WEATHER'}).status_code==200
    case=client.get('/api/cases/2',headers=kix).json()
    assert notice(client,kix,case,case['events'][0]['id']).status_code==201
    after=client.get('/api/cases/2',headers=kix).json()
    assert after['status']=='CLOSED' and after['flight_status']=='CANCELLED'
    assert client.get('/api/demo/passenger/2').json()['status']['status']=='CANCELLED'


def test_existing_database_adds_bilingual_column_without_changing_history(env):
    app,client,_=env
    with connect(app.state.db_path) as db:
        before=[tuple(r) for r in db.execute('SELECT id,draft_text,status FROM passenger_updates ORDER BY id')]
        db.execute('ALTER TABLE passenger_updates DROP COLUMN final_text_zh')
    with TestClient(create_app(app.state.db_path)) as restarted:
        assert restarted.get('/api/demo/passenger/2').status_code==200
    with connect(app.state.db_path) as db:
        assert 'final_text_zh' in [r['name'] for r in db.execute('PRAGMA table_info(passenger_updates)')]
        assert [tuple(r) for r in db.execute('SELECT id,draft_text,status FROM passenger_updates ORDER BY id')]==before
