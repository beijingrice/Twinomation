import { t, getLanguage, itemLabel, itemAnswer, eventText } from "./i18n";
import React, { useRef, useState } from 'react';
import { Activity, BellRing, Check, CheckCheck, ChevronRight, CircleStop, Download, FilePlus2, FileText, Hourglass, ListChecks, Paperclip, PencilLine, Plane, Plus, RotateCw, Send, ShieldCheck, Smartphone, Trash2, Upload, X, XCircle } from 'lucide-react';
import {publishedNoticeForEvent} from './noticeTemplates';
import {OperationsMetrics,WeatherOverview,sortFlights} from './OpsExtras';
import CaseWorkspace from './CaseWorkspace';
import { ACTIVE_WO, FLIGHT_STATUS, MODE, PRESET_OPTIONS, REGIONS, WO_STATUS, answerTone, humanize, latestWO, mineOf, needsAction, nextStep, notReady, todoOf, waitingOn } from './constants';
import { passengerPreviewPath } from './passengerPreview.js';
import { Empty, Hero, Pill, SearchField, Segmented, Widget, dateOf, relative, timeOf } from './components';

const FILTERS = [['OPEN', 'Active'], ['CLOSED', 'Closed'], ['', 'All']];
const plural = (n, word) => getLanguage() === 'zh' ? t(word === 'open flight' ? '{0} open flights' : '{0} outports', {0: n}) : `${n} ${word}${n === 1 ? '' : 's'}`;

/* ---------- Building blocks ---------- */

/** Explain the next action and name the responsible team in either workspace. */
function NextStep({ c }) {
  const step = nextStep(c);
  const Icon = step.owner === 'done' ? CheckCheck : ChevronRight;
  return <span className={'next ' + step.owner + (step.mine ? ' mine' : '')}>
    <span className="next-heading"><Icon size={16} aria-hidden="true"/><span>{step.text}</span></span>
    <small className="next-detail">{step.detail}</small>
  </span>;
}

function OrderStatus({ order }) {
  return <span className="order-status">
    <Pill tone={WO_STATUS[order.status].tone}>{t(WO_STATUS[order.status].label)}</Pill>
    <small>{t('Work order · Version {0}', {0: order.number})}</small>
  </span>;
}

function FlightRow({ c, stationName, onClick }) {
  const wo = latestWO(c);
  const time = c.public_departure || wo?.proposed_departure || c.proposed_departure || c.original_departure;
  const timeLabel = c.flight_status === 'CANCELLED' ? t('Cancelled') : c.flight_status === 'DELAYED' && !c.public_departure ? t('Time pending') : null;
  return <button className={'case-row' + (c.status === 'CLOSED' ? ' closed' : '') + (nextStep(c).mine ? ' mine' : '')} onClick={onClick}>
    <span className="cr-flight"><strong>{c.flight_no}{(c.has_recent_update||c.last_collaboration_at&&Date.now()-Date.parse(c.last_collaboration_at)<300000)&&<small className="recent-update">{t('New update')}</small>}</strong><small>{c.origin||c.station} → {c.destination}{stationName ? ` · ${stationName}` : ''}</small></span>
    <span className="cr-time"><b className={timeLabel ? 'time-label' : ''}>{timeLabel || timeOf(time)}</b>{!timeLabel && time !== c.original_departure && <small>{t("was ")}{timeOf(c.original_departure)}</small>}</span>
    <span className="cr-wo">{wo ? <OrderStatus order={wo}/> : <Pill tone="muted">{t("No work order")}</Pill>}</span>
    <NextStep c={c} />
    <ChevronRight size={18} className="cr-chevron" />
  </button>;
}

function FlightList({ cases, stations, onSelect, showStation = true, empty = 'No flights here' }) {
  if (!cases.length) return <Empty title={empty} text={""} icon={CheckCheck} />;
  return <div className="case-list">{cases.map((c) => <FlightRow key={c.id} c={c} stationName={showStation ? t(stations.find((s) => s.code === c.station)?.name) : null} onClick={() => onSelect(c.id)} />)}</div>;
}

const byUrgency = (a, b) => Number(!!nextStep(b).mine) - Number(!!nextStep(a).mine) || Number(needsAction(b)) - Number(needsAction(a)) || b.id - a.id;
const workloadSub = n => MODE === 'outport'
  ? t(n ? 'flights awaiting this station’s action' : 'No flights awaiting this station’s action')
  : t(n ? 'flights awaiting OCC action' : 'No flights awaiting OCC action');

