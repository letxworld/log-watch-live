const db = require('./db');
const { loadRules } = require('./ruleLoader');

// Rules are loaded once at startup. To add a new detection, just add a .yml
// file to /rules and restart the server - no code changes needed here.
const rules = loadRules();

const insertAlert = db.prepare(`
  INSERT INTO alerts (rule_name, severity, detail, hostname)
  VALUES (@rule_name, @severity, @detail, @hostname)
`);

/**
 * Runs every loaded rule against a batch of newly inserted events.
 * Returns any new alerts generated, so they can be broadcast live.
 */
function runDetection(newEvents) {
  const newAlerts = [];

  for (const event of newEvents) {
    for (const rule of rules) {
      const alert = evaluateRule(rule, event);
      if (alert) newAlerts.push(alert);
    }
  }

  return newAlerts;
}

function evaluateRule(rule, event) {
  const { event_type, group_by, threshold, timeframe_minutes } = rule.detection;

  // This rule doesn't apply to this event's type - skip
  if (event.event_type !== event_type) {
    return null;
  }

  const fieldValue = event[group_by];
  if (!fieldValue) {
    return null;
  }

  // Build the count query dynamically based on which field this rule groups by
  // (source_ip, username, hostname, etc.) - group_by is only ever a fixed set of
  // known column names from our own YAML files, never raw user input, so this is safe.
  const query = `
    SELECT COUNT(*) as count
    FROM events
    WHERE event_type = ?
      AND ${group_by} = ?
      AND timestamp >= datetime('now', '-' || ? || ' minutes')
  `;
  const result = db.prepare(query).get(event_type, fieldValue, timeframe_minutes);

  if (result && result.count >= threshold) {
    const alertData = {
      rule_name: rule.title,
      severity: rule.severity,
      detail: `${rule.description} (matched on ${group_by}=${fieldValue}, count=${result.count})`,
      hostname: event.hostname,
    };

    insertAlert.run(alertData);
    return alertData;
  }

  return null;
}

module.exports = { runDetection };