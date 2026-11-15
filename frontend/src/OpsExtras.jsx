import React,{useEffect,useState} from 'react';
import {CloudSun,FlaskConical} from 'lucide-react';
import {api} from './api';
import {t} from './i18n';
import {Hero,Pill,Widget,timeOf} from './components';
import {visibilityText} from './stationServices';

export const delayMinutes=c=>Math.max(0,Math.round((Date.parse(c.public_departure||c.proposed_departure||c.original_departure)-Date.parse(c.original_departure))/60000)||0);
export const sortFlights=(cases,sort)=>[...cases].sort(sort==='delay'?(a,b)=>delayMinutes(b)-delayMinutes(a):sort==='station'?(a,b)=>a.station.localeCompare(b.station)||Date.parse(a.original_departure)-Date.parse(b.original_departure):(a,b)=>Date.parse(a.original_departure)-Date.parse(b.original_departure));
export function OperationsMetrics({cases}) {
 const delayed=cases.filter(c=>c.status==='OPEN'&&c.flight_status==='DELAYED');
 return <div className="operations-metrics s6"><div><strong>{delayed.length}</strong><span>{t('Delayed flights')}</span></div><div><strong>{Math.max(0,...delayed.map(delayMinutes))}<small> min</small></strong><span>{t('Longest confirmed delay')}</span></div><div><strong>{cases.filter(c=>c.flight_status==='CANCELLED').length}</strong><span>{t('Cancelled flights')}</span></div></div>;
}
export function WeatherOverview({stations,token,refreshTick,go}) {
 const [rows,setRows]=useState([]),[error,setError]=useState('');
 useEffect(()=>{let active=true;Promise.all(stations.map(async s=>({...s,weather:await api(`/stations/${s.code}/weather-briefings/latest`,{token})}))).then(r=>{if(active){setRows(r);setError('');}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[stations,token,refreshTick]);
 return <Widget span={6} icon={CloudSun} label={t('Network weather overview')}><p className="content-note">{t('Simulated · Not live weather')}</p>{error&&<p role="alert">{t(error)}</p>}<div className="weather-overview">{rows.map(r=><button key={r.code} onClick={()=>go({page:'station',station:r.code})}><strong>{r.code} <small>{t(r.name)}</small></strong><b>{visibilityText(r.weather?.parsed.departure.visibility_m)}</b><span>{t('Wind')} {r.weather?.parsed.departure.wind_speed_kt??'—'} kt · {t('Humidity')} {r.weather?.parsed.departure.humidity_pct??'—'}%</span><small>{r.weather?.parsed.issued_at?timeOf(r.weather.parsed.issued_at):t('No briefing yet. Load a demo sample to begin.')}</small></button>)}</div></Widget>;
}
export function DemoScenarios({token,onChanged}) {
 const [catalog,setCatalog]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[confirm,setConfirm]=useState(''),[backup,setBackup]=useState(''),[result,setResult]=useState('');
 const refresh=()=>api('/demo/scenarios',{token}).then(setCatalog);
 useEffect(()=>{refresh().catch(e=>setError(e.message));},[token]);
 const run=async(path,body)=>{setBusy(true);setError('');try{const r=await api(path,{token,method:'POST',body});setResult(r.backup_id?`${t('Backup created')}: ${r.backup_id}`:t('Demo scenarios updated'));setConfirm('');await refresh();await onChanged();}catch(e){setError(e.message);}finally{setBusy(false);}};
 return <><Hero title={t('Demo scenarios')} value={catalog?.loaded??'—'} sub={t('synthetic flights loaded')} line={t('30 HK Express examples · Both directions · On time, delayed and cancelled')}/><div className="grid"><Widget span={6} icon={FlaskConical} label={t('Add the friend’s flight scenarios')}><p>{t('Adds 30 synthetic flights without changing existing flights, work orders or files. Loading again does not duplicate them.')}</p><button disabled={busy||catalog?.loaded===30} className="button primary big" onClick={()=>run('/demo/scenarios/load',{})}>{t('Load 30 demo flights')}</button>{result&&<p role="status" className="notice good">{result}</p>}{error&&<p role="alert" className="notice warn">{t(error)}</p>}</Widget><Widget span={6} label={t('Reset and restore')}><p>{t('Reset replaces this local demo’s data. A complete database backup is created first. Uploaded files remain on disk.')}</p><form className="demo-reset" onSubmit={e=>e.preventDefault()}><fieldset disabled={busy}><label>{t('Type RESET DEMO to reset, or RESTORE DEMO to restore')}<input value={confirm} onChange={e=>setConfirm(e.target.value)} autoComplete="off"/></label><button className="button danger" disabled={confirm!=='RESET DEMO'} onClick={()=>run('/demo/reset',{confirmation:confirm})}>{t('Back up and reset demo')}</button><label>{t('Database backup')}<select value={backup} onChange={e=>setBackup(e.target.value)}><option value="">{t('Choose a backup')}</option>{catalog?.backups.map(b=><option key={b}>{b}</option>)}</select></label><button className="button glass" disabled={confirm!=='RESTORE DEMO'||!backup} onClick={()=>run(`/demo/restore/${backup}`,{confirmation:confirm})}>{t('Restore selected backup')}</button></fieldset></form><Pill>{t('Local demo only')}</Pill></Widget></div></>;
}
