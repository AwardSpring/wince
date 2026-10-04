import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK = fileURLToPath(new URL('../src/hook.mjs', import.meta.url));

function runHook(input, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [HOOK, 'post-tool-use'], { env: { ...process.env, WINCE_INNER: '', ...env } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(JSON.stringify(input));
  });
}

// Runs the real Jev backend through the hook against a local HTTP server.
// It does not reproduce the Windows shutdown crash, which needs a TLS socket.
test('the Jev backend works end to end through the hook', async () => {
  const server = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ answers: { verdict: { type: 'choice', choice: 'no-any', confidence: 0.97, probabilities: { none: 0.03, 'no-any': 0.97 } } } }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();

  const dir = mkdtempSync(join(tmpdir(), 'wince-net-'));
  mkdirSync(join(dir, '.wince'));
  writeFileSync(join(dir, '.wince', 'rules.json'), JSON.stringify({ rules: [{ id: 'no-any', applies: ['**/*.ts'], rule: 'No any.' }] }));

  try {
    for (let i = 0; i < 3; i++) {
      const out = await runHook(
        { cwd: dir, tool_name: 'Edit', tool_input: { file_path: join(dir, 'a.ts'), old_string: 'a', new_string: 'let x: any;' } },
        { WINCE_BACKEND: 'jev', TYPESAFE_API_KEY: 'test', WINCE_JEV_URL: `http://127.0.0.1:${port}/v1/systemone`, CLAUDE_PROJECT_DIR: dir, CLAUDE_PLUGIN_DATA: join(dir, '.data') },
      );
      assert.equal(out.code, 0, out.stderr);
      assert.doesNotMatch(out.stderr, /Assertion failed/);
      assert.match(JSON.parse(out.stdout).hookSpecificOutput.additionalContext, /no-any/);
    }
  } finally {
    server.close();
  }
});
