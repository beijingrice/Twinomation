"""Internal OCC broadcasts and explicit demo weather-briefing workflows."""
import json
from typing import Literal

from fastapi import Depends, Header
from pydantic import BaseModel,ConfigDict,Field,field_validator

from .db import STATIONS,connect,encode,event,now,transaction
from .weather_briefings import parse_briefing,sample_briefing

STATION_CODES={s['code'] for s in STATIONS}
REGION_CODES={s['region'] for s in STATIONS}


class ServiceInput(BaseModel):
    model_config=ConfigDict(extra='forbid',str_strip_whitespace=True)


class BroadcastInput(ServiceInput):
    title:str=Field(default='',max_length=120)
    body:str=Field(default='',max_length=4000)
    scope:Literal['all','regions','stations']
    targets:list[str]=Field(default_factory=list,max_length=32)
    priority:Literal['normal','important']='normal'

    @field_validator('targets')
    @classmethod
    def clean_targets(cls,values):
        values=[v.strip().upper() for v in values]
        if len(values)!=len(set(values)): raise ValueError('Duplicate recipients')
        return values


class BriefingInput(ServiceInput):
    source_name:str=Field(default='Demo route briefing',max_length=120)
    raw_text:str=Field(default='',max_length=16000)


class SaveBriefingInput(BriefingInput):
    previous_id:int|None=Field(default=None,ge=1)


