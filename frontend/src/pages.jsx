import React, { useState } from 'react';
import { Activity, ArrowUpRight, CalendarClock, Check, CheckCheck, ChevronRight, ListChecks, Pause, Play, Plane, Plus, Send, Smartphone, Workflow, X } from 'lucide-react';
import { CONDITION_META, ME, MODE, REGIONS, countReady, humanize, needsAction, nextStep, titleTopic, todoOf, waitingOn } from './constants';
import { Empty, Hero, Pill, SearchField, Segmented, Widget, dateOf, relative, timeOf } from './components';

const FILTERS = [['OPEN', 'Active'], ['CLOSED', 'Closed'], ['', 'All']];
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const attentionSub = n => n ? (n === 1 ? 'case needs attention' : 'cases need attention') : 'All clear';

/* ---------- Building blocks ---------- */

/** "● KIX  confirm gate and counter" — who has to do what next. */
function NextStep({ c, showOwner = true }) {
  const step = nextStep(c);
  return <span className={'next ' + step.owner + (step.mine ? ' mine' : '')}>
    <i className="dot"/>
    {showOwner && step.who && <b>{step.who}</b>}
    <span>{step.text}{step.more > 0 && <small className="next-more"> · +{step.more} more</small>}</span>
  </span>;
}

function CaseRow({ c, stationName, onClick }) {
  return <button className={'case-row' + (c.status === 'CLOSED' ? ' closed' : '')} onClick={onClick}>
    <span className="cr-flight"><strong>{c.flight_no}</strong><small>{c.station} → {c.destination}{stationName ? ` · ${stationName}` : ''}</small></span>
    <span className="cr-time"><b>{timeOf(c.proposed_departure || c.original_departure)}</b>{c.proposed_departure && <small>was {timeOf(c.original_departure)}</small>}</span>
    <NextStep c={c}/>
    <ChevronRight size={16} className="cr-chevron"/>
  </button>;
}

function CaseList({ cases, stations, onSelect, showStation = true, empty = 'No cases here' }) {
  if (!cases.length) return <Empty title={empty} text="" icon={CheckCheck}/>;
  return <div className="case-list">{cases.map(c => <CaseRow key={c.id} c={c} stationName={showStation ? stations.find(s => s.code === c.station)?.name : null} onClick={() => onSelect(c.id)}/>)}</div>;
}

/** Viewer's own tasks first, then anything needing attention, then newest. */
const byUrgency = (a, b) => Number(!!nextStep(b).mine) - Number(!!nextStep(a).mine) || Number(needsAction(b)) - Number(needsAction(a)) || b.id - a.id;

/* ---------- Overview ---------- */

export function OverviewPage({ stations, cases, go, onCreate }) {
  const open = cases.filter(c => c.status === 'OPEN');
  const attention = open.filter(needsAction).sort(byUrgency);
  // Non-exclusive: one case can have work for the station and customer service at the same time.
  const owners = [['station', 'Stations'], ['occ', 'Operations'], ['cs', 'Customer service']].map(([o, label]) => [o, label, open.filter(c => waitingOn(c, o)).length]);
  owners.push(['done', 'Ready', open.filter(c => !needsAction(c)).length]);
  return <>
    <Hero title="All outports" value={attention.length} sub={attentionSub(attention.length)} line={`${plural(open.length, 'open case')} across ${stations.length} outports`}>
      {onCreate && <div className="hero-actions"><button className="button primary" onClick={onCreate}><Plus size={16}/>New case</button></div>}
    </Hero>
    <div className="grid">
      <Widget span={6} icon={Workflow} label="Open cases with work for">
        <div className="owner-strip">{owners.map(([o, label, n]) => <div key={o} className={'owner ' + o + (n ? '' : ' zero')}><strong>{n}</strong><span>{label}{o === ME && <em> · you</em>}</span></div>)}</div>
      </Widget>
      <Widget span={6} icon={ListChecks} label="Needs attention">
        <CaseList cases={attention} stations={stations} onSelect={id => go({ page: 'case', id })} empty="Nothing needs attention"/>
      </Widget>
    </div>
  </>;
}

/* ---------- Region ---------- */