/* ---------- OCC overview ---------- */

export function OverviewPage({ stations, cases, go, onCreate,token,refreshTick }) {
  const open = cases.filter((c) => c.status === 'OPEN');
  const mine = mineOf(open);
  const strip = [['occ', 'OCC action', open.filter((c) => waitingOn(c, 'occ')).length], ['station', 'Station action', open.filter((c) => waitingOn(c, 'station')).length]];
  return <>
    <Hero title={t("All outports")} value={mine} sub={t(workloadSub(mine))} line={t('{0} open flights · {1} outports', {0: open.length, 1: stations.length})}>
      {onCreate && <div className="hero-actions"><button className="button glass" onClick={onCreate}><Plus size={16} />{t("New flight case")}</button></div>}
    </Hero>
    <div className="grid">
      <OperationsMetrics cases={cases}/>
      <Widget span={6} icon={ListChecks} label={t("Waiting on")}>
        <div className="owner-strip">{strip.map(([o, label, n]) => <div key={o} className={'owner ' + o + (n ? '' : ' zero')}><strong>{n}</strong><span>{t(label)}</span></div>)}</div>
      </Widget>
      <Widget span={6} icon={Plane} label={t("Needs action")}>
        <FlightList cases={open.filter(needsAction).sort(byUrgency)} stations={stations} onSelect={(id) => go({ page: 'case', id })} empty={t("Nothing needs action")} />
      </Widget>
      <Widget span={6} icon={Hourglass} label={t('Delay follow-up')}><FlightList cases={sortFlights(open.filter(c=>c.flight_status==='DELAYED'),'delay')} stations={stations} onSelect={id=>go({page:'case',id})}/></Widget>
      <WeatherOverview stations={stations} token={token} refreshTick={refreshTick} go={go}/>
    </div>
  </>;
}

export function RegionPage({ region, stations, cases, go }) {
  const ss = stations.filter((s) => s.region === region?.code);
  const rc = cases.filter((c) => ss.some((s) => s.code === c.station));
  return <>
    <Hero title={region?.name || t('Region')} value={todoOf(rc)} sub={t("need action")} line={`${region?.local} · ${plural(ss.length, 'outport')}`} />
    <div className="grid">{ss.map((s) => {
        const n = todoOf(cases.filter((c) => c.station === s.code));
        return <Widget key={s.code} span={3} icon={Plane} label={`${s.code} · ${t(s.airport)}`} onClick={() => go({ page: 'station', station: s.code })}>
        <div className="place"><h3>{t(s.name)}</h3><span className={'place-num' + (n ? '' : ' zero')}>{n}</span></div>
        <p className="place-note">{n ? t('need action') : t('All clear')} · {plural(s.open_cases, 'open flight')}</p>
      </Widget>;
      })}</div>
  </>;
}

export function StationPage({ station, code, cases, stations, go, onCreate, serviceWidget }) {
  const [filter, setFilter] = useState('OPEN');
  const sc = cases.filter((c) => c.station === code);
  const open = sc.filter((c) => c.status === 'OPEN');
  const n = MODE === 'outport' ? mineOf(open) : todoOf(open);
  return <>
    <Hero title={t(station?.name) || code} value={n} sub={MODE === 'outport' ? workloadSub(n) : t('need action')} line={`${code} · ${t(station?.airport) || ''} · ${plural(open.length, 'open flight')}`}>
      {onCreate && <div className="hero-actions"><button className="button glass" onClick={onCreate}><Plus size={16} />{t("New flight case")}</button></div>}
    </Hero>
    <div className="grid">
      {MODE==='outport'&&<div className="operations-metrics s6"><div><strong>{sc.length}</strong><span>{t('Station flights')}</span></div><div><strong>{sc.reduce((n,c)=>n+(c.pending_tasks||0),0)}</strong><span>{t('Ground tasks awaiting completion')}</span></div><div><strong>{sc.filter(c=>c.boarding_recall_active).length}</strong><span>{t('Active boarding reminders')}</span></div></div>}
      {serviceWidget}
      <Widget span={6} icon={Plane} label={t("Flights · HKT")} aside={<Segmented value={filter} options={FILTERS} onChange={setFilter} />}>
        <FlightList cases={sc.filter((c) => !filter || c.status === filter).sort(byUrgency)} stations={stations} onSelect={(id) => go({ page: 'case', id })} showStation={false} />
      </Widget>
    </div>
  </>;
}

