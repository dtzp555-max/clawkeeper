#!/usr/bin/env node
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { restoreApply, restoreGuide } from './restore.js';

type Json = any;

const HOME = process.env.HOME || '';
const OPENCLAW_CONFIG = process.env.OPENCLAW_CONFIG_PATH || join(HOME, '.openclaw', 'openclaw.json');

function die(msg: string): never {
  console.error(msg);
  process.exit(1);
}

function loadConfig(): Json {
  if (!existsSync(OPENCLAW_CONFIG)) die(`Config not found: ${OPENCLAW_CONFIG}`);
  return JSON.parse(readFileSync(OPENCLAW_CONFIG, 'utf8'));
}

function saveConfig(cfg: Json): void {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const bak = `${OPENCLAW_CONFIG}.bak.${ts}`;
  copyFileSync(OPENCLAW_CONFIG, bak);
  writeFileSync(OPENCLAW_CONFIG, JSON.stringify(cfg, null, 1) + '\n', 'utf8');
  console.error(`Saved config. Backup: ${bak}`);
}

function get(obj: any, path: string[]): any {
  return path.reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj);
}

function set(obj: any, path: string[], value: any): void {
  let cur = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const k = path[i];
    if (!cur[k] || typeof cur[k] !== 'object') cur[k] = {};
    cur = cur[k];
  }
  cur[path[path.length - 1]] = value;
}

function del(obj: any, path: string[]): void {
  const parent = get(obj, path.slice(0, -1));
  if (parent && typeof parent === 'object') delete parent[path[path.length - 1]];
}

function run(cmd: string, args: string[], opts: { quiet?: boolean } = {}): string {
  const out = execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const s = out.toString('utf8');
  if (!opts.quiet) process.stdout.write(s);
  return s;
}

function restartGateway() {
  try {
    run('openclaw', ['gateway', 'restart'], { quiet: true });
  } catch (e: any) {
    die(`Failed to restart gateway: ${e?.message || e}`);
  }
}

async function openaiEmbeddingProbe(apiKey: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ model: 'text-embedding-3-small', input: 'clawkeeper doctor probe' })
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, detail: `HTTP ${res.status} ${res.statusText}${text ? `: ${text.slice(0, 200)}` : ''}` };
    }
    const data: any = await res.json();
    const n = Array.isArray(data?.data) ? data.data.length : 0;
    return { ok: n > 0, detail: `ok (vectors=${n})` };
  } catch (e: any) {
    return { ok: false, detail: String(e?.message || e) };
  }
}

function parseOllamaTags(raw: string): string[] {
  try {
    const j = JSON.parse(raw);
    const models: any[] = Array.isArray(j?.models) ? j.models : [];
    return models.map(m => m?.name).filter(Boolean);
  } catch {
    return [];
  }
}

async function doctor() {
  let cfg: any;
  try {
    cfg = loadConfig();
  } catch (e: any) {
    die(String(e?.message || e));
  }

  const ms = get(cfg, ['agents', 'defaults', 'memorySearch']);
  const provider = ms?.provider;
  const enabled = ms?.enabled;
  const hasOpenAIKey = !!ms?.remote?.apiKey;

  console.log(`config: ${OPENCLAW_CONFIG}`);
  console.log(`memorySearch.enabled: ${enabled}`);
  console.log(`memorySearch.provider: ${provider}`);
  console.log(`memorySearch.remote.apiKey.present: ${hasOpenAIKey}`);

  // OpenClaw memory status (best effort)
  try {
    const raw = run('openclaw', ['memory', 'status', '--json'], { quiet: true });
    const arr = JSON.parse(raw);
    const main = arr.find((x: any) => x.agentId === 'main') || arr[0];
    if (main?.status) {
      console.log(`memory.backend: ${main.status.backend}`);
      console.log(`memory.dbPath: ${main.status.dbPath}`);
      console.log(`memory.fts.available: ${main.status.fts?.available}`);
      console.log(`memory.vector.available: ${main.status.vector?.available}`);
      console.log(`memory.provider(requested): ${main.status.requestedProvider}`);
      console.log(`memory.model: ${main.status.model}`);
    }
  } catch {
    console.log('memory.status: unavailable');
  }

  // Provider-specific health checks
  if (provider === 'ollama') {
    try {
      const raw = run('curl', ['-sS', '-m', '3', 'http://127.0.0.1:11434/api/tags'], { quiet: true });
      const names = parseOllamaTags(raw);
      console.log('ollama: reachable');
      const hasNomic = names.includes('nomic-embed-text');
      console.log(`ollama.model.nomic-embed-text: ${hasNomic ? 'present' : 'missing (run: ollama pull nomic-embed-text)'}`);
    } catch {
      console.log('ollama: NOT reachable at http://127.0.0.1:11434');
    }
  }

  if (provider === 'openai') {
    if (hasOpenAIKey) {
      const probe = await openaiEmbeddingProbe(ms.remote.apiKey);
      console.log(`openai.embeddings.probe: ${probe.ok ? 'OK' : 'FAIL'} (${probe.detail})`);
    } else {
      console.log('openai.embeddings.probe: SKIP (no apiKey configured)');
    }
  }
}

