import React,{useRef,useState} from 'react';
import {BellRing,ClipboardList,MessageSquare,Send,Users} from 'lucide-react';
import {api} from './api';
import {t} from './i18n';
import {Modal,Pill,Widget,dateOf,timeOf} from './components';
import TimeWheel,{hktInput,fromHkt} from './TimeWheel';
import {markSaved,mayLeave} from './draftGuard';

const TASKS={pending:'Not completed',working:'In progress',delayed:'Delayed',coordination:'Needs coordination',done:'Completed'};
const STAGES={'':'Unconfirmed',preparing:'Flight preparation',boarding:'Go to gate',departed:'Departed',arrived:'Arrived'};
const PRESETS=[['Weather','Weather affects the operating window.','Check departure and destination weather and the next update.'],['Air traffic control','The flight is waiting for an operating slot.','Confirm the latest slot and boarding arrangements.'],['Late arriving aircraft','The inbound aircraft is late.','Confirm arrival and turnaround readiness.'],['Aircraft check','Additional technical checks are required.','Check engineering progress and the next update.'],['Ground arrangements','Ground tasks need coordination.','Confirm outstanding tasks and completion times.'],['Crew scheduling','Crew arrangements need confirmation.','Check crew availability and duty-time arrangements.'],['Airport restrictions','Airport capacity or facilities affect the flight.','Check airport restrictions and the expected next update.']];

function Compose({run,path,label,kind='message'}) {
  const [value,setValue]=useState('');const key=useRef(crypto.randomUUID());
  return <form className="staff-compose" onSubmit={async e=>{e.preventDefault();const form=e.currentTarget;if(await run(form,path,{method:'POST',key:key.current,body:{body:value||t('No additional details.'),kind}})){setValue('');key.current=crypto.randomUUID();}}}>
    <label>{t(label)}<textarea value={value} maxLength={2000} rows={3} onChange={e=>setValue(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();e.currentTarget.form.requestSubmit();}}}/></label><button className="button primary"><Send size={16}/>{t('Send')}</button>
  </form>;
}

