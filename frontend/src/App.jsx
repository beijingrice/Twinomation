import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Bell, Check, CircleCheck, Pause, Play, RefreshCw, Send, ShieldCheck, Smartphone, X } from 'lucide-react';
import { api, useLive } from './api';
import { Crumbs, Live, Mark, Modal, SearchField, timeOf } from './components';
import { MODE, REGIONS, STATION_CODES, titleTopic, todoOf, waitingOn } from './constants';
import { CreateForm, NoteForm, ReadinessForm, RejectForm, ScheduleForm } from './forms';
import { CasePage, CasesPage, OverviewPage, RegionPage, ReviewPage, StationPage } from './pages';

const DEFAULT_PAGE = MODE === 'outport' ? 'station' : MODE === 'cs' ? 'review' : 'overview';
const HOME = MODE === 'outport' ? '/outport' : MODE === 'cs' ? '/review' : '/';

/* Navigation lives in the query string so reload and back/forward work. In the outport demo `station` is the simulated identity. */
function parseNav() {
  const q = new URLSearchParams(window.location.search);
  if (q.has('case')) return { page: 'case', id: Number(q.get('case')) };
  if (MODE === 'outport') return { page: 'station' };
  if (q.get('outport')) return { page: 'station', station: q.get('outport') };
  if (q.get('region')) return { page: 'region', region: q.get('region') };
  const view = q.get('view');
  if (view === 'cases' || view === 'review') return { page: view };
  return { page: DEFAULT_PAGE };
}
function navUrl(nav, station) {
  const q = new URLSearchParams();
  if (MODE === 'outport') q.set('station', station);
  if (nav.page === 'case') q.set('case', nav.id);
  else if (nav.page === 'region') q.set('region', nav.region);
  else if (nav.page === 'station' && MODE !== 'outport') q.set('outport', nav.station);
  else if (['cases', 'review'].includes(nav.page) && nav.page !== DEFAULT_PAGE) q.set('view', nav.page);
  const s = q.toString();
  return window.location.pathname + (s ? '?' + s : '');
}

const MODAL_TITLES = { create: 'Open a coordination case', readiness: 'Update ground readiness', schedule: 'Propose a departure time', note: 'Add an internal note', close: 'Close this case?', publish: 'Publish update', reject: 'Keep this update internal', link: 'Passenger preview is ready' };

