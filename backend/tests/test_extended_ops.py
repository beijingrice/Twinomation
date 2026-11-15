from datetime import datetime,timedelta,timezone
import pytest
from fastapi.testclient import TestClient
from backend.main import create_app
from backend.db import connect,transaction
from backend.extended_ops import operations,run_due

@pytest.fixture
def env(tmp_path):
    app=create_app(tmp_path/'extended.db')
    with TestClient(app,headers={'X-Twinomation-Client':'local-demo'}) as c:
        def login(role,station='KIX'):
            return {'Authorization':'Bearer '+c.post('/api/session',json={'role':role,'station':station}).json()['token']}
        yield app,c,login

def resume(c,occ):
    s=c.get('/api/kill-switch',headers=occ).json()
    assert c.put('/api/kill-switch',headers=occ,json={'active':False,'version':s['version']}).status_code==200

def test_messages_receipts_and_care_scope(env):
    _,c,login=env
    occ,kix,nrt,care=login('occ'),login('outport'),login('outport','NRT'),login('care')
    path='/api/cases/2/messages';headers={**occ,'Idempotency-Key':'message-test'}
    first=c.post(path,headers=headers,json={'body':'Internal message sentinel'})
    assert first.status_code==201
    assert c.post(path,headers=headers,json={'body':'Internal message sentinel'}).json()==first.json()
    assert c.post(path,headers=headers,json={'body':'different'}).status_code==409
    assert len(c.get('/api/inbox',headers=kix).json())==1
    assert c.get('/api/inbox',headers=nrt).json()==[]
    mid=first.json()['id']
    assert c.post(f'/api/inbox/{mid}/acknowledge',headers=nrt,json={}).status_code==404
    for _ in range(2): assert c.post(f'/api/inbox/{mid}/acknowledge',headers=kix,json={}).status_code==200
    assert c.get('/api/inbox',headers=care).json()[0]['acknowledged_at']
    assert c.get('/api/cases/3',headers=care).status_code==404
    assert c.get('/api/stations',headers=care).json()[0]['code']=='KIX'
    assert c.post(path,headers={**care,'Idempotency-Key':'care-message'},json={'body':'no'}).status_code==403
    assert 'Internal message sentinel' not in str(c.get('/api/demo/passenger/2').json())

def test_task_progress_is_independent_of_work_order_answers(env):
    _,c,login=env
    occ,kix,care=login('occ'),login('outport'),login('care')
    before=c.get('/api/cases/2',headers=kix).json()
    tasks=before['workspace']['tasks'];assert len(tasks)==4
    task=tasks[0];p=f'/api/cases/2/tasks/{task["id"]}'
    for who in [occ,care]: assert c.put(p,headers=who,json={'version':task['version'],'status':'done'}).status_code==403
    assert c.put(p,headers=kix,json={'version':task['version'],'status':'working'}).status_code==200
    assert c.put(p,headers=kix,json={'version':task['version'],'status':'done'}).status_code==409
    assert c.put(p,headers=kix,json={'version':task['version']+1,'status':'fake'}).status_code==422
    new=c.post('/api/cases/2/tasks',headers={**kix,'Idempotency-Key':'task-test'},json={'name':'Custom task sentinel','description':'Custom detail'})
    assert new.status_code==201
    after=c.get('/api/cases/2',headers=occ).json()
    assert after['work_orders']==before['work_orders']
    assert after['version']==before['version']
    assert len(after['workspace']['tasks'])==5
    assert len(c.get('/api/inbox',headers=occ).json())==2
    assert 'Custom task sentinel' not in str(c.get('/api/demo/passenger/2').json())

def test_persistent_draft_concurrency_and_customer_care_publication(env):
    app,c,login=env
    occ,care=login('occ'),login('care')
    case=c.get('/api/cases/2',headers=care).json()
    eid=case['events'][0]['id']
    body={'version':0,'text_zh':'已保存草稿 sentinel','text_en':'saved draft sentinel','template':'waiting','source_event_id':eid}
    saved=c.put('/api/cases/2/notice-draft',headers=care,json=body)
    assert saved.status_code==200 and saved.json()['version']==1
    assert c.put('/api/cases/2/notice-draft',headers=care,json=body).status_code==409
    assert c.get('/api/cases/2',headers=care).json()['workspace']['draft']['text_zh']==body['text_zh']
    assert 'sentinel' not in str(c.get('/api/demo/passenger/2').json())
    resume(c,occ)
    assert c.post(f'/api/cases/2/events/{eid}/passenger-notices',headers={**care,'Idempotency-Key':'care-notice'},json={'version':case['version'],'text_zh':'谢谢等候。','text_en':'Thank you for waiting.','template':'waiting'}).status_code==201
    assert c.get('/api/demo/passenger/2').json()['timeline'][0]['text']=='Thank you for waiting.'
    with connect(app.state.db_path) as db: assert db.execute('SELECT text_en FROM notice_drafts WHERE case_id=2').fetchone()[0]=='saved draft sentinel'

