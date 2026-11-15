import { t, useLocale } from "./i18n";
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, DoorOpen, History, MessageCircle, PlaneTakeoff, RefreshCw, X } from 'lucide-react';
import { api, useLive } from './api';
import TravelExperience, {OfficialLink} from './TravelExperience';
import ThematicGuide from './ThematicGuide';
import {NetworkConnections} from './PassengerJourney';
import AirportExperience from './AirportExperience';
import {connectionRows, guidanceMode} from './passengerGuidance';
import {supportQuestions} from './assistantSupport';
import {JourneyProgress,TransferCalculator} from './PassengerJourney';
import {OFFICIAL_LINKS} from './travelContent';
import {DELAY_SCENARIOS, COMMON_PASSENGER_QA, scenarioCopy, scenarioStatus, scenarioNotice} from './delayScenarios';
import { parsePassengerPreview, passengerPreviewPath } from './passengerPreview.js';
import { Hero, LanguageSwitch, Live, Mark, Pill, Widget, dateOf, timeOf } from './components';
import { CAUSES, CONNECTIONS, FLIGHT_STATUS } from './constants';

const minutesBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 60000);
const duration = m => m >= 60 ? (m % 60 ? t('{0} h {1} min', {0: Math.floor(m / 60), 1: m % 60}) : t('{0} h', {0: Math.floor(m / 60)})) : t('{0} min', {0: m});

function Assistant({ cause, flight, status, connection, now, scenarioPreview, onClose }) {
  const language = useLocale();
  const [messages,setMessages] = useState([]);
  const copy = scenarioCopy(cause,language);
  const zh = [...supportQuestions(cause,status,connection,now,'zh'),...(DELAY_SCENARIOS[cause]?.zh.qa || []),...COMMON_PASSENGER_QA.zh];
  const en = [...supportQuestions(cause,status,connection,now,'en'),...(DELAY_SCENARIOS[cause]?.en.qa || []),...COMMON_PASSENGER_QA.en];
  const pairs = zh.map((pair,index)=>({zh:pair,en:en[index]}));
  const end = useRef(null);
  useEffect(()=>{if(messages.length) end.current?.scrollIntoView({block:'end'});},[messages,language]);
  const ask = pair => setMessages(m=>[...m,{from:'me',text:{zh:pair.zh[0],en:pair.en[0]}},{from:'bot',text:{zh:pair.zh[1],en:pair.en[1]}}]);
  return <aside className="chat" role="dialog" aria-label={t('Assistant')}>
    <header><Bot size={18}/><strong>{t('Assistant')}</strong><small>{t('Here to help')}</small><button className="icon-button" onClick={onClose} aria-label={t('Close assistant')}><X size={18}/></button></header>
    <div className="chat-context"><small>{t(scenarioPreview ? 'Scenario preview' : 'Published flight update')}</small><strong>{flight.flight_no} · {flight.origin||flight.station} → {flight.destination}</strong><span>{status.departure ? t('Estimated departure: {0} HKT',{0:timeOf(status.departure)}) : t('Departure time not yet confirmed')}</span></div>
    <div className="chat-log" role="log" aria-live="polite" aria-label={t('Conversation')}><div className="msg bot"><p>{copy.welcome}</p><p className="chat-current-fact">{copy.brief}</p><p>{t('Choose what is on your mind. We can take it one step at a time.')}</p></div>{messages.map((m,i)=><p key={i} className={'msg '+m.from}>{m.text[language]}</p>)}<span ref={end}/></div>
    <div className="chat-chips">{pairs.map(pair=><button key={pair.en[0]} onClick={()=>ask(pair)}>{pair[language][0]}</button>)}<OfficialLink href={OFFICIAL_LINKS.hkExpressSupport}>{t('Official flight-disruption support')}</OfficialLink></div>
  </aside>;
}

