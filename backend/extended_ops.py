"""Persistent collaboration, customer-care drafts and local demo notification jobs."""
import json
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import Depends, Header
from pydantic import BaseModel, ConfigDict, Field, field_validator

from .db import connect, encode, event, now, transaction

TASK_STATES=('pending','working','delayed','coordination','done')
STAGES=('', 'preparing','boarding','departed','arrived')
DEFAULT_TASKS=[('Fuel coordination','Confirm the fuel supplier and service readiness.'),('Stand and ground equipment','Confirm stand and ground equipment availability.'),('Load control handover','Confirm load-control handover.'),('Passenger and connection assistance','Confirm passenger and connection assistance.')]


def init_extended(path):
    with connect(path) as db:
        db.execute("UPDATE cases SET origin=station WHERE origin=''")
        db.executescript('''
        CREATE TABLE IF NOT EXISTS case_operations(case_id INTEGER PRIMARY KEY REFERENCES cases(id),version INTEGER NOT NULL DEFAULT 1,data TEXT NOT NULL DEFAULT '{}',updated_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS ground_tasks(id INTEGER PRIMARY KEY,case_id INTEGER NOT NULL REFERENCES cases(id),name TEXT NOT NULL,description TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',version INTEGER NOT NULL DEFAULT 1,updated_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS staff_messages(id INTEGER PRIMARY KEY,case_id INTEGER NOT NULL REFERENCES cases(id),sender_id TEXT NOT NULL,sender_role TEXT NOT NULL,body TEXT NOT NULL,kind TEXT NOT NULL DEFAULT 'message',created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS staff_receipts(message_id INTEGER NOT NULL REFERENCES staff_messages(id),recipient TEXT NOT NULL,acknowledged_at TEXT NOT NULL,PRIMARY KEY(message_id,recipient));
        CREATE TABLE IF NOT EXISTS notice_drafts(case_id INTEGER PRIMARY KEY REFERENCES cases(id),version INTEGER NOT NULL,text_zh TEXT NOT NULL,text_en TEXT NOT NULL,template TEXT NOT NULL,source_event_id INTEGER REFERENCES case_events(id),updated_at TEXT NOT NULL,updated_by TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS passenger_dispatches(id INTEGER PRIMARY KEY,case_id INTEGER NOT NULL REFERENCES cases(id),text_zh TEXT NOT NULL,text_en TEXT NOT NULL,notify INTEGER NOT NULL,email INTEGER NOT NULL,recipient TEXT NOT NULL,includes TEXT NOT NULL,publish_at TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'QUEUED',created_at TEXT NOT NULL,created_by TEXT NOT NULL,sent_at TEXT,email_status TEXT NOT NULL DEFAULT 'not_requested');
        CREATE INDEX IF NOT EXISTS idx_messages_case ON staff_messages(case_id,id);
        CREATE INDEX IF NOT EXISTS idx_dispatch_due ON passenger_dispatches(status,publish_at);
        ''')
    with transaction(path) as db:
        for row in db.execute('SELECT id FROM cases').fetchall(): ensure_workspace(db,row['id'])


def ensure_workspace(db,cid):
    if db.execute('SELECT 1 FROM case_operations WHERE case_id=?',(cid,)).fetchone(): return
    db.execute('INSERT INTO case_operations(case_id,updated_at) VALUES(?,?)',(cid,now()))
    db.executemany('INSERT INTO ground_tasks(case_id,name,description,updated_at) VALUES(?,?,?,?)',[(cid,*task,now()) for task in DEFAULT_TASKS])


def operations(db,cid):
    row=db.execute('SELECT * FROM case_operations WHERE case_id=?',(cid,)).fetchone()
    return {'version':row['version'],**json.loads(row['data'])} if row else {'version':1}


def store_operations(db,cid,data):
    data={k:v for k,v in data.items() if k!='version'}
    db.execute('UPDATE case_operations SET data=?,version=version+1,updated_at=? WHERE case_id=?',(encode(data),now(),cid))


def message(db,cid,who,body,kind='message'):
    mid=db.execute('INSERT INTO staff_messages(case_id,sender_id,sender_role,body,kind,created_at) VALUES(?,?,?,?,?,?)',(cid,who['id'],who['role'],body,kind,now())).lastrowid
    event(db,cid,'STAFF_MESSAGE_SENT',who,{'summary':'Collaboration message sent','message_id':mid})
    return mid


