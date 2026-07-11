const db = require('./db');
const { loadRules } = require('./ruleLoader');


const rules = loadRules();

const insertAlert = db.prepare(`
  INSERT INTO alerts (rule_name, severity, detail, hostname)
  VALUES (@rule_name, @severity, @detail, @hostname)
`);


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

 
  const query = `
    SELECT COUNT(*) as count
    FROM events
    WHERE event_type = ?
      AND ${group_by} = ?
      AND timestamp >= datetime('now', '-' || ? || ' minutes')
  `;
  const result = db.prepare(query).get(event_type, fieldValue, timeframe_minutes);

  if (!result || result.count < threshold) {
    return null;
  }

  
  const existingAlert = db.prepare(`
    SELECT COUNT(*) as count
    FROM alerts
    WHERE rule_name = ?
      AND hostname = ?
      AND detail LIKE ?
      AND timestamp >= datetime('now', '-' || ? || ' minutes')
  `).get(rule.title, event.hostname, `%${group_by}=${fieldValue}%`, timeframe_minutes);

  if (existingAlert && existingAlert.count > 0) {
    return null; // already alerted for this rule+entity recently, don't duplicate
  }

  const alertData = {
    rule_name: rule.title,
    severity: rule.severity,
    detail: `${rule.description} (matched on ${group_by}=${fieldValue}, count=${result.count})`,
    hostname: event.hostname,
  };

  insertAlert.run(alertData);
  return alertData;
}

module.exports = { runDetection };