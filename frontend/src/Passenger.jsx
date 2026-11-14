import React, { useCallback, useEffect, useState } from 'react';
import { Clock3, History, MapPin, MessageSquare, RefreshCw, Ticket } from 'lucide-react';
import { api, useLive } from './api';
import { Hero, Live, Mark, Widget, dateOf, timeOf } from './components';
import { titleTopic } from './constants';

const TOPIC_ICON = { counter: Ticket, gate: MapPin, flight_status: MessageSquare };

export default function PassengerApp() {
  const [token] = useState(() => window.location.hash.slice(1));
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    if (!token) { setError('This page needs a private demo link from your coordination team.'); return; }
    try { setData(await api(`/passenger/${encodeURIComponent(token)}`)); setError(''); }
    catch (e) { setError(e.message); if (e.status === 404) setData(null); }
  }, [token]);
  useEffect(() => { refresh(); }, [refresh]);
  const live = useLive(token ? `/passenger/${encodeURIComponent(token)}/stream` : null, null, refresh);
  const current = data?.current || {};
  const topics = ['flight_status', 'counter', 'gate'].filter(t => current[t]);

  return <div className="app passenger">
    <main className="page passenger-main">
      <div className="page-bar"><span className="brand"><Mark small/><span>Twinomation</span></span><span className="publish-chip">Demo</span></div>
      {error && <div className="banner bad" role="alert">{error}</div>}
      {data && <>
        <Hero title={data.flight.flight_no} value={<>{data.flight.station}<span className="hero-arrow">→</span>{data.flight.destination}</>}
          sub={`${dateOf(data.flight.flight_date + 'T12:00:00Z')} ${new Date(data.flight.flight_date).getUTCFullYear()}`}
          line={topics.length ? 'Updates reviewed by our team' : 'Waiting for the first update'}>
          <div className="hero-actions"><Live status={live}/><button onClick={refresh} className="button glass small" aria-label="Refresh flight updates"><RefreshCw size={13}/>Refresh</button></div>
        </Hero>
        <div className="grid passenger-grid">
          {topics.map(t => <Widget key={t} span={6} icon={TOPIC_ICON[t]} label={titleTopic(t)} className={current[t].invalidated ? 'outdated' : ''}>
            <p className="update-text large">{current[t].invalidated ? 'This location is no longer current. Please wait for an update.' : current[t].text}</p>
            <p className="w-foot">{current[t].invalidated ? 'Awaiting reconfirmation' : `Reviewed · ${timeOf(current[t].published_at)} HKT`}</p>
          </Widget>)}
          {!topics.length && <Widget span={6} icon={Clock3} label="Latest update"><p className="update-text large">No updates yet.</p></Widget>}
          <Widget span={6} icon={History} label={`Your updates · ${data.timeline.length} published`}>
            <ol className="timeline">{data.timeline.map(u => <li key={u.id}>
              <small>{dateOf(u.published_at)} · {timeOf(u.published_at)} HKT</small>
              <strong>{titleTopic(u.topic)}</strong>
              <p>{u.text}</p>
              {u.invalidated && <small className="warn-text">Historical · This location is no longer current</small>}
              {u.corrects_id && <small>Correction to an earlier update</small>}
            </li>)}</ol>
            {!data.timeline.length && <p className="muted">Updates will appear here.</p>}
          </Widget>
        </div>
      </>}
      {!data && !error && <div className="loading"><RefreshCw size={20}/><p>Finding your flight updates…</p></div>}
      <footer className="footer">Demo · Not live travel information</footer>
    </main>
  </div>;
}