function Handover({record,run}) {
  const op=record.workspace.operations;
  const [data,setData]=useState({impact:op.impact||'',recommendation:op.recommendation||'',reason:op.reason||'',next_update:op.next_update||'',stage:op.stage||''});
  const arrival=record.public_departure?new Date(new Date(record.public_departure).getTime()+(record.block_minutes||270)*60000).toISOString():null;
  return <form className="handover-form" onSubmit={e=>{e.preventDefault();run(e.currentTarget,`/cases/${record.id}/operations`,{method:'PUT',body:{version:op.version,...data}});}}>
    <div className="form-grid"><label>{t('Delay handover preset')}<select defaultValue="" onChange={e=>{const preset=PRESETS[Number(e.target.value)];if(preset)setData(d=>({...d,reason:t(preset[0]),impact:t(preset[1]),recommendation:t(preset[2])}));}}><option value="">{t('Choose a preset')}</option>{PRESETS.map(([name],i)=><option key={name} value={i}>{t(name)}</option>)}</select></label>
    <label>{t('Confirmed journey stage')}<select value={data.stage} onChange={e=>setData({...data,stage:e.target.value})}>{Object.entries(STAGES).map(([key,label])=><option key={key} value={key}>{t(label)}</option>)}</select></label></div>
    <label>{t('Internal reason')}<input value={data.reason} maxLength={160} onChange={e=>setData({...data,reason:e.target.value})}/></label>
    <div className="form-grid"><label>{t('Operational impact')}<textarea value={data.impact} maxLength={500} onChange={e=>setData({...data,impact:e.target.value})}/></label><label>{t('Station handover recommendation')}<textarea value={data.recommendation} maxLength={500} onChange={e=>setData({...data,recommendation:e.target.value})}/></label></div>
    <div className="form-grid"><label>{t('Next update')}<input value={data.next_update} maxLength={40} onChange={e=>setData({...data,next_update:e.target.value})}/></label><div className="notice">{t('Estimated arrival · destination local time')}<strong>{arrival?new Intl.DateTimeFormat(undefined,{timeZone:record.destination_timezone||'Asia/Hong_Kong',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(arrival))+' · '+(record.destination_timezone||'Asia/Hong_Kong'):t('Time pending')}</strong></div></div>
    <p className="content-note">{t('Operational times and cancellation remain controlled by OCC work-order authorisation. Saving a journey stage publishes that stage.')}</p><button className="button primary">{t('Save handover')}</button>
  </form>;
}

function Boarding({record,role,run}) {
  const [confirm,setConfirm]=useState(null);
  const op=record.workspace.operations;const [value,setValue]=useState(hktInput(op.confirmed_departure||record.public_departure||record.original_departure));
  const editable=role!=='care'&&(role==='occ'||!record.origin||record.origin===record.station)&&record.status==='OPEN'&&!['departed','arrived'].includes(op.stage);
  const approved=record.public_departure&&op.confirmed_departure===record.public_departure;
  return <section className="station-board"><h3><BellRing size={19}/>{t('Boarding reminder')}</h3><p>{op.boarding_at?`${t('Reminder at')} ${dateOf(op.boarding_at)} ${timeOf(op.boarding_at)}`:t('Confirm departure to schedule a reminder 30 minutes earlier.')}</p>
    {op.confirmed_departure&&!approved&&<p className="notice warn">{t('Waiting for OCC to authorise this departure. No passenger reminder will be sent yet.')}</p>}
    {op.recall&&<Pill tone="warn">{t('Passengers have been recalled')}</Pill>}
    {editable&&<><form onSubmit={e=>{e.preventDefault();run(e.currentTarget,`/cases/${record.id}/boarding`,{method:'PUT',body:{version:op.version,departure:fromHkt(value)}});}}><TimeWheel value={value} onChange={setValue} label={t('Confirmed departure · HKT')} optional/><button className="button primary">{t('Save confirmed departure')}</button></form>
    <div className="button-row">{(op.recall?[['end','End reminder']]:[['send','Recall passengers now'],['test','Simulate reminder time']]).map(([action,label])=><button key={action} type="button" className="button glass" onClick={()=>{setConfirm(action);}}>{t(label)}</button>)}</div></>}
    {confirm&&<Modal title={t('Confirm this passenger reminder action?')} eyebrow={record.flight_no} onClose={()=>setConfirm(null)}><p>{t(confirm==='end'?'End the current boarding reminder.':'This will notify passengers to return to the gate. Test reminders are also visible on this demo’s passenger page.')}</p><div className="modal-actions"><button className="button glass" onClick={()=>setConfirm(null)}>{t('Cancel')}</button><button className="button primary" onClick={async()=>{await run(null,`/cases/${record.id}/recall`,{method:'POST',body:{version:op.version,action:confirm}});setConfirm(null);}}>{t('Confirm reminder')}</button></div></Modal>}
  </section>;
}

function Dispatch({record,run}) {
  const [zh,setZh]=useState(''),[en,setEn]=useState(''),[notify,setNotify]=useState(true),[email,setEmail]=useState(false),[recipient,setRecipient]=useState(''),[when,setWhen]=useState(''),[include,setInclude]=useState(['departure']),[preview,setPreview]=useState(false);
  const key=useRef(crypto.randomUUID());
  const textZh=zh.trim()||en.trim()?zh||en:t('Thank you for waiting. Please watch this page and airport announcements for updates.');
  const textEn=en.trim()||zh.trim()?en||zh:'Thank you for waiting. Please watch this page and airport announcements for updates.';
  const address=recipient.trim()||'demo@example.test';
  return <><h3>{t('Passenger notifications & demo email')}</h3><p className="content-note">{t('Email is simulated locally. Scheduled messages run while the demo server is running and respect OCC’s publishing pause.')}</p>
    <form className="dispatch-form" onSubmit={async e=>{e.preventDefault();if(!preview){setPreview(true);return;}if(await run(e.currentTarget,`/cases/${record.id}/dispatches`,{method:'POST',key:key.current,body:{text_zh:textZh,text_en:textEn,notify,email,recipient:address,includes:include,publish_at:fromHkt(when)}})){setZh('');setEn('');setWhen('');setPreview(false);key.current=crypto.randomUUID();}}}>
      {!preview?<><div className="form-grid"><label>{t('Chinese notice')}<textarea value={zh} maxLength={3000} onChange={e=>setZh(e.target.value)}/></label><label>{t('English notice')}<textarea value={en} maxLength={3000} onChange={e=>setEn(e.target.value)}/></label></div>
      <fieldset><legend>{t('Include approved flight information')}</legend>{[['departure','Estimated departure'],['boarding','Confirmed boarding'],['gate','Gate'],['arrival','Estimated arrival']].map(([key,label])=><label key={key}><input type="checkbox" checked={include.includes(key)} onChange={()=>setInclude(a=>a.includes(key)?a.filter(x=>x!==key):[...a,key])}/>{t(label)}</label>)}</fieldset>
      <div className="button-row"><label><input type="checkbox" checked={notify} onChange={e=>setNotify(e.target.checked)}/>{t('Passenger page notification')}</label><label><input type="checkbox" checked={email} onChange={e=>setEmail(e.target.checked)}/>{t('Simulate email')}</label></div>
      {email&&<label>{t('Test email recipient')}<input type="email" value={recipient} maxLength={160} onChange={e=>setRecipient(e.target.value)}/></label>}
      <label>{t('Schedule · HKT (empty means now)')}<input type="datetime-local" value={when} onChange={e=>setWhen(e.target.value)}/></label><button className="button primary" disabled={!(notify||email)}>{t('Preview notification')}</button></>
      :<><div className="notice-preview"><p>{textZh}</p><p>{textEn}</p>{include.length>0&&<p className="content-note">{include.map(k=>t({departure:'Estimated departure',boarding:'Confirmed boarding',gate:'Gate',arrival:'Estimated arrival'}[k])).join(' · ')} — {t('Fields use approved information at delivery time.')}</p>}<small>{when?`${t('Scheduled')} ${when}`:t('Send immediately')} · {notify?t('Passenger page notification'):''} {email?`${t('Simulated email')} · ${address}`:''}</small></div><div className="button-row"><button type="button" className="button glass" onClick={e=>{e.preventDefault();setPreview(false);}}>{t('Back to editing')}</button><button className="button primary">{t('Confirm and send / schedule')}</button></div></>}
    </form><ol className="dispatch-history">{record.workspace.dispatches.map(d=><li key={d.id}><Pill tone={d.status==='SENT'?'good':d.status==='QUEUED'?'warn':'muted'}>{t(d.status)}</Pill><small>{dateOf(d.sent_at||d.publish_at)} {timeOf(d.sent_at||d.publish_at)} · {d.email?t('Simulated email'):t('Passenger page notification')}</small><p>{d.text_zh||d.text_en}</p>{d.email&&<small>{d.recipient}</small>}{d.status==='QUEUED'&&<button className="button glass small" onClick={()=>run(null,`/cases/${record.id}/dispatches/${d.id}/cancel`,{method:'POST',body:{}})}>{t('Cancel scheduled message')}</button>}</li>)}</ol>
  </>;
}

export default function CaseWorkspace({record,role,token,onChanged,onEditNotice}) {
  const [tab,setTab]=useState(role==='care'?'care':'team'),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const running=useRef(false),newTaskKey=useRef(crypto.randomUUID());
  const run=async(form,path,options)=>{if(running.current)return null;running.current=true;setBusy(true);setError('');try{const result=await api(path,{token,...options});markSaved(form);await onChanged();return result;}catch(e){setError(e.message);return null;}finally{setBusy(false);running.current=false;}};
  const ws=record.workspace;if(!ws)return null;
  return <Widget span={6} icon={Users} label={t('Flight collaboration')} className="case-workspace"><div className="workspace-tabs">{[['team','Tasks & messages'],['care','Passenger care'],...(role==='occ'?[['operations','OCC handover']]:[])].map(([key,label])=><button type="button" key={key} aria-pressed={tab===key} onClick={()=>{if(mayLeave(t('Discard unsaved changes?')))setTab(key);}}>{t(label)}</button>)}</div>
    {error&&<div className="banner bad" role="alert">{t(error)}</div>}<fieldset disabled={busy} className="workspace-content">
    {tab==='team'&&<div className="team-columns"><section><h3><ClipboardList size={18}/>{t('Ground task progress')} · {ws.tasks.filter(t=>t.status==='done').length}/{ws.tasks.length}</h3><p className="content-note">{t('These progress tasks support handover. Work-order resource answers still require a separate reply and OCC review.')}</p><div className="ground-task-list">{ws.tasks.map(task=><div key={task.id}><span><strong>{t(task.name)}</strong><small>{t(task.description)} · {timeOf(task.updated_at)}</small></span>{role==='outport'&&record.status==='OPEN'?<select aria-label={`${t(task.name)} ${t('Status')}`} value={task.status} onChange={e=>{if(mayLeave(t('Discard unsaved changes?')))run(null,`/cases/${record.id}/tasks/${task.id}`,{method:'PUT',body:{version:task.version,status:e.target.value}});}}>{Object.entries(TASKS).map(([key,label])=><option key={key} value={key}>{t(label)}</option>)}</select>:<Pill>{t(TASKS[task.status])}</Pill>}</div>)}</div>
      {role==='outport'&&record.status==='OPEN'&&<><form onSubmit={async e=>{e.preventDefault();const form=e.currentTarget;const f=new FormData(form);if(await run(form,`/cases/${record.id}/tasks`,{method:'POST',key:newTaskKey.current,body:{name:f.get('name'),description:f.get('description')}})){form.reset();newTaskKey.current=crypto.randomUUID();}}}><label>{t('Custom ground task')}<input name="name" maxLength={80}/></label><label>{t('Task details')}<input name="description" maxLength={240}/></label><button className="button glass">{t('Add task')}</button></form><Compose path={`/cases/${record.id}/messages`} run={run} kind="progress" label="Record station progress"/></>}
      {ws.operations.impact&&<div className="notice"><strong>{t('Operational impact')}</strong><p>{t(ws.operations.impact)}</p><strong>{t('Station handover recommendation')}</strong><p>{t(ws.operations.recommendation)}</p></div>}</section>
      <section><h3><MessageSquare size={18}/>{t('Collaboration messages')}</h3><div className="staff-message-list">{[...ws.messages].reverse().map(m=><article key={m.id} className={m.sender_role==='occ'?'occ-message':'station-message'}><small>{t(m.sender_role==='occ'?'OCC':'Station')} · {dateOf(m.created_at)} {timeOf(m.created_at)}</small><p>{m.body}</p></article>)}{!ws.messages.length&&<p className="muted">{t('No collaboration messages yet')}</p>}</div>{role!=='care'&&<Compose path={`/cases/${record.id}/messages`} run={run} label="Send a collaboration message"/>}</section></div>}
    {tab==='care'&&<><Boarding key={ws.operations.version} record={record} role={role} run={run}/>{role!=='occ'&&<><div className="notice-draft-card"><h3>{t('Passenger announcement')}</h3><p>{ws.draft?(ws.draft.text_zh||ws.draft.text_en):t('Write a bilingual notice or apply a template.')}</p><button className="button primary" onClick={()=>onEditNotice(record.events[0])}>{t(ws.draft?'Continue saved draft':'Edit passenger notice')}</button></div><Dispatch record={record} run={run}/></>}</>}
    {tab==='operations'&&role==='occ'&&<Handover key={ws.operations.version} record={record} run={run}/>}
    </fieldset>
  </Widget>;
}

export function InboxPage({inbox,broadcasts,mode,onAcknowledge,onBroadcastAck,onOpen,clock}) {
  const [pending,setPending]=useState(false);
  const items=[...inbox.map(m=>({...m,key:'message-'+m.id,label:m.flight_no,kind:'message'})),...(mode==='occ'?[]:broadcasts.map(b=>({...b,key:'broadcast-'+b.id,label:'OCC · '+b.title,kind:'broadcast',acknowledged_at:b.recipients[0]?.acknowledged_at})))].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
  return <><div className="hero"><h1>{t('Message inbox')}</h1><div className="hero-value">{items.filter(m=>!m.acknowledged_at).length}</div><p>{t('Messages awaiting acknowledgement')}</p><button className="button glass" aria-pressed={pending} onClick={()=>setPending(v=>!v)}>{t(pending?'Show all messages':'Only unacknowledged')}</button></div><div className="grid">{items.filter(m=>!pending||!m.acknowledged_at).map(m=>{const overdue=mode!=='occ'&&!m.acknowledged_at&&+clock-Date.parse(m.created_at)>=300000;return <Widget key={m.key} span={6} icon={MessageSquare} label={`${m.label} · ${dateOf(m.created_at)} ${timeOf(m.created_at)}`} className={overdue?'inbox-overdue':''}>{overdue&&<Pill tone="warn">{t('Unacknowledged for over 5 minutes')}</Pill>}<p className="broadcast-body">{m.body}</p><div className="button-row">{m.case_id&&<button className="button glass" onClick={()=>onOpen(m.case_id)}>{t('Open flight')}</button>}{m.acknowledged_at?<Pill tone="good">{t('Acknowledged')}</Pill>:<button className="button primary" onClick={()=>m.kind==='broadcast'?onBroadcastAck(m.id):onAcknowledge(m.id)}>{t('Acknowledge receipt')}</button>}</div></Widget>;})}{!items.length&&<Widget span={6} label={t('Messages')}><p>{t('No collaboration messages yet')}</p></Widget>}</div></>;
}
