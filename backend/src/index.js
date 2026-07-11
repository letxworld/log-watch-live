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
  const patterns = [
    {
      event_type: 'auth_failure',
      regex: /Failed password for (?!invalid user)(\S+) from ([\d.]+)/,
      fields: ['username', 'source_ip'],
    },
    {
      event_type: 'invalid_user_attempt',
      regex: /Failed password for invalid user (\S+) from ([\d.]+)/,
      fields: ['username', 'source_ip'],
    },
    {
      event_type: 'auth_success',
      regex: /Accepted password for (\S+) from ([\d.]+)/,
      fields: ['username', 'source_ip'],
    },
    {
      event_type: 'ssh_key_login',
      regex: /Accepted publickey for (\S+) from ([\d.]+)/,
      fields: ['username', 'source_ip'],
    },
    {
      event_type: 'root_login',
      regex: /Accepted \S+ for root from ([\d.]+)/,
      fields: ['source_ip'],
    },
    {
      event_type: 'sudo_command',
      regex: /(\S+)\s*:\s*TTY=\S+\s*;\s*PWD=\S+\s*;\s*USER=(\S+)\s*;\s*COMMAND=(.+)/,
      fields: ['username', 'target_user', 'command'],
    },
    {
      event_type: 'sudo_auth_failure',
      regex: /pam_unix\(sudo:auth\):\s*authentication failure.*user=(\S+)/,
      fields: ['username'],
    },
    {
      event_type: 'user_added',
      regex: /new user:\s*name=(\S+)/,
      fields: ['username'],
    },
    {
      event_type: 'user_deleted',
      regex: /delete user '(\S+)'/,
      fields: ['username'],
    },
    {
      event_type: 'connection_closed_preauth',
      regex: /Connection closed by (?:authenticating user \S+ )?([\d.]+) port \d+ \[preauth\]/,
      fields: ['source_ip'],
    },
  ];

  for (const pattern of patterns) {
    const match = line.match(pattern.regex);
    if (match) {
      const result = { event_type: pattern.event_type, username: null, source_ip: null };
      pattern.fields.forEach((field, i) => {
        if (field === 'username' || field === 'source_ip') {
          result[field] = match[i + 1];
        }
      });
      return result;
    }
  }

  return { event_type: 'unknown', username: null, source_ip: null };
}