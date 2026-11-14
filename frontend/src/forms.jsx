import React, { useRef, useState } from 'react';
import { ArrowRight, Check, ShieldCheck } from 'lucide-react';
import { CONDITION_META } from './constants';

export function CreateForm({ stations, initialStation, busy, onSubmit }) {
  const key = useRef(crypto.randomUUID());
  return <form onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); onSubmit({ flight_no: f.get('flight_no'), station: f.get('station'), flight_date: f.get('date'), original_departure: `${f.get('date')}T${f.get('time')}:00+08:00`, reason: f.get('reason') }, key.current); }}>
    <div className="form-grid">
      <label>Demo flight number<input name="flight_no" placeholder="TW240" pattern="TW[0-9]{2,4}" title="TW followed by 2 to 4 digits" required maxLength={6}/></label>
      <label>Outport<select name="station" defaultValue={initialStation || 'KIX'}>{stations.map(s => <option key={s.code} value={s.code}>{s.code} · {s.name}</option>)}</select></label>
      <label>Flight date<input type="date" name="date" defaultValue="2026-11-15" required/></label>
      <label>Original departure · HKT<input type="time" name="time" defaultValue="09:40" required/></label>
    </div>
    <label>Internal reason<textarea name="reason" placeholder="Describe the disruption for your operations team." maxLength={500} rows={3} required/></label>
    <div className="notice"><ShieldCheck size={16}/>A cancellation draft will be created. Nothing is published automatically.</div>
    <div className="modal-actions"><button className="button primary" disabled={busy}>{busy ? 'Creating…' : 'Create case'}<ArrowRight size={15}/></button></div>
  </form>;
}

export function ReadinessForm({ record, busy, onSubmit }) {
  const [base] = useState(record);
  const [conditions, setConditions] = useState(structuredClone(base.conditions));
  const [counters, setCounters] = useState(base.readiness.counters.join(', '));
  const [gates, setGates] = useState(base.readiness.gates.join(', '));
  const [note, setNote] = useState(base.readiness.note);
  const split = v => v.split(',').map(x => x.trim()).filter(Boolean);
  const set = (key, patch) => setConditions({ ...conditions, [key]: { ...conditions[key], ...patch } });
  return <form onSubmit={e => { e.preventDefault(); onSubmit({ version: base.version, conditions, counters: split(counters), gates: split(gates), note }); }}>
    <p className="modal-description">Confirm only what your local team has verified. Any location changes create a new passenger draft.</p>
    <div className="readiness-rows">{CONDITION_META.map(({ key, title, icon: Icon }) => <div className="readiness-row" key={key}>
      <label htmlFor={`status-${key}`}><Icon size={17}/>{title}</label>
      <select id={`status-${key}`} value={conditions[key].status} onChange={e => set(key, { status: e.target.value })}><option value="PENDING">Pending</option><option value="CONFIRMED">Confirmed</option><option value="UNAVAILABLE">Unavailable</option></select>
      <input aria-label={`${title} note`} maxLength={240} placeholder="Optional resource note" value={conditions[key].note} onChange={e => set(key, { note: e.target.value })}/>
    </div>)}</div>
    <div className="form-grid">
      <label>Counter locations<input value={counters} onChange={e => setCounters(e.target.value)} placeholder="A1, A2" maxLength={250}/></label>
      <label>Gate locations<input value={gates} onChange={e => setGates(e.target.value)} placeholder="18" maxLength={250}/></label>
    </div>
    <label>Internal coordination note<textarea value={note} onChange={e => setNote(e.target.value)} rows={2} maxLength={1000}/></label>
    <div className="modal-actions"><button className="button primary" disabled={busy}>{busy ? 'Saving…' : 'Save readiness'}<Check size={15}/></button></div>
  </form>;
}

export function ScheduleForm({ record, busy, onSubmit }) {
  return <form onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); onSubmit({ version: record.version, proposed_departure: `${f.get('date')}T${f.get('time')}:00+08:00`, note: f.get('note') }); }}>
    <p className="modal-description">An internal coordination proposal only. This will not change the flight's published status.</p>
    <div className="form-grid">
      <label>Proposed date<input type="date" name="date" defaultValue={record.flight_date} required/></label>
      <label>Proposed departure · HKT<input type="time" name="time" defaultValue="16:00" required/></label>
    </div>
    <label>Reason for proposal<textarea name="note" maxLength={500} rows={3} required placeholder="What changed?"/></label>
    <div className="modal-actions"><button className="button primary" disabled={busy}>{busy ? 'Saving…' : 'Save internal proposal'}</button></div>
  </form>;
}

export function NoteForm({ version, busy, onSubmit }) {
  return <form onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); onSubmit({ version, text: f.get('text'), suggest_for_passengers: f.get('suggest') === 'on' }); }}>
    <label>Internal note<textarea name="text" rows={4} maxLength={2000} required placeholder="Share an update with your coordination team."/></label>
    <label className="checkbox-label"><input type="checkbox" name="suggest"/>Suggest this note for passenger review</label>
    <p className="form-hint">This creates a draft only. Customer service must review it before publication.</p>
    <div className="modal-actions"><button className="button primary" disabled={busy}>{busy ? 'Saving…' : 'Add note'}</button></div>
  </form>;
}

export function RejectForm({ busy, onSubmit }) {
  return <form onSubmit={e => { e.preventDefault(); onSubmit(new FormData(e.currentTarget).get('note')); }}>
    <p className="modal-description">The draft will be retained in the internal record and will never appear on the passenger page.</p>
    <label>Review note · optional<textarea name="note" rows={3} maxLength={1000} placeholder="Why should this stay internal?"/></label>
    <div className="modal-actions"><button className="button primary" disabled={busy}>{busy ? 'Rejecting…' : 'Reject draft'}</button></div>
  </form>;
}
