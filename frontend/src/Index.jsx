import { t, useLocale } from "./i18n";
import React from 'react';
import { ArrowRight, Plane, Radar, Smartphone } from 'lucide-react';
import { LanguageSwitch, Mark } from './components';
import { REGIONS, STATIONS, WORKSPACE_PATH } from './constants';

/** Workspace index: the demo's front door. Each role has its own entry; nothing here needs a session. */
export default function IndexPage() {
  useLocale();
  return <div className="app passenger index">
    <main className="page index-main">
      <div className="page-bar"><span className="brand"><Mark small /><span>{t("Twinomation")}</span></span><div className="page-bar-right"><LanguageSwitch/><span className="publish-chip">{t("Local demo")}</span></div></div>

      <section className="hero">
        <h1>{t("Twinomation")}</h1>
        <p className="index-lead">{t("Flight disruption coordination")}</p>
        <p className="hero-line">{t("Open OCC and a station side by side to watch a work order move.")}</p>
      </section>

      <div className="grid index-grid">
        <a className="widget s3 clickable entry occ" href={WORKSPACE_PATH.occ}>
          <header className="widget-head"><span className="widget-label"><Radar size={14} />{t("OCC · desktop")}</span></header>
          <div className="widget-body">
            <h2>{t("Operations control")}</h2>
            <p>{t("Create work orders, review station replies, publish to passengers.")}</p>
            <span className="entry-go">{t("Enter")}<ArrowRight size={16} /></span>
          </div>
        </a>

        <section className="widget s3 entry">
          <header className="widget-head"><span className="widget-label"><Plane size={14} />{t("Outstation manager · desktop & phone")}</span></header>
          <div className="widget-body">
            <h2>{t("Outstation")}</h2>
            <div className="station-grid">{REGIONS.map((r) => STATIONS.filter((s) => s.region === r.code).map((s) =>
              <a key={s.code} className="station-chip" href={`${WORKSPACE_PATH.outport}?station=${s.code}`}><b>{s.code}</b><span>{t(s.name)}</span></a>))}</div>
          </div>
        </section>
        <a className="widget s6 clickable entry passenger-entry" href="/passenger">
          <header className="widget-head"><span className="widget-label"><Smartphone size={14}/>{t('Passenger preview · always available')}</span></header>
          <div className="widget-body">
            <h2>{t('Passenger preview')}</h2>
            <p>{t('Choose a flight and view published updates. No link generation needed.')}</p>
            <span className="entry-go">{t('Open passenger page')}<ArrowRight size={16}/></span>
          </div>
        </a>
      </div>

      <section className="widget customer-care-entry"><div className="widget-body"><h2>{t('Customer Care')}</h2><p>{t('Read ground progress and publish passenger notices. Operational changes stay with OCC and the station manager.')}</p><div className="station-grid">{STATIONS.map(s=><a key={s.code} className="station-chip" href={`/outport?station=${s.code}&care=1`}><b>{s.code}</b><span>{t(s.name)}</span></a>)}</div></div></section>
      <p className="index-note"><Smartphone size={14} />{t("Passenger preview is always available here or from any OCC flight.")}</p>
      <footer className="footer">{t("Demo · Synthetic data · Email off · All times HKT")}</footer>
    </main>
  </div>;
}