export function CasesPage({ cases, stations, go, onCreate }) {
  const [filter, setFilter] = useState('OPEN');
  const [search, setSearch] = useState('');
  const [sort,setSort]=useState('departure');
  const open = cases.filter((c) => c.status === 'OPEN');
  const match = (c) => `${c.flight_no} ${c.station} ${stations.find((s) => s.code === c.station)?.name || ''} ${t(stations.find((s) => s.code === c.station)?.name) || ''}`.toLowerCase().includes(search.toLowerCase());
  return <>
    <Hero title={t("All flights")} value={open.length} sub={t("open")} line={t('{0} need action · {1} closed', {0: todoOf(open), 1: cases.length - open.length})}>
      {onCreate && <div className="hero-actions"><button className="button glass" onClick={onCreate}><Plus size={16} />{t("New flight case")}</button></div>}
    </Hero>
    <div className="grid">
      <Widget span={6} icon={Plane} label={t("Flights · HKT")} aside={<div className="w-tools"><label className="flight-sort">{t('Sort by')}<select value={sort} onChange={e=>setSort(e.target.value)}>{[['departure','Departure'],['delay','Delay length'],['station','Outstation']].map(([v,l])=><option key={v} value={v}>{t(l)}</option>)}</select></label><SearchField value={search} onChange={setSearch} placeholder={t("Flight or outport")} /><Segmented value={filter} options={FILTERS} onChange={setFilter} /></div>}>
        <FlightList cases={sortFlights(cases.filter((c) => (!filter || c.status === filter) && match(c)),sort)} stations={stations} onSelect={(id) => go({ page: 'case', id })} />
      </Widget>
    </div>
  </>;
}

/* ---------- Flight detail ---------- */

/** Large, colour-coded action tile — the main way to act on a flight. */
function ActionTile({ tone, icon: Icon, title, sub, onClick, disabled, pulse }) {
  const Tag = onClick ? 'button' : 'div';
  return <Tag className={`action-tile ${tone}${pulse ? ' pulse' : ''}`} onClick={onClick} disabled={disabled}>
    <Icon size={26} /><span><strong>{t(title)}</strong>{sub && <small>{t(sub)}</small>}</span>
  </Tag>;
}

function ItemTile({ item }) {
  const tone = answerTone(item);
  return <div className={`item-tile ${tone}`}>
    <span className="it-label">{itemLabel(item)}{item.kind === 'custom' && <em>{t("Custom")}</em>}</span>
    <strong>{itemAnswer(item) || t('No answer yet')}</strong>
    {item.note && <small>{item.note}</small>}
    {item.previous !== undefined && item.previous !== null && <small className="was">{t("was ")}{itemAnswer(item, item.previous)}</small>}
  </div>;
}

function OrderView({ order }) {
  return <>
    <div className="wo-meta">
      <span><small>{t("Proposed")}</small><b>{order.proposed_departure ? t("{0} HKT", { 0: timeOf(order.proposed_departure) }) : '—'}</b></span>
      <span><small>{t("Sent")}</small><b>{relative(order.sent_at)}</b></span>
      {order.responded_at && <span><small>{t("Reply")}</small><b>{relative(order.responded_at)}</b></span>}
    </div>
    {order.note && <p className="wo-note"><b>{t("OCC")}</b>{t(order.note)}</p>}
    <div className="item-grid">{order.items.map((i) => <ItemTile key={i.key} item={i} />)}</div>
    {order.response_note && <p className="wo-note"><b>{t("Station")}</b>{order.response_note}</p>}
    {order.decision_note && <p className="wo-note"><b>{t("Decision")}</b>{order.decision_note}</p>}
  </>;
}

