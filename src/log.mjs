import { appendFile, mkdir, readFile, readdir, rename, stat } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, extname } from 'node:path';

export const MAX_BYTES = 5 * 1024 * 1024;
const FILE = 'log.jsonl';
const PREVIOUS = 'log.1.jsonl';

export function logDir(env = process.env) {
  return env.FLINCH_LOG_DIR || env.CLAUDE_PLUGIN_DATA || join(tmpdir(), 'flinch');
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

// Plugin data folders are named <plugin>-<marketplace>, e.g. flinch-flinch
// when installed from the marketplace and flinch-inline with --plugin-dir.
export async function findLogDirs(home = homedir()) {
  const root = join(home, '.claude', 'plugins', 'data');
  const names = await readdir(root).catch(() => []);
  return names.filter((n) => n === 'flinch' || n.startsWith('flinch-')).map((n) => join(root, n));
}

export function fileKind(filePath) {
  return extname(String(filePath ?? '')).toLowerCase() || null;
}
