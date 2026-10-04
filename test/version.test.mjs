import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));

test('the plugin and package versions match', () => {
  assert.equal(read('.claude-plugin/plugin.json').version, read('package.json').version);
});

test('the changelog has a section for the current version', () => {
  const { version } = read('package.json');
  assert.match(readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8'), new RegExp(`^## ${version.replaceAll('.', '\.')}$`, 'm'));
});