/** Station reply: one tap per item, optional note, and fully custom items. */
function ReplyForm({ order, busy, onSubmit }) {
  const [items, setItems] = useState(() => order.items.map(({ previous, ...i }) => ({ ...i, status: order.status === 'RESPONDED' ? i.status : null })));
  const [note, setNote] = useState(order.response_note || '');
  const [draft, setDraft] = useState(null);
  const set = (key, patch) => setItems(items.map((i) => i.key === key ? { ...i, ...patch } : i));
  const previous = Object.fromEntries(order.items.map((i) => [i.key, i.previous]));
  const options = draft ? (draft.options.trim()||'Ready,Pending,Unavailable').split(',').map((o) => o.trim()).filter(Boolean) : [];
  const validCustom = draft && options.length >= 2 && options.length <= 6 && new Set(options).size === options.length && options.every((o) => o.length <= 30);
  const addCustom = () => {
    const n = 1 + Math.max(0, ...items.filter((i) => i.kind === 'custom').map((i) => Number(i.key.split('-')[1]) || 0));
    setItems([...items, { key: `custom-${n}`, label: draft.label.trim()||t('Custom item'), kind: 'custom', options: [...new Set(options)].slice(0, 6), status: null, note: '' }]);
    setDraft(null);
  };
  const missing = items.filter((i) => !i.status).length;
  return <form className="reply" onSubmit={(e) => {e.preventDefault();onSubmit({ version: order.version, items, note });}}>
    {order.note && <p className="wo-note"><b>{t("OCC")}</b>{t(order.note)}</p>}
    {items.map((i) => <div key={i.key} className={`reply-row ${answerTone(i)}`}>
      <div className="rr-head">
        <strong>{itemLabel(i)}{i.kind === 'custom' && <em>{t("Custom")}</em>}</strong>
        {previous[i.key] && <small className="was">{t("was ")}{itemAnswer(i, previous[i.key])}</small>}
        {i.kind === 'custom' && <button type="button" className="icon-button" aria-label={t("Remove {0}", { 0: itemLabel(i) })} onClick={() => setItems(items.filter((x) => x.key !== i.key))}><Trash2 size={16} /></button>}
      </div>
      <div className="opt-row" role="radiogroup" aria-label={itemLabel(i)}>{i.options.map((o, idx) => <button type="button" key={o} role="radio" aria-checked={i.status === o}
        className={'opt ' + (i.kind === 'preset' ? ['good', 'warn', 'bad'][idx] : 'neutral') + (i.status === o ? ' on' : '')} onClick={() => set(i.key, { status: o })}>{itemAnswer(i, o)}</button>)}</div>
      <input className="rr-note" aria-label={t("{0} note", { 0: itemLabel(i) })} value={i.note} maxLength={240} placeholder={i.key === 'gate' ? t('Gate number') : i.key === 'counter' ? t('Counter numbers') : t('Note (optional)')} onChange={(e) => set(i.key, { note: e.target.value })} />
    </div>)}
    {draft ? <div className="custom-add">
      <input autoFocus aria-label={t('Custom item name')} value={draft.label} maxLength={60} placeholder={t("Item name, e.g. De-icing")} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
      <input aria-label={t('Custom item choices')} value={draft.options} maxLength={200} placeholder={t("Choices, comma separated: Booked, Waiting, Not needed")} onChange={(e) => setDraft({ ...draft, options: e.target.value })} />
      <p className="form-hint">{t("2–6 unique choices, up to 30 characters each.")}</p>
      <div className="button-row"><button type="button" className="button glass small" onClick={() => setDraft(null)}><X size={14} />{t("Cancel")}</button><button type="button" className="button primary small" disabled={!validCustom} onClick={addCustom}><Plus size={14} />{t("Add item")}</button></div>
    </div> : <button type="button" className="add-custom" disabled={items.length >= 20} onClick={() => setDraft({ label: '', options: '' })}><Plus size={16} />{t("Add custom item")}</button>}
    <label className="reply-note">{t("Message to OCC")}<textarea rows={2} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} placeholder={t("Optional")} /></label>
    <button className="button primary big" disabled={busy || missing > 0}><Send size={18} />{missing ? t("Answer {0} more", { 0: missing }) : order.status === 'RESPONDED' ? t('Update reply to OCC') : t('Send to OCC')}</button>
  </form>;
}