def install_station_services(app,path,actor,require_role,fail,idempotent):
    def station_scope(code,who):
        require_role(who,'occ','outport','care')
        if code not in STATION_CODES or who['role'] in ('outport','care') and who['station']!=code:
            fail('NOT_FOUND','Station not found.',404)

    def broadcast_json(db,row,who):
        result=dict(row);result['targets']=json.loads(result['targets'])
        sql='SELECT station,acknowledged_at FROM broadcast_recipients WHERE broadcast_id=?'
        args=[row['id']]
        if who['role'] in ('outport','care'): sql+=' AND station=?';args.append(who['station'])
        result['recipients']=[dict(r) for r in db.execute(sql+' ORDER BY station',args)]
        return result

    def scoped_broadcast(db,bid,who):
        row=db.execute('SELECT * FROM broadcasts WHERE id=?',(bid,)).fetchone()
        if not row or who['role'] in ('outport','care') and not db.execute('SELECT 1 FROM broadcast_recipients WHERE broadcast_id=? AND station=?',(bid,who['station'])).fetchone():
            fail('NOT_FOUND','Broadcast not found.',404)
        return row

    @app.get('/api/broadcasts')
    def broadcasts(who=Depends(actor)):
        require_role(who,'occ','outport','care')
        with connect(path) as db:
            rows=db.execute('SELECT * FROM broadcasts ORDER BY id DESC LIMIT 100').fetchall() if who['role']=='occ' else db.execute('SELECT b.* FROM broadcasts b JOIN broadcast_recipients r ON r.broadcast_id=b.id WHERE r.station=? ORDER BY b.id DESC LIMIT 100',(who['station'],)).fetchall()
            return [broadcast_json(db,row,who) for row in rows]

    @app.post('/api/broadcasts',status_code=201)
    def send_broadcast(body:BroadcastInput,idempotency_key:str=Header(default=''),who=Depends(actor)):
        require_role(who,'occ')
        valid=(body.scope=='all' and not body.targets or body.scope=='regions' and body.targets and set(body.targets)<=REGION_CODES or body.scope=='stations' and body.targets and set(body.targets)<=STATION_CODES)
        if not valid: fail('VALIDATION_ERROR','Choose valid broadcast recipients.',422)
        recipients=[s['code'] for s in STATIONS if body.scope=='all' or body.scope=='regions' and s['region'] in body.targets or body.scope=='stations' and s['code'] in body.targets]
        with transaction(path) as db:
            def action():
                bid=db.execute('INSERT INTO broadcasts(title,body,scope,targets,priority,created_at,created_by) VALUES(?,?,?,?,?,?,?)',(body.title or 'OCC broadcast',body.body or 'Demo coordination message.',body.scope,encode(body.targets),body.priority,now(),who['id'])).lastrowid
                db.executemany('INSERT INTO broadcast_recipients(broadcast_id,station) VALUES(?,?)',[(bid,s) for s in recipients])
                event(db,None,'BROADCAST_SENT',who,{'summary':'OCC broadcast sent','broadcast_id':bid,'recipients':recipients})
                return broadcast_json(db,db.execute('SELECT * FROM broadcasts WHERE id=?',(bid,)).fetchone(),who),201
            return idempotent(db,who,'POST','/api/broadcasts',idempotency_key,body.model_dump(mode='json'),action)

    @app.get('/api/broadcasts/{broadcast_id}')
    def broadcast_detail(broadcast_id:int,who=Depends(actor)):
        require_role(who,'occ','outport','care')
        with connect(path) as db: return broadcast_json(db,scoped_broadcast(db,broadcast_id,who),who)

    @app.post('/api/broadcasts/{broadcast_id}/acknowledge')
    def acknowledge(broadcast_id:int,body:ServiceInput,who=Depends(actor)):
        require_role(who,'outport','care')
        with transaction(path) as db:
            scoped_broadcast(db,broadcast_id,who)
            receipt=db.execute('SELECT * FROM broadcast_recipients WHERE broadcast_id=? AND station=?',(broadcast_id,who['station'])).fetchone()
            if not receipt['acknowledged_at']:
                db.execute('UPDATE broadcast_recipients SET acknowledged_at=?,acknowledged_by=? WHERE broadcast_id=? AND station=?',(now(),who['id'],broadcast_id,who['station']))
                event(db,None,'BROADCAST_ACKNOWLEDGED',who,{'summary':'Broadcast acknowledged','broadcast_id':broadcast_id,'station':who['station']})
        return {'ok':True}

    def briefing_json(row):
        if not row: return None
        result=dict(row);result['parsed']=json.loads(result.pop('parsed_json'));result['demo']=True
        return result

    @app.get('/api/stations/{station}/weather-briefings/latest')
    def weather_latest(station:str,who=Depends(actor)):
        station_scope(station,who)
        with connect(path) as db: return briefing_json(db.execute('SELECT * FROM weather_briefings WHERE station=? ORDER BY id DESC LIMIT 1',(station,)).fetchone())

    @app.get('/api/stations/{station}/weather-briefings/sample')
    def weather_sample(station:str,who=Depends(actor)):
        station_scope(station,who)
        return {'source_name':'Demo route briefing','raw_text':sample_briefing(station),'demo':True}

    def parse(body,station):
        try: return parse_briefing(body.raw_text or sample_briefing(station),station)
        except ValueError as error: fail('BRIEFING_FORMAT',str(error),422)

    @app.post('/api/stations/{station}/weather-briefings/parse')
    def weather_preview(station:str,body:BriefingInput,who=Depends(actor)):
        require_role(who,'occ','outport')
        station_scope(station,who)
        return parse(body,station)

    @app.post('/api/stations/{station}/weather-briefings',status_code=201)
    def weather_save(station:str,body:SaveBriefingInput,idempotency_key:str=Header(default=''),who=Depends(actor)):
        require_role(who,'occ','outport')
        station_scope(station,who)
        raw=body.raw_text or sample_briefing(station)
        parsed=parse(body.model_copy(update={'raw_text':raw}),station)
        with transaction(path) as db:
            def action():
                latest=db.execute('SELECT id FROM weather_briefings WHERE station=? ORDER BY id DESC LIMIT 1',(station,)).fetchone()
                if (latest['id'] if latest else None)!=body.previous_id: fail('VERSION_CONFLICT','The weather briefing changed. Reopen it before saving.')
                bid=db.execute('INSERT INTO weather_briefings(station,source_name,raw_text,parsed_json,created_at,created_by) VALUES(?,?,?,?,?,?)',(station,body.source_name or 'Demo route briefing',raw,encode(parsed),now(),who['id'])).lastrowid
                event(db,None,'WEATHER_BRIEFING_UPDATED',who,{'summary':'Weather briefing updated','station':station,'briefing_id':bid})
                return briefing_json(db.execute('SELECT * FROM weather_briefings WHERE id=?',(bid,)).fetchone()),201
            return idempotent(db,who,'POST',f'/api/stations/{station}/weather-briefings',idempotency_key,body.model_dump(mode='json'),action)
