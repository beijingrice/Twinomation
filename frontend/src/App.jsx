import { t, useLocale } from "./i18n";
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, BellOff, BellRing, Check, CircleCheck, CloudSun, Megaphone, Pause, Play, RefreshCw, Send, X } from 'lucide-react';
import { api, downloadFile, uploadFile, useLive } from './api';
import {hasUnsavedForms,markDirty,markSaved,mayLeave} from './draftGuard';
import {DemoScenarios} from './OpsExtras';
import {InboxPage} from './CaseWorkspace';
import { chime, unlockSound } from './chime';
import { Crumbs, LanguageSwitch, Live, Mark, Modal, SearchField, timeOf } from './components';
import { MODE, CARE_MODE, REGIONS, latestWO, mineOf, todoOf } from './constants';
import { AbortForm, AuthorizeForm, CancelFlightForm, CreateForm, ReissueForm, WorkOrderForm } from './forms';
import PassengerNoticeForm from './PassengerNoticeForm';
import BroadcastPage,{BroadcastForm} from './Broadcasts';
import WeatherPage,{WeatherPanel} from './WeatherBriefing';
import { CasePage, CasesPage, OverviewPage, RegionPage, StationPage } from './pages';

const DEFAULT_PAGE = MODE === 'outport' ? 'station' : 'overview';
const ROLE_NAME = { occ: 'Operations control', outport: 'Outstation manager' };
const SOUND_KEY = 'twinomation.sound';
const SIDEBAR_KEY = 'twinomation.sidebar-width';
const SIDEBAR_DEFAULT = 320;
const SIDEBAR_MIN = 280;
const SIDEBAR_MAX = 440;
const readSidebarWidth = () => {
  try {
    const saved = Number(localStorage.getItem(SIDEBAR_KEY));
    if (Number.isFinite(saved) && saved >= SIDEBAR_MIN && saved <= SIDEBAR_MAX) return saved;
  } catch {/* Use the default when browser storage is unavailable. */}
  return SIDEBAR_DEFAULT;
};

/* Navigation lives in the query string so reload and back/forward work. In the outport client `station` is the simulated identity. */
function parseNav() {
  const q = new URLSearchParams(window.location.search);
  if (q.has('case')) return { page: 'case', id: Number(q.get('case')) };
  if (['broadcasts','weather','inbox','demo'].includes(q.get('view'))) return {page:q.get('view')};
  if (MODE === 'outport') return { page: 'station' };
  if (q.get('outport')) return { page: 'station', station: q.get('outport') };
  if (q.get('region')) return { page: 'region', region: q.get('region') };
  if (q.get('view') === 'cases') return { page: 'cases' };
  return { page: DEFAULT_PAGE };
}
function navUrl(nav, station) {
  const q = new URLSearchParams();
  if (MODE === 'outport') q.set('station', station);
  if(CARE_MODE)q.set('care','1');
  if (nav.page === 'case') q.set('case', nav.id);else
  if (nav.page === 'region') q.set('region', nav.region);else
  if (nav.page === 'station' && MODE !== 'outport') q.set('outport', nav.station);else
  if (['cases','broadcasts','weather','inbox','demo'].includes(nav.page)) q.set('view', nav.page);
  const s = q.toString();
  return window.location.pathname + (s ? '?' + s : '');
}

const readSound = () => {try {return localStorage.getItem(SOUND_KEY) === 'on';} catch {return false;}};
const writeSound = (on) => {try {localStorage.setItem(SOUND_KEY, on ? 'on' : 'off');} catch {/* per-viewer convenience only */}};

