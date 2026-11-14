import React, { useEffect, useRef } from 'react';
import { ChevronRight, Check, Search, X } from 'lucide-react';

export function Mark({ small = false }) {
  return <span className={'brand-mark' + (small ? ' small' : '')} aria-hidden="true"><svg viewBox="0 0 32 32" fill="none"><path d="M6 10h20M16 10v16M10 6v10M22 6v10" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/><path d="m12 23 4 4 4-4" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg></span>;
}

const PILL_TONE = { CONFIRMED: 'good', PUBLISHED: 'good', READY: 'good', OPEN: 'brand', PENDING: 'neutral', REVIEW: 'warn', UNAVAILABLE: 'bad', CLOSED: 'muted', REJECTED: 'muted', SUPERSEDED: 'muted' };

/** Outlined status pill (uppercase), as used on condition tiles. */
export function Pill({ status, tone, children }) {
  return <span className={`pill ${tone || PILL_TONE[status] || 'neutral'}`}>{children || (status || '').replaceAll('_', ' ')}</span>;
}

/** Centered page hero, Weather-style: place name, one huge figure, a secondary line, a condition line. */
export function Hero({ title, value, sub, line, children }) {
  return <section className="hero">
    <h1>{title}</h1>
    <div className="hero-value">{value}</div>
    {sub && <div className="hero-sub">{sub}</div>}
    {line && <p className="hero-line">{line}</p>}
    {children}
  </section>;
}

/** Glass widget on the 6-column grid. `span` = columns, `rows` = row span. Clickable widgets must not contain other buttons. */
export function Widget({ icon: Icon, label, aside, span = 2, rows = 1, className = '', onClick, children }) {
  const Tag = onClick ? 'button' : 'section';
  return <Tag className={`widget s${span} r${rows} ${onClick ? 'clickable ' : ''}${className}`} onClick={onClick}>
    <header className="widget-head"><span className="widget-label">{Icon && <Icon size={13}/>}{label}</span>{aside}</header>
    <div className="widget-body">{children}</div>
  </Tag>;
}

export function Live({ status }) {
  return <span className={'live ' + status}><span />{status === 'live' ? 'Live' : status === 'polling' ? 'Auto refresh' : status === 'offline' ? 'Reconnecting' : 'Connecting'}</span>;
}

export function Empty({ title = 'All clear for now', text = 'New updates will appear here.', icon: Icon = Check }) {
  return <div className="empty"><span className="empty-icon"><Icon size={22}/></span><h3>{title}</h3>{text && <p>{text}</p>}</div>;
}

export function Crumbs({ items }) {
  return <nav className="crumbs" aria-label="Breadcrumb">{items.map((item, i) => <React.Fragment key={i}>
    {i > 0 && <ChevronRight size={13}/>}
    {item.onClick && i < items.length - 1 ? <button onClick={item.onClick}>{item.label}</button> : <span aria-current={i === items.length - 1 ? 'page' : undefined}>{item.label}</span>}
  </React.Fragment>)}</nav>;
}

export function SearchField({ value, onChange, placeholder }) {
  return <label className="search-field"><Search size={16}/><input aria-label={placeholder} placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)}/>{value && <button onClick={() => onChange('')} type="button" aria-label="Clear search"><X size={14}/></button>}</label>;
}

export function Segmented({ value, options, onChange }) {
  return <div className="segmented" role="group">{options.map(([v, label]) => <button key={v} className={value === v ? 'selected' : ''} aria-pressed={value === v} onClick={() => onChange(v)}>{label}</button>)}</div>;
}

export function Modal({ title, eyebrow, children, onClose, wide = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const before = document.activeElement;
    const focusables = () => [...ref.current.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]')];
    focusables()[0]?.focus();
    const key = e => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab') {
        const items = focusables();
        if (!items.length) return;
        if (e.shiftKey && document.activeElement === items[0]) { e.preventDefault(); items.at(-1).focus(); }
        if (!e.shiftKey && document.activeElement === items.at(-1)) { e.preventDefault(); items[0].focus(); }
      }
    };
    document.addEventListener('keydown', key);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', key); document.body.style.overflow = overflow; before?.focus(); };
  }, []);
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <section className={'modal ' + (wide ? 'wide' : '')} role="dialog" aria-modal="true" aria-labelledby="modal-title" ref={ref}>
      <header><div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h2 id="modal-title">{title}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={20}/></button></header>
      {children}
    </section>
  </div>;
}

export function timeOf(value, zone = 'Asia/Hong_Kong') { return value ? new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: zone }).format(new Date(value)) : '—'; }
export function dateOf(value) { return value ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Hong_Kong' }).format(new Date(value)) : ''; }
export function relative(value) {
  const seconds = Math.max(0, (Date.now() - new Date(value).getTime()) / 1000);
  return seconds < 60 ? 'Just now' : seconds < 3600 ? `${Math.floor(seconds / 60)}m ago` : seconds < 86400 ? `${Math.floor(seconds / 3600)}h ago` : dateOf(value);
}
