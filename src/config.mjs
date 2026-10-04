import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { mainCheckout } from './worktree.mjs';

export const DEFAULTS = Object.freeze({
  mode: 'nudge',
  checks: { rules: true, done: true, risky: true, retry: true },
  threshold: 0.6,
  subagents: 'send-back',
  rules: '.wince/rules.json',
});

export async function loadConfig(projectDir) {
  const raw = await readProjectJson(projectDir, '.wince.json');
  return {
    ...DEFAULTS,
    ...raw,
    checks: { ...DEFAULTS.checks, ...(raw?.checks ?? {}) },
  };
}

export async function loadProjectRules(projectDir, config) {
  const parsed = await readProjectJson(projectDir, config.rules);
  return Array.isArray(parsed?.rules) ? parsed.rules : [];
}

// A file in the project wins. Inside a linked git worktree that lacks it,
// the main checkout's copy applies, so untracked Wince files cover every
// worktree of the repository.
export async function readProjectJson(projectDir, relativePath) {
  const own = await readJson(join(projectDir, relativePath));
  if (own) return own;
  const main = await mainCheckout(projectDir);
  return main ? readJson(join(main, relativePath)) : null;
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}
