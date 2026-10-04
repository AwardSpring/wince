import { appendFile, mkdir, readFile, readdir, rename, stat } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, extname } from 'node:path';

export const MAX_BYTES = 5 * 1024 * 1024;
const FILE = 'log.jsonl';
const PREVIOUS = 'log.1.jsonl';

export function logDir(env = process.env) {
  return env.WINCE_LOG_DIR || env.CLAUDE_PLUGIN_DATA || join(tmpdir(), 'wince');
}

// One size check per write: past the cap, the current file replaces the
// previous one and a fresh file starts, so the log never exceeds 2 x MAX_BYTES.
export async function appendEntry(dir, entry, { maxBytes = MAX_BYTES } = {}) {
  await mkdir(dir, { recursive: true });
  const path = join(dir, FILE);
  const size = await stat(path).then((s) => s.size, () => 0);
  if (size >= maxBytes) await rename(path, join(dir, PREVIOUS));
  await appendFile(path, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
}

export async function readEntries(dir) {
  const entries = [];
  for (const name of [PREVIOUS, FILE]) {
    const text = await readFile(join(dir, name), 'utf8').catch(() => '');
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        entries.push(JSON.parse(line));
      } catch {}
    }
  }
  return entries;
}

// Plugin data folders are named <plugin>-<marketplace>, e.g. wince-wince
// when installed from the marketplace and wince-inline with --plugin-dir.
// Claude Code keeps plugin data under CLAUDE_CONFIG_DIR when it is set, and
// under ~/.claude otherwise.
export async function findLogDirs(home = homedir(), env = process.env) {
  const configDir = env.CLAUDE_CONFIG_DIR || join(home, '.claude');
  const root = join(configDir, 'plugins', 'data');
  const names = await readdir(root).catch(() => []);
  return names.filter((n) => n === 'wince' || n.startsWith('wince-')).map((n) => join(root, n));
}

export function fileKind(filePath) {
  return extname(String(filePath ?? '')).toLowerCase() || null;
}
