import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { stat } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { join, dirname, resolve, isAbsolute } from 'node:path';
import { EDIT_TOOLS } from './edits.mjs';

const run = promisify(execFile);
const SHELLS = new Set(['Bash', 'PowerShell']);
// Windows (C:\x, C:/x), Git Bash (/c/x) and Unix (/home/x) absolute paths.
// The lookbehinds keep URLs (https://host/x) and relative paths (./x, ~/x)
// from matching.
const ABS_PATH = /(?:(?<![\w])[A-Za-z]:[\\/](?![\\/])|(?<![:\w/.~])\/(?=[\w.~-]))[^\s"'`;|&<>()]+/g;

// The repository root at or above a folder, or null.
export function repoRootOfDir(dir) {
  let current = resolve(dir);
  for (let i = 0; i < 64; i++) {
    if (existsSync(join(current, '.git'))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return null;
}

// Git Bash writes C:\x as /c/x. Turn that back into a Windows path when
// running on Windows so it can be found on disk.
export function toLocalPath(p) {
  if (process.platform === 'win32' && /^\/[a-z]\//.test(p)) return `${p[1].toUpperCase()}:${p.slice(2)}`;
  return p;
}

// Repositories this turn could have changed: where the session runs, where
// edit tools wrote, and any repository a shell command named by path.
export function candidateRoots({ cwd, projectDir, calls }) {
  const roots = new Set();
  const add = (dir) => {
    if (!dir) return;
    const root = repoRootOfDir(dir);
    if (root) roots.add(root);
  };
  add(cwd);
  add(projectDir);
  for (const c of calls) {
    if (EDIT_TOOLS.has(c.name) && isAbsolute(String(c.input?.file_path ?? ''))) add(dirname(c.input.file_path));
    if (!SHELLS.has(c.name)) continue;
    for (const raw of String(c.input?.command ?? '').match(ABS_PATH) ?? []) {
      const p = toLocalPath(raw.replace(/[\\/]+$/, ''));
      try {
        add(statSync(p).isDirectory() ? p : dirname(p));
      } catch {
        add(dirname(p));
      }
    }
  }
  return [...roots];
}

// Files git reports as changed (or new) whose contents were written at or
// after `since` (ms). Older uncommitted changes predate the turn and are
// not the agent's doing.
export async function changedSince(root, since) {
  let out;
  try {
    ({ stdout: out } = await run('git', ['-C', root, 'status', '--porcelain=v1', '-z', '--untracked-files=all'], { maxBuffer: 16 * 1024 * 1024, timeout: 10_000 }));
  } catch {
    return [];
  }
  const files = [];
  const entries = out.split('\0');
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry.length < 4) continue;
    const code = entry.slice(0, 2);
    if (code[0] === 'R' || code[0] === 'C') i++;
    if (code.includes('D')) continue;
    const rel = entry.slice(3);
    const abs = join(root, rel);
    try {
      const s = await stat(abs);
      if (s.isFile() && s.mtimeMs >= since) files.push({ root, rel: rel.replaceAll('\\', '/'), abs, mtimeMs: s.mtimeMs });
    } catch {}
  }
  return files;
}

export async function fileDiff(root, rel) {
  try {
    const { stdout } = await run('git', ['-C', root, 'diff', '--no-color', '-U3', '--', rel], { maxBuffer: 8 * 1024 * 1024, timeout: 10_000 });
    if (stdout.trim()) return stdout;
    const { stdout: untracked } = await run('git', ['-C', root, 'diff', '--no-color', '--no-index', '--', process.platform === 'win32' ? 'NUL' : '/dev/null', rel], { cwd: root, maxBuffer: 8 * 1024 * 1024, timeout: 10_000 }).catch((e) => ({ stdout: e.stdout ?? '' }));
    return untracked;
  } catch {
    return '';
  }
}

export function sameFile(a, b) {
  const norm = (p) => resolve(String(p)).replaceAll('\\', '/').toLowerCase();
  return norm(a) === norm(b);
}
