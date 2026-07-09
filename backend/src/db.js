const Database = require('better-sqlite3');
const path = require('path');

// Creates (or opens) a local SQLite database file - no separate DB server needed
const db = new Database(path.join(__dirname, '..', 'logwatch.db'));

// --- Table: endpoints ---
// Tracks each machine that has an agent reporting to this backend
db.exec(`
  CREATE TABLE IF NOT EXISTS endpoints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hostname TEXT UNIQUE NOT NULL,
    os TEXT,
    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// --- Table: events ---
// Every parsed log line lands here, structured
db.exec(`
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hostname TEXT NOT NULL,
    event_type TEXT,
    raw_log TEXT,
    source_ip TEXT,
    username TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// --- Table: alerts ---
// Anything that matched a detection rule lands here
db.exec(`
  CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rule_name TEXT NOT NULL,
    severity TEXT,
    detail TEXT,
    hostname TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

module.exports = db;