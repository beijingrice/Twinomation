"""Optional, synthetic bidirectional scenarios and reversible local demo reset."""
import secrets
import sqlite3
from datetime import datetime,timedelta,timezone
from pathlib import Path

from fastapi import Depends
from pydantic import BaseModel,ConfigDict
from .db import BLOCK_MINUTES,CONDITION_KEYS,STATIONS,connect,encode,event,init_db,now,preset_items,transaction
from .extended_ops import ensure_workspace,public_notice,store_operations


def seed_passenger_delays(path):
    """Two named, already-published demo cases; never overwrite existing edits."""
    start=datetime.now(timezone.utc).replace(second=0,microsecond=0)
    with transaction(path) as db:
        for key,name,minutes,cause in [('passenger-short-delay','短延误',45,'WEATHER'),('passenger-long-delay','长延误',180,'TECHNICAL')]:
            if db.execute('SELECT 1 FROM cases WHERE scenario_key=?',(key,)).fetchone(): continue
            stamp=now();scheduled=start+timedelta(minutes=45);departure=scheduled+timedelta(minutes=minutes)
            original=scheduled.isoformat().replace('+00:00','Z');estimated=departure.isoformat().replace('+00:00','Z')
            conditions={k:{'status':'CONFIRMED','note':''} for k in CONDITION_KEYS}
            cid=db.execute('''INSERT INTO cases(flight_no,flight_date,station,origin,destination,reason,status,acknowledged,readiness,conditions,original_departure,proposed_departure,created_at,updated_at,operator,aircraft,flight_status,public_departure,delay_cause,public_gate,scenario_key)
                VALUES(?,?,'KIX','KIX','HKG',?,'OPEN',1,?,?,?,?,?,?,'HK Express (demo)','A321neo (demo)','DELAYED',?,?,'7',?)''',
                (name,scheduled.astimezone(timezone(timedelta(hours=8))).date().isoformat(),'Passenger delay demonstration',encode({'counters':[],'gates':['7'],'note':''}),encode(conditions),original,estimated,stamp,stamp,estimated,cause,key)).lastrowid
            db.execute("INSERT INTO work_orders(case_id,number,status,items,note,proposed_departure,operator_checked,created_by,sent_at,received_at,responded_at,decided_at) VALUES(?,1,'AUTHORIZED',?,?,?,1,'demo.scenario',?,?,?,?)",
                (cid,encode(preset_items(list(CONDITION_KEYS),{k:'Ready' for k in CONDITION_KEYS})),'Synthetic pre-approved resource fixture',estimated,stamp,stamp,stamp,stamp))
            ensure_workspace(db,cid);store_operations(db,cid,{'stage':'preparing'})
            event(db,cid,'DEMO_SCENARIO_LOADED',{'id':'demo.scenario','role':'system'},{'summary':'Synthetic flight scenario loaded'})
            reason_zh,reason_en=('天气影响','weather conditions') if cause=='WEATHER' else ('飞机技术检查','additional aircraft checks')
            time=departure.astimezone(timezone(timedelta(hours=8))).strftime('%H:%M')
            public_notice(db,cid,{'id':'demo.scenario','role':'system'},f'感谢您的等候。「{name}」演示航班因{reason_zh}延误 {minutes} 分钟，预计香港时间 {time} 起飞。请留意本页及机场广播。',f'Thank you for waiting. The “{name}” demo flight is delayed by {minutes} minutes due to {reason_en}. Estimated departure is {time} HKT. Please watch this page and airport announcements.','Synthetic scenario announcement')


