"""Non-destructive scenario import and reversible local exercise controls."""
import json
import pytest
from fastapi.testclient import TestClient
from backend.main import create_app
from backend.db import connect,transaction
from backend.extended_ops import operations,store_operations

@pytest.fixture
def env(tmp_path):
    app=create_app(tmp_path/'demo.db')
    with TestClient(app,headers={'X-Twinomation-Client':'local-demo'}) as c:
        def login(role='occ',station='KIX'):
            return {'Authorization':'Bearer '+c.post('/api/session',json={'role':role,'station':station}).json()['token']}
        yield app,c,login

def snapshot(path):
    with connect(path) as db:
        return {table:[tuple(r) for r in db.execute('SELECT * FROM '+table+' ORDER BY rowid')] for table in ['cases','work_orders','case_events','passenger_updates','case_files']}

def test_scenarios_add_thirty_once_and_keep_existing_business_data(env):
    app,c,login=env;occ=login();original=snapshot(app.state.db_path)
    assert c.post('/api/demo/scenarios/load',headers=login('care'),json={}).status_code==403
    first=c.post('/api/demo/scenarios/load',headers=occ,json={})
    assert first.status_code==200,first.text
    assert first.json()['added']==30 and first.json()['scenario_count']==30
    assert c.post('/api/demo/scenarios/load',headers=occ,json={}).json()['added']==0
    after=snapshot(app.state.db_path)
    for table,rows in original.items():
        assert after[table][:len(rows)]==rows,table
    flights=c.get('/api/cases',headers=occ).json()
    assert len(flights)==40
    assert any(f['origin']=='HKG' and f['destination']=='BKK' for f in flights)
    assert any(f['origin']=='SYX' and f['destination']=='HKG' for f in flights)
    assert {'ON_TIME','DELAYED','CANCELLED'}.issubset({f['flight_status'] for f in flights})

def test_reset_requires_confirmation_and_backup_restores_exact_original_rows(env):
    app,c,login=env;occ=login();original=snapshot(app.state.db_path)
    assert c.post('/api/demo/reset',headers=login('outport'),json={'confirmation':'RESET DEMO'}).status_code==403
    assert c.post('/api/demo/reset',headers=occ,json={'confirmation':'reset'}).status_code==422
    assert snapshot(app.state.db_path)==original
    reset=c.post('/api/demo/reset',headers=occ,json={'confirmation':'RESET DEMO'})
    assert reset.status_code==200,reset.text
    bid=reset.json()['backup_id']
    assert bid in c.get('/api/demo/scenarios',headers=occ).json()['backups']
    assert c.get('/api/demo/scenarios',headers=occ).json()['loaded']==30
    assert c.post(f'/api/demo/restore/{bid}',headers=occ,json={'confirmation':'restore'}).status_code==422
    response=c.post(f'/api/demo/restore/{bid}',headers=occ,json={'confirmation':'RESTORE DEMO'})
    assert response.status_code==200,response.text
    assert snapshot(app.state.db_path)==original
    assert c.get('/api/demo/scenarios',headers=occ).json()['loaded']==0
    assert c.post('/api/demo/restore/not-a-file',headers=occ,json={'confirmation':'RESTORE DEMO'}).status_code==404

def test_network_exposes_only_published_facts_and_updates_cancel_departed_and_unknown(env):
    app,c,login=env;occ=login()
    c.post('/api/demo/scenarios/load',headers=occ,json={})
    network=c.get('/api/demo/network-connections/1').json()
    assert len(network)==9
    assert set(network[0])=={'flight_no','destination','departure','status'}
    with transaction(app.state.db_path) as db:
        case=db.execute("SELECT * FROM cases WHERE origin='HKG' ORDER BY id LIMIT 1").fetchone()
        data=operations(db,case['id']);data.update(stage='departed',reason='INTERNAL SENTINEL');store_operations(db,case['id'],data)
        outbound=case['id'];number=case['flight_no']
    assert c.get(f'/api/demo/network-connections/{outbound}').json()==[]
    network=c.get('/api/demo/network-connections/1').json()
    assert next(r for r in network if r['flight_no']==number)['status']=='DEPARTED'
    assert 'SENTINEL' not in str(network)
    token=c.post('/api/demo/passenger-link',headers=occ,json={'case_id':1}).json()['path'].split('#')[1]
    assert c.get(f'/api/passenger/{token}/network-connections').json()==network
    assert c.get('/api/passenger/bad/network-connections').status_code==404

