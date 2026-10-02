import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const DEFAULTS = Object.freeze({
  mode: 'nudge',
  checks: { rules: true, done: true },
  threshold: 0.6,
  rules: '.flinch/rules.json',
});

export async function loadConfig(projectDir) {
  const raw = await readJson(join(projectDir, '.flinch.json'));
  return {
    ...DEFAULTS,
    ...raw,
    checks: { ...DEFAULTS.checks, ...(raw?.checks ?? {}) },
  };
}

export async function loadProjectRules(projectDir, config) {
  const parsed = await readJson(join(projectDir, config.rules));
  return Array.isArray(parsed?.rules) ? parsed.rules : [];
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}