def load_scenarios(path):
    start=datetime.now(timezone.utc).replace(second=0,microsecond=0)
    fixtures=[]
    for i,(station,base) in enumerate([('NRT',810),('TPE',820),('BKK',830)]):
        fixtures.append((f'base-{i}',[624,112,700][i],station,True,[600,540,780][i],[75,25,0][i],False,None))
        for j,(outbound,minutes,delay,cancelled) in enumerate([(True,540,0,False),(False,120,0,False),(False,720,45,False),(False,420,0,True),(False,900,0,False)]):
            fixtures.append((f'rotation-{i}-{j}',base+j,station,outbound,minutes+i*60,delay if i!=1 else (55 if j==0 else 65 if j==1 else delay),cancelled,None))
    historical=[('SYX',250,'https://www.hkexpress.com/zh-TW/About-Us/Media-Centre/HK-Express-Takes-Off-to-Sanya-on-10-May'),('PKX',260,'https://www.hkexpress.com/zh-TW/About-Us/Media-Centre/HK-Express-Debuts-Daily-Flights-to-Beijing-Daxing-International-Airport-Starting-12-March'),('CRK',532,'https://www.hkexpress.com/zh-HK/About-Us/Media-Centre/HK-Express-Launches-New-Route-to-Clark-on-6-June')]
    for i,(station,number,source) in enumerate(historical):
        for j,(outbound,delay,cancelled) in enumerate([(True,0,False),(False,0,False),(False,45,False),(False,0,True)]):
            fixtures.append((f'historical-{i}-{j}',number if outbound else number+1,station,outbound,1440+i*90+j*1440,delay,cancelled,source))
    added=0
    with transaction(path) as db:
        for key,number,station,outbound,minutes,delay,cancelled,source in fixtures:
            if db.execute('SELECT 1 FROM cases WHERE scenario_key=?',('friend-'+key,)).fetchone(): continue
            stamp=now();scheduled=start+timedelta(minutes=minutes);departure=scheduled+timedelta(minutes=delay)
            original=scheduled.isoformat().replace('+00:00','Z');estimated=departure.isoformat().replace('+00:00','Z')
            conditions={k:{'status':'CONFIRMED','note':''} for k in CONDITION_KEYS}
            cid=db.execute('''INSERT INTO cases(flight_no,flight_date,station,origin,destination,reason,status,acknowledged,readiness,conditions,original_departure,proposed_departure,created_at,updated_at,operator,aircraft,flight_status,public_departure,delay_cause,public_gate,scenario_key)
              VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',(f'UO{number}',scheduled.astimezone(timezone(timedelta(hours=8))).date().isoformat(),station,'HKG' if outbound else station,station if outbound else 'HKG','Synthetic demonstration scenario','CLOSED' if cancelled else 'OPEN',1,encode({'counters':[],'gates':['D13'],'note':''}),encode(conditions),original,estimated,stamp,stamp,'HK Express (demo)','A321neo (demo)','CANCELLED' if cancelled else 'DELAYED' if delay else 'ON_TIME',None if cancelled else estimated,'OPERATIONAL' if delay or cancelled else None,None if cancelled else 'D13','friend-'+key)).lastrowid
            items=preset_items(list(CONDITION_KEYS),{k:'Ready' for k in CONDITION_KEYS})
            db.execute("INSERT INTO work_orders(case_id,number,status,items,note,proposed_departure,operator_checked,created_by,sent_at,received_at,responded_at,decided_at) VALUES(?,1,'AUTHORIZED',?,?,?,1,'demo.scenario',?,?,?,?)",(cid,encode(items),'Synthetic pre-approved resource fixture',estimated,stamp,stamp,stamp,stamp))
            if outbound: db.execute("UPDATE cases SET public_terminal='T2 (demo)' WHERE id=?",(cid,))
            ensure_workspace(db,cid)
            store_operations(db,cid,{'stage':'preparing' if not cancelled else '', 'reason':'Synthetic aircraft rotation','impact':'Demo scenario; not live flight information.','recommendation':'Follow the latest confirmed arrangements.','next_update':'Pending','schedule_source':source,'arrival':(departure+timedelta(minutes=BLOCK_MINUTES[station])).isoformat().replace('+00:00','Z') if not cancelled else None})
            event(db,cid,'DEMO_SCENARIO_LOADED',{'id':'demo.scenario','role':'system'},{'summary':'Synthetic flight scenario loaded'})
            public_notice(db,cid,{'id':'demo.scenario','role':'system'},f'演示航班 UO{number} '+('已取消。' if cancelled else '延误，请留意最新通知。' if delay else '预计按计划运行。'),f'Demo flight UO{number} '+('is cancelled.' if cancelled else 'is delayed. Please watch for updates.' if delay else 'is expected on time.'),'Synthetic scenario announcement')
            added+=1
    return {'added':added,'scenario_count':len(fixtures),'demo':True}


def network_public(db,case_id):
    import json
    case=db.execute('SELECT destination FROM cases WHERE id=?',(case_id,)).fetchone()
    if not case or case['destination']!='HKG': return []
    flights=[]
    for r in db.execute("SELECT c.*,o.data AS ops FROM cases c LEFT JOIN case_operations o ON o.case_id=c.id WHERE c.origin='HKG' AND c.flight_status IN ('DELAYED','BOARDING','ON_TIME','CANCELLED') ORDER BY coalesce(c.public_departure,c.original_departure) LIMIT 100"):
        stage=json.loads(r['ops'] or '{}').get('stage')
        flights.append({'flight_no':r['flight_no'],'destination':r['destination'],'departure':r['public_departure'] or (r['original_departure'] if r['flight_status']=='CANCELLED' else None),'status':'DEPARTED' if stage in ('departed','arrived') and r['flight_status']!='CANCELLED' else r['flight_status']})
    return flights


class Confirm(BaseModel):
    model_config=ConfigDict(extra='forbid')
    confirmation:str


def install_demo_scenarios(app,path,actor,require_role,fail):
    backup_dir=Path(path).parent/'demo-backups'

    @app.get('/api/demo/scenarios')
    def catalog(who=Depends(actor)):
        require_role(who,'occ')
        with connect(path) as db: loaded=db.execute("SELECT count(*) FROM cases WHERE scenario_key LIKE 'friend-%'").fetchone()[0]
        return {'available':30,'loaded':loaded,'name':'HK Express bidirectional scenarios','backups':sorted(p.stem for p in backup_dir.glob('*.sqlite3')) if backup_dir.exists() else []}

    @app.post('/api/demo/scenarios/load')
    def load(who=Depends(actor)):
        require_role(who,'occ')
        return load_scenarios(path)

    @app.post('/api/demo/reset')
    def reset(body:Confirm,who=Depends(actor)):
        require_role(who,'occ')
        if body.confirmation!='RESET DEMO': fail('CONFIRMATION_REQUIRED','Type RESET DEMO to reset the demo.',422)
        backup_dir.mkdir(parents=True,exist_ok=True)
        bid=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')+'-'+secrets.token_hex(4)
        with sqlite3.connect(path) as src,sqlite3.connect(backup_dir/(bid+'.sqlite3')) as dst: src.backup(dst)
        with transaction(path) as db:
            for table in ['staff_receipts','staff_messages','notice_drafts','passenger_dispatches','ground_tasks','case_operations','broadcast_recipients','broadcasts','weather_briefings','passenger_updates','passengers','case_files','work_orders','case_events','cases','idempotency_keys','settings']:
                db.execute('DELETE FROM '+table)
        init_db(path);load_scenarios(path)
        return {'ok':True,'backup_id':bid,'restorable':True,'demo':True}

    @app.post('/api/demo/restore/{backup_id}')
    def restore(backup_id:str,body:Confirm,who=Depends(actor)):
        require_role(who,'occ')
        if body.confirmation!='RESTORE DEMO': fail('CONFIRMATION_REQUIRED','Type RESTORE DEMO to restore the demo.',422)
        if not backup_id or any(c not in '0123456789Tabcdef-' for c in backup_id): fail('NOT_FOUND','Backup not found.',404)
        source=backup_dir/(backup_id+'.sqlite3')
        if not source.is_file(): fail('NOT_FOUND','Backup not found.',404)
        with sqlite3.connect(source) as src,sqlite3.connect(path) as dst: src.backup(dst)
        init_db(path,seed=False)
        return {'ok':True}

    @app.get('/api/demo/network-connections/{case_id}')
    def network_connections(case_id:int):
        with connect(path) as db:
            case=db.execute('SELECT destination FROM cases WHERE id=?',(case_id,)).fetchone()
            if not case: fail('NOT_FOUND','Flight not found.',404)
            if case['destination']!='HKG': return []
            return network_public(db,case_id)