export function RegionPage({ region, stations, cases, go }) {
  const ss = stations.filter(s => s.region === region?.code);
  const rc = cases.filter(c => ss.some(s => s.code === c.station));
  return <>
    <Hero title={region?.name || 'Region'} value={todoOf(rc)} sub={attentionSub(todoOf(rc))} line={`${region?.local} · ${plural(ss.length, 'outport')}`}/>
    <div className="grid">{ss.map(s => {
      const n = todoOf(cases.filter(c => c.station === s.code));
      return <Widget key={s.code} span={3} icon={Plane} label={`${s.code} · ${s.airport}`} onClick={() => go({ page: 'station', station: s.code })}>
        <div className="place"><h3>{s.name}</h3><span className={'place-num' + (n ? '' : ' zero')}>{n}</span></div>
        <p className="place-note">{n ? attentionSub(n) : 'All clear'} · {plural(s.open_cases, 'open case')}</p>
      </Widget>;
    })}</div>
  </>;
}

/* ---------- Station ---------- */

export function StationPage({ station, code, cases, stations, go, onCreate }) {
  const [filter, setFilter] = useState('OPEN');
  const sc = cases.filter(c => c.station === code);
  const open = sc.filter(c => c.status === 'OPEN');
  // A station viewer cares about what is waiting on them; everyone else about what needs attention.
  const n = MODE === 'outport' ? open.filter(c => waitingOn(c, 'station')).length : todoOf(sc);
  const sub = MODE === 'outport' ? (n ? `${n === 1 ? 'case is' : 'cases are'} waiting on you` : 'Nothing waiting on you') : attentionSub(n);
  return <>
    <Hero title={station?.name || code} value={n} sub={sub} line={`${code} · ${station?.airport || ''} · ${plural(open.length, 'open case')}`}>
      {onCreate && <div className="hero-actions"><button className="button primary" onClick={onCreate}><Plus size={16}/>New case</button></div>}
    </Hero>
    <div className="grid">
      <Widget span={6} icon={Plane} label="Cases · departure HKT" aside={<Segmented value={filter} options={FILTERS} onChange={setFilter}/>}>
        <CaseList cases={sc.filter(c => !filter || c.status === filter).sort(byUrgency)} stations={stations} onSelect={id => go({ page: 'case', id })} showStation={false}/>
      </Widget>
    </div>
  </>;
}

/* ---------- All cases ---------- */

export function CasesPage({ cases, stations, go, onCreate }) {
  const [filter, setFilter] = useState('OPEN');
  const [search, setSearch] = useState('');
  const open = cases.filter(c => c.status === 'OPEN');
  const match = c => `${c.flight_no} ${c.station} ${stations.find(s => s.code === c.station)?.name || ''}`.toLowerCase().includes(search.toLowerCase());
  return <>
    <Hero title="All cases" value={open.length} sub={open.length === 1 ? 'open case' : 'open cases'} line={`${todoOf(cases)} need attention · ${cases.length - open.length} closed`}>
      {onCreate && <div className="hero-actions"><button className="button primary" onClick={onCreate}><Plus size={16}/>New case</button></div>}
    </Hero>
    <div className="grid">
      <Widget span={6} icon={Plane} label="Cases · departure HKT" aside={<div className="w-tools"><SearchField value={search} onChange={setSearch} placeholder="Flight or outport"/><Segmented value={filter} options={FILTERS} onChange={setFilter}/></div>}>
        <CaseList cases={cases.filter(c => (!filter || c.status === filter) && match(c)).sort(byUrgency)} stations={stations} onSelect={id => go({ page: 'case', id })}/>
      </Widget>
    </div>
  </>;
}

/* ---------- Review queue ---------- */

export function ReviewPage({ updates, mode, switchState, busy, go, onPublish, onReject, onToggleSwitch }) {
  return <>
    <Hero title="Passenger updates" value={updates.length} sub={updates.length ? 'waiting for review' : 'Nothing to review'} line={mode === 'cs' ? 'Check each message, edit if needed, then publish it to the passenger page.' : 'Customer service reviews these before passengers see them.'}>
      {mode === 'occ' && <div className="hero-actions"><button className="button glass" onClick={onToggleSwitch}>{switchState.active ? <Play size={15}/> : <Pause size={15}/>}{switchState.active ? 'Resume publishing' : 'Pause publishing'}</button></div>}
    </Hero>
    {switchState.active && <div className="banner warn"><Pause size={16}/>Publishing is paused by Operations. Drafts can be edited, but nothing can be published until it resumes.</div>}
    <div className="grid">
      {updates.map(u => <ReviewCard key={u.id} update={u} canReview={mode === 'cs'} paused={switchState.active} busy={busy} onCase={() => go({ page: 'case', id: u.case_id })} onPublish={text => onPublish(u, text)} onReject={() => onReject(u)}/>)}
      {!updates.length && <Widget span={6} icon={CheckCheck} label="Review queue"><Empty title="Every update has a decision" text="New drafts appear here automatically." icon={CheckCheck}/></Widget>}
    </div>
  </>;
}