export default function App() {
  const [token, setToken] = useState('');
  const [station, setStation] = useState(() => new URLSearchParams(window.location.search).get('station') || 'KIX');
  const [stations, setStations] = useState([]);
  const [cases, setCases] = useState([]);
  const [updates, setUpdates] = useState([]);
  const [switchState, setSwitchState] = useState({ active: true, version: 1 });
  const [nav, setNav] = useState(parseNav);
  const [detail, setDetail] = useState(null);
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);
  const [bootError, setBootError] = useState('');
  const [initialLoading, setInitialLoading] = useState(true);
  const [clock, setClock] = useState(new Date());
  const [sideSearch, setSideSearch] = useState('');
  const mutation = useRef(false);
  const navRef = useRef(nav); navRef.current = nav;

  useEffect(() => { const i = setInterval(() => setClock(new Date()), 30000); return () => clearInterval(i); }, []);
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(null), 6500); return () => clearTimeout(t); } }, [toast]);
  useEffect(() => { const pop = () => setNav(parseNav()); window.addEventListener('popstate', pop); return () => window.removeEventListener('popstate', pop); }, []);

  // Simulated employee session, one per tab/role/station.
  useEffect(() => {
    let active = true;
    setToken(''); setInitialLoading(true); setBootError('');
    const storageKey = `twinomation.session.${MODE}.${station}`;
    const saved = sessionStorage.getItem(storageKey);
    (async () => {
      if (saved) {
        try { await api('/stations', { token: saved }); if (active) setToken(saved); return; } catch { sessionStorage.removeItem(storageKey); }
      }
      const result = await api('/session', { method: 'POST', body: { role: MODE, station } });
      if (active) { sessionStorage.setItem(storageKey, result.token); setToken(result.token); }
    })().catch(error => { if (active) { setBootError(error.message); setInitialLoading(false); } });
    return () => { active = false; };
  }, [station]);

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const [s, c, u, k] = await Promise.all([api('/stations', { token }), api('/cases', { token }), api('/updates?status=PENDING', { token }), api('/kill-switch', { token })]);
      setStations(s); setCases(c); setUpdates(u); setSwitchState(k); setBootError(''); setInitialLoading(false);
      const current = navRef.current;
      if (current.page === 'case') {
        const d = await api(`/cases/${current.id}`, { token });
        if (navRef.current.page === 'case' && navRef.current.id === current.id) setDetail(d);
      }
    } catch (error) {
      setInitialLoading(false);
      setBootError(error.status === 401 ? 'Your local session has expired. Reload to choose a fresh workspace.' : error.message);
    }
  }, [token]);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    setDetail(null);
    if (nav.page !== 'case' || !token) return;
    const controller = new AbortController();
    api(`/cases/${nav.id}`, { token, signal: controller.signal }).then(setDetail).catch(error => { if (!controller.signal.aborted) setToast({ error: true, text: error.message }); });
    return () => controller.abort();
  }, [nav.page, nav.id, token]);
  const live = useLive(token ? '/stream' : null, token, refresh);

  const go = next => { setNav(next); window.history.pushState(null, '', navUrl(next, station)); window.scrollTo({ top: 0, behavior: 'instant' }); };
  const switchStation = code => { setDetail(null); setStation(code); const next = { page: 'station' }; setNav(next); window.history.replaceState(null, '', navUrl(next, code)); };
  const perform = async (path, options, success) => {
    if (mutation.current) return null;
    mutation.current = true; setBusy(true);
    try {
      const result = await api(path, { token, ...options });
      setModal(null); setToast({ text: success }); await refresh(); return result;
    } catch (error) { setToast({ error: true, text: error.message }); await refresh(); return null; }
    finally { mutation.current = false; setBusy(false); }
  };
  const openPassenger = async id => {
    const result = await perform('/demo/passenger-link', { method: 'POST', body: { case_id: id } }, 'Demo link created. Previous link revoked.');
    if (result) setModal({ kind: 'link', path: result.path });
  };
  const askPublish = (update, text) => setModal({ kind: 'publish', update, text, key: crypto.randomUUID() });
  const askReject = update => setModal({ kind: 'reject', update });
  const askSwitch = () => setModal({ kind: 'switch', active: !switchState.active, version: switchState.version });
  const onCreate = MODE === 'occ' ? (initial => () => setModal({ kind: 'create', station: initial })) : null;

  /* Breadcrumbs */
  const stationOf = code => stations.find(s => s.code === code);
  const regionOf = code => REGIONS.find(r => r.code === code);
  const crumbs = [];
  const network = { label: 'Overview', onClick: () => go({ page: 'overview' }) };
  const pushStation = code => {
    const s = stationOf(code);
    if (MODE === 'outport') { crumbs.push({ label: s ? `${s.name} · ${s.code}` : code, onClick: () => go({ page: 'station' }) }); return; }
    const r = regionOf(s?.region);
    crumbs.push(network);
    if (r) crumbs.push({ label: r.name, onClick: () => go({ page: 'region', region: r.code }) });
    crumbs.push({ label: s?.name || code, onClick: () => go({ page: 'station', station: code }) });
  };
  if (nav.page === 'region') crumbs.push(network, { label: regionOf(nav.region)?.name || nav.region });
  if (nav.page === 'station' && MODE !== 'outport') pushStation(nav.station);
  if (nav.page === 'case' && detail) { pushStation(detail.station); crumbs.push({ label: detail.flight_no }); }

  const open = cases.filter(c => c.status === 'OPEN');
  const q = sideSearch.toLowerCase();
  const stationMatch = s => !q || `${s.name} ${s.code} ${s.airport} ${s.country}`.toLowerCase().includes(q);
  const selectedStation = nav.page === 'station' ? (MODE === 'outport' ? station : nav.station) : nav.page === 'case' ? detail?.station : null;
  const stationCard = s => {
    const sc = cases.filter(c => c.station === s.code);
    // A station viewer sees what is waiting on them, matching their page hero; others see what needs attention.
    const n = MODE === 'outport' ? sc.filter(c => waitingOn(c, 'station')).length : todoOf(sc);
    return <LocationCard key={s.code} name={s.name} sub={s.code} value={n} note={n ? (MODE === 'outport' ? 'Waiting on you' : 'Needs attention') : 'All clear'}
      selected={selectedStation === s.code} onClick={() => go(MODE === 'outport' ? { page: 'station' } : { page: 'station', station: s.code })}/>;
  };
  const publishing = MODE === 'occ'
    ? <button className={'publish-chip ' + (switchState.active ? 'paused' : 'on')} onClick={askSwitch} title="Click to change">{switchState.active ? <Pause size={12}/> : <Send size={12}/>}{switchState.active ? 'Publishing paused' : 'Publishing on'}</button>
    : <span className={'publish-chip ' + (switchState.active ? 'paused' : 'on')}>{switchState.active ? 'Publishing paused' : 'Publishing on'}</span>;
  const roleHref = { occ: '/', outport: `/outport?station=${station}`, cs: '/review' };

  return <div className="app">
    <aside className="sidebar">
      <div className="side-top">
        <a className="brand" href={HOME}><Mark small/><span>Twinomation</span></a>
        <label className="picker"><span>View as</span>
          <select value={MODE} onChange={e => { window.location.href = roleHref[e.target.value]; }}>
            <option value="occ">Operations control</option>
            <option value="outport">Outport station</option>
            <option value="cs">Customer service</option>
          </select>
        </label>
        {MODE === 'outport' && <label className="picker"><span>Station</span><select value={station} onChange={e => switchStation(e.target.value)}>{STATION_CODES.map(s => <option key={s}>{s}</option>)}</select></label>}
        {MODE !== 'outport' && <nav className="side-nav" aria-label="Workspace">
          <button className={nav.page === 'overview' ? 'active' : ''} onClick={() => go({ page: 'overview' })}>Overview<span className={todoOf(cases) ? 'warn' : ''}>{todoOf(cases)}</span></button>
          <button className={nav.page === 'review' ? 'active' : ''} onClick={() => go({ page: 'review' })}>Passenger updates<span className={updates.length ? 'warn' : ''}>{updates.length}</span></button>
          <button className={nav.page === 'cases' ? 'active' : ''} onClick={() => go({ page: 'cases' })}>All cases<span>{open.length}</span></button>
        </nav>}
      </div>
      {MODE !== 'outport' && <SearchField value={sideSearch} onChange={setSideSearch} placeholder="Find an outport"/>}
      <div className="side-list">
        {MODE === 'outport'
          ? stations.map(stationCard)
          : REGIONS.map(r => {
              const list = stations.filter(s => s.region === r.code && stationMatch(s));
              if (!list.length) return null;
              return <React.Fragment key={r.code}>
                <button className={'side-group' + (nav.page === 'region' && nav.region === r.code ? ' active' : '')} onClick={() => go({ page: 'region', region: r.code })}>{r.name}</button>
                {list.map(stationCard)}
              </React.Fragment>;
            })}
      </div>
    </aside>

    <main className="page">
      <div className="page-bar">
        {crumbs.length > 0 ? <Crumbs items={crumbs}/> : <span/>}
        <div className="page-bar-right"><Live status={live}/><time className="clock">{timeOf(clock)} <span>HKT</span></time>{publishing}</div>
      </div>
      {bootError && <div className="banner bad" role="alert"><span>{bootError}</span><button className="text-button" onClick={() => window.location.reload()}>Reload</button></div>}
      {initialLoading ? <div className="loading"><Mark/><p>Connecting your workspace…</p></div> : <>
        {nav.page === 'overview' && <OverviewPage stations={stations} cases={cases} updates={updates} switchState={switchState} mode={MODE} go={go} onCreate={onCreate?.()} onToggleSwitch={askSwitch}/>}
        {nav.page === 'region' && <RegionPage region={regionOf(nav.region)} stations={stations} cases={cases} go={go}/>}
        {nav.page === 'station' && (MODE === 'outport'
          ? <StationPage code={station} station={stationOf(station)} cases={cases} stations={stations} switchState={switchState} mode={MODE} go={go} badge={<span className="pill brand"><ShieldCheck size={13}/>{station} · local demo</span>}/>
          : <StationPage code={nav.station} station={stationOf(nav.station)} cases={cases} stations={stations} switchState={switchState} mode={MODE} go={go} onCreate={onCreate?.(nav.station)} onToggleSwitch={askSwitch}/>)}
        {nav.page === 'cases' && <CasesPage cases={cases} stations={stations} go={go} onCreate={onCreate?.()}/>}
        {nav.page === 'review' && <ReviewPage updates={updates} mode={MODE} switchState={switchState} busy={busy} go={go} onPublish={askPublish} onReject={askReject} onToggleSwitch={askSwitch}/>}
        {nav.page === 'case' && (detail
          ? <CasePage detail={detail} stations={stations} mode={MODE} busy={busy} switchState={switchState} actions={{
              acknowledge: () => perform(`/cases/${detail.id}/acknowledge`, { method: 'POST', body: { version: detail.version } }, 'Case acknowledged. OCC has been updated.'),
              schedule: () => setModal({ kind: 'schedule', case: detail }),
              passenger: () => openPassenger(detail.id),
              note: () => setModal({ kind: 'note', case: detail }),
              readiness: () => setModal({ kind: 'readiness', case: detail }),
              close: () => setModal({ kind: 'close', case: detail }),
              publish: askPublish,
              reject: askReject
            }}/>
          : <div className="loading"><RefreshCw size={20}/><p>Loading case…</p></div>)}
      </>}
      <footer className="footer">Demo · Synthetic data · Email off · All times HKT</footer>
    </main>

    {toast && <div className={'toast ' + (toast.error ? 'error' : '')} role={toast.error ? 'alert' : 'status'}>{toast.error ? <Bell size={18}/> : <CircleCheck size={18}/>}<span>{toast.text}</span><button onClick={() => setToast(null)} aria-label="Dismiss notification"><X size={16}/></button></div>}

    {modal && <Modal title={modal.kind === 'switch' ? (modal.active ? 'Pause passenger publishing?' : 'Resume passenger publishing?') : MODAL_TITLES[modal.kind]} eyebrow={modal.kind === 'publish' ? 'FINAL REVIEW' : modal.kind === 'link' ? 'PRIVATE DEMO LINK' : 'LOCAL DEMO'} onClose={() => { if (!busy) setModal(null); }} wide={modal.kind === 'readiness'}>
      {modal.kind === 'create' && <CreateForm stations={stations} initialStation={modal.station} busy={busy} onSubmit={(body, key) => perform('/cases', { method: 'POST', body, key }, 'Case created.').then(result => { if (result) go({ page: 'case', id: result.id }); })}/>}
      {modal.kind === 'readiness' && <ReadinessForm record={modal.case} busy={busy} onSubmit={body => perform(`/cases/${modal.case.id}/readiness`, { method: 'PUT', body }, 'Readiness saved.')}/>}
      {modal.kind === 'schedule' && <ScheduleForm record={modal.case} busy={busy} onSubmit={body => perform(`/cases/${modal.case.id}/schedule`, { method: 'PUT', body }, 'Internal proposal saved.')}/>}
      {modal.kind === 'note' && <NoteForm version={modal.case.version} busy={busy} onSubmit={body => perform(`/cases/${modal.case.id}/notes`, { method: 'POST', body }, 'Note saved to the internal timeline.')}/>}
      {modal.kind === 'reject' && <RejectForm busy={busy} onSubmit={review_note => perform(`/updates/${modal.update.id}/reject`, { method: 'POST', body: { version: modal.update.version, review_note } }, 'Draft rejected. It will not appear to passengers.')}/>}
      {modal.kind === 'close' && <>
        <p className="modal-description">Close {modal.case.flight_no}'s internal coordination case. Unreviewed updates will be superseded. Customer service can still review the closing notice.</p>
        <div className="notice"><ShieldCheck size={17}/>This does not mean the flight has resumed or that passenger arrangements are complete.</div>
        <div className="modal-actions"><button className="button secondary" disabled={busy} onClick={() => setModal(null)}>Keep open</button><button className="button primary" disabled={busy} onClick={() => perform(`/cases/${modal.case.id}/close`, { method: 'POST', body: { version: modal.case.version } }, 'Case closed. The closing notice is waiting for review.')}>{busy ? 'Closing…' : 'Close case'}</button></div>
      </>}
      {modal.kind === 'publish' && <>
        <p className="modal-description">This exact message will appear on this case's demo passenger page.</p>
        <div className="message-preview"><p className="eyebrow">{titleTopic(modal.update.topic)}</p><p>{modal.text}</p></div>
        <div className="notice"><ShieldCheck size={17}/>Web publication only. No email will be sent.</div>
        <div className="modal-actions"><button className="button secondary" disabled={busy} onClick={() => setModal(null)}>Back to editing</button><button className="button primary" disabled={busy} onClick={() => perform(`/updates/${modal.update.id}/publish`, { method: 'POST', body: { version: modal.update.version, final_text: modal.text, send_email: false }, key: modal.key }, 'Update published to the demo passenger page.')}><Send size={15}/>{busy ? 'Publishing…' : 'Approve & publish'}</button></div>
      </>}
      {modal.kind === 'switch' && <>
        <p className="modal-description">{modal.active ? 'New passenger publications will be blocked. Internal coordination continues, and previously published messages remain visible.' : 'Customer service will be able to publish reviewed updates to demo passenger pages. Pending drafts will not publish automatically.'}</p>
        <div className="notice"><ShieldCheck size={17}/>External email remains disabled. This control cannot retract a message already seen by a passenger.</div>
        <div className="modal-actions"><button className="button secondary" disabled={busy} onClick={() => setModal(null)}>Cancel</button><button className="button primary" disabled={busy} onClick={() => perform('/kill-switch', { method: 'PUT', body: { active: modal.active, version: modal.version } }, modal.active ? 'Publishing paused.' : 'Publishing resumed.')}>{modal.active ? <Pause size={15}/> : <Play size={15}/>} {busy ? 'Updating…' : modal.active ? 'Pause publishing' : 'Resume publishing'}</button></div>
      </>}
      {modal.kind === 'link' && <>
        <p className="modal-description">Open the mobile-friendly passenger page for this demo case. The private link expires in eight hours; issuing another link revokes this one.</p>
        <div className="notice"><Smartphone size={18}/>For phone layout preview, use a narrow browser window. This server accepts local connections only.</div>
        <div className="modal-actions"><button className="button secondary" onClick={() => setModal(null)}>Done</button><a className="button primary" href={modal.path} target="_blank" rel="noreferrer">Open passenger page<ArrowUpRight size={16}/></a></div>
      </>}
    </Modal>}
  </div>;
}

/** Sidebar location card (Weather city list): name on the left, one number on the right, one status word below. */
function LocationCard({ name, sub, value, note, selected, onClick }) {
  return <button className={'loc-card' + (selected ? ' selected' : '') + (value ? '' : ' clear')} aria-current={selected ? 'page' : undefined} onClick={onClick}>
    <span className="loc-name"><strong>{name}</strong><small>{sub}</small></span>
    <span className="loc-value">{value ? value : <Check size={22}/>}</span>
    <span className="loc-note">{note}</span>
  </button>;
}