function Connection({ connection, status, now }) {
  const {arrival,rows} = connectionRows(connection,status,now);
  const booked = rows.find((r) => r.booked);
  const lost = booked?.unavailable;
  const states={cancelled:['Cancelled','bad'],departed:['Departed','muted'],tight:['Too tight','bad'],limited:['Tight connection','warn'],possible:['Connection possible','good'],unknown:['Pending','muted']};
  return <Widget span={6} icon={PlaneTakeoff} label={t("Connection to {0}", { 0: t(connection.city) })} className="connections" aside={<small className="muted">{arrival ? <>{t("Arrive HKG ~")}{timeOf(arrival.toISOString())}</> : t('Arrival time pending')}</small>}>
    {lost && <p className="conn-alert">{t('Connection {0} may be missed. Contact the airline for onward arrangements.', {0: booked.flight_no})}</p>}
    <ol className="conn-list" aria-label={t('Onward flights · read only')}>{rows.map((r) => <li key={r.flight_no} aria-disabled={r.unavailable || undefined} className={`connection-${states[r.state][1]}${['departed','cancelled'].includes(r.state) ? ' off' : ''}${r.booked ? ' booked' : ''}`}>
      <span className="conn-flight"><b>{r.flight_no}</b><small>HKG → {connection.destination}{r.booked && <> · {t('Your flight')}</>}</small></span>
      <span className="conn-time">{timeOf(r.departure)}</span>
      <span className="conn-state"><Pill tone={states[r.state][1]}>{t(states[r.state][0])}</Pill>{['tight','limited','possible'].includes(r.state) && <small className="transfer-window">{r.transferMinutes <= 0 ? t('No transfer time') : t('About {0} min to transfer',{0:Math.round(r.transferMinutes)})}</small>}</span>
    </li>)}</ol>
    <div className="connection-legend" aria-label={t('Transfer time colours')}><span className="bad">{t('≤30 min')}</span><span className="warn">{t('30–60 min')}</span><span className="good">{t('≥60 min')}</span></div>
    <p className="content-note">{t('Demo timetable · Refreshes automatically · Read only')}</p>
  </Widget>;
}