export function ReviewCard({ update, canReview, paused, busy, onPublish, onReject, onCase, span = 3 }) {
  const [text, setText] = useState(update.draft_text);
  return <Widget span={span} icon={Send} label={`${titleTopic(update.topic)} · draft`} aside={onCase && <button className="w-link" onClick={onCase}>Open case<ArrowUpRight size={12}/></button>} className="review-widget">
    <h3 className="rv-title">{update.flight_no || `Case ${update.case_id}`} <span>{update.station} → HKG</span></h3>
    {canReview
      ? <textarea className="rv-text" aria-label={`Passenger message for ${update.flight_no || update.case_id}`} rows={3} maxLength={3000} value={text} onChange={e => setText(e.target.value)}/>
      : <p className="rv-draft">{update.draft_text}</p>}
    <div className="rv-foot">
      {canReview
        ? <><button className="button glass small" disabled={busy} onClick={onReject}><X size={14}/>Reject</button><button className="button primary small" disabled={busy || paused || !text.trim()} onClick={() => onPublish(text.trim())}><Send size={14}/>{paused ? 'Publishing paused' : 'Publish'}</button></>
        : <span className="muted">Waiting for customer service</span>}
    </div>
  </Widget>;
}

/* ---------- Case detail ---------- */

const STATUS_WORD = { CONFIRMED: 'Confirmed', PENDING: 'Waiting', UNAVAILABLE: 'Unavailable' };
const ACTOR = { occ: 'Operations', outport: 'Station', cs: 'Customer service', system: 'System' };