export default function App() {
  useLocale();
  const [token, setToken] = useState('');
  const [station] = useState(() => new URLSearchParams(window.location.search).get('station') || 'KIX');
  const [stations, setStations] = useState([]);
  const [cases, setCases] = useState([]);
  const [switchState, setSwitchState] = useState({ active: true, version: 1 });
  const [nav, setNav] = useState(parseNav);
  const [detail, setDetail] = useState(null);
  const detailRef=useRef(detail);detailRef.current=detail;
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);
  const [bootError, setBootError] = useState('');
  const [initialLoading, setInitialLoading] = useState(true);
  const [broadcasts,setBroadcasts]=useState([]);
  const [inbox,setInbox]=useState([]),[remoteChanged,setRemoteChanged]=useState(false);
  const [serviceTick,setServiceTick]=useState(0);
  const [clock, setClock] = useState(new Date());
  const [sideSearch, setSideSearch] = useState('');
  const [sidebarWidth, setSidebarWidth] = useState(readSidebarWidth);
  const [viewportWidth, setViewportWidth] = useState(window.innerWidth);
  const [resizingSidebar, setResizingSidebar] = useState(false);
  const sidebarDrag = useRef(null);
  const [sound, setSound] = useState(readSound);
  const [incoming, setIncoming] = useState([]);
  const mutation = useRef(false);
  const seenSent = useRef(null);
  const navRef = useRef(nav);navRef.current = nav;
  const soundRef = useRef(sound);soundRef.current = sound;
  const sidebarMax = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, viewportWidth - 620));
  const shownSidebarWidth = Math.min(sidebarWidth, sidebarMax);
  const resizeSidebar = (width) => setSidebarWidth(Math.round(Math.max(SIDEBAR_MIN, Math.min(sidebarMax, width))));

  useEffect(() => {
    const resize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  useEffect(() => {
    try {localStorage.setItem(SIDEBAR_KEY, String(sidebarWidth));} catch {/* Preference only. */}
  }, [sidebarWidth]);

  useEffect(() => {const i = setInterval(() => setClock(new Date()), 30000);return () => clearInterval(i);}, []);
  useEffect(() => {if (toast) {const t = setTimeout(() => setToast(null), 6000);return () => clearTimeout(t);}}, [toast]);
  useEffect(() => {const pop = () => {if(mayLeave(t('Discard unsaved changes?')))setNav(parseNav());else window.history.pushState(null,'',navUrl(navRef.current,station));};window.addEventListener('popstate', pop);return () => window.removeEventListener('popstate', pop);}, []);
  // Audio can only start after a user gesture; the first tap anywhere unlocks it when sound is on.
  useEffect(() => {const unlock = () => {if (soundRef.current) unlockSound();};window.addEventListener('pointerdown', unlock);return () => window.removeEventListener('pointerdown', unlock);}, []);

  // Simulated employee session, one per tab/role/station.
  useEffect(() => {
    let active = true;
    setToken('');setInitialLoading(true);setBootError('');
    const storageKey = `twinomation.session.${CARE_MODE?'care':MODE}.${station}`;
    const saved = sessionStorage.getItem(storageKey);
    (async () => {
      if (saved) {
        try {await api('/stations', { token: saved });if (active) setToken(saved);return;} catch {sessionStorage.removeItem(storageKey);}
      }
      const result = await api('/session', { method: 'POST', body: { role: CARE_MODE?'care':MODE, station } });
      if (active) {sessionStorage.setItem(storageKey, result.token);setToken(result.token);}
    })().catch((error) => {if (active) {setBootError(error.message);setInitialLoading(false);}});
    return () => {active = false;};
  }, [station]);

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const [s, c, k, b, messages] = await Promise.all([api('/stations', { token }), api('/cases', { token }), api('/kill-switch', { token }),api('/broadcasts',{token}),api('/inbox',{token})]);
      setStations(s);setCases(c);setSwitchState(k);setBootError('');setInitialLoading(false);
      setBroadcasts(b);setServiceTick(v=>v+1);
      setInbox(messages);
      setCases(c.map(row=>({...row,has_recent_update:messages.some(m=>m.case_id===row.id&&!m.acknowledged_at)})));
      if (MODE === 'outport') {
        // Alarm: ring for work orders that arrive while this page is open.
        const sent = c.filter((x) => latestWO(x)?.status === 'SENT').map((x) => ({ id: x.id, flight_no: x.flight_no, number: latestWO(x).number, woId: latestWO(x).id }));
        const fresh = seenSent.current ? sent.filter((x) => !seenSent.current.has(x.woId)) : [];
        seenSent.current = new Set(sent.map((x) => x.woId));
        setIncoming(sent);
        if (fresh.length && soundRef.current) chime();
      }
      const current = navRef.current;
      if (current.page === 'case') {
        const d = await api(`/cases/${current.id}`, { token });
        if (navRef.current.page === 'case' && navRef.current.id === current.id) {if(hasUnsavedForms()){if(JSON.stringify(d)!==JSON.stringify(detailRef.current))setRemoteChanged(true);}else{setDetail(d);setRemoteChanged(false);}}
      }
    } catch (error) {
      setInitialLoading(false);
      setBootError(error.status === 401 ? 'Your local session has expired. Reload to start again.' : error.message);
    }
  }, [token]);
  useEffect(() => {refresh();}, [refresh]);
  useEffect(() => {
    setDetail(null);
    if (nav.page !== 'case' || !token) return;
    const controller = new AbortController();
    api(`/cases/${nav.id}`, { token, signal: controller.signal }).then(setDetail).catch((error) => {if (!controller.signal.aborted) setToast({ error: true, text: error.message });});
    return () => controller.abort();
  }, [nav.page, nav.id, token]);
  const live = useLive(token ? '/stream' : null, token, refresh);

  const go = (next) => {if(!mayLeave(t('Discard unsaved changes?')))return;setNav(next);window.history.pushState(null, '', navUrl(next, station));window.scrollTo({ top: 0, behavior: 'instant' });};
  const perform = async (path, options, success, keepModal = false) => {
    if (mutation.current) return null;
    mutation.current = true;setBusy(true);
    try {
      const result = await api(path, { token, ...options });
      if(!/acknowledge|kill-switch|receive/.test(path))markSaved(document.querySelector('.modal form')||document.querySelector('form.reply'));
      if (!keepModal) setModal(null);
      setToast({ text: success });await refresh();return result;
    } catch (error) {setToast({ error: true, text: error.message });await refresh();return null;} finally
    {mutation.current = false;setBusy(false);}
  };
  const toggleSound = () => {const on = !sound;setSound(on);writeSound(on);if (on && unlockSound()) setTimeout(chime, 50);};
  const askSwitch = () => setModal({ kind: 'switch', active: !switchState.active, version: switchState.version });
  // Resuming from inside the authorise / cancel dialog keeps that dialog open.
  const resumePublishing = () => perform('/kill-switch', { method: 'PUT', body: { active: false, version: switchState.version } }, 'Publishing resumed.', true);
  const onCreate = MODE === 'occ' ? (initial) => () => setModal({ kind: 'create', station: initial }) : null;

  const upload = async (list, woId) => {
    if (mutation.current || !detail) return;
    // FileList is live: clearing the input must not truncate a multi-file upload.
    const files = Array.from(list);
    mutation.current = true;setBusy(true);
    try {
      for (const file of files) await uploadFile(detail.id, file, token, woId);
      setToast({ text: files.length === 1 ? t('{0} shared.', {0: files[0].name}) : t('{0} files shared.', {0: files.length}) });
    } catch (error) {setToast({ error: true, text: error.message });} finally
    {mutation.current = false;setBusy(false);await refresh();}
  };

  /* Breadcrumbs */
  const stationOf = (code) => stations.find((s) => s.code === code);
  const regionOf = (code) => REGIONS.find((r) => r.code === code);
  const crumbs = [];
  const network = { label: 'Overview', onClick: () => go({ page: 'overview' }) };
  const pushStation = (code) => {
    const s = stationOf(code);
    if (MODE === 'outport') {crumbs.push({ label: s ? `${t(s.name)} · ${s.code}` : code, onClick: () => go({ page: 'station' }) });return;}
    const r = regionOf(s?.region);
    crumbs.push(network);
    if (r) crumbs.push({ label: t(r.name), onClick: () => go({ page: 'region', region: r.code }) });
    crumbs.push({ label: t(s?.name) || code, onClick: () => go({ page: 'station', station: code }) });
  };
  if (nav.page === 'region') crumbs.push(network, { label: regionOf(nav.region)?.name || nav.region });
  if (nav.page === 'station' && MODE !== 'outport') pushStation(nav.station);
  if (nav.page === 'case' && detail) {pushStation(detail.station);crumbs.push({ label: detail.flight_no });}

  const open = cases.filter((c) => c.status === 'OPEN');
  const q = sideSearch.toLowerCase();
  const stationMatch = (s) => !q || `${s.name} ${t(s.name)} ${s.code} ${s.airport} ${t(s.airport)} ${s.country} ${t(s.country)}`.toLowerCase().includes(q);
  const selectedStation = nav.page === 'station' ? MODE === 'outport' ? station : nav.station : nav.page === 'case' ? detail?.station : null;
  const unreadBroadcasts=MODE==='outport'?broadcasts.filter(b=>!b.recipients[0]?.acknowledged_at):[];
  const openBroadcast=()=>setModal({kind:'broadcast',initial:{scope:nav.page==='region'?'regions':selectedStation?'stations':'all',targets:nav.page==='region'?[nav.region]:selectedStation?[selectedStation]:[]}});
  const stationCard = (s) => {
    const sc = cases.filter((c) => c.station === s.code && c.status === 'OPEN');
    const n = MODE === 'outport' ? mineOf(sc) : todoOf(sc);
    return <LocationCard key={s.code} name={t(s.name)} sub={s.code} value={n} note={n ? MODE === 'outport' ? 'Awaiting station action' : 'Need action' : 'All clear'}
    selected={selectedStation === s.code} onClick={() => go(MODE === 'outport' ? { page: 'station' } : { page: 'station', station: s.code })} />;
  };
  const publishing = MODE === 'occ' ?
  <button className={'publish-chip ' + (switchState.active ? 'paused' : 'on')} onClick={askSwitch} title={t("Passenger publishing")}>{switchState.active ? <Pause size={12} /> : <Send size={12} />}{switchState.active ? t('Publishing paused') : t('Publishing on')}</button> :
  null;
  const shownIncoming = incoming.filter((x) => !(nav.page === 'case' && nav.id === x.id));

  return <div className={'app ' + MODE + (resizingSidebar ? ' resizing-sidebar' : '')} style={{ '--side': `${shownSidebarWidth}px` }} onInputCapture={markDirty} onChangeCapture={markDirty} onClickCapture={e=>{if(e.target.closest('.opt,.pick,.cause,.choice,.add-custom'))markDirty(e);}}>
    <aside className="sidebar" id="workspace-sidebar">
      <div className="side-top">
        <a className="brand" href="/" title={t("Back to all workspaces")}><Mark small /><span>{t("Twinomation")}</span></a>
        <div className="role-card">
          <span><small>{t("Workspace")}</small><strong>{t(CARE_MODE?'Customer Care':ROLE_NAME[MODE])}{MODE === 'outport' ? ` · ${station}` : ''}</strong></span>
          <a href="/">{t("Switch")}</a>
        </div>
        {MODE === 'occ' && <nav className="side-nav" aria-label={t("Workspace")}>
          <button className={nav.page === 'overview' ? 'active' : ''} onClick={() => go({ page: 'overview' })}>{t("Overview")}<span className={mineOf(open) ? 'warn' : ''}>{mineOf(open)}</span></button>
          <button className={nav.page === 'cases' ? 'active' : ''} onClick={() => go({ page: 'cases' })}>{t("All flights")}<span>{open.length}</span></button>
        </nav>}
        <nav className="service-nav" aria-label={t('Station services')}>
          {MODE==='occ'&&<button className={nav.page==='demo'?'active':''} onClick={()=>go({page:'demo'})}><Play size={16}/>{t('Demo scenarios')}</button>}
          <button className={nav.page==='inbox'?'active':''} onClick={()=>go({page:'inbox'})}><Bell size={16}/>{t('Message inbox')}{inbox.filter(m=>!m.acknowledged_at).length>0&&<span>{inbox.filter(m=>!m.acknowledged_at).length}</span>}</button>
          <button className={nav.page==='broadcasts'?'active':''} onClick={()=>go({page:'broadcasts'})}><Megaphone size={16}/>{t('Broadcasts')}{unreadBroadcasts.length>0&&<span>{unreadBroadcasts.length}</span>}</button>
          <button className={nav.page==='weather'?'active':''} onClick={()=>go({page:'weather'})}><CloudSun size={16}/>{t('Route weather')}</button>
        </nav>
        {MODE==='outport'&&<label className="care-picker">{t('Station workspace')}<select value={CARE_MODE?'care':'manager'} onChange={e=>{if(mayLeave(t('Discard unsaved changes?')))window.location.href=`/outport?station=${station}${e.target.value==='care'?'&care=1':''}`;}}><option value="manager">{t('Outstation manager')}</option><option value="care">{t('Customer Care')}</option></select></label>}
        {MODE === 'outport' && !CARE_MODE && <button className={'sound-toggle' + (sound ? ' on' : '')} onClick={toggleSound} aria-pressed={sound}>{sound ? <BellRing size={16} /> : <BellOff size={16} />}{sound ? t('Alarm sound on') : t('Turn on alarm sound')}</button>}
      </div>
      {MODE === 'occ' && <SearchField value={sideSearch} onChange={setSideSearch} placeholder={t("Find an outport")} />}
      <div className="side-list">
        {MODE === 'outport' ?
        stations.map(stationCard) :
        REGIONS.map((r) => {
          const list = stations.filter((s) => s.region === r.code && stationMatch(s));
          if (!list.length) return null;
          return <React.Fragment key={r.code}>
                <button className={'side-group' + (nav.page === 'region' && nav.region === r.code ? ' active' : '')} onClick={() => go({ page: 'region', region: r.code })}>{t(r.name)}</button>
                {list.map(stationCard)}
              </React.Fragment>;
        })}
      </div>
      <div className="sidebar-resize" role="separator" aria-label={t("Sidebar width")} aria-orientation="vertical" aria-controls="workspace-sidebar"
      aria-valuemin={SIDEBAR_MIN} aria-valuemax={sidebarMax} aria-valuenow={shownSidebarWidth} tabIndex={0}
      title={t("Drag to resize · Double-click to reset")}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        sidebarDrag.current = { x: e.clientX, width: shownSidebarWidth };
        e.currentTarget.setPointerCapture(e.pointerId);
        setResizingSidebar(true);
      }}
      onPointerMove={(e) => {if (sidebarDrag.current) resizeSidebar(sidebarDrag.current.width + e.clientX - sidebarDrag.current.x);}}
      onPointerUp={(e) => {if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);}}
      onLostPointerCapture={() => {sidebarDrag.current = null;setResizingSidebar(false);}}
      onPointerCancel={() => {sidebarDrag.current = null;setResizingSidebar(false);}}
      onDoubleClick={() => setSidebarWidth(SIDEBAR_DEFAULT)}
      onKeyDown={(e) => {
        const next = { ArrowLeft: shownSidebarWidth - 16, ArrowRight: shownSidebarWidth + 16, Home: SIDEBAR_MIN, End: sidebarMax, Enter: SIDEBAR_DEFAULT }[e.key];
        if (next !== undefined) {e.preventDefault();resizeSidebar(next);}
      }} />
    </aside>

    <main className="page">
      <div className="page-bar">
        {crumbs.length > 0 ? <Crumbs items={crumbs} /> : <span />}
        <div className="page-bar-right"><LanguageSwitch/><Live status={live} /><time className="clock">{timeOf(clock)} <span>{t("HKT")}</span></time>{MODE==='occ'&&<button className="button glass small" onClick={openBroadcast}><Megaphone size={14}/>{t('New broadcast')}</button>}{publishing}</div>
      </div>
      {bootError && <div className="banner bad" role="alert"><span>{t(bootError)}</span><button className="text-button" onClick={() => window.location.reload()}>{t("Reload")}</button></div>}
      {remoteChanged&&<div className="banner warn" role="status"><span>{t('New updates are available. Your unsaved form has been kept.')}</span><button className="button glass small" onClick={()=>{if(mayLeave(t('Discard unsaved changes?')))window.location.reload();}}>{t('Load latest updates')}</button></div>}
      {inbox.some(m=>!m.acknowledged_at)&&nav.page!=='inbox'&&<div className={'broadcast-banner '+(MODE==='outport'&&inbox.some(m=>!m.acknowledged_at&&+clock-Date.parse(m.created_at)>=300000)?'inbox-overdue':'')}><Bell size={20}/><span><strong>{t('{0} messages to acknowledge',{0:inbox.filter(m=>!m.acknowledged_at).length})}</strong><small>{MODE==='outport'&&inbox.some(m=>!m.acknowledged_at&&+clock-Date.parse(m.created_at)>=300000)?t('Unacknowledged for over 5 minutes'):inbox.find(m=>!m.acknowledged_at)?.flight_no}</small></span><button className="button glass small" onClick={()=>go({page:'inbox'})}>{t('View messages')}</button></div>}
      {MODE==='outport' && unreadBroadcasts.length>0 && nav.page!=='broadcasts' && <div className="broadcast-banner" role="status"><Megaphone size={20}/><span><strong>{t('{0} OCC broadcasts to acknowledge',{0:unreadBroadcasts.length})}</strong><small>{unreadBroadcasts[0].title}</small></span><button className="button glass small" onClick={()=>go({page:'broadcasts'})}>{t('View broadcasts')}</button></div>}
      {MODE === 'outport' && !CARE_MODE && shownIncoming.length > 0 && <div className="alarm" role="alert">
        <BellRing size={22} /><span><strong>{shownIncoming.length === 1 ? t('New work order') : t("{0} new work orders", { 0: shownIncoming.length })}</strong>{shownIncoming.map((x) => `${x.flight_no} v${x.number}`).join(' · ')}</span>
        <button className="button primary small" onClick={() => go({ page: 'case', id: shownIncoming[0].id })}>{t("Open")}</button>
      </div>}
      {initialLoading ? <div className="loading"><Mark /><p>{t("Connecting…")}</p></div> : <>
        {nav.page==='demo'&&MODE==='occ'&&<DemoScenarios token={token} onChanged={refresh}/>}
        {nav.page==='broadcasts'&&<BroadcastPage mode={MODE} broadcasts={broadcasts} busy={busy} onCreate={openBroadcast} onAcknowledge={id=>perform(`/broadcasts/${id}/acknowledge`,{method:'POST',body:{}},'Broadcast acknowledged')}/>}
        {nav.page==='weather'&&<WeatherPage stations={stations} token={token} refreshTick={serviceTick}/>}
        {nav.page==='inbox'&&<InboxPage inbox={inbox} broadcasts={broadcasts} mode={MODE} clock={clock} onOpen={id=>go({page:'case',id})} onAcknowledge={id=>perform(`/inbox/${id}/acknowledge`,{method:'POST',body:{}},'Acknowledged')} onBroadcastAck={id=>perform(`/broadcasts/${id}/acknowledge`,{method:'POST',body:{}},'Acknowledged')}/>}
        {nav.page === 'overview' && <OverviewPage stations={stations} cases={cases} go={go} token={token} refreshTick={serviceTick} onCreate={onCreate?.()} />}
        {nav.page === 'region' && <RegionPage region={regionOf(nav.region)} stations={stations} cases={cases} go={go} />}
        {nav.page === 'station' && (MODE === 'outport' ?
        <StationPage code={station} station={stationOf(station)} cases={cases} stations={stations} go={go} serviceWidget={<WeatherPanel key={station} station={station} token={token} refreshTick={serviceTick}/>} /> :
        <StationPage code={nav.station} station={stationOf(nav.station)} cases={cases} stations={stations} go={go} onCreate={onCreate?.(nav.station)} serviceWidget={<WeatherPanel key={nav.station} station={nav.station} token={token} refreshTick={serviceTick}/>} />)}
        {nav.page === 'cases' && <CasesPage cases={cases} stations={stations} go={go} onCreate={onCreate?.()} />}
        {nav.page === 'case' && (detail ?
        <CasePage detail={detail} stations={stations} mode={CARE_MODE?'care':MODE} token={token} onChanged={refresh} busy={busy} actions={{
          createWO: () => setModal({ kind: 'wo', case: detail, number: (detail.work_orders[0]?.number || 0) + 1 }),
          authorize: (wo) => setModal({ kind: 'authorize', order: wo, case: detail }),
          reissue: (wo) => setModal({ kind: 'reissue', order: wo }),
          abort: (wo) => setModal({ kind: 'abort', order: wo }),
          cancel: () => setModal({ kind: 'cancel', case: detail }),
          receive: (wo) => perform(`/work-orders/${wo.id}/receive`, { method: 'POST', body: { version: wo.version } }, t('Work order v{0} received.', {0: wo.number})),
          respond: (wo, body) => perform(`/work-orders/${wo.id}/respond`, { method: 'POST', body }, 'Reply sent to OCC.'),
          editPassengerNotice: (event) => setModal({kind:'passenger-notice',event,case:detail}),
          upload,
          download: (file) => downloadFile(file, token).catch((error) => setToast({ error: true, text: error.message }))
        }} /> :
        <div className="loading"><RefreshCw size={20} /><p>{t("Loading flight…")}</p></div>)}
      </>}
      <footer className="footer">{t("Demo · Synthetic data · All times HKT")}</footer>
    </main>

    {toast && <div className={'toast ' + (toast.error ? 'error' : '')} role={toast.error ? 'alert' : 'status'}>{toast.error ? <Bell size={18} /> : <CircleCheck size={18} />}<span>{t(toast.text)}</span><button onClick={() => setToast(null)} aria-label={t("Dismiss notification")}><X size={16} /></button></div>}

    {modal && <Modal wide={['wo', 'authorize','passenger-notice','broadcast'].includes(modal.kind)} onClose={() => {if (!busy) setModal(null);}}
    eyebrow={{ wo: modal.case?.flight_no, authorize: 'Passengers will see this', cancel: 'Special case', abort: 'Special case','passenger-notice':modal.case?.flight_no }[modal.kind]}
    title={{ create: 'New flight case', wo: t('Work order v{0}', {0: modal.number}), authorize: 'Authorise & publish', reissue: t('Reissue as v{0}', {0: modal.order?.number + 1}), abort: t('Stop work order v{0}', {0: modal.order?.number}),
      cancel: t('Cancel {0}?', {0: modal.case?.flight_no}), switch: modal.active ? 'Pause passenger publishing?' : 'Resume passenger publishing?', 'passenger-notice':'Edit passenger notice',broadcast:'New broadcast' }[modal.kind]}>
      {modal.kind==='broadcast'&&<BroadcastForm stations={stations} initial={modal.initial} busy={busy} onSubmit={(body,key)=>perform('/broadcasts',{method:'POST',body,key},'OCC broadcast sent')}/>}
      {modal.kind === 'create' && <CreateForm stations={stations} initialStation={modal.station} busy={busy} onSubmit={(body, key) => perform('/cases', { method: 'POST', body, key }, 'Flight case created.').then((result) => {if (result) go({ page: 'case', id: result.id });})} />}
      {modal.kind === 'wo' && <WorkOrderForm record={modal.case} number={modal.number} busy={busy} onSubmit={(body) => perform(`/cases/${modal.case.id}/work-orders`, { method: 'POST', body }, t('Work order v{0} sent to {1}.', {0: modal.number, 1: modal.case.station}))} />}
      {modal.kind === 'authorize' && <AuthorizeForm order={modal.order} record={modal.case} busy={busy} paused={switchState.active} onResume={resumePublishing} onSubmit={(body) => perform(`/work-orders/${modal.order.id}/authorize`, { method: 'POST', body }, 'Authorised. Passengers have the update.')} />}
      {modal.kind === 'reissue' && <ReissueForm order={modal.order} busy={busy} onSubmit={(body) => perform(`/work-orders/${modal.order.id}/reissue`, { method: 'POST', body }, t('v{0} sent.', {0: modal.order.number + 1}))} />}
      {modal.kind === 'abort' && <AbortForm order={modal.order} busy={busy} onSubmit={(body) => perform(`/work-orders/${modal.order.id}/abort`, { method: 'POST', body }, t('v{0} stopped.', {0: modal.order.number}))} />}
      {modal.kind === 'cancel' && <CancelFlightForm record={modal.case} busy={busy} paused={switchState.active} onResume={resumePublishing} onSubmit={(body) => perform(`/cases/${modal.case.id}/cancel-flight`, { method: 'POST', body }, 'Flight cancelled. Passengers have been told.')} />}
      {modal.kind==='passenger-notice' && <PassengerNoticeForm record={modal.case} event={modal.event} busy={busy} paused={switchState.active} token={token} onDraftSaved={data=>{setModal(m=>({...m,case:{...m.case,workspace:{...m.case.workspace,draft:data}}}));refresh();}} onSubmit={(body,key)=>perform(`/cases/${modal.case.id}/events/${modal.event.id}/passenger-notices`,{method:'POST',body,key},'Passenger notice published')}/>}
      {modal.kind === 'switch' && <><p className="modal-description">{modal.active ? t('Authorising and cancelling will be blocked until you resume. Work orders continue.') : t('Authorised updates will reach passengers immediately.')}</p>
        <div className="modal-actions"><button className="button glass" disabled={busy} onClick={() => setModal(null)}>{t("Cancel")}</button><button className="button primary" disabled={busy} onClick={() => perform('/kill-switch', { method: 'PUT', body: { active: modal.active, version: modal.version } }, modal.active ? 'Publishing paused.' : 'Publishing resumed.')}>{modal.active ? <Pause size={15} /> : <Play size={15} />}{modal.active ? t('Pause') : t('Resume')}</button></div></>}
    </Modal>}
  </div>;
}

/** Sidebar location card (Weather city list): name on the left, one number on the right, one status word below. */
function LocationCard({ name, sub, value, note, selected, onClick }) {
  return <button className={'loc-card' + (selected ? ' selected' : '') + (value ? '' : ' clear')} aria-current={selected ? 'page' : undefined} onClick={onClick}>
    <span className="loc-name"><strong>{t(name)}</strong><small>{sub}</small></span>
    <span className="loc-value">{value ? value : <Check size={22} />}</span>
    <span className="loc-note">{t(note)}</span>
  </button>;
}
