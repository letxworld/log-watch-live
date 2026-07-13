import { useEffect, useState, useRef } from 'react';
import './App.css';

const BACKEND_HTTP = 'http://localhost:4000';
const BACKEND_WS = 'ws://localhost:4000';

function App() {
  const [events, setEvents] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [endpoints, setEndpoints] = useState([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef(null);

  // --- Initial load: fetch existing data on page load ---
  useEffect(() => {
    fetch(`${BACKEND_HTTP}/api/events`).then(r => r.json()).then(setEvents);
    fetch(`${BACKEND_HTTP}/api/alerts`).then(r => r.json()).then(setAlerts);
    fetch(`${BACKEND_HTTP}/api/endpoints`).then(r => r.json()).then(setEndpoints);
  }, []);

  // --- Live updates via WebSocket ---
  useEffect(() => {
    const ws = new WebSocket(BACKEND_WS);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);

    ws.onmessage = (msg) => {
      const { type, payload } = JSON.parse(msg.data);

      if (type === 'new_events') {
        setEvents((prev) => [...payload.reverse(), ...prev].slice(0, 100));
      }
      if (type === 'new_alerts') {
        setAlerts((prev) => [...payload.reverse(), ...prev].slice(0, 100));
      }
    };

    return () => ws.close();
  }, []);

  return (
    <div className="dashboard">
      <header className="header">
        <h1><img src="../../public/logo.svg" alt="Log watch live" /></h1>
        <span className={`status ${connected ? 'online' : 'offline'}`}>
          {connected ? '● Live' : '○ Disconnected'}
        </span>
      </header>

      <div className="grid">
        <section className="panel">
          <h2>Endpoints ({endpoints.length})</h2>
          <ul className="endpoint-list">
            {endpoints.map((ep) => (
              <li key={ep.id}>
                <strong>{ep.hostname}</strong>
                <span className="meta">{ep.os} · last seen {formatTime(ep.last_seen)}</span>
              </li>
            ))}
            {endpoints.length === 0 && <p className="empty">No endpoints reporting yet</p>}
          </ul>
        </section>

        <section className="panel alerts-panel">
          <h2>Alerts ({alerts.length})</h2>
          <ul className="alert-list">
            {alerts.map((a) => (
              <li key={a.id ?? Math.random()} className={`severity-${a.severity}`}>
                <div className="alert-title">{a.rule_name}</div>
                <div className="alert-detail">{a.detail}</div>
                <div className="meta">{a.hostname} · {formatTime(a.timestamp)}</div>
              </li>
            ))}
            {alerts.length === 0 && <p className="empty">No alerts yet</p>}
          </ul>
        </section>

        <section className="panel events-panel">
          <h2>Live Events ({events.length})</h2>
          <ul className="event-list">
            {events.map((e) => (
              <li key={e.id ?? Math.random()}>
                <span className={`tag tag-${e.event_type}`}>{e.event_type}</span>
                <span className="raw-log">{e.raw_log}</span>
                <span className="meta">{e.hostname} · {formatTime(e.timestamp)}</span>
              </li>
            ))}
            {events.length === 0 && <p className="empty">No events yet</p>}
          </ul>
        </section>
      </div>
    </div>
  );
}

function formatTime(ts) {
  if (!ts) return '';
  return new Date(ts.replace(' ', 'T') + 'Z').toLocaleTimeString();
}

export default App;