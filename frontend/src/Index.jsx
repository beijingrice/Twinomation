import React from 'react';
import { ArrowRight, ClipboardCheck, Plane, Radar, Smartphone } from 'lucide-react';
import { Mark } from './components';
import { REGIONS, STATIONS, WORKSPACE_PATH } from './constants';

/** Workspace index: the demo's front door. Each role has its own entry; nothing here needs a session. */
export default function IndexPage() {
  return <div className="app passenger index">
    <main className="page index-main">
      <div className="page-bar"><span className="brand"><Mark small/><span>Twinomation</span></span><span className="publish-chip">Local demo</span></div>

      <section className="hero">
        <h1>Twinomation</h1>
        <p className="index-lead">Flight disruption coordination</p>
        <p className="hero-line">Choose a workspace. Open several in separate tabs to see a case move between teams.</p>
      </section>

      <div className="grid index-grid">
        <a className="widget s2 clickable entry" href={WORKSPACE_PATH.occ}>
          <header className="widget-head"><span className="widget-label"><Radar size={13}/>Operations control · OCC</span></header>
          <div className="widget-body">
            <h2>Operations control</h2>
            <p>Open cases, follow every outport, propose new times and control passenger publishing.</p>
            <span className="entry-go">Enter<ArrowRight size={15}/></span>
          </div>
        </a>

        <section className="widget s2 entry">
          <header className="widget-head"><span className="widget-label"><Plane size={13}/>Outport station</span></header>
          <div className="widget-body">
            <h2>Outport station</h2>
            <p>Acknowledge cases and confirm ground resources. Pick your station:</p>
            <div className="station-grid">{REGIONS.map(r => STATIONS.filter(s => s.region === r.code).map(s =>
              <a key={s.code} className="station-chip" href={`${WORKSPACE_PATH.outport}?station=${s.code}`}><b>{s.code}</b><span>{s.name}</span></a>))}</div>
          </div>
        </section>

        <a className="widget s2 clickable entry" href={WORKSPACE_PATH.cs}>
          <header className="widget-head"><span className="widget-label"><ClipboardCheck size={13}/>Customer service · CS</span></header>
          <div className="widget-body">
            <h2>Customer service</h2>
            <p>Review, edit and publish the messages passengers will see.</p>
            <span className="entry-go">Enter<ArrowRight size={15}/></span>
          </div>
        </a>
      </div>

      <p className="index-note"><Smartphone size={14}/>Passenger pages open from a private link issued inside a case in Operations control.</p>
      <footer className="footer">Demo · Synthetic data · Email off · All times HKT</footer>
    </main>
  </div>;
}