def dispatch(c,who,body,key='dispatch-test'):
    return c.post('/api/cases/2/dispatches',headers={**who,'Idempotency-Key':key},json=body)

def test_dispatch_queue_pause_restart_and_exactly_one_local_delivery(env):
    app,c,login=env
    occ,care=login('occ'),login('care')
    body={'text_en':'Scheduled sentinel','notify':True,'email':True,'recipient':'test@example.com','publish_at':(datetime.now(timezone.utc)+timedelta(hours=1)).isoformat()}
    first=dispatch(c,care,body)
    assert first.status_code==201 and first.json()['status']=='QUEUED'
    assert dispatch(c,care,body).json()==first.json()
    assert not c.get('/api/demo/passenger/2').json()['timeline']
    with transaction(app.state.db_path) as db: db.execute("UPDATE passenger_dispatches SET publish_at='2000-01-01T00:00:00Z'")
    run_due(app.state.db_path)
    assert not c.get('/api/demo/passenger/2').json()['timeline']
    resume(c,occ);run_due(app.state.db_path);run_due(app.state.db_path)
    public=c.get('/api/demo/passenger/2').json()
    assert len(public['timeline'])==1 and public['timeline'][0]['text']=='Scheduled sentinel'
    assert 'test@example.com' not in str(public)
    with connect(app.state.db_path) as db:
        row=db.execute('SELECT status,email_status FROM passenger_dispatches').fetchone()
        assert tuple(row)==('SENT','simulated')
    with TestClient(create_app(app.state.db_path)) as restarted:
        assert len(restarted.get('/api/demo/passenger/2').json()['timeline'])==1

def test_dispatch_validation_cancellation_and_approved_field_only(env):
    app,c,login=env
    occ,kix,foreign=login('occ'),login('outport'),login('outport','NRT')
    assert dispatch(c,kix,{'text_en':'now'}).status_code==409
    resume(c,occ)
    for body in [{'text_en':'x','notify':False,'email':False},{'text_en':'x','email':True,'recipient':'bad'},{'text_en':'x','publish_at':'2026-11-15T12:00:00'}]: assert dispatch(c,kix,body).status_code==422
    assert dispatch(c,foreign,{'text_en':'x'}).status_code==404
    response=dispatch(c,kix,{'text_en':'Approved fields only','includes':['departure','boarding','gate','arrival']})
    assert response.status_code==201
    text=c.get('/api/demo/passenger/2').json()['timeline'][0]['text']
    assert 'Pending' in text and '16:15' not in text
    queued=dispatch(c,kix,{'text_en':'Later','publish_at':(datetime.now(timezone.utc)+timedelta(hours=1)).isoformat()},'queue-to-cancel').json()
    assert c.post(f'/api/cases/2/dispatches/{queued["id"]}/cancel',headers=kix,json={}).status_code==200
    assert c.post(f'/api/cases/2/dispatches/{queued["id"]}/cancel',headers=kix,json={}).status_code==409

def approve(c,occ,kix,departure):
    case=c.get('/api/cases/2',headers=kix).json();wo=case['work_orders'][0]
    assert c.post(f'/api/work-orders/{wo["id"]}/receive',headers=kix,json={'version':wo['version']}).status_code==200
    wo=c.get('/api/cases/2',headers=kix).json()['work_orders'][0]
    items=[{**item,'status':'Ready','note':'Gate 7' if item['key']=='gate' else ''} for item in wo['items']]
    assert c.post(f'/api/work-orders/{wo["id"]}/respond',headers=kix,json={'version':wo['version'],'items':items}).status_code==200
    wo=c.get('/api/cases/2',headers=occ).json()['work_orders'][0]
    assert c.post(f'/api/work-orders/{wo["id"]}/authorize',headers=occ,json={'version':wo['version'],'flight_status':'BOARDING','departure':departure,'gate':'7'}).status_code==200

def test_boarding_never_exposes_unapproved_confirmation_and_recall_needs_authorisation(env):
    app,c,login=env
    occ,kix,care=login('occ'),login('outport'),login('care')
    departure=(datetime.now(timezone.utc)+timedelta(days=1)).isoformat()
    op=c.get('/api/cases/2',headers=kix).json()['workspace']['operations']
    assert c.put('/api/cases/2/boarding',headers=care,json={'version':op['version'],'departure':departure}).status_code==403
    assert c.put('/api/cases/2/boarding',headers=kix,json={'version':op['version'],'departure':departure}).status_code==200
    public=c.get('/api/demo/passenger/2').json();assert public['journey']['boarding_at'] is None and public['journey']['recall'] is None
    resume(c,occ)
    op=c.get('/api/cases/2',headers=kix).json()['workspace']['operations']
    assert c.post('/api/cases/2/recall',headers=kix,json={'version':op['version'],'action':'send'}).status_code==409
    approve(c,occ,kix,departure)
    assert c.post('/api/cases/2/recall',headers=kix,json={'version':op['version'],'action':'test'}).status_code==200
    public=c.get('/api/demo/passenger/2').json()
    assert public['journey']['recall']['gate']=='7' and public['journey']['stage']=='boarding'
    assert c.post('/api/cases/2/recall',headers=kix,json={'version':op['version'],'action':'send'}).status_code==409
    op=c.get('/api/cases/2',headers=kix).json()['workspace']['operations']
    assert c.post('/api/cases/2/recall',headers=kix,json={'version':op['version'],'action':'end'}).status_code==200
    assert c.get('/api/demo/passenger/2').json()['journey']['recall'] is None