def workspace(db,cid,who):
    return {'operations':operations(db,cid),'tasks':[dict(r) for r in db.execute('SELECT * FROM ground_tasks WHERE case_id=? ORDER BY id',(cid,))],
            'messages':[dict(r) for r in db.execute('SELECT * FROM staff_messages WHERE case_id=? ORDER BY id DESC LIMIT 200',(cid,))],
            'draft':dict(r) if (r:=db.execute('SELECT * FROM notice_drafts WHERE case_id=?',(cid,)).fetchone()) else None,
            'dispatches':[{**dict(r),'includes':json.loads(r['includes'])} for r in db.execute('SELECT * FROM passenger_dispatches WHERE case_id=? ORDER BY id DESC LIMIT 100',(cid,))]}


def public_journey(db,cid):
    from .db import BLOCK_MINUTES
    data=operations(db,cid);case=db.execute('SELECT * FROM cases WHERE id=?',(cid,)).fetchone()
    confirmed=case['status']=='OPEN' and case['public_departure'] and data.get('confirmed_departure')==case['public_departure']
    return {'stage':data.get('stage') if case['status']=='OPEN' else None,
            'boarding_at':data.get('boarding_at') if confirmed and recall_allowed(db,case,{**data,'stage':''}) else None,'recall':data.get('recall') if confirmed and recall_allowed(db,case,data) else None,
            'arrival':(_date(case['public_departure'])+timedelta(minutes=BLOCK_MINUTES.get(case['station'],120))).isoformat().replace('+00:00','Z') if case['public_departure'] else None}


def public_notice(db,cid,who,text_zh,text_en,summary='Passenger notice published'):
    source=event(db,cid,'PUBLIC_NOTIFICATION_CREATED',who,{'summary':summary})
    stamp=now();text=text_en or text_zh
    uid=db.execute("INSERT INTO passenger_updates(case_id,source_event_id,topic,draft_text,final_text,final_text_zh,status,reviewed_by,reviewed_at,published_at,created_at,version) VALUES(?,?,'general',?,?,?,'PUBLISHED',?,?,?,?,2)",(cid,source,text,text,text_zh or None,who['id'],stamp,stamp,stamp)).lastrowid
    event(db,cid,'PASSENGER_NOTICE_PUBLISHED',who,{'summary':summary,'source_event_id':source,'update_id':uid,'template':'custom'})
    return uid


def _date(value):
    return datetime.fromisoformat(value.replace('Z','+00:00')) if value else None


def _time(value):
    return _date(value).astimezone(timezone(timedelta(hours=8))).strftime('%m-%d %H:%M') if value else 'Pending'


def recall_allowed(db,case,data):
    latest=db.execute('SELECT status FROM work_orders WHERE case_id=? ORDER BY number DESC LIMIT 1',(case['id'],)).fetchone()
    return case['status']=='OPEN' and case['flight_status'] in ('DELAYED','BOARDING','ON_TIME') and latest and latest['status']=='AUTHORIZED' and case['public_departure'] and data.get('confirmed_departure')==case['public_departure'] and data.get('stage') not in ('departed','arrived')


def start_recall(db,case,data,who,source):
    rid=event(db,case['id'],'BOARDING_RECALL_STARTED',who,{'summary':'Boarding recall started','source':source})
    data['recall']={'id':rid,'at':now(),'source':source,'gate':case['public_gate']}
    data['recall_sent_for']=data.get('boarding_at');data['stage']='boarding'
    gate=case['public_gate'] or 'the announced gate'
    public_notice(db,case['id'],who,f'航班 {case["flight_no"]} 的旅客，请返回 {gate} 登机口，准备登机牌和旅行证件，并听从现场工作人员指引。',f'Passengers on flight {case["flight_no"]}, please return to gate {gate} with your boarding pass and travel documents, and follow ground staff’s instructions.','Please return to the gate')
    store_operations(db,case['id'],data)


