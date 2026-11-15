import { t } from "./i18n";
import React, { useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Pause, Plane, PlaneTakeoff, Send, ShieldCheck } from 'lucide-react';
import { CAUSES, DEFAULT_ITEMS, PRESET_ITEMS, notReady } from './constants';
import { timeOf } from './components';

/** ISO → { date, time } in HKT, for date/time inputs. */
export function hktParts(iso) {
  if (!iso) return { date: '2026-11-15', time: '12:00' };
  const d = new Date(new Date(iso).getTime() + 8 * 3600 * 1000).toISOString();
  return { date: d.slice(0, 10), time: d.slice(11, 16) };
}
const hktIso = (date, time) => `${date}T${time}:00+08:00`;
const addMinutes = (iso, minutes) => new Date(new Date(iso).getTime() + minutes * 60000).toISOString();

function TimeFields({ label, value, onChange }) {
  return <div className="form-grid">
    <label>{label}{t(" date")}<input type="date" value={value.date} onChange={(e) => onChange({ ...value, date: e.target.value })} required /></label>
    <label>{label}{t(" time · HKT")}<input type="time" value={value.time} onChange={(e) => onChange({ ...value, time: e.target.value })} required /></label>
  </div>;
}

export function CreateForm({ stations, initialStation, busy, onSubmit }) {
  const key = useRef(crypto.randomUUID());
  return <form onSubmit={(e) => {e.preventDefault();const f = new FormData(e.currentTarget);onSubmit({ flight_no: f.get('flight_no'), station: f.get('station'), flight_date: f.get('date'), original_departure: `${f.get('date')}T${f.get('time')}:00+08:00`, reason: f.get('reason'), direction:f.get('direction') }, key.current);}}>
    <div className="form-grid">
      <label>{t("Flight")}<input name="flight_no" placeholder="UO624 / TW240" maxLength={60} /></label>
      <label>{t("Outport")}<select name="station" defaultValue={initialStation || 'KIX'}>{stations.map((s) => <option key={s.code} value={s.code}>{s.code} · {t(s.name)}</option>)}</select></label>
      <label>{t("Direction")}<select name="direction"><option value="inbound">{t("Outstation to Hong Kong")}</option><option value="outbound">{t("Hong Kong to outstation")}</option></select></label>
      <label>{t("Date")}<input type="date" name="date" defaultValue={hktParts(new Date().toISOString()).date} required /></label>
      <label>{t("Scheduled · HKT")}<input type="time" name="time" defaultValue="09:40" required /></label>
    </div>
    <label>{t("What happened (internal)")}<textarea name="reason" maxLength={500} rows={2} /></label>
    <div className="modal-actions"><button className="button primary" disabled={busy}>{busy ? t('Creating…') : t('Create flight case')}<ArrowRight size={15} /></button></div>
  </form>;
}

