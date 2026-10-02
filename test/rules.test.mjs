import { test } from 'node:test';
import assert from 'node:assert/strict';
import { globToRegExp, rulesFor } from '../src/rules.mjs';

const matches = (glob, path) => globToRegExp(glob).test(path);

test('a pattern without a slash matches the file name at any depth', () => {
  assert.ok(matches('*.cs', 'Program.cs'));
  assert.ok(matches('*.cs', 'src/Orders/Program.cs'));
  assert.ok(!matches('*.cs', 'styles/site.css'));
});

test('a leading **/ matches at the root and below', () => {
  assert.ok(matches('**/*.ts', 'index.ts'));
  assert.ok(matches('**/*.ts', 'src/app/index.ts'));
  assert.ok(!matches('**/*.ts', 'src/app/index.tsx'));
});

test('a pattern with a slash is anchored to the project root', () => {
  assert.ok(matches('src/**/*.py', 'src/app.py'));
  assert.ok(matches('src/**/*.py', 'src/pkg/app.py'));
  assert.ok(!matches('src/**/*.py', 'tools/src/app.py'));
});

test('a directory segment in the middle of a pattern', () => {
  assert.ok(matches('**/Controllers/**/*.cs', 'Web/Controllers/OrdersController.cs'));
  assert.ok(matches('**/Controllers/**/*.cs', 'Controllers/Admin/UsersController.cs'));
  assert.ok(!matches('**/Controllers/**/*.cs', 'Web/Services/OrdersService.cs'));
});

test('* stays inside one path segment and ? matches one character', () => {
  assert.ok(!matches('src/*.js', 'src/lib/a.js'));
  assert.ok(matches('file?.md', 'file1.md'));
  assert.ok(!matches('file?.md', 'file12.md'));
});

test('regex characters in patterns are literal', () => {
  assert.ok(matches('app/(admin)/*.tsx', 'app/(admin)/page.tsx'));
  assert.ok(!matches('*.c+', 'main.cc'));
});

test('rulesFor normalizes Windows paths and a leading ./', () => {
  const rules = [{ id: 'cs', applies: ['src/**/*.cs'], rule: 'r' }];
  assert.deepEqual(rulesFor('src\\Orders\\Query.cs', rules).map((r) => r.id), ['cs']);
  assert.deepEqual(rulesFor('./src/Query.cs', rules).map((r) => r.id), ['cs']);
});

test('rulesFor keeps only matching rules and treats a missing applies as everything', () => {
  const rules = [
    { id: 'styles', applies: ['**/*.scss'], rule: 'r' },
    { id: 'code', applies: ['**/*.ts'], rule: 'r' },
    { id: 'all', rule: 'r' },
  ];
  assert.deepEqual(rulesFor('src/app.ts', rules).map((r) => r.id), ['code', 'all']);
});