def test_uo_direction_and_on_time_authorisation_preserve_resource_review(env):
    _,c,login=env;occ=login()
    create=c.post('/api/cases',headers={**occ,'Idempotency-Key':'outbound'},json={'flight_no':'UO999','station':'NRT','direction':'outbound','flight_date':'2026-11-16','original_departure':'2026-11-16T08:00:00+08:00','reason':'demo'})
    assert create.status_code==201,create.text
    cid=create.json()['id'];case=c.get(f'/api/cases/{cid}',headers=occ).json()
    assert case['origin']=='HKG' and case['destination']=='NRT' and case['destination_timezone']=='Asia/Tokyo'
    wo=c.post(f'/api/cases/{cid}/work-orders',headers=occ,json={'items':['fueling'],'operator_checked':True,'proposed_departure':'2026-11-16T08:00:00+08:00'}).json()
    nrt=login('outport','NRT')
    assert c.post(f'/api/work-orders/{wo["id"]}/authorize',headers=occ,json={'version':wo['version'],'flight_status':'ON_TIME','departure':'2026-11-16T08:00:00+08:00'}).status_code==409
    c.post(f'/api/work-orders/{wo["id"]}/receive',headers=nrt,json={'version':wo['version']})
    wo=c.get(f'/api/cases/{cid}',headers=nrt).json()['work_orders'][0]
    c.post(f'/api/work-orders/{wo["id"]}/respond',headers=nrt,json={'version':wo['version'],'items':[{**i,'status':'Ready'} for i in wo['items']]})
    wo=c.get(f'/api/cases/{cid}',headers=occ).json()['work_orders'][0]
    switch=c.get('/api/kill-switch',headers=occ).json();c.put('/api/kill-switch',headers=occ,json={'version':switch['version'],'active':False})
    response=c.post(f'/api/work-orders/{wo["id"]}/authorize',headers=occ,json={'version':wo['version'],'flight_status':'ON_TIME','departure':'2026-11-16T08:00:00+08:00','gate':'D1','terminal':'T2'})
    assert response.status_code==200,response.text
    public=c.get(f'/api/demo/passenger/{cid}?connection=LHR').json()
    assert public['status']['status']=='ON_TIME' and public['connection'] is None
    assert public['status']['airport']=='Hong Kong International Airport'
    assert public['status']['terminal']=='T2'
    assert '按计划运行' in public['timeline'][0]['text_zh']
    op=c.get(f'/api/cases/{cid}',headers=occ).json()['workspace']['operations']
    assert c.put(f'/api/cases/{cid}/boarding',headers=nrt,json={'version':op['version'],'departure':None}).status_code==403

