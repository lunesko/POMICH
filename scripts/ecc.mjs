import { readFileSync, readdirSync, existsSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const upstream = join(root, 'tools/ecc');
const lock = JSON.parse(readFileSync(join(root, '.ecc/upstream.json'), 'utf8'));
const action = process.argv[2] || 'check';
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
}
function check() {
  if (!existsSync(join(upstream, 'package.json'))) {
    throw new Error('ECC is missing. Run npm run ecc:setup.');
  }
  const head = spawnSync('git', ['-C', upstream, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  if (head.status !== 0 || head.stdout.trim() !== lock.commit) throw new Error('ECC commit differs from .ecc/upstream.json');
  const pkg = JSON.parse(readFileSync(join(upstream, 'package.json'), 'utf8'));
  if (pkg.version !== lock.version) throw new Error('ECC version mismatch');
  const skills = readdirSync(join(upstream, 'skills')).filter(n => existsSync(join(upstream, 'skills', n, 'SKILL.md'))).length;
  const agents = readdirSync(join(upstream, 'agents')).filter(n => n.endsWith('.md')).length;
  if (skills !== lock.skills || agents !== lock.agents) throw new Error('ECC catalog mismatch');
  if (realpathSync(join(root, '.agents/skills')) !== realpathSync(join(upstream, 'skills'))) throw new Error('Broken skill discovery');
  for (const name of ['common', 'python', 'typescript', 'react', 'web']) {
    if (realpathSync(join(root, '.claude/rules', `ecc-${name}`)) !== realpathSync(join(upstream, 'rules', name))) throw new Error(`Broken ${name} rules`);
  }
  for (const file of ['LICENSE', 'hooks/hooks.json', 'hooks/codex-hooks.json', 'scripts/memory-mcp.mjs', '.codex-plugin/plugin.json', '.claude-plugin/plugin.json']) {
    if (!existsSync(join(upstream, file))) throw new Error(`Missing ECC file: ${file}`);
  }
  console.log(`ECC ${pkg.version} @ ${lock.commit}: ${skills} skills, ${agents} agents; discovery, rules, hooks and memory present.`);
}
function setup() {
  run('git', ['submodule', 'update', '--init', '--recursive', '--', 'tools/ecc']);
  check();
  // npm may reconcile a sibling yarn.lock even under ci; preserve the checkout.
  const yarnLock = join(upstream, 'yarn.lock');
  const originalYarnLock = readFileSync(yarnLock);
  try {
    run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], upstream);
  } finally {
    if (!readFileSync(yarnLock).equals(originalYarnLock)) writeFileSync(yarnLock, originalYarnLock);
  }
}
try {
  if (action === 'setup') setup();
  else if (action === 'check') check();
  else if (action === 'codex') {
    setup();
    run('codex', ['plugin', 'marketplace', 'add', upstream, '--json']);
    run('codex', ['plugin', 'add', 'ecc@ecc', '--json']);
    run('codex', ['plugin', 'list', '--json']);
    console.log('ECC native plugin registered for this Codex user. Review and trust its SessionStart hook in /hooks.');
  } else if (action === 'claude') {
    check();
    if (!existsSync(join(upstream, 'node_modules/ajv'))) throw new Error('Run npm run ecc:setup before launching Claude.');
    run('claude', ['--plugin-dir', upstream, ...process.argv.slice(3)]);
  } else throw new Error(`Unknown ECC action: ${action}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
