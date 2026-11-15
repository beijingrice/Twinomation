import React,{useEffect,useRef,useState} from 'react';
import {CloudSun,FileText,RefreshCw,Save,Wind} from 'lucide-react';
import {api} from './api';
import {t} from './i18n';
import {Hero,Modal,Pill,Widget,dateOf,timeOf} from './components';
import {CARE_MODE} from './constants';
import {visibilityText} from './stationServices';

const number=(value,unit='')=>value==null?'—':`${value}${unit}`;
function WeatherFacts({parsed,expanded=false}) {
  const d=parsed.departure,a=parsed.destination;
  return <>
    <div className="weather-metrics">
      <div><small>{t('Departure visibility')} · {d.airport}</small><strong>{visibilityText(d.visibility_m)}</strong><span>{t(d.conditions||'Not extracted')}</span></div>
      <div><small>{t('Arrival visibility')} · {a.airport}</small><strong>{visibilityText(a.visibility_m)}</strong><span>{t(a.conditions||'Not extracted')}</span></div>
      <div><small>{t('Departure wind')}</small><strong>{number(d.wind_direction_deg,'°')} / {number(d.wind_speed_kt,' kt')}</strong><span>{t('Gust')} {number(d.gust_kt,' kt')}</span></div>
      <div><small>{t('Departure cloud base')}</small><strong>{number(d.cloud_base_ft,' ft')}</strong><span>{t('Humidity')} {number(d.humidity_pct,'%')} · {t('Temperature')} {number(d.temperature_c,'°C')} · QNH {number(d.qnh_hpa,' hPa')}</span></div>
    </div>
    <div className="weather-enroute"><Wind size={17}/><span>{t('Enroute summary')} · {t(parsed.enroute.summary||'Not extracted')}</span></div>
    <details className="weather-details" open={expanded}><summary>{t('Briefing details')}</summary><dl>
      <div><dt>{t('Destination wind')}</dt><dd>{number(a.wind_direction_deg,'°')} / {number(a.wind_speed_kt,' kt')} · {t('Gust')} {number(a.gust_kt,' kt')}</dd></div>
      <div><dt>{t('Destination cloud base')}</dt><dd>{number(a.cloud_base_ft,' ft')} · {number(a.temperature_c,'°C')} · QNH {number(a.qnh_hpa,' hPa')}</dd></div>
      {[['turbulence','Turbulence'],['icing','Icing'],['thunderstorms','Thunderstorms']].map(([key,label])=><div key={key}><dt>{t(label)}</dt><dd>{t(parsed.enroute[key]||'Not extracted')}</dd></div>)}
      <div><dt>{t('Issued · HKT')}</dt><dd>{parsed.issued_at?`${dateOf(parsed.issued_at)} · ${timeOf(parsed.issued_at)}`:'—'}</dd></div>
      <div><dt>{t('Valid period · HKT')}</dt><dd>{parsed.valid_from?`${dateOf(parsed.valid_from)} ${timeOf(parsed.valid_from)} → ${dateOf(parsed.valid_to)} ${timeOf(parsed.valid_to)}`:'—'}</dd></div>
    </dl></details>
    {!!parsed.missing_fields.length&&<p className="notice warn">{t('Some fields could not be extracted. Check the original briefing.')}</p>}
  </>;
}