/** Two steps, matching the OCC flow: build the request → check operator info → send. */
export function WorkOrderForm({ record, number, busy, onSubmit }) {
  const [step, setStep] = useState(1);
  const [items, setItems] = useState(DEFAULT_ITEMS);
  const [time, setTime] = useState(hktParts(record.proposed_departure || addMinutes(record.original_departure, 120)));
  const [note, setNote] = useState('');
  const [checked, setChecked] = useState(false);
  const toggle = (key) => setItems(items.includes(key) ? items.filter((k) => k !== key) : [...items, key]);

  if (step === 1) return <form onSubmit={(e) => {e.preventDefault();if (items.length) setStep(2);}}>
    <p className="step-label">{t('Step 1 of 2 · What should {0} confirm?', {0: record.station})}</p>
    <div className="pick-grid">{PRESET_ITEMS.map((i) => <button type="button" key={i.key} className={'pick' + (items.includes(i.key) ? ' on' : '')} aria-pressed={items.includes(i.key)} onClick={() => toggle(i.key)}>
      <span className="pick-box">{items.includes(i.key) && <Check size={14} />}</span>{t(i.label)}</button>)}</div>
    <TimeFields label={t("Proposed")} value={time} onChange={setTime} />
    <label>{t("Note to station")}<textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000} placeholder={t("Optional")} /></label>
    <div className="modal-actions"><button className="button primary" disabled={!items.length}>{t("Next: check operator info")}<ArrowRight size={15} /></button></div>
  </form>;

  return <form onSubmit={(e) => {e.preventDefault();onSubmit({ items, operator_checked: checked, proposed_departure: hktIso(time.date, time.time), note });}}>
    <p className="step-label">{t("Step 2 of 2 · Check operator information")}</p>
    <dl className="check-sheet">
      <div><dt>{t("Flight")}</dt><dd>{record.flight_no} · {record.origin||record.station} → {record.destination}</dd></div>
      <div><dt>{t("Operator")}</dt><dd>{record.operator}</dd></div>
      <div><dt>{t("Aircraft")}</dt><dd>{record.aircraft || '—'}</dd></div>
      <div><dt>{t("Scheduled")}</dt><dd>{timeOf(record.original_departure)}{t(" HKT")}</dd></div>
      <div><dt>{t("Proposed")}</dt><dd><b>{time.time}{t(" HKT")}</b> · {time.date}</dd></div>
      <div><dt>{t("Items")}</dt><dd>{PRESET_ITEMS.filter((i) => items.includes(i.key)).map((i) => t(i.label)).join(', ')}</dd></div>
      {note && <div><dt>{t("Note")}</dt><dd>{note}</dd></div>}
    </dl>
    <label className="confirm-check"><input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />{t("I have checked the operator information")}</label>
    <div className="modal-actions">
      <button type="button" className="button glass" onClick={() => setStep(1)}><ArrowLeft size={15} />{t("Back")}</button>
      <button className="button primary" disabled={busy || !checked}><Send size={15} />{busy ? t('Sending…') : t("Send work order v{0}", { 0: number })}</button>
    </div>
  </form>;
}

export function AuthorizeForm({ order, record, busy, paused, onResume, onSubmit }) {
  const gateNote = order.items.find((i) => i.key === 'gate')?.note || '';
  const [status, setStatus] = useState('DELAYED');
  const [time, setTime] = useState(hktParts(order.proposed_departure || record.original_departure));
  const [cause, setCause] = useState('');
  const [gate, setGate] = useState((gateNote.match(/[A-Z]?\d+[A-Z]?/i) || [''])[0]);
  const [terminal,setTerminal]=useState(record.public_terminal||'');
  const [unknownTime, setUnknownTime] = useState(false);
  const [customReviewed, setCustomReviewed] = useState(false);
  const customItems = order.items.filter(i=>i.kind==='custom');
  const gaps = notReady(order.items);
  return <form onSubmit={(e) => {e.preventDefault();if(gaps.length || customItems.length && !customReviewed) return;onSubmit({ version: order.version, flight_status: status, departure: status === 'DELAYED' && unknownTime ? null : hktIso(time.date, time.time), cause: status === 'DELAYED' ? cause : null, gate, terminal, custom_items_reviewed:customReviewed });}}>
    {gaps.length > 0 && <div className="notice warn">{t('{0} items not ready: {1}', {0: gaps.length, 1: gaps.map(i => t(i.label)).join(', ')})}</div>}
    <div className="choice-row">
      <button type="button" className={'choice good' + (status === 'ON_TIME' ? ' on' : '')} onClick={() => setStatus('ON_TIME')}><Check size={22}/>{t("On time")}<small>{t("Confirmed departure")}</small></button>
      <button type="button" className={'choice' + (status === 'DELAYED' ? ' on' : '')} onClick={() => setStatus('DELAYED')}><Plane size={22} />{t("Delayed")}<small>{t("New time + reason")}</small></button>
      <button type="button" className={'choice good' + (status === 'BOARDING' ? ' on' : '')} onClick={() => setStatus('BOARDING')}><PlaneTakeoff size={22} />{t("Ready to board")}<small>{t("Passengers go to gate")}</small></button>
    </div>
    {status === 'DELAYED' && <label className="confirm-check"><input type="checkbox" checked={unknownTime} onChange={e=>setUnknownTime(e.target.checked)}/>{t('Departure time not yet confirmed')}</label>}
    {!(status === 'DELAYED' && unknownTime) && <TimeFields label={t("Departure")} value={time} onChange={setTime} />}
    {status === 'DELAYED' && <><p className="field-label">{t("Reason shown to passengers")}</p>
      <div className="cause-grid">{Object.entries(CAUSES).map(([code, c]) => <button type="button" key={code} className={'cause' + (cause === code ? ' on' : '')} onClick={() => setCause(code)}><c.icon size={18} />{t(c.title)}</button>)}</div></>}
    <label>{t('Terminal')}<input value={terminal} maxLength={12} onChange={e=>setTerminal(e.target.value)} placeholder={t('Optional')}/></label>
    <label>{t("Gate")}<input value={gate} onChange={(e) => setGate(e.target.value)} maxLength={12} placeholder={t("Optional")} /></label>
    {customItems.length>0 && <div className="custom-review"><p className="field-label">{t('Custom items · OCC confirmation')}</p><ul>{customItems.map(i=><li key={i.key}><strong>{i.label}</strong><span>{i.status}</span>{i.note&&<small>{i.note}</small>}</li>)}</ul><label className="confirm-check"><input type="checkbox" checked={customReviewed} onChange={e=>setCustomReviewed(e.target.checked)}/>{t('I confirm these custom answers meet the requirements')}</label></div>}
    {paused && <div className="notice warn"><Pause size={16} />{t("Passenger publishing is paused.")}<button type="button" className="text-button" onClick={onResume}>{t("Resume")}</button></div>}
    <div className="modal-actions"><button className="button success" disabled={busy || paused || gaps.length>0 || customItems.length>0 && !customReviewed || status === 'DELAYED' && !cause}><ShieldCheck size={15} />{busy ? t('Publishing…') : t('Authorise & publish')}</button></div>
  </form>;
}

