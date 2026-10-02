import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseVerdict } from '../verdict.mjs';

const SYSTEM = 'You answer one multiple-choice question. Reply with only a JSON object {"choice": string, "confidence": number}. choice must be exactly one of the listed choices. confidence is 0 to 1. Write nothing else.';

// An empty working directory keeps the spawned session from loading the
// watched project's CLAUDE.md into the judge.
const quietCwd = mkdtempSync(join(tmpdir(), 'flinch-'));

export const name = 'claude-cli';

export function available() {
  return true;
}

export function classify(question, choices, { timeoutMs = 120_000, model = 'haiku' } = {}) {
  const prompt = `${question}\n\nCHOICES: ${choices.join(', ')}`;
  const args = ['-p', '--model', model, '--output-format', 'json', '--tools', '', '--strict-mcp-config', '--system-prompt', SYSTEM];

  return new Promise((resolve, reject) => {
    const child = spawn('claude', args, {
      cwd: quietCwd,
      env: { ...process.env, FLINCH_INNER: '1', MAX_THINKING_TOKENS: '0' },
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`claude exited ${code}: ${stderr.slice(0, 300)}`));
      try {
        const out = JSON.parse(stdout);
        resolve({ ...parseVerdict(out.result, choices), apiMs: out.duration_api_ms });
      } catch (e) {
        reject(new Error(`unparseable verdict: ${e.message}`));
      }
    });
    child.stdin.end(prompt);
  });
}

