import React,{useEffect,useRef,useState} from 'react';
import {BellRing,Clock,Plane,Route} from 'lucide-react';
import {t} from './i18n';
import {Modal,Pill,Widget,dateOf,timeOf} from './components';
import {transferMargin} from './timeInput.js';
import {api} from './api';
import {connectionRows} from './passengerGuidance';
import {hktInput,fromHkt} from './TimeWheel';

const stages=['Scheduled','Flight preparation','Go to gate','Departure','Arrival'];
export function JourneyProgress({data,now}) {
  const [show,setShow]=useState(false),seen=useRef(new Set());
  const journey=data.journey||{},recall=journey.recall;
  const cancelled=data.status.status==='CANCELLED';
  const stage=['','preparing','boarding','departed','arrived'].indexOf(journey.stage);
  const current=stage>=0?stage:(data.status.status==='BOARDING'?2:0),departure=data.status.departure;
  const wait=departure?Math.ceil((Date.parse(departure)-+now)/60000):null;
  useEffect(()=>{if(recall&&!seen.current.has(recall.id)&&!cancelled){seen.current.add(recall.id);setShow(true);}if(!recall||cancelled)setShow(false);},[recall?.id,cancelled]);
  if(cancelled)return <Widget span={6} icon={Plane} label={t('Next arrangements')}><h2>{t('Check flight-change options')}</h2><p>{t('Have your booking details ready. If you booked through an agent, contact the original booking channel.')}</p><a className="button primary" href="https://irop.hkexpress.com/en-us/irop/login" target="_blank" rel="noopener noreferrer">{t('HK Express official disruption assistance')} ↗</a></Widget>;
  if(data.status.status==='AWAITING')return null;
  const gate=recall?.gate||data.status.gate||t('Gate pending');
  return <><Widget span={6} icon={Route} label={t('Journey progress')} className="journey-progress">
    {recall&&<div className="recall-banner"><BellRing size={25}/><div><h2>{t('Please return to gate {0}',{0:gate})}</h2><p>{t('Have your boarding pass and travel documents ready. Follow ground staff’s instructions.')}</p></div></div>}
    {current<3&&<p className="journey-countdown"><Clock size={18}/>{wait>0?t('Estimated departure in {0} minutes',{0:wait}):t('Please watch for the latest flight announcement.')}</p>}
    <ol>{stages.map((label,i)=><li key={label} className={i===current?'current':i<current?'past':''} aria-current={i===current?'step':undefined}><span>{i+1}</span><div><strong>{t(label)}</strong><small>{i===0?`${t('Scheduled')} ${timeOf(data.status.scheduled)}`:i===2?`${gate}${journey.boarding_at?' · '+timeOf(journey.boarding_at):''}`:i===3?departure?`${t('Estimated departure')} ${dateOf(departure)} ${timeOf(departure)}`:t('Time pending'):i===4?journey.arrival?`${t('Estimated arrival')} ${dateOf(journey.arrival)} ${timeOf(journey.arrival)}`:t('Arrival time pending'):t('Please watch for the latest flight announcement.')}</small></div></li>)}</ol>
    <p className="content-note">{t('Progress is confirmed by staff. Estimates are not live aircraft tracking. All times HKT.')}</p>
  </Widget>{show&&<Modal title={t('Please return to gate {0}',{0:gate})} eyebrow={data.flight.flight_no} onClose={()=>setShow(false)}><div className="recall-modal"><BellRing size={42}/><strong>{gate}</strong><p>{t('Have your boarding pass and travel documents ready. Follow ground staff’s instructions.')}</p><button className="button primary big" onClick={()=>setShow(false)}>{t('Understood')}</button></div></Modal>}</>;
}