def test_automatic_recall_is_due_once_and_pause_guarded(env):
    app,c,login=env
    occ,kix=login('occ'),login('outport');resume(c,occ)
    with transaction(app.state.db_path) as db: db.execute("UPDATE cases SET original_departure='2000-01-01T00:00:00Z' WHERE id=2")
    departure=(datetime.now(timezone.utc)+timedelta(minutes=10)).isoformat()
    approve(c,occ,kix,departure)
    op=c.get('/api/cases/2',headers=kix).json()['workspace']['operations']
    assert c.put('/api/cases/2/boarding',headers=kix,json={'version':op['version'],'departure':departure}).status_code==200
    run_due(app.state.db_path);run_due(app.state.db_path)
    with connect(app.state.db_path) as db:
        assert db.execute("SELECT count(*) FROM case_events WHERE type='BOARDING_RECALL_STARTED'").fetchone()[0]==1
    assert c.get('/api/demo/passenger/2').json()['journey']['recall']['source']=='automatic'

def test_journey_stage_guard_cancel_queued_and_internal_handover_is_private(env):
    _,c,login=env
    occ,kix=login('occ'),login('outport');resume(c,occ)
    op=c.get('/api/cases/2',headers=occ).json()['workspace']['operations']
    body={'version':op['version'],'impact':'Internal impact sentinel','recommendation':'Internal recommendation sentinel','stage':'departed'}
    assert c.put('/api/cases/2/operations',headers=occ,json=body).status_code==409
    body['stage']='preparing'
    assert c.put('/api/cases/2/operations',headers=occ,json=body).status_code==200
    public=c.get('/api/demo/passenger/2').json()
    assert public['journey']['stage']=='preparing' and 'sentinel' not in str(public)
    queued=dispatch(c,kix,{'text_en':'Old departure reminder','publish_at':(datetime.now(timezone.utc)+timedelta(days=1)).isoformat()},'cancel-flight-queue').json()
    case=c.get('/api/cases/2',headers=occ).json()
    assert c.post('/api/cases/2/cancel-flight',headers=occ,json={'version':case['version'],'cause':'WEATHER'}).status_code==200
    after=c.get('/api/cases/2',headers=kix).json()
    assert next(d for d in after['workspace']['dispatches'] if d['id']==queued['id'])['status']=='CANCELLED'
    assert c.get('/api/demo/passenger/2').json()['journey']['recall'] is None

def test_station_reply_confirms_pending_occ_messages_once_without_publishing(env):
    app,c,login=env;occ,kix=login('occ'),login('outport')
    before=c.get('/api/demo/passenger/2').json()
    c.post('/api/cases/2/messages',headers={**occ,'Idempotency-Key':'occ-first'},json={'body':'Please confirm'})
    assert c.get('/api/inbox',headers=kix).json()[0]['acknowledged_at'] is None
    headers={**kix,'Idempotency-Key':'station-reply'}
    for _ in range(2): assert c.post('/api/cases/2/messages',headers=headers,json={'body':'Received; checking'}).status_code==201
    assert c.get('/api/inbox',headers=kix).json()[0]['acknowledged_at']
    assert c.get('/api/demo/passenger/2').json()==before
    with connect(app.state.db_path) as db: assert db.execute("SELECT count(*) FROM case_events WHERE type='MESSAGE_ACKNOWLEDGED'").fetchone()[0]==1

def test_two_scheduler_workers_cannot_deliver_a_queue_entry_twice(env):
    from concurrent.futures import ThreadPoolExecutor
    app,c,login=env;occ,care=login('occ'),login('care')
    queued=dispatch(c,care,{'text_en':'Concurrent scheduler sentinel','publish_at':(datetime.now(timezone.utc)+timedelta(hours=1)).isoformat()}).json()
    resume(c,occ)
    with transaction(app.state.db_path) as db: db.execute("UPDATE passenger_dispatches SET publish_at='2000-01-01T00:00:00Z' WHERE id=?",(queued['id'],))
    with ThreadPoolExecutor(max_workers=2) as executor: list(executor.map(run_due,[app.state.db_path]*2))
    assert len(c.get('/api/demo/passenger/2').json()['timeline'])==1
