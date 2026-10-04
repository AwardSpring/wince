import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findRisk, simpleCommands, outsideProject } from '../src/risky.mjs';

const project = process.platform === 'win32' ? 'C:\\work\\app' : '/work/app';
const risk = (command) => findRisk(command, { projectDir: project })?.id ?? null;

const flagged = {
  'force-push': [
    'git push --force',
    'git push -f origin main',
    'git push origin +main',
    'git -C ../repo push --force origin feature',
    'cd app && git push -f',
  ],
  'discard-changes': ['git reset --hard origin/main', 'git reset -q --hard HEAD~1', 'git checkout -- .', 'git restore .', 'git clean -fd'],
  'delete-remote-branch': ['git push origin --delete feature/x', 'git push origin :feature/x'],
  'delete-outside-project': ['rm -rf /', 'rm -rf ~', 'rm -rf ~/', 'rm -rf ../other-project', 'rm -r -f /etc/nginx', 'rm -rf .'],
  publish: ['npm publish', 'pnpm publish --access public', 'dotnet nuget push pkg.nupkg -k x', 'gh release create v1.0.0', 'docker push org/app:1'],
  deploy: ['terraform apply -auto-approve', 'kubectl delete pod web-1', 'az group delete -n rg-prod', 'az webapp config appsettings delete -n app -g rg --setting-names X', 'aws s3 rm s3://bucket --recursive', 'helm upgrade web ./chart'],
  'drop-data': ['psql -h db.example.com -c "DROP TABLE users"', 'sqlcmd -S prod-sql.example.com -Q "TRUNCATE TABLE Orders"'],
};

for (const [id, commands] of Object.entries(flagged)) {
  test(`flags ${id}`, () => {
    for (const c of commands) assert.equal(risk(c), id, c);
  });
}

test('flags recursive deletes in PowerShell outside the project', () => {
  const target = process.platform === 'win32' ? 'C:\\' : '/';
  assert.equal(risk(`Remove-Item -Recurse -Force ${target}`), 'delete-outside-project');
});

const quiet = [
  'git push',
  'git push -u origin feature/x',
  'git push --force-with-lease',
  'git add a.txt && git commit -q -m "fix -f flag" && git push',
  'git status --short && git diff --stat',
  'git checkout -- src/a.ts',
  'git checkout -B merge/x 2>&1 | tail -2',
  'git restore --staged a.txt',
  'git branch -D old-feature',
  'git worktree remove --force ../wt',
  'rm -rf node_modules dist',
  'rm -rf ./build/output',
  'rm -rf /tmp/wince-test',
  'rm -f /etc/hosts.bak',
  'rm -rf "$TMPDIR/x"',
  'Remove-Item -Recurse -Force .\\bin',
  'npm test',
  'npm run publish-docs-preview',
  'echo "git push --force"',
  'az storage account show -n acct',
  'az functionapp config appsettings list -g rg -n app',
  'az cognitiveservices account keys list -n x -g rg --query key1',
  'sqlcmd -S "(localdb)\\MSSQLLocalDB" -Q "DROP DATABASE TestDB"',
  'psql -h localhost -c "DROP TABLE scratch"',
  'cat schema.sql | grep "DROP TABLE"',
  'kubectl get pods',
  'terraform plan',
];

test('stays quiet on everyday and near-miss commands', () => {
  for (const c of quiet) assert.equal(risk(c), null, c);
});

test('simpleCommands splits chains but keeps quoted text together', () => {
  assert.deepEqual(simpleCommands('cd a && git push -f; echo "x && y" | tail'), ['cd a', 'git push -f', 'echo "x && y"', 'tail']);
});

test('outsideProject treats temp folders and paths inside the project as safe', () => {
  assert.equal(outsideProject('build', project), false);
  assert.equal(outsideProject('../sibling', project), true);
  assert.equal(outsideProject('/tmp/x', project), false);
  assert.equal(outsideProject('$SOME_VAR/x', project), false);
});