export default function PassengerApp() {
  const language = useLocale();
  const [token] = useState(() => window.location.hash.slice(1));
  const [preview, setPreview] = useState(() => parsePassengerPreview(window.location.search));
  const [flights, setFlights] = useState([]);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [chat, setChat] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const requestId = useRef(0);
  useEffect(() => { const i = setInterval(() => setNow(new Date()), 15000); return () => clearInterval(i); }, []);
  useEffect(() => {
    if (token) return;
    const pop = () => { setChat(false); setPreview(parsePassengerPreview(window.location.search)); };
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, [token]);
  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    try {
      let result;
      if (token) result = await api(`/passenger/${encodeURIComponent(token)}`);
      else {
        const choices = await api('/demo/passenger/cases');
        if (id !== requestId.current) return;
        setFlights(choices);
        const caseId = preview.caseId ?? choices[0]?.id;
        if (!caseId) { setData(null); setError('No demo flights yet.'); return; }
        const query = new URLSearchParams(preview.connection ? {connection: preview.connection} : {});
        result = await api(`/demo/passenger/${caseId}${query.size ? '?' + query : ''}`);
      }
      if (id === requestId.current) { setData(result); setError(''); }
    } catch (e) {
      if (id !== requestId.current) return;
      setError(e.message);
      if (e.status === 404) setData(null);
    }
  }, [token, preview.caseId, preview.connection]);
  useEffect(() => {
    setData(null); setChat(false); refresh();
    return () => { requestId.current += 1; };
  }, [refresh]);
  const selectedCase = preview.caseId ?? flights[0]?.id;
  const live = useLive(token ? `/passenger/${encodeURIComponent(token)}/stream`
    : selectedCase ? `/demo/passenger/${selectedCase}/stream` : null, null, refresh);
  const choosePreview = (caseId, connection, scenario = preview.scenario) => {
    if (caseId !== selectedCase || connection !== preview.connection) {
      requestId.current += 1; setData(null); setError('');
    }
    setChat(false);
    setPreview({caseId,connection,scenario});
    window.history.pushState(null,'',passengerPreviewPath(caseId,connection,scenario));
  };

  const demoScenario = !token && preview.scenario ? DELAY_SCENARIOS[preview.scenario] : null;
  const s = data ? scenarioStatus(data.status, demoScenario ? preview.scenario : null) : null;
  const explanation = s?.cause ? scenarioCopy(s.cause,language) : null;
  const delay = s?.status === 'DELAYED' && s.departure ? Math.max(0, minutesBetween(s.scheduled, s.departure)) : 0;
  const cause = s?.status === 'DELAYED' && CAUSES[s.cause];
  const guidance = s ? guidanceMode(s) : 'none';
  const label = s?.status === 'AWAITING' ? { label: 'Update coming', tone: 'warn' } : FLIGHT_STATUS[s?.status];

  return <div className="app passenger">
    <main className="page passenger-main">
      <div className="page-bar"><span className="brand"><Mark small /><span>{t("Twinomation")}</span></span><div className="page-bar-right"><LanguageSwitch/><Live status={live}/></div></div>
      {!token && <section className="preview-controls" aria-label={t('Passenger preview')}>
        <p>{t('Passenger preview · always available')}</p>
        <div className="preview-fields">
          <label>{t('Flight')}<select value={selectedCase || ''} disabled={!flights.length}
            onChange={e => choosePreview(Number(e.target.value), flights.find(f=>f.id===Number(e.target.value))?.destination==='HKG'?preview.connection:null,null)}>
            {!flights.length && <option value="">{t('Loading flights…')}</option>}
            {flights.map(f => <option key={f.id} value={f.id}>{f.flight_no} · {f.origin||f.station} → {f.destination} · {dateOf(f.flight_date + 'T12:00:00Z')}</option>)}
          </select></label>
          <label>{t('Passenger view type')}<select disabled={data?.flight.destination!=='HKG'} value={preview.connection || ''}
            onChange={e => choosePreview(selectedCase, e.target.value || null)}>
            <option value="">{t('No onward connection')}</option>
            {CONNECTIONS.map(([code, city]) => <option key={code} value={code}>{t('Connecting to {0}', {0: t(city)})} · {code}</option>)}
          </select></label>
          <label className="scenario-picker">{t('Demo delay scenario')}<select value={preview.scenario || ''} onChange={e=>choosePreview(selectedCase,preview.connection,e.target.value || null)}>
            <option value="">{t('Use published flight updates')}</option>
            {Object.entries(DELAY_SCENARIOS).map(([code,scenario])=><option key={code} value={code}>{scenario[language].title} · +{scenario.minutes} {t('min')}</option>)}
          </select></label>
        </div>
        {demoScenario && <p className="scenario-demo-notice" role="status">{t('Preset scenario preview — not a published flight update. Switching scenarios does not change OCC data.')}</p>}
      </section>}
      {error && <div className="banner bad" role="alert">{t(error)}</div>}
      {data && <>
        <Hero title={data.flight.flight_no} value={s.status === 'CANCELLED' ? t('Cancelled') : s.status === 'DELAYED' && !s.departure ? <span className="time-label">{t('Time pending')}</span> : timeOf(s.departure || s.scheduled)}
        sub={<span className="hero-meta"><Pill tone={label.tone}>{t(label.label)}</Pill>{delay > 0 && <b className="delay">+{duration(delay)}</b>}</span>}
        line={`${data.flight.origin||data.flight.station} → ${data.flight.destination} · ${dateOf(data.flight.flight_date + 'T12:00:00Z')}${delay ? ` · ${t('was ')}${timeOf(s.scheduled)}` : ''}`}>
          <div className="hero-actions"><button className="button glass small" onClick={refresh} aria-label={t("Refresh")}><RefreshCw size={14} />{t("Refresh")}</button></div>
        </Hero>
        <div className="grid passenger-grid">
          <JourneyProgress data={{...data,status:s,...(demoScenario?{journey:{...data.journey,recall:null,boarding_at:null}}:{})}} now={now}/>
          {cause && explanation && <Widget span={s.gate ? 4 : 6} icon={cause.icon} label={t('Understanding the delay')} className="reason">
            <h2>{explanation.title}</h2><p>{explanation.brief}</p>
            <div className="reason-actions"><button className="button primary" onClick={()=>setChat(true)}><MessageCircle size={18}/>{t('Ask the assistant')}</button><OfficialLink href={OFFICIAL_LINKS.hkExpressSupport}>{t('Official support')}</OfficialLink></div>
          </Widget>}
          {s.gate && <Widget span={cause ? 2 : 6} icon={DoorOpen} label={t("Gate")}><div className="big-fact">{s.gate}</div>{s.terminal&&<p>{t('Terminal')} {s.terminal}</p>}</Widget>}
          {s.status === 'AWAITING' && <Widget span={6} icon={RefreshCw} label={t("Status")}><h2 className="soft">{t("We are working on your flight.")}</h2><p className="muted">{t("This page updates by itself.")}</p></Widget>}

          {data.connection && ['DELAYED', 'BOARDING','ON_TIME'].includes(s.status) && <Connection key={`${selectedCase || token}:${data.connection.destination}`} connection={data.connection} status={s} now={now} />}
          {data.flight.destination==='HKG'&&s.status!=='CANCELLED'&&<NetworkConnections token={token} caseId={selectedCase} status={s} now={now} refreshKey={data}/>}
          {data.flight.destination==='HKG'&&s.status!=='CANCELLED'&&<TransferCalculator key={`${selectedCase||token}:${s.departure}`} status={s}/>}

          <Widget span={6} icon={History} label={demoScenario ? t('Example passenger notice') : t("Updates · {0}", { 0: data.timeline.length })}>
            {demoScenario ? <p className="example-notice">{scenarioNotice(data.flight.flight_no,preview.scenario,s.departure,language)}</p> : data.timeline.length ? <ol className="timeline">{data.timeline.map((u) => <li key={u.id} className={u.invalidated ? 'stale' : ''}><small>{dateOf(u.published_at)} · {timeOf(u.published_at)}</small><p>{language === 'zh' ? u.text_zh || u.text : u.text}</p>{u.invalidated && <small className="warn-text">{t("Previous guidance · Awaiting confirmation. Do not use the old location.")}</small>}</li>)}</ol> : <p className="muted">{t("Updates will appear here.")}</p>}
          </Widget>
          {['long','pending'].includes(guidance) ? <><AirportExperience station={data.flight.origin||data.flight.station}/><details className="s6 optional-travel"><summary>{t('Explore destination guides')}</summary><TravelExperience key={`${data.flight.flight_no}:${data.flight.station}`} flight={data.flight} showPromotions={false}/><ThematicGuide key={selectedCase||token} flight={data.flight} showPromotions={false}/></details></>
            : guidance === 'short' ? <><TravelExperience key={`${data.flight.flight_no}:${data.flight.station}`} flight={data.flight}/><ThematicGuide key={selectedCase||token} flight={data.flight}/></>
            : <details className="s6 optional-travel"><summary>{t('Explore destination guides')}</summary><TravelExperience key={`${data.flight.flight_no}:${data.flight.station}`} flight={data.flight} showPromotions={false}/><ThematicGuide key={selectedCase||token} flight={data.flight} showPromotions={false}/></details>}
        </div>
        {!chat && cause && <button className="chat-fab" onClick={() => setChat(true)} aria-label={t("Open assistant")}><MessageCircle size={22} /></button>}
        {chat && cause && <Assistant key={`${data.flight.flight_no}:${s.cause}`} cause={s.cause} flight={data.flight} status={s} connection={data.connection} now={now} scenarioPreview={!!demoScenario} onClose={() => setChat(false)} />}
      </>}
      {!data && !error && <div className="loading"><RefreshCw size={20} /><p>{t("Finding your flight…")}</p></div>}
      <footer className="footer">{t("Demo · Not live travel information")}</footer>
    </main>
  </div>;
}