function BriefingEditor({station,record,token,onSaved}) {
  const [source,setSource]=useState(record?.source_name||'Demo route briefing');
  const [raw,setRaw]=useState(record?.raw_text||'');const [parsed,setParsed]=useState(null);
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  const key=useRef(crypto.randomUUID());
  const perform=async action=>{setBusy(true);setError('');try{await action();}catch(e){setError(e.message);}finally{setBusy(false);}};
  const load=()=>perform(async()=>{const sample=await api(`/stations/${station}/weather-briefings/sample`,{token});setSource(sample.source_name);setRaw(sample.raw_text);setParsed(null);});
  return <form className="briefing-editor" onSubmit={e=>{e.preventDefault();perform(async()=>{if(!raw.trim()){const sample=await api(`/stations/${station}/weather-briefings/sample`,{token});setSource(source.trim()||sample.source_name);setRaw(sample.raw_text);setParsed(await api(`/stations/${station}/weather-briefings/parse`,{token,method:'POST',body:{source_name:source.trim()||sample.source_name,raw_text:sample.raw_text}}));return;}if(!parsed){setParsed(await api(`/stations/${station}/weather-briefings/parse`,{token,method:'POST',body:{source_name:source,raw_text:raw}}));return;}const saved=await api(`/stations/${station}/weather-briefings`,{token,method:'POST',key:key.current,body:{source_name:source,raw_text:raw,previous_id:record?.id||null}});onSaved(saved);});}}>
    <p className="content-note">{t('Demo format only. Edit the sample fields, then extract a preview.')}</p>
    <label>{t('Briefing name')}<input value={source} maxLength={120} onChange={e=>setSource(e.target.value)}/></label>
    <label>{t('Briefing text')}<textarea className="briefing-raw" value={raw} rows={12} maxLength={16000} onChange={e=>{setRaw(e.target.value);setParsed(null);}}/></label>
    {error&&<div className="banner bad" role="alert">{t(error)}</div>}
    {parsed&&<><h3>{t('Extracted preview')} · {parsed.route.departure} → {parsed.route.destination}</h3><WeatherFacts parsed={parsed}/></>}
    <div className="modal-actions"><button type="button" className="button glass" disabled={busy} onClick={load}><RefreshCw size={16}/>{t('Load demo sample')}</button><button className="button primary" disabled={busy}>{parsed?<Save size={16}/>:<FileText size={16}/>} {busy?t('Working…'):t(parsed?'Save weather summary':'Extract key fields')}</button></div>
  </form>;
}

export function WeatherPanel({station,token,refreshTick=0,expanded=false}) {
  const [record,setRecord]=useState(null);const [loading,setLoading]=useState(true);const [error,setError]=useState('');const [editing,setEditing]=useState(false);
  useEffect(()=>{let active=true;setLoading(true);api(`/stations/${station}/weather-briefings/latest`,{token}).then(data=>{if(active){setRecord(data);setError('');}}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[station,token,refreshTick]);
  const expired=record?.parsed.valid_to && new Date(record.parsed.valid_to)<new Date();
  return <>
    <Widget span={6} icon={CloudSun} label={t('Route weather briefing')} className="weather-widget" aside={!CARE_MODE&&<button className="button glass small" onClick={()=>setEditing(true)}>{t('Edit demo briefing')}</button>}>
      <div className="weather-heading"><h2>{station} → {record?.parsed.route.destination||'HKG'}</h2><Pill tone="brand">{t('Simulated · Not live weather')}</Pill>{expired&&<Pill tone="muted">{t('Sample validity has ended')}</Pill>}</div>
      {error?<p className="warn-text">{t(error)}</p>:record?<><WeatherFacts parsed={record.parsed} expanded={expanded}/><details className="weather-source"><summary>{t('Original briefing')} · {record.source_name}</summary><pre>{record.raw_text}</pre></details></>:<p className="muted">{t(loading?'Loading weather briefing…':'No briefing yet. Load a demo sample to begin.')}</p>}
    </Widget>
    {editing&&<Modal wide title={t('Edit demo briefing')} eyebrow={`${station} → HKG`} onClose={()=>setEditing(false)}><BriefingEditor station={station} record={record} token={token} onSaved={data=>{setRecord(data);setEditing(false);}}/></Modal>}
  </>;
}

export default function WeatherPage({stations,token,refreshTick}) {
  const [selected,setSelected]=useState(stations[0]?.code||'KIX');
  return <><Hero title={t('Route weather')} value={selected} sub={t('Simulated briefing extracts')} line={t('Visibility, wind, cloud base and enroute notes.')}/>
    {stations.length>1&&<div className="weather-station-picker"><label>{t('Outstation')}<select value={selected} onChange={e=>setSelected(e.target.value)}>{stations.map(s=><option key={s.code} value={s.code}>{s.code} · {t(s.name)}</option>)}</select></label></div>}
    <div className="grid"><WeatherPanel key={selected} station={selected} token={token} refreshTick={refreshTick} expanded/></div></>;
}
