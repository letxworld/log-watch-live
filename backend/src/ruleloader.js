const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const RULES_DIR = path.join(__dirname, '..', '..', 'rules');


function loadRules() {
  const files = fs.readdirSync(RULES_DIR).filter(
    (f) => f.endsWith('.yml') || f.endsWith('.yaml')
  );

  const rules = files.map((file) => {
    const fullPath = path.join(RULES_DIR, file);
    const content = fs.readFileSync(fullPath, 'utf8');
    const rule = yaml.load(content);
    return rule;
  });

  console.log(`[*] Loaded ${rules.length} detection rule(s): ${rules.map(r => r.title).join(', ')}`);
  return rules;
}

module.exports = { loadRules };