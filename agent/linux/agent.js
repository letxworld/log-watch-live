const fs = require('fs');
const os = require('os');
const https = require('http');

// --- Configuration ---
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:4000/api/ingest';
const LOG_FILE = process.env.LOG_FILE || '/var/log/auth.log';
const BATCH_INTERVAL_MS = 5000; // send whatever new lines accumulated every 5 seconds
const HOSTNAME = os.hostname();

let buffer = [];
let filePosition = 0;

console.log(`[*] log-watch-live agent starting`);
console.log(`[*] Hostname: ${HOSTNAME}`);
console.log(`[*] Watching: ${LOG_FILE}`);
console.log(`[*] Reporting to: ${BACKEND_URL}`);

// --- Start tailing from the END of the file, not the beginning ---
// We only want NEW log lines from this point forward, not the entire log history
try {
  const stats = fs.statSync(LOG_FILE);
  filePosition = stats.size;
} catch (err) {
  console.error(`[!] Could not access ${LOG_FILE}: ${err.message}`);
  console.error(`[!] You may need to run this with sudo, or set LOG_FILE to a readable file.`);
  process.exit(1);
}

// --- Watch the file for changes ---
fs.watch(LOG_FILE, (eventType) => {
  if (eventType !== 'change') return;

  fs.stat(LOG_FILE, (err, stats) => {
    if (err) return;

    // File got smaller than our last position - it was probably rotated/truncated, reset
    if (stats.size < filePosition) {
      filePosition = 0;
    }

    if (stats.size === filePosition) return; // nothing new

    const stream = fs.createReadStream(LOG_FILE, {
      start: filePosition,
      end: stats.size,
    });

    let chunk = '';
    stream.on('data', (data) => (chunk += data));
    stream.on('end', () => {
      filePosition = stats.size;
      const newLines = chunk.split('\n').filter((line) => line.trim().length > 0);
      buffer.push(...newLines);
    });
  });
});

// --- Send whatever's in the buffer every BATCH_INTERVAL_MS ---
setInterval(() => {
  if (buffer.length === 0) return;

  const logsToSend = buffer;
  buffer = [];

  sendBatch(logsToSend);
}, BATCH_INTERVAL_MS);

function sendBatch(logs) {
  const payload = JSON.stringify({
    hostname: HOSTNAME,
    os: process.platform,
    logs,
  });

  const url = new URL(BACKEND_URL);
  const req = https.request(
    {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    },
    (res) => {
      if (res.statusCode === 200) {
        console.log(`[*] Sent ${logs.length} log line(s) - backend responded ${res.statusCode}`);
      } else {
        console.error(`[!] Backend responded with status ${res.statusCode}`);
      }
    }
  );

  req.on('error', (err) => {
    console.error(`[!] Failed to send logs: ${err.message}`);
    // Put the logs back so we retry next cycle instead of losing them
    buffer.unshift(...logs);
  });

  req.write(payload);
  req.end();
}