export function TransferCalculator({status}) {
  const arrival=status.departure?new Date(Date.parse(status.departure)+status.block_minutes*60000).toISOString():null;
  const [arrive,setArrive]=useState(hktInput(arrival)),[deadline,setDeadline]=useState(''),[minutes,setMinutes]=useState(120),[result,setResult]=useState(null);
  return <details className="transfer-calculator s6"><summary>{t('Recalculate using my itinerary')}</summary><form onSubmit={e=>{e.preventDefault();setResult(transferMargin(arrive,deadline,minutes));}}>
    <div className="form-grid"><label>{t('Arrival · HKT')}<input type="datetime-local" value={arrive} required onChange={e=>setArrive(e.target.value)}/></label><label>{t('Next flight gate closing · HKT')}<input type="datetime-local" value={deadline} required onChange={e=>setDeadline(e.target.value)}/></label></div>
    <label>{t('Transfer process time (minutes)')}<input type="number" min={1} max={1440} value={minutes} required onChange={e=>setMinutes(e.target.value)}/></label><button className="button primary">{t('Calculate connection margin')}</button>
    {result!==null&&<output role="status" className={'notice '+(result<=0?'warn':'good')}>{result>0?t('Estimated margin: {0} minutes. Confirm the transfer requirements with your airline.',{0:result}):result===0?t('No margin remains. Contact the airline to check your connection.'):t('The entered itinerary is short by {0} minutes. Ask the airline about onward arrangements.',{0:-result})}</output>}
    <p className="content-note">{t('This calculator uses your inputs. It does not book or change a flight, or change the list’s 30/60-minute colour rules.')}</p><a href="https://www.hongkongairport.com/en/contact-us/faq.page" target="_blank" rel="noopener noreferrer">{t('Hong Kong airport transfer guidance')} ↗</a>
  </form></details>;
}

export function NetworkConnections({caseId,token,status,now,refreshKey}) {
 const [flights,setFlights]=useState([]),[error,setError]=useState('');
 useEffect(()=>{let active=true;if(!caseId&&!token)return;api(token?`/passenger/${encodeURIComponent(token)}/network-connections`:`/demo/network-connections/${caseId}`).then(r=>{if(active){setFlights(r);setError('');}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[caseId,token,refreshKey]);
 const {rows}=connectionRows({flights,min_connection_minutes:60},status,now);
 const labels={cancelled:'Cancelled',departed:'Departed',tight:'Too tight',limited:'Tight connection',possible:'Connection possible',unknown:'Time pending'};
 return <Widget span={6} icon={Plane} label={t('Hong Kong onward flight network')}><p className="content-note">{t('Synthetic flight scenarios · Read only · Times update with published flight information')}</p>{error&&<p role="alert">{t(error)}</p>}{rows.length?<ol className="conn-list">{rows.map((r,i)=><li key={i} aria-disabled={r.unavailable||undefined} className={'connection-'+(r.state==='possible'?'good':r.state==='limited'?'warn':r.state==='tight'||r.state==='cancelled'?'bad':'muted')+(['cancelled','departed'].includes(r.state)?' off':'')}><span className="conn-flight"><b>{r.flight_no}</b><small>HKG → {r.destination}</small></span><span className="conn-time">{timeOf(r.departure)}<small>{r.departure?dateOf(r.departure):'—'}</small></span><span className="conn-state"><Pill tone={r.state==='possible'?'good':r.state==='limited'?'warn':r.state==='tight'||r.state==='cancelled'?'bad':'muted'}>{t(labels[r.state])}</Pill>{r.transferMinutes!=null&&Number.isFinite(r.transferMinutes)&&!['cancelled','departed'].includes(r.state)&&<small>{r.transferMinutes<=0?t('No transfer time'):t('About {0} min to transfer',{0:Math.round(r.transferMinutes)})}</small>}</span></li>)}</ol>:<p className="muted">{t('No onward demo flights loaded. OCC can load the 30-flight scenarios.')}</p>}{rows.some(r=>r.state==='tight')&&<p className="notice warn">{t('After arriving in Hong Kong, show your boarding pass at the transfer desk and ask ground staff to confirm onward arrangements.')}</p>}<div className="connection-legend"><span className="bad">{t('≤30 min')}</span><span className="warn">{t('30–60 min')}</span><span className="good">{t('≥60 min')}</span></div></Widget>;
}
