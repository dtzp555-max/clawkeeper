#!/usr/bin/env node
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

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

function doctor() {
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
      // minimal tags call
      run('curl', ['-sS', '-m', '3', 'http://127.0.0.1:11434/api/tags'], { quiet: true });
      console.log('ollama: reachable');
    } catch {
      console.log('ollama: NOT reachable at http://127.0.0.1:11434');
    }
  }

  if (provider === 'openai') {
    console.log('openai: configured (note: this tool does not call OpenAI APIs)');
  }
}

function backupPlan() {
  console.log('Backup include list (recommended):');
  console.log('- ~/.openclaw/openclaw.json');
  console.log('- ~/.openclaw/.env (if used)');
  console.log('- ~/.openclaw/credentials');
  console.log('- ~/.openclaw/agents');
  console.log('- ~/.openclaw/memory (per-agent sqlite)');
  console.log('- ~/.openclaw/workspaces');
  console.log('- ~/.openclaw/workspace/main');
  console.log('- ~/.openclaw/cron');
  console.log('Weekly full add-on:');
  console.log('- ~/.openclaw/agents/*/sessions');
}

function switchProvider(to: 'openai' | 'ollama') {
  const cfg = loadConfig();
  const path = ['agents', 'defaults', 'memorySearch'];
  const ms = get(cfg, path) || {};

  if (to === 'ollama') {
    set(cfg, [...path, 'provider'], 'ollama');
    // remove openai key from memorySearch section to avoid confusion
    del(cfg, [...path, 'remote']);
  } else {
    set(cfg, [...path, 'provider'], 'openai');
    // keep existing remote.apiKey if present; do not prompt
    if (!ms?.remote?.apiKey) {
      console.error('WARN: memorySearch.remote.apiKey is not set. Configure it in openclaw.json first.');
    }
  }

  saveConfig(cfg);
  restartGateway();
  console.log(`Switched memorySearch.provider -> ${to} and restarted gateway.`);
}

const [,, cmd, ...args] = process.argv;

if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
  console.log('openclaw-memops');
  console.log('Commands:');
  console.log('  memops doctor');
  console.log('  memops switch openai|ollama');
  console.log('  memops backup-plan');
  process.exit(0);
}

if (cmd === 'doctor') doctor();
else if (cmd === 'backup-plan') backupPlan();
else if (cmd === 'switch') {
  const to = args[0];
  if (to !== 'openai' && to !== 'ollama') die('Usage: memops switch openai|ollama');
  switchProvider(to);
} else {
  die(`Unknown command: ${cmd}`);
}
