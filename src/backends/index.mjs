import * as jev from './jev.mjs';
import * as anthropic from './anthropic.mjs';
import * as claudeCli from './claude-cli.mjs';

const ORDER = [jev, anthropic, claudeCli];

const TIMEOUT_MS = { jev: 1500, anthropic: 3000, 'claude-cli': 20_000, fake: 1000 };

export function timeoutFor(backend) {
  return TIMEOUT_MS[backend.name] ?? 3000;
}

export async function selectBackend(env = process.env) {
  if (env.FLINCH_BACKEND === 'fake') return import('./fake.mjs');
  if (env.FLINCH_BACKEND) {
    const pinned = ORDER.find((b) => b.name === env.FLINCH_BACKEND);
    if (pinned) return pinned;
  }
  return ORDER.find((b) => b.available(env));
}

export function guarded(backend) {
  return {
    name: backend.name,
    classify(question, choices, opts = {}) {
      const ms = opts.timeoutMs ?? timeoutFor(backend);
      let timer;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${backend.name} timed out after ${ms}ms`)), ms);
      });
      return Promise.race([backend.classify(question, choices, opts), timeout]).finally(() => clearTimeout(timer));
    },
  };
}