export function CasePage({ detail, stations, mode, busy, switchState, actions }) {
  const [allEvents, setAllEvents] = useState(false);
  const [showInternal, setShowInternal] = useState(false);
  const ready = countReady(detail);
  const open = detail.status === 'OPEN';
  const pending = detail.updates.filter(u => u.status === 'PENDING');
  const published = detail.updates.filter(u => u.status === 'PUBLISHED');
  const internal = detail.updates.filter(u => !['PENDING', 'PUBLISHED'].includes(u.status));
  const blocked = CONDITION_META.some(m => detail.conditions[m.key].status === 'UNAVAILABLE');
  const proposed = detail.proposed_departure;
  const { gates, counters } = detail.readiness;
  const step = nextStep(detail);

  // Three-step progress. The first unfinished step is "current".
  const steps = [
    { title: 'Station acknowledges', done: detail.acknowledged, detail: detail.acknowledged ? 'Acknowledged' : `Waiting for ${detail.station}`,
      action: mode === 'outport' && open && !detail.acknowledged && <button className="button primary small" disabled={busy} onClick={actions.acknowledge}><Check size={14}/>Acknowledge</button> },
    { title: 'Ground resources ready', done: ready === 5, warn: blocked, detail: blocked ? 'Something is unavailable' : `${ready} of 5 confirmed`,
      action: mode === 'outport' && open && detail.acknowledged && ready < 5 && <button className="button primary small" onClick={actions.readiness}>Update resources</button> },
    { title: 'Passengers informed', done: !pending.length && published.length > 0, detail: pending.length ? `${plural(pending.length, 'update')} to review${switchState.active ? ' · publishing paused' : ''}` : `${published.length} published` }
  ];
  const current = open ? steps.findIndex(s => !s.done) : -1;

  return <>
    <Hero title={detail.flight_no} value={timeOf(proposed || detail.original_departure)}
      sub={<span className="hero-meta">{detail.station} → {detail.destination} · {dateOf(detail.flight_date + 'T12:00:00Z')}{proposed && <> · <s>{timeOf(detail.original_departure)}</s> originally</>}</span>}
      line={<NextStep c={detail}/>}>
      <div className="hero-actions">
        {mode === 'occ' && open && <button className="button glass" onClick={actions.schedule}><CalendarClock size={15}/>Propose new time</button>}
        {['occ', 'outport'].includes(mode) && open && <button className="button glass" onClick={actions.note}><Plus size={15}/>Add note</button>}
        {mode !== 'outport' && <button className="button glass" disabled={busy} onClick={actions.passenger}><Smartphone size={15}/>Passenger view</button>}
        {mode === 'occ' && open && step.owner === 'done' && <button className="button primary" onClick={actions.close}><Check size={15}/>Close case</button>}
        {mode === 'occ' && open && step.owner !== 'done' && <button className="button glass" onClick={actions.close}><Check size={15}/>Close case</button>}
      </div>
      {mode === 'occ' && <a className="hero-link" href={`/outport?station=${detail.station}&case=${detail.id}`} target="_blank" rel="noreferrer">Open this case as {detail.station} station<ArrowUpRight size={12}/></a>}
    </Hero>

    <div className="grid">
      <Widget span={6} icon={Workflow} label="Progress">
        <ol className="progress">{steps.map((s, i) => <li key={s.title} className={(s.done ? 'done' : '') + (i === current ? ' current' : '') + (s.warn ? ' warn' : '')}>
          <span className="p-node">{s.done ? <Check size={14}/> : i + 1}</span>
          <div><strong>{s.title}</strong><small>{s.detail}</small>{i === current && s.action}</div>
        </li>)}</ol>
      </Widget>

      <Widget span={6} icon={ListChecks} label={`Ground resources at ${detail.station} · ${ready} of 5 confirmed`} aside={mode === 'outport' && open && <button className="w-link" onClick={actions.readiness}>Update<ChevronRight size={13}/></button>}>
        <div className="cond-cols">{CONDITION_META.map(({ key, short, icon: Icon }) => {
          const c = detail.conditions[key];
          const loc = key === 'gate' ? gates : key === 'counter' ? counters : [];
          return <div key={key} className={'cond ' + c.status.toLowerCase()} title={c.note || undefined}>
            <Icon size={22}/>
            <span className="cond-name">{short}</span>
            <span className="cond-status">{STATUS_WORD[c.status] || c.status}</span>
            {(loc.length > 0 || c.note) && <small>{loc.join(', ') || c.note}</small>}
          </div>;
        })}</div>
        {detail.readiness.note && <p className="w-foot">Station note: {detail.readiness.note}</p>}
      </Widget>

      {pending.map(u => <ReviewCard key={u.id} span={pending.length === 1 ? 6 : 3} update={{ ...u, flight_no: detail.flight_no, station: detail.station }} canReview={mode === 'cs'} paused={switchState.active} busy={busy} onPublish={text => actions.publish(u, text)} onReject={() => actions.reject(u)}/>)}

      <Widget span={6} icon={Smartphone} label="What passengers see" aside={internal.length > 0 && <button className="w-link" onClick={() => setShowInternal(!showInternal)}>{showInternal ? 'Hide' : 'Show'} {plural(internal.length, 'internal record')}</button>}>
        {published.length
          ? <ol className="msgs">{published.map(u => <li key={u.id} className={u.invalidated_at ? 'stale' : ''}>
              <span className="msg-topic">{titleTopic(u.topic)}</span>
              <p>{u.final_text || u.draft_text}</p>
              <small>{timeOf(u.published_at)} HKT{u.invalidated_at ? ' · no longer current' : ''}</small>
            </li>)}</ol>
          : <p className="muted">Nothing published yet.</p>}
        {showInternal && <ol className="msgs internal">{internal.map(u => <li key={u.id}>
          <span className="msg-topic">{titleTopic(u.topic)} · {humanize(u.status)}</span>
          <p>{u.final_text || u.draft_text}</p>
          <small>Never shown to passengers</small>
        </li>)}</ol>}
      </Widget>

      <Widget span={6} icon={Activity} label="History" aside={detail.events.length > 5 && <button className="w-link" onClick={() => setAllEvents(!allEvents)}>{allEvents ? 'Show less' : `Show all ${detail.events.length}`}</button>}>
        <ol className="timeline">{(allEvents ? detail.events : detail.events.slice(0, 5)).map(e => <li key={e.id} className={e.type === 'UPDATE_PUBLISHED' ? 'good' : ''}>
          <strong>{e.payload.summary || humanize(e.type)}{e.payload.snapshot && <span className="v">V{e.payload.snapshot.version}</span>}</strong>
          <small>{ACTOR[e.actor_role] || humanize(e.actor_role)} ·{relative(e.created_at)}{e.type === 'NOTE_ADDED' ? ' · internal note' : ''}</small>
        </li>)}</ol>
      </Widget>
    </div>
  </>;
}