function FilesWidget({ files, busy, onUpload, onDownload,readOnly=false }) {
  const input = useRef(null);
  const [over, setOver] = useState(false);
  return <Widget span={2} icon={Paperclip} label={t("Files · {0}", { 0: files.length })} className="files">
    <button type="button" className={'drop' + (over ? ' over' : '')} disabled={busy||readOnly} onClick={() => input.current?.click()}
    onDragOver={(e) => {e.preventDefault();setOver(true);}} onDragLeave={() => setOver(false)}
    onDrop={(e) => {e.preventDefault();setOver(false);if (!readOnly && e.dataTransfer.files.length) onUpload(e.dataTransfer.files);}}>
      <Upload size={20} /><span>{t("Add Word, PDF…")}</span>
    </button>
    <input ref={input} type="file" multiple hidden accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.png,.jpg,.jpeg" onChange={(e) => {if (e.target.files.length) onUpload(e.target.files);e.target.value = '';}} />
    <ul className="file-list">{files.map((f) => <li key={f.id}><button onClick={() => onDownload(f)} title={t("Download")}>
      <FileText size={18} /><span><b>{f.name}</b><small>{f.uploaded_role === 'occ' ? t('OCC') : t('Station')} · {Math.max(1, Math.round(f.size / 1024))}{t(" KB · ")}{relative(f.created_at)}</small></span><Download size={15} />
    </button></li>)}</ul>
  </Widget>;
}

