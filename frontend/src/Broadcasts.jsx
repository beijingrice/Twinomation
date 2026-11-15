import React,{useRef,useState} from 'react';
import {ArrowLeft,CheckCheck,Eye,Megaphone,Send} from 'lucide-react';
import {t} from './i18n';
import {Hero,Pill,Widget,dateOf,timeOf} from './components';
import {REGIONS} from './constants';
import {broadcastTargets} from './stationServices';

export function BroadcastForm({stations,initial,busy,onSubmit}) {
  const [scope,setScope]=useState(initial?.scope||'all');
  const [targets,setTargets]=useState(initial?.targets||[]);
  const [title,setTitle]=useState('');const [body,setBody]=useState('');
  const [priority,setPriority]=useState('normal');const [preview,setPreview]=useState(false);
  const key=useRef(crypto.randomUUID());
  const recipients=broadcastTargets(stations,scope,targets);
  const valid=recipients.length>0;
  const finalTitle=title.trim()||t('OCC broadcast'),finalBody=body.trim()||t('Demo coordination message.');
  const toggle=id=>setTargets(v=>v.includes(id)?v.filter(x=>x!==id):[...v,id]);
  return <form className="broadcast-form" onSubmit={e=>{e.preventDefault();if(!valid || busy)return;if(preview)onSubmit({title:finalTitle,body:finalBody,scope,targets,priority},key.current);else setPreview(true);}}>
    {!preview ? <>
      <div className="form-grid"><label>{t('Broadcast audience')}<select value={scope} onChange={e=>{setScope(e.target.value);setTargets([]);}}><option value="all">{t('All outstations')}</option><option value="regions">{t('By region')}</option><option value="stations">{t('Selected outstations')}</option></select></label><label>{t('Priority')}<select value={priority} onChange={e=>setPriority(e.target.value)}><option value="normal">{t('Normal')}</option><option value="important">{t('Important')}</option></select></label></div>
      {scope!=='all' && <div className="broadcast-audience">{scope==='regions' ? REGIONS.map(r=><label key={r.code}><input type="checkbox" checked={targets.includes(r.code)} onChange={()=>toggle(r.code)}/><span>{t(r.name)}<small>{stations.filter(s=>s.region===r.code).map(s=>s.code).join(' · ')}</small></span></label>) : stations.map(s=><label key={s.code}><input type="checkbox" checked={targets.includes(s.code)} onChange={()=>toggle(s.code)}/><span>{s.code} · {t(s.name)}<small>{t(s.country)}</small></span></label>)}</div>}
      <p className="broadcast-target-summary">{t('{0} receiving outstations',{0:recipients.length})} · {recipients.map(s=>s.code).join(' / ')||'—'}</p>
      <label>{t('Broadcast title')}<input value={title} maxLength={120} onChange={e=>setTitle(e.target.value)}/></label>
      <label>{t('Broadcast message')}<textarea value={body} rows={5} maxLength={4000} onChange={e=>setBody(e.target.value)}/></label>
      <div className="modal-actions"><button className="button primary" disabled={!valid||busy}><Eye size={16}/>{t('Preview broadcast')}</button></div>
    </> : <>
      <div className="broadcast-preview"><Pill tone={priority==='important'?'warn':'brand'}>{t(priority==='important'?'Important':'Normal')}</Pill><h2>{finalTitle}</h2><p>{finalBody}</p></div>
      <p className="field-label">{t('Receiving outstations')}</p><div className="broadcast-recipients">{recipients.map(s=><span key={s.code}>{s.code} · {t(s.name)}</span>)}</div>
      <div className="modal-actions"><button type="button" className="button glass" disabled={busy} onClick={e=>{e.preventDefault();setPreview(false);}}><ArrowLeft size={16}/>{t('Back to editing')}</button><button className="button primary" disabled={busy||!valid}><Send size={16}/>{busy?t('Sending…'):t('Send broadcast')}</button></div>
    </>}
  </form>;
}

export default function BroadcastPage({mode,broadcasts,busy,onCreate,onAcknowledge}) {
  const [pendingOnly,setPendingOnly]=useState(false);
  const pending=broadcasts.filter(b=>!b.recipients[0]?.acknowledged_at);
  const list=mode==='outport'&&pendingOnly?pending:broadcasts;
  return <>
    <Hero title={t('Broadcast centre')} value={mode==='occ'?broadcasts.length:pending.length} sub={t(mode==='occ'?'sent broadcasts':'awaiting acknowledgement')} line={t(mode==='occ'?'Coordinate all, regional or selected outstations.':'Messages from OCC for your station.')}>
      <div className="hero-actions">{mode==='occ'?<button className="button primary" onClick={onCreate}><Megaphone size={17}/>{t('New broadcast')}</button>:<button className="button glass" aria-pressed={pendingOnly} onClick={()=>setPendingOnly(v=>!v)}>{t(pendingOnly?'Show all broadcasts':'Only unacknowledged')}</button>}</div>
    </Hero>
    <div className="grid">{!list.length && <Widget span={6} icon={Megaphone} label={t('Broadcasts')}><h2>{t('No broadcasts here yet')}</h2></Widget>}{list.map(b=>{
      const ack=b.recipients.filter(r=>r.acknowledged_at).length;
      const receipt=b.recipients[0];
      return <Widget key={b.id} span={6} icon={Megaphone} label={`OCC · ${dateOf(b.created_at)} · ${timeOf(b.created_at)}`} className={'broadcast-card '+b.priority} aside={<Pill tone={b.priority==='important'?'warn':'muted'}>{t(b.priority==='important'?'Important':'Normal')}</Pill>}>
        <h2>{b.title}</h2><p className="broadcast-body">{b.body}</p>
        {mode==='occ'?<><p className="broadcast-progress">{t('{0} / {1} stations acknowledged',{0:ack,1:b.recipients.length})}</p><div className="broadcast-recipients">{b.recipients.map(r=><span key={r.station} className={r.acknowledged_at?'acknowledged':''}>{r.station} · {t(r.acknowledged_at?'Acknowledged':'Awaiting acknowledgement')}</span>)}</div></>
          : receipt?.acknowledged_at?<p className="broadcast-ack"><CheckCheck size={17}/>{t('Acknowledged')} · {timeOf(receipt.acknowledged_at)}</p>:<div><button className="button primary" disabled={busy} onClick={()=>onAcknowledge(b.id)}><CheckCheck size={17}/>{t('Acknowledge receipt')}</button></div>}
      </Widget>;
    })}</div>
  </>;
}
