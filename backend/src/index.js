const express = require('express');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const db = require('./db');

const app = express();
app.use(cors());
app.use(express.json());


const PORT = process.env.PORT || 4000;

//websocket
const server = app.listen(PORT, () => {
  console.log(`[*] log-watch-live backend running on http://localhost:${PORT}`);
});
const wss = new WebSocketServer({ server });

function broadcast(type, payload) {
  const message = JSON.stringify({ type, payload });
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(message);
    }
  });
}

const insertEvent = db.prepare(`
  INSERT INTO events (hostname, event_type, raw_log, source_ip, username)
  VALUES (@hostname, @event_type, @raw_log, @source_ip, @username)
`);

const upsertEndpoint = db.prepare(`
  INSERT INTO endpoints (hostname, os, last_seen)
  VALUES (@hostname, @os, CURRENT_TIMESTAMP)
  ON CONFLICT(hostname) DO UPDATE SET last_seen = CURRENT_TIMESTAMP
`);


app.get('/api/config', (req, res) => {
  res.json({ port: PORT });
});


app.post('/api/ingest', (req, res) => {
  const { hostname, os, logs } = req.body;

  if (!hostname || !Array.isArray(logs)) {
    return res.status(400).json({ error: 'hostname and logs[] are required' });
  }

  upsertEndpoint.run({ hostname, os: os || 'unknown' });

  const insertedEvents = [];

  for (const line of logs) {
    const parsed = parseLogLine(line);

    insertEvent.run({
      hostname,
      event_type: parsed.event_type,
      raw_log: line,
      source_ip: parsed.source_ip,
      username: parsed.username,
    });

    insertedEvents.push({ hostname, ...parsed, raw_log: line });
  }

  // Notify the dashboard live
  broadcast('new_events', insertedEvents);

  res.json({ status: 'ok', received: logs.length });
});


app.get('/api/events', (req, res) => {
  const rows = db.prepare('SELECT * FROM events ORDER BY timestamp DESC LIMIT 100').all();
  res.json(rows);
});

app.get('/api/alerts', (req, res) => {
  const rows = db.prepare('SELECT * FROM alerts ORDER BY timestamp DESC LIMIT 100').all();
  res.json(rows);
});


app.get('/api/endpoints', (req, res) => {
  const rows = db.prepare('SELECT * FROM endpoints ORDER BY last_seen DESC').all();
  res.json(rows);
});


function parseLogLine(line) {
  const failedLoginMatch = line.match(/Failed password for (\S+) from ([\d.]+)/);
  if (failedLoginMatch) {
    return {
      event_type: 'auth_failure',
      username: failedLoginMatch[1],
      source_ip: failedLoginMatch[2],
    };
  }

  const successLoginMatch = line.match(/Accepted password for (\S+) from ([\d.]+)/);
  if (successLoginMatch) {
    return {
      event_type: 'auth_success',
      username: successLoginMatch[1],
      source_ip: successLoginMatch[2],
    };
  }

  return {
    event_type: 'unknown',
    username: null,
    source_ip: null,
  };
}