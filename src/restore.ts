import { existsSync, renameSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

export function untildify(home: string, p: string): string {
  if (p.startsWith('~/')) return join(home, p.slice(2));
  return p;
}

export function run(cmd: string, args: string[], quiet = false): string {
  const out = execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const s = out.toString('utf8');
  if (!quiet) process.stdout.write(s);
  return s;
}

function checkPaths(paths: string[]): { ok: string[]; missing: string[] } {
  const ok: string[] = [];
  const missing: string[] = [];
  for (const p of paths) {
    if (existsSync(p)) ok.push(p);
    else missing.push(p);
  }
  return { ok, missing };
}

export function restoreGuide(opts: { home: string }) {
  const { home } = opts;
  const lines: string[] = [];
  lines.push('Clawkeeper restore guide (safe mode)');
  lines.push('');
  lines.push('0) Install OpenClaw on the new machine');
  lines.push('   - Follow OpenClaw install docs for your OS');
  lines.push('');
  lines.push('1) Copy backup tarball to the new machine, e.g. ~/openclaw-backup.tgz');
  lines.push('');
  lines.push('2) Restore (safe): rename existing ~/.openclaw before extracting');
  lines.push('   clawkeeper restore-apply ~/openclaw-backup.tgz');
  lines.push('');
  lines.push('3) Verify');
  lines.push('   openclaw config validate');
  lines.push('   openclaw gateway restart');
  lines.push('   openclaw status');
  lines.push('   openclaw memory status');
  lines.push('');
  lines.push('Notes:');
  lines.push('- This uses safe mode: if ~/.openclaw exists, it will be renamed to ~/.openclaw.bak.<timestamp>');
  lines.push('- Secrets are restored from ~/.openclaw/credentials and ~/.openclaw/.env (if present in backup).');
  console.log(lines.join('\n'));
}

export function restoreApply(opts: { home: string; tgzPath: string; restartGateway?: boolean }) {
  const { home, tgzPath, restartGateway = false } = opts;
  const src = tgzPath;
  if (!existsSync(src)) throw new Error(`Backup not found: ${src}`);

  const oc = join(home, '.openclaw');
  if (existsSync(oc)) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const bak = join(home, `.openclaw.bak.${ts}`);
    renameSync(oc, bak);
    console.log(`Renamed existing ~/.openclaw -> ${bak}`);
  }

  // Extract into HOME. The tarball is expected to contain a top-level .openclaw/ folder.
  mkdirSync(oc, { recursive: true });
  run('/usr/bin/tar', ['-xzf', src, '-C', home], true);
  console.log('Extracted backup into HOME.');

  // Best-effort validate
  try {
    run('openclaw', ['config', 'validate'], true);
    console.log('openclaw config validate: OK');
  } catch (e: any) {
    console.log(`openclaw config validate: WARN (${e?.message || e})`);
  }

  const required = [
    join(oc, 'openclaw.json'),
    join(oc, 'credentials'),
    join(oc, 'agents'),
    join(oc, 'memory'),
    join(oc, 'workspaces'),
    join(oc, 'cron')
  ];
  const checked = checkPaths(required);
  if (checked.ok.length) {
    console.log('Restored paths present:');
    for (const p of checked.ok) console.log(`- ${p}`);
  }
  if (checked.missing.length) {
    console.log('WARN missing restored paths:');
    for (const p of checked.missing) console.log(`- ${p}`);
  }

  if (restartGateway) {
    try {
      run('openclaw', ['gateway', 'restart'], true);
      console.log('openclaw gateway restart: OK');
    } catch (e: any) {
      console.log(`openclaw gateway restart: WARN (${e?.message || e})`);
      console.log('If gateway service is not loaded, try: openclaw gateway install --force');
    }
  } else {
    console.log('NOTE: gateway was NOT restarted (safe default).');
    console.log('This is normal during restore on a new or temporary environment.');
    console.log('Next steps:');
    console.log('- Run: openclaw config validate');
    console.log('- Then run: openclaw gateway restart');
    console.log('- If restart fails, run: openclaw gateway install --force');
    console.log('- After gateway is up, run: openclaw status');
    console.log('- Then run: openclaw memory status');
  }
}