def deliver(db,row):
    case=db.execute('SELECT * FROM cases WHERE id=?',(row['case_id'],)).fetchone();data=operations(db,case['id'])
    zh,en=row['text_zh'] or row['text_en'],row['text_en'] or row['text_zh']
    fields={'departure':('预计起飞','Estimated departure',_time(case['public_departure'])),
            'boarding':('确认登机时间','Confirmed boarding',_time(data.get('boarding_at')) if data.get('confirmed_departure')==case['public_departure'] else 'Pending'),
            'gate':('登机口','Gate',case['public_gate'] or 'Pending'),'arrival':('预计到达','Estimated arrival',_time(public_journey(db,case['id']).get('arrival')))}
    for key in json.loads(row['includes']):
        a,b,value=fields[key];zh+=f'\n{a}：{value}'+('（香港时间）' if key!='gate' else '');en+=f'\n{b}: {value}'+(' (HKT)' if key!='gate' else '')
    who={'id':row['created_by'],'role':'outport' if row['created_by'].startswith('demo.outport.') else 'care'}
    if row['notify']: public_notice(db,case['id'],who,zh,en,'Passenger notification delivered')
    db.execute("UPDATE passenger_dispatches SET status='SENT',sent_at=?,email_status=? WHERE id=?",(now(),'simulated' if row['email'] else 'not_requested',row['id']))
    event(db,case['id'],'DISPATCH_SENT',who,{'summary':'Passenger notification delivered (demo)','dispatch_id':row['id']})


def run_due(path):
    with transaction(path) as db:
        switch=db.execute("SELECT value FROM settings WHERE key='kill_switch'").fetchone()
        if not switch or switch['value']!='false': return
        stamp=now()
        for row in db.execute("SELECT * FROM passenger_dispatches WHERE status='QUEUED' AND publish_at<=? ORDER BY id LIMIT 100",(stamp,)).fetchall(): deliver(db,row)
        for case in db.execute("SELECT c.* FROM cases c JOIN case_operations o ON o.case_id=c.id WHERE c.status='OPEN'").fetchall():
            data=operations(db,case['id'])
            if recall_allowed(db,case,data) and data.get('boarding_at') and _date(data['boarding_at'])<=_date(stamp)<_date(data['confirmed_departure']) and not data.get('recall') and data.get('recall_sent_for')!=data['boarding_at']:
                start_recall(db,case,data,{'id':data.get('confirmed_by','system.scheduler'),'role':'system'},'automatic')


class Body(BaseModel):
    model_config=ConfigDict(extra='forbid',str_strip_whitespace=True)
class MessageInput(Body):
    body:str=Field(default='', max_length=2000)
    kind:Literal['message','progress']='message'
class TaskInput(Body):
    name:str=Field(default='', max_length=80)
    description:str=Field(default='',max_length=240)
class TaskUpdate(Body):
    version:int=Field(ge=1)
    status:Literal[TASK_STATES]
class OperationsInput(Body):
    version:int=Field(ge=1)
    impact:str=Field(default='',max_length=500)
    recommendation:str=Field(default='',max_length=500)
    next_update:str=Field(default='',max_length=40)
    reason:str=Field(default='',max_length=160)
    stage:Literal[STAGES]=''
class BoardingInput(Body):
    version:int=Field(ge=1)
    departure:datetime|None=None
    @field_validator('departure')
    @classmethod
    def aware(cls,value):
        if value and value.utcoffset() is None: raise ValueError('Timezone required')
        return value
class RecallInput(Body):
    version:int=Field(ge=1)
    action:Literal['send','test','end']
class DraftInput(Body):
    version:int=Field(ge=0)
    text_zh:str=Field(default='',max_length=3000)
    text_en:str=Field(default='',max_length=3000)
    template:Literal['flight_update','waiting','connection','care','custom']='custom'
    source_event_id:int|None=None
class DispatchInput(Body):
    text_zh:str=Field(default='',max_length=3000)
    text_en:str=Field(default='',max_length=3000)
    notify:bool=True
    email:bool=False
    recipient:str=Field(default='',max_length=160)
    includes:list[Literal['departure','boarding','gate','arrival']]=Field(default_factory=list,max_length=4)
    publish_at:datetime|None=None
    @field_validator('publish_at')
    @classmethod
    def aware(cls,value):
        if value and value.utcoffset() is None: raise ValueError('Timezone required')
        return value