export function ReissueForm({ order, busy, onSubmit }) {
  const [time, setTime] = useState(hktParts(order.proposed_departure));
  const gaps = notReady(order.items);
  return <form onSubmit={(e) => {e.preventDefault();onSubmit({ version: order.version, note: new FormData(e.currentTarget).get('note'), proposed_departure: hktIso(time.date, time.time) });}}>
    {gaps.length > 0 && <div className="notice warn">{t('Not ready in v{0}: {1}', {0: order.number, 1: gaps.map(i => `${t(i.label)} (${t(i.status || 'no answer')})`).join(', ')})}</div>}
    <TimeFields label={t("Proposed")} value={time} onChange={setTime} />
    <label>{t("What should the station do?")}<textarea name="note" rows={3} maxLength={1000} defaultValue={gaps.length ? t('Please reconfirm {0}.', {0: gaps.map(i => t(i.label)).join(', ')}) : ''} /></label>
    <div className="modal-actions"><button className="button warn" disabled={busy}><Send size={15} />{busy ? t('Sending…') : t("Send v{0}", { 0: order.number + 1 })}</button></div>
  </form>;
}

export function AbortForm({ order, busy, onSubmit }) {
  return <form onSubmit={(e) => {e.preventDefault();onSubmit({ version: order.version, reason: new FormData(e.currentTarget).get('reason') });}}>
    <p className="modal-description">{t('The station stops working on v{0}. You can create a new work order afterwards.', {0: order.number})}</p>
    <label>{t("Reason")}<input name="reason" maxLength={500} /></label>
    <div className="modal-actions"><button className="button danger" disabled={busy}>{busy ? t('Stopping…') : t("Stop v{0}", { 0: order.number })}</button></div>
  </form>;
}

export function CancelFlightForm({ record, busy, paused, onResume, onSubmit }) {
  const [cause, setCause] = useState('');
  return <form onSubmit={(e) => {e.preventDefault();onSubmit({ version: record.version, cause });}}>
    <p className="modal-description">{t("Open work orders stop, the case closes and passengers are told the flight is cancelled.")}</p>
    <p className="field-label">{t("Reason")}</p>
    <div className="cause-grid">{Object.entries(CAUSES).map(([code, c]) => <button type="button" key={code} className={'cause' + (cause === code ? ' on' : '')} onClick={() => setCause(code)}><c.icon size={18} />{t(c.title)}</button>)}</div>
    {paused && <div className="notice warn"><Pause size={16} />{t("Passenger publishing is paused.")}<button type="button" className="text-button" onClick={onResume}>{t("Resume")}</button></div>}
    <div className="modal-actions"><button className="button danger" disabled={busy || !cause || paused}>{busy ? t('Cancelling…') : t("Cancel {0}", { 0: record.flight_no })}</button></div>
  </form>;
}