function backupPlan(opts: { json?: boolean } = {}) {
  const plan = {
    dailyEssential: {
      include: [
        '~/.openclaw/openclaw.json',
        '~/.openclaw/.env',
        '~/.openclaw/credentials',
        '~/.openclaw/agents',
        '~/.openclaw/memory',
        '~/.openclaw/workspaces',
        '~/.openclaw/workspace/main',
        '~/.openclaw/cron'
      ],
      exclude: [
        '~/.openclaw/logs',
        '~/.openclaw/agents/*/sessions'
      ]
    },
    weeklyFull: {
      include: ['~/.openclaw/agents/*/sessions']
    }
  };

  if (opts.json) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  console.log('Backup plan (recommended)');
  console.log('\nDaily (essential):');
  for (const p of plan.dailyEssential.include) console.log(`- ${p}`);
  console.log('\nDaily excludes:');
  for (const p of plan.dailyEssential.exclude) console.log(`- ${p}`);
  console.log('\nWeekly add-on (full):');
  for (const p of plan.weeklyFull.include) console.log(`- ${p}`);
}

function switchProvider(to: 'openai' | 'ollama', opts: { dryRun?: boolean } = {}) {
  const cfg = loadConfig();
  const path = ['agents', 'defaults', 'memorySearch'];
  const msBefore = structuredClone(get(cfg, path) || {});
  const from = msBefore?.provider;
  const hadRemote = !!msBefore?.remote;
  const hadOpenAIKey = !!msBefore?.remote?.apiKey;

  if (to === 'ollama') {
    set(cfg, [...path, 'provider'], 'ollama');
    // remove openai key from memorySearch section to avoid confusion
    del(cfg, [...path, 'remote']);
  } else {
    set(cfg, [...path, 'provider'], 'openai');
    // keep existing remote.apiKey if present; do not prompt
  }

  const msAfter = get(cfg, path) || {};
  const removedRemote = hadRemote && !msAfter?.remote;
  const changed = JSON.stringify(msBefore) !== JSON.stringify(msAfter);

  if (opts.dryRun) {
    console.log('Dry run: no changes applied.');
    console.log(`config: ${OPENCLAW_CONFIG}`);
    console.log(`memorySearch.provider: ${from} -> ${to}`);
    if (to === 'ollama') {
      console.log(`memorySearch.remote: ${removedRemote ? 'would be removed' : 'no change'}`);
    } else {
      console.log(`memorySearch.remote.apiKey.present: ${hadOpenAIKey}`);
      if (!hadOpenAIKey) {
        console.log('WARN: memorySearch.remote.apiKey is not set. A real switch to openai would still proceed, but memory search may remain broken until configured.');
      }
    }
    console.log(`config mutation: ${changed ? 'would update openclaw.json' : 'no-op (already matches requested provider)'}`);
    console.log(`config backup: ${changed ? 'would create timestamped backup before write' : 'would skip (no write needed)'}`);
    console.log(`gateway restart: ${changed ? 'would restart after config write' : 'would skip (no write needed)'}`);
    return;
  }

  if (to === 'openai' && !hadOpenAIKey) {
    console.error('WARN: memorySearch.remote.apiKey is not set. Configure it in openclaw.json first.');
  }

  if (!changed) {
    console.log(`memorySearch.provider is already ${to}; no config changes made and gateway restart skipped.`);
    return;
  }

  saveConfig(cfg);
  restartGateway();
  console.log(`Switched memorySearch.provider -> ${to} and restarted gateway.`);
}

const [,, cmd, ...args] = process.argv;

function untildify(p: string): string {
  if (p.startsWith('~/')) return join(HOME, p.slice(2));
  return p;
}

if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
  console.log('clawkeeper');
  console.log('Commands:');
  console.log('  clawkeeper doctor');
  console.log('  clawkeeper switch openai|ollama [--dry-run]');
  console.log('  clawkeeper backup-plan [--json]');
  console.log('  clawkeeper verify-backup <path.tgz>');
  console.log('  clawkeeper restore-guide');
  console.log('  clawkeeper restore-apply <path.tgz>');
  process.exit(0);
}

if (cmd === 'doctor') await doctor();
else if (cmd === 'backup-plan') {
  const json = args.includes('--json');
  backupPlan({ json });
}
else if (cmd === 'verify-backup') {
  const file = args[0];
  if (!file) die('Usage: clawkeeper verify-backup <path.tgz>');
  const tgz = untildify(file);
  try {
    const list = execFileSync('/usr/bin/tar', ['-tzf', tgz], { stdio: ['ignore', 'pipe', 'pipe'] }).toString('utf8');
    const required = [
      '.openclaw/openclaw.json',
      '.openclaw/credentials',
      '.openclaw/agents',
      '.openclaw/memory',
      '.openclaw/workspaces',
      '.openclaw/cron'
    ];
    const missing = required.filter(r => !list.includes(r));
    if (missing.length) {
      console.log('FAIL missing required paths:');
      for (const m of missing) console.log(`- ${m}`);
      process.exitCode = 2;
    } else {
      console.log('OK backup contains required paths.');
    }
  } catch (e: any) {
    die(`Failed to read tarball: ${e?.message || e}`);
  }
}
else if (cmd === 'restore-guide') {
  restoreGuide({ home: HOME });
}
else if (cmd === 'restore-apply') {
  const file = args[0];
  if (!file) die('Usage: clawkeeper restore-apply <path.tgz> [--restart-gateway]');
  const restartGateway = args.includes('--restart-gateway');
  const tgz = untildify(file);
  try {
    restoreApply({ home: HOME, tgzPath: tgz, restartGateway });
  } catch (e: any) {
    die(String(e?.message || e));
  }
}
else if (cmd === 'switch') {
  const to = args.find(arg => arg === 'openai' || arg === 'ollama');
  const dryRun = args.includes('--dry-run');
  if (to !== 'openai' && to !== 'ollama') die('Usage: clawkeeper switch openai|ollama [--dry-run]');
  switchProvider(to, { dryRun });
} else {
  die(`Unknown command: ${cmd}`);
}