def install_extended(app,path,actor,require_role,scope_case,fail,idempotent,kill_switch_off):
    def scoped(db,cid,who,*roles):
        require_role(who,*(roles or ('occ','outport','care')))
        return scope_case(db,cid,who)
    def check(data,version):
        if data['version']!=version: fail('VERSION_CONFLICT','This workspace changed. Refresh before continuing.')

    @app.post('/api/cases/{cid}/messages',status_code=201)
    def send_message(cid:int,body:MessageInput,idempotency_key:str=Header(default=''),who=Depends(actor)):
        with transaction(path) as db:
            scoped(db,cid,who,'occ','outport')
            def action():
                mid=message(db,cid,who,body.body or 'No additional details.',body.kind)
                if who['role']=='outport' and body.kind=='message':
                    changed=db.execute("INSERT OR IGNORE INTO staff_receipts SELECT id,?,? FROM staff_messages WHERE case_id=? AND sender_role='occ'",('station.'+who['station'],now(),cid)).rowcount
                    if changed: event(db,cid,'MESSAGE_ACKNOWLEDGED',who,{'summary':'Station reply acknowledged pending OCC messages','count':changed})
                return {'id':mid},201
            return idempotent(db,who,'POST',f'/api/cases/{cid}/messages',idempotency_key,body.model_dump(),action)

    @app.get('/api/inbox')
    def inbox(who=Depends(actor)):
        require_role(who,'occ','outport','care')
        recipient='occ' if who['role']=='occ' else 'station.'+who['station']
        with connect(path) as db:
            sql="SELECT m.*,c.station,c.flight_no,r.acknowledged_at FROM staff_messages m JOIN cases c ON c.id=m.case_id LEFT JOIN staff_receipts r ON r.message_id=m.id AND r.recipient=? WHERE "+("m.sender_role IN ('outport','care')" if who['role']=='occ' else "m.sender_role='occ' AND c.station=?")+' ORDER BY m.id DESC LIMIT 200'
            return [dict(r) for r in db.execute(sql,[recipient] if who['role']=='occ' else [recipient,who['station']])]

    @app.post('/api/inbox/{mid}/acknowledge')
    def acknowledge_message(mid:int,who=Depends(actor)):
        require_role(who,'occ','outport','care')
        with transaction(path) as db:
            row=db.execute('SELECT * FROM staff_messages WHERE id=?',(mid,)).fetchone()
            if not row: fail('NOT_FOUND','Message not found.',404)
            scoped(db,row['case_id'],who)
            if (who['role']=='occ')==(row['sender_role']=='occ'): fail('NOT_FOUND','Message not found.',404)
            key='occ' if who['role']=='occ' else 'station.'+who['station']
            changed=db.execute('INSERT OR IGNORE INTO staff_receipts VALUES(?,?,?)',(mid,key,now())).rowcount
            if changed: event(db,row['case_id'],'MESSAGE_ACKNOWLEDGED',who,{'summary':'Collaboration message acknowledged','message_id':mid})
        return {'ok':True}

    @app.post('/api/cases/{cid}/tasks',status_code=201)
    def add_task(cid:int,body:TaskInput,idempotency_key:str=Header(default=''),who=Depends(actor)):
        with transaction(path) as db:
            case=scoped(db,cid,who,'outport')
            if case['status']!='OPEN': fail('CASE_CLOSED','This case is closed.')
            def action():
                if db.execute('SELECT count(*) FROM ground_tasks WHERE case_id=?',(cid,)).fetchone()[0]>=40: fail('TASK_LIMIT','Keep at most 40 ground tasks.',422)
                tid=db.execute('INSERT INTO ground_tasks(case_id,name,description,updated_at) VALUES(?,?,?,?)',(cid,body.name or 'Custom ground task',body.description,now())).lastrowid
                message(db,cid,who,'New ground task: '+(body.name or 'Custom ground task'),'task')
                return dict(db.execute('SELECT * FROM ground_tasks WHERE id=?',(tid,)).fetchone()),201
            return idempotent(db,who,'POST',f'/api/cases/{cid}/tasks',idempotency_key,body.model_dump(),action)

    @app.put('/api/cases/{cid}/tasks/{tid}')
    def update_task(cid:int,tid:int,body:TaskUpdate,who=Depends(actor)):
        with transaction(path) as db:
            case=scoped(db,cid,who,'outport')
            if case['status']!='OPEN': fail('CASE_CLOSED','This case is closed.')
            row=db.execute('SELECT * FROM ground_tasks WHERE id=? AND case_id=?',(tid,cid)).fetchone()
            if not row: fail('NOT_FOUND','Task not found.',404)
            check(dict(row),body.version)
            db.execute('UPDATE ground_tasks SET status=?,version=version+1,updated_at=? WHERE id=?',(body.status,now(),tid))
            message(db,cid,who,f'{row["name"]}: {body.status}','task')
        return {'ok':True}

    @app.put('/api/cases/{cid}/operations')
    def update_operations(cid:int,body:OperationsInput,who=Depends(actor)):
        with transaction(path) as db:
            case=scoped(db,cid,who,'occ');data=operations(db,cid);check(data,body.version)
            if case['status']!='OPEN': fail('CASE_CLOSED','This case is closed.')
            stage_changed=body.stage!=data.get('stage','')
            if stage_changed:
                kill_switch_off(db)
                if body.stage in ('boarding','departed','arrived') and not recall_allowed(db,case,{**data,'stage':'' ,'confirmed_departure':case['public_departure']}): fail('AUTHORISATION_REQUIRED','OCC must authorise ready resources and a departure before advancing the journey.')
                if body.stage in ('departed','arrived'): data['recall']=None
            data.update(body.model_dump(exclude={'version'}))
            if case['public_departure']:
                from .db import BLOCK_MINUTES
                data['arrival']=(_date(case['public_departure'])+timedelta(minutes=BLOCK_MINUTES.get(case['station'],120))).isoformat().replace('+00:00','Z')
            store_operations(db,cid,data)
            message(db,cid,who,'Operations handover updated. '+body.reason+' '+body.impact+' '+body.recommendation,'operations')
            if stage_changed: public_notice(db,cid,who,'航班进度已更新：'+{'':'待确认','preparing':'航班准备','boarding':'前往登机口','departed':'已起飞','arrived':'已抵达'}[body.stage],'Flight progress updated: '+(body.stage or 'awaiting confirmation'),'Flight progress updated')
        return {'ok':True}

    @app.put('/api/cases/{cid}/boarding')
    def confirm_boarding(cid:int,body:BoardingInput,who=Depends(actor)):
        with transaction(path) as db:
            case=scoped(db,cid,who,'outport','occ');data=operations(db,cid);check(data,body.version)
            origin=case['origin'] if 'origin' in case.keys() else case['station']
            if who['role']=='outport' and origin!=who['station']: fail('FORBIDDEN','Only the departure station can control boarding.',403)
            if case['status']!='OPEN' or data.get('stage') in ('departed','arrived'): fail('INVALID_TRANSITION','Boarding cannot be changed after cancellation or departure.')
            departure=body.departure.astimezone(timezone.utc).isoformat().replace('+00:00','Z') if body.departure else None
            if departure and _date(departure)<_date(case['original_departure']): fail('VALIDATION_ERROR','Confirmed departure cannot be earlier than scheduled.',422)
            data.update(confirmed_departure=departure,boarding_at=(_date(departure)-timedelta(minutes=30)).isoformat().replace('+00:00','Z') if departure else None,confirmed_by=who['id'],recall=None,recall_sent_for=None)
            store_operations(db,cid,data)
            message(db,cid,who,'Departure confirmation: '+(_time(departure) if departure else 'cleared'),'boarding')
        return {'ok':True}

    @app.post('/api/cases/{cid}/recall')
    def recall(cid:int,body:RecallInput,who=Depends(actor)):
        with transaction(path) as db:
            case=scoped(db,cid,who,'outport','occ');data=operations(db,cid);check(data,body.version)
            origin=case['origin'] if 'origin' in case.keys() else case['station']
            if who['role']=='outport' and origin!=who['station']: fail('FORBIDDEN','Only the departure station can control boarding.',403)
            kill_switch_off(db)
            if body.action=='end':
                if not data.get('recall'): fail('INVALID_TRANSITION','No active boarding recall.')
                data['recall']=None;store_operations(db,cid,data)
                public_notice(db,cid,who,'登机提醒已结束，请留意机场广播。','The boarding reminder has ended. Please watch airport announcements.','Boarding recall ended')
            else:
                if not recall_allowed(db,case,data): fail('AUTHORISATION_REQUIRED','Confirm the OCC-approved departure and ready resources before recalling passengers.')
                if data.get('recall'): fail('INVALID_TRANSITION','A boarding recall is already active.')
                start_recall(db,case,data,who,'test' if body.action=='test' else 'manual')
        return {'ok':True}

    @app.put('/api/cases/{cid}/notice-draft')
    def save_draft(cid:int,body:DraftInput,who=Depends(actor)):
        with transaction(path) as db:
            scoped(db,cid,who,'outport','care')
            old=db.execute('SELECT * FROM notice_drafts WHERE case_id=?',(cid,)).fetchone()
            if (old['version'] if old else 0)!=body.version: fail('VERSION_CONFLICT','The notice draft changed. Reopen it before saving.')
            if body.source_event_id and not db.execute('SELECT 1 FROM case_events WHERE id=? AND case_id=?',(body.source_event_id,cid)).fetchone(): fail('NOT_FOUND','Timeline event not found.',404)
            db.execute('INSERT INTO notice_drafts VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(case_id) DO UPDATE SET version=excluded.version,text_zh=excluded.text_zh,text_en=excluded.text_en,template=excluded.template,source_event_id=excluded.source_event_id,updated_at=excluded.updated_at,updated_by=excluded.updated_by',(cid,body.version+1,body.text_zh,body.text_en,body.template,body.source_event_id,now(),who['id']))
            event(db,cid,'NOTICE_DRAFT_SAVED',who,{'summary':'Passenger notice draft saved'})
            return dict(db.execute('SELECT * FROM notice_drafts WHERE case_id=?',(cid,)).fetchone())

    @app.post('/api/cases/{cid}/dispatches',status_code=201)
    def create_dispatch(cid:int,body:DispatchInput,idempotency_key:str=Header(default=''),who=Depends(actor)):
        with transaction(path) as db:
            scoped(db,cid,who,'outport','care')
            if not(body.text_zh or body.text_en):
                body=body.model_copy(update={'text_zh':'感谢您的等候，请留意本页及机场广播的最新通知。','text_en':'Thank you for waiting. Please watch this page and airport announcements for updates.'})
            if body.email and not body.recipient: body=body.model_copy(update={'recipient':'demo@example.test'})
            if not(body.notify or body.email): fail('VALIDATION_ERROR','Write a message and select a delivery channel.',422)
            if body.email and ('@' not in body.recipient or any(c.isspace() for c in body.recipient)): fail('VALIDATION_ERROR','Enter a test email address.',422)
            when=body.publish_at.astimezone(timezone.utc).isoformat().replace('+00:00','Z') if body.publish_at else now()
            def action():
                immediate=_date(when)<=_date(now())
                if immediate: kill_switch_off(db)
                did=db.execute('INSERT INTO passenger_dispatches(case_id,text_zh,text_en,notify,email,recipient,includes,publish_at,created_at,created_by) VALUES(?,?,?,?,?,?,?,?,?,?)',(cid,body.text_zh,body.text_en,int(body.notify),int(body.email),body.recipient if body.email else '',encode(list(dict.fromkeys(body.includes))),when,now(),who['id'])).lastrowid
                if immediate: deliver(db,db.execute('SELECT * FROM passenger_dispatches WHERE id=?',(did,)).fetchone())
                else: event(db,cid,'DISPATCH_SCHEDULED',who,{'summary':'Passenger notification scheduled','dispatch_id':did})
                return {'id':did,'status':'SENT' if immediate else 'QUEUED','email_delivery':'simulated_only'},201
            return idempotent(db,who,'POST',f'/api/cases/{cid}/dispatches',idempotency_key,body.model_dump(mode='json'),action)

    @app.post('/api/cases/{cid}/dispatches/{did}/cancel')
    def cancel_dispatch(cid:int,did:int,who=Depends(actor)):
        with transaction(path) as db:
            scoped(db,cid,who,'outport','care')
            if not db.execute("UPDATE passenger_dispatches SET status='CANCELLED' WHERE id=? AND case_id=? AND status='QUEUED'",(did,cid)).rowcount: fail('INVALID_TRANSITION','This notification has already been handled.')
            event(db,cid,'DISPATCH_CANCELLED',who,{'summary':'Scheduled notification cancelled','dispatch_id':did})
        return {'ok':True}