export function CasePage({ detail, stations, mode, busy, actions,token,onChanged }) {
  const [viewing, setViewing] = useState(null);
  const [allEvents, setAllEvents] = useState(false);
  const orders = detail.work_orders;
  const wo = orders[0];
  const shown = orders.find((o) => o.id === viewing) || wo;
  const open = detail.status === 'OPEN';
  const active = wo && ACTIVE_WO.includes(wo.status);
  const fs = FLIGHT_STATUS[detail.flight_status] || FLIGHT_STATUS.DISRUPTED;
  const time = detail.public_departure || wo?.proposed_departure || detail.proposed_departure || detail.original_departure;
  const timeLabel = detail.flight_status === 'CANCELLED' ? t('Cancelled') : detail.flight_status === 'DELAYED' && !detail.public_departure ? t('Time pending') : null;
  const gaps = wo ? notReady(wo.items).length : 0;
  const stationName = stations.find((s) => s.code === detail.station)?.name;
  const editable = open && mode === 'outport' && shown?.id === wo?.id && ['RECEIVED', 'RESPONDED'].includes(wo?.status);

  const tiles = [];
  if (mode === 'occ' && open) {
    if (!active) tiles.push(<ActionTile key="new" tone="brand" icon={FilePlus2} title={t("Create work order v{0}", { 0: (wo?.number || 0) + 1 })} sub={t("Send to {0}", { 0: detail.station })} onClick={actions.createWO} />);
    if (wo?.status === 'RESPONDED') {
      tiles.push(<ActionTile key="auth" tone={gaps ? 'wait' : 'good'} icon={ShieldCheck} title={t("Authorise & publish")} sub={gaps ? t("{0} not ready · Reissue first", { 0: gaps }) : t('All ready')} disabled={busy || gaps>0} onClick={() => actions.authorize(wo)} />);
      tiles.push(<ActionTile key="re" tone="warn" icon={RotateCw} title={t("Reissue as v{0}", { 0: wo.number + 1 })} sub={t("Ask again")} onClick={() => actions.reissue(wo)} />);
    }
    if (active && wo.status !== 'RESPONDED') tiles.push(<ActionTile key="wait" tone="wait" icon={Hourglass} title={t("Waiting for {0}", { 0: detail.station })} sub={t("v{0} {1} · {2}", { 0: wo.number, 1: t(WO_STATUS[wo.status].label), 2: relative(wo.received_at || wo.sent_at) })} />);
    if (active) tiles.push(<ActionTile key="stop" tone="danger" icon={CircleStop} title={t("Stop v{0}", { 0: wo.number })} onClick={() => actions.abort(wo)} />);
    tiles.push(<ActionTile key="cancel" tone="danger" icon={XCircle} title={t("Cancel flight")} onClick={actions.cancel} />);
  }
  if (open && mode === 'outport' && wo?.status === 'SENT') tiles.push(<ActionTile key="rx" tone="warn" icon={BellRing} title={t("Receive work order v{0}", { 0: wo.number })} sub={t("New from OCC")} pulse disabled={busy} onClick={() => actions.receive(wo)} />);

  return <>
    <Hero title={detail.flight_no} value={timeLabel ? <span className="time-label">{timeLabel}</span> : timeOf(time)}
    sub={<span className="hero-meta"><Pill tone={fs.tone}>{t(fs.label)}</Pill>{detail.origin||detail.station} → {detail.destination} · {dateOf(detail.flight_date + 'T12:00:00Z')}{!timeLabel && time !== detail.original_departure && <> · <s>{timeOf(detail.original_departure)}</s></>}</span>}
    line={<NextStep c={detail} />}>
      {mode === 'occ' && <div className="hero-actions"><a className="button glass" href={passengerPreviewPath(detail.id)} target="_blank" rel="noreferrer"><Smartphone size={15}/>{t("Passenger view")}</a></div>}
    </Hero>

    <div className="grid">
      {tiles.length > 0 && <div className="action-row s6">{tiles}</div>}

      <Widget span={4} rows={2} icon={ListChecks} label={t('Work order')} className="wo"
      aside={shown && <span className="wo-aside">{orders.length > 1 && <span className="vtabs">{[...orders].reverse().map((o) => <button key={o.id} className={o.id === shown.id ? 'on' : ''} onClick={() => setViewing(o.id)}>{t('Version {0}', {0: o.number})}</button>)}</span>}<OrderStatus order={shown}/></span>}>
        {!shown ? <Empty title={t("No work order yet")} text={mode === 'occ' ? t('Create one to ask the station for confirmation.') : t('OCC has not sent a work order.')} icon={ListChecks} /> :
        editable ? <ReplyForm key={wo.id + ':' + wo.version} order={wo} busy={busy} onSubmit={(body) => actions.respond(wo, body)} /> :
        <OrderView order={shown} />}
      </Widget>

      <FilesWidget readOnly={mode==='care'} files={detail.files} busy={busy} onUpload={(list) => actions.upload(list, wo?.id)} onDownload={actions.download} />

      <Widget span={2} icon={Plane} label={t("Flight")}>
        <dl className="facts">
          <div><dt>{t("Route")}</dt><dd>{detail.origin||detail.station}{detail.origin!=='HKG'&&stationName ? ` ${t(stationName)}` : ''} → {detail.destination}</dd></div>
          <div><dt>{t("Aircraft")}</dt><dd>{detail.aircraft || '—'}</dd></div>
          <div><dt>{t("Scheduled")}</dt><dd>{timeOf(detail.original_departure)}</dd></div>
          {detail.public_departure && <div><dt>{t("Published")}</dt><dd>{timeOf(detail.public_departure)}{detail.public_gate ? t(" · Gate {0}", { 0: detail.public_gate }) : ''}</dd></div>}
        </dl>
      </Widget>

      <CaseWorkspace record={detail} role={mode} token={token} onChanged={onChanged} onEditNotice={actions.editPassengerNotice}/>
      <Widget span={6} icon={Activity} label={t("History")} aside={detail.events.length > 6 && <button className="w-link" onClick={() => setAllEvents(!allEvents)}>{allEvents ? t('Show less') : t("All {0}", { 0: detail.events.length })}</button>}>
        <ol className="timeline event-timeline">{(allEvents ? detail.events : detail.events.slice(0, 6)).map((e) => <li key={e.id} className={['UPDATE_PUBLISHED', 'WORK_ORDER_AUTHORIZED','PASSENGER_NOTICE_PUBLISHED'].includes(e.type) ? 'good' : ['WORK_ORDER_ABORTED', 'FLIGHT_CANCELLED'].includes(e.type) ? 'bad' : ''}>
          <strong>{eventText(e)}</strong>
          <small>{t({ occ: 'OCC', outport: 'Station', cs: 'Customer service', care:'Customer Care', system: 'System' }[e.actor_role] || e.actor_role)} · {relative(e.created_at)}</small>
          {['outport','care'].includes(mode) && <div className="event-notice-actions">{publishedNoticeForEvent(detail,e)&&<Pill tone="good">{t('Notice published')}</Pill>}<button className="button glass small" disabled={busy} onClick={()=>actions.editPassengerNotice(e)}><PencilLine size={14}/>{t(publishedNoticeForEvent(detail,e)?'Edit another notice':'Edit passenger notice')}</button></div>}
        </li>)}</ol>
      </Widget>
    </div>
  </>;
}
