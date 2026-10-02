import { isAbsolute, resolve, relative } from 'node:path';

// Each pattern names one command shape that destroys work or reaches
// outside the machine. Patterns test one simple command at a time, anchored
// at its start, so text further along a chained line can't match. Keep them
// narrow: this runs before every shell command, and a false alarm stops the
// user.
const LEAD = String.raw`^(?:(?:sudo|time|command|exec|env)\s+|[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*`;
const at = (body, flags = '') => new RegExp(LEAD + body, flags);

export const PATTERNS = [
  {
    id: 'force-push',
    label: "force-pushes, which can overwrite other people's commits",
    test: (s) => at(String.raw`git\s+(?:-C\s+\S+\s+)?push\b`).test(s) && /\s(--force(?![\w-])|-[a-zA-Z]*f(?![\w-])|\+\S+)/.test(s),
  },
  {
    id: 'discard-changes',
    label: 'throws away uncommitted changes',
    test: (s) =>
      at(String.raw`git\s+(?:-C\s+\S+\s+)?(?:reset\s+(?:\S+\s+)*--hard\b|checkout\s+(?:\S+\s+)*--\s+\.(?:\s|$)|restore\s+(?:\S+\s+)*\.(?:\s|$)|clean\s+-[a-zA-Z]*f)`).test(s),
  },
  {
    id: 'delete-remote-branch',
    label: 'deletes a branch on the remote',
    test: (s) => at(String.raw`git\s+(?:-C\s+\S+\s+)?push\s+(?:\S+\s+)*(?:--delete\b|-d\s|\S+\s+:\S+)`).test(s),
  },
  {
    id: 'delete-outside-project',
    label: 'deletes files outside this project',
    test: (s, ctx) => rmTargets(s).some((t) => outsideProject(t, ctx.projectDir)),
  },
  {
    id: 'publish',
    label: 'publishes a package or release to the outside world',
    test: (s) =>
      at(String.raw`(?:(?:npm|pnpm|yarn)\s+publish\b|dotnet\s+nuget\s+push\b|nuget\s+push\b|twine\s+upload\b|gem\s+push\b|cargo\s+publish\b|gh\s+release\s+create\b|docker\s+(?:image\s+)?push\b)`).test(s),
  },
  {
    id: 'deploy',
    label: 'deploys or changes live infrastructure',
    test: (s) =>
      at(String.raw`(?:terraform\s+(?:apply|destroy)\b|kubectl\s+(?:apply|delete|rollout\s+restart)\b|helm\s+(?:install|upgrade|uninstall)\b|az(?:\s+[a-z][\w-]*){1,4}\s+(?:delete|purge|swap)\b|az\s+webapp\s+(?:deploy|deployment\s+source\s+config-zip)\b|aws(?:\s+[a-z][\w-]*){1,2}\s+(?:delete|terminate|remove|rm)[\w-]*)`).test(s),
  },
  {
    id: 'drop-data',
    label: 'drops or empties tables on a database server',
    test: (s) =>
      at(String.raw`(?:sqlcmd|psql|mysql|Invoke-Sqlcmd)\b`, 'i').test(s) &&
      /\b(drop\s+(table|database|schema)|truncate\s+table)\b/i.test(s) &&
      !/(localdb|localhost|127\.0\.0\.1|\(local\)|\s-S\s+\.(\s|$))/i.test(s),
  },
];

// Splits a shell line into simple commands at newlines, &&, ||, ; and |.
// Quoting is respected only enough to keep "a && b" inside quotes together.
export function simpleCommands(command) {
  const out = [];
  let cur = '';
  let quote = null;
  const s = String(command ?? '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      cur += ch;
      if (ch === quote && s[i - 1] !== '\\') quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
      continue;
    }
    const two = s.slice(i, i + 2);
    if (two === '&&' || two === '||') {
      out.push(cur);
      cur = '';
      i++;
      continue;
    }
    if (ch === ';' || ch === '|' || ch === '\n' || ch === '\r') {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim()).filter(Boolean);
}

export function findRisk(command, ctx = {}) {
  for (const s of simpleCommands(command)) {
    const hit = PATTERNS.find((p) => p.test(s, ctx));
    if (hit) return { ...hit, command: s };
  }
  return null;
}

export function rmTargets(simple) {
  let m = simple.match(at(String.raw`rm\s+((?:-[a-zA-Z-]+\s+)*)(.*)$`));
  if (m && /(^|\s)-[a-zA-Z]*[rR]|--recursive/.test(m[1])) return words(m[2]);
  m = simple.match(at(String.raw`Remove-Item\b(.*)$`, 'i'));
  if (m && /\s-Recurse\b/i.test(m[1])) return words(m[1]).filter((t) => !/^\$(true|false)$/i.test(t));
  return [];
}

function words(text) {
  return (text.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((t) => t.replace(/^["']|["']$/g, '')).filter((t) => t && !t.startsWith('-'));
}

export function outsideProject(target, projectDir) {
  if (!target) return false;
  if (/^(\/|~|\$HOME|\$env:USERPROFILE|%USERPROFILE%|[A-Za-z]:[\\/]?)\*?$/i.test(target)) return true;
  if (/^(\/|~\/|\$HOME\/)\*$/.test(target)) return true;
  if (!projectDir || target.includes('$')) return false;
  if (/^(\/tmp\/|\/var\/tmp\/)/.test(target) || /[\\/](temp|tmp)[\\/]/i.test(target)) return false;
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const expanded = target.replace(/^~(?=[\\/]|$)/, home);
  const abs = isAbsolute(expanded) || /^[A-Za-z]:[\\/]/.test(expanded) ? expanded : resolve(projectDir, expanded);
  const rel = relative(resolve(projectDir), resolve(abs));
  return rel === '' || rel.startsWith('..') || isAbsolute(rel);
}