def test_named_short_and_long_passenger_demos_are_published_and_restart_safe(env):
    from datetime import datetime
    app,c,login=env
    cases=c.get('/api/demo/passenger/cases').json()
    ids={r['flight_no']:r['id'] for r in cases if r['flight_no'] in ('短延误','长延误')}
    assert set(ids)=={'短延误','长延误'}
    before={}
    for name,minutes,cause in [('短延误',45,'WEATHER'),('长延误',180,'TECHNICAL')]:
        data=c.get(f'/api/demo/passenger/{ids[name]}').json();before[name]=data
        status=data['status']
        assert status['status']=='DELAYED' and status['cause']==cause
        assert (datetime.fromisoformat(status['departure'].replace('Z','+00:00'))-datetime.fromisoformat(status['scheduled'].replace('Z','+00:00'))).total_seconds()==minutes*60
        assert len(data['timeline'])==1 and data['timeline'][0]['text_zh']
        assert data['flight']['flight_no']==name and data['journey']['recall'] is None
    assert c.get('/api/demo/scenarios',headers=login()).json()['loaded']==0
    with TestClient(create_app(app.state.db_path)) as restarted:
        for name,cid in ids.items(): assert restarted.get(f'/api/demo/passenger/{cid}').json()==before[name]
        assert sum(r['flight_no'] in ids for r in restarted.get('/api/demo/passenger/cases').json())==2

def test_text_fields_accept_empty_input_with_useful_demo_defaults(env):
    _,c,login=env;occ,station=login(),login('outport')
    switch=c.get('/api/kill-switch',headers=occ).json();c.put('/api/kill-switch',headers=occ,json={'version':switch['version'],'active':False})
    created=c.post('/api/cases',headers={**occ,'Idempotency-Key':'empty-create'},json={'flight_no':'','reason':'','station':'KIX','flight_date':'2026-11-15','original_departure':'2026-11-15T08:00:00+08:00'})
    assert created.status_code==201 and created.json()['flight_no'].startswith('DEMO')
    named=c.post('/api/cases',headers={**occ,'Idempotency-Key':'named-create'},json={'flight_no':'演示名称','station':'KIX','flight_date':'2026-11-15','original_departure':'2026-11-15T08:00:00+08:00'})
    assert named.status_code==201
    case=c.get('/api/cases/2',headers=station).json();wo=case['work_orders'][0]
    assert c.post(f'/api/work-orders/{wo["id"]}/abort',headers=occ,json={'version':wo['version'],'reason':''}).status_code==200
    c.post('/api/cases/2/tasks',headers={**station,'Idempotency-Key':'empty-task'},json={'name':''}).raise_for_status()
    assert c.get('/api/cases/2',headers=station).json()['workspace']['tasks'][-1]['name']=='Custom ground task'
    message=c.post('/api/cases/2/messages',headers={**station,'Idempotency-Key':'empty-message'},json={'body':''})
    assert message.status_code==201
    case=c.get('/api/cases/2',headers=station).json()
    notice=c.post(f'/api/cases/2/events/{case["events"][0]["id"]}/passenger-notices',headers={**station,'Idempotency-Key':'empty-notice'},json={'version':case['version'],'text_en':'','text_zh':''})
    assert notice.status_code==201
    assert c.get('/api/demo/passenger/2').json()['timeline'][0]['text'].startswith('Thank you for waiting.')
    dispatch=c.post('/api/cases/2/dispatches',headers={**station,'Idempotency-Key':'empty-dispatch'},json={'text_en':'','email':True,'recipient':''})
    assert dispatch.status_code==201
    assert c.get('/api/cases/2',headers=station).json()['workspace']['dispatches'][0]['recipient']=='demo@example.test'
    broadcast=c.post('/api/broadcasts',headers={**occ,'Idempotency-Key':'empty-broadcast'},json={'title':'','body':'','scope':'all'})
    assert broadcast.status_code==201 and broadcast.json()['title'] and broadcast.json()['body']
    weather=c.get('/api/stations/KIX/weather-briefings/latest',headers=station).json()
    saved=c.post('/api/stations/KIX/weather-briefings',headers={**station,'Idempotency-Key':'empty-weather'},json={'source_name':'','raw_text':'','previous_id':weather['id']})
    assert saved.status_code==201 and saved.json()['raw_text'] and saved.json()['parsed']['departure']['visibility_m'] is not None

    assert c.post('/api/stations/KIX/weather-briefings',headers={**station,'Idempotency-Key':'empty-weather'},json={'source_name':'','raw_text':'','previous_id':weather['id']}).json()==saved.json()
