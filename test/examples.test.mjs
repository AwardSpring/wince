import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const dir = new URL('../examples/', import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith('.json'));

for (const file of files) {
  test(`examples/${file} is a valid rules file`, () => {
    const { rules } = JSON.parse(readFileSync(new URL(file, dir), 'utf8'));
    assert.ok(Array.isArray(rules) && rules.length > 0);
    const ids = new Set();
    for (const r of rules) {
      assert.match(r.id, /^[a-z0-9-]+$/, `bad id ${r.id}`);
      assert.ok(!ids.has(r.id), `duplicate id ${r.id}`);
      ids.add(r.id);
      assert.ok(Array.isArray(r.applies) && r.applies.length > 0, `${r.id} needs applies`);
      assert.ok(typeof r.rule === 'string' && r.rule.length > 10, `${r.id} needs a rule sentence`);
    }
  });
}
