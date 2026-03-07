# clawkeeper

Clawkeeper is a Memory Ops Kit for OpenClaw.

Goals:
- Make OpenClaw memory operationally reliable.
- Catch embeddings/provider failures early instead of discovering them after memory search breaks.
- Keep recovery simple: restore agents, config, memory, and workspaces on a fresh machine.
- Prefer safe defaults, especially around gateway restarts.

## Current features
- `clawkeeper doctor`
  - Reads the current OpenClaw memorySearch config
  - Shows OpenClaw memory status when available
  - For `provider=openai`, runs a real minimal embeddings probe
  - For `provider=ollama`, checks reachability and whether `nomic-embed-text` is present
- `clawkeeper switch openai|ollama`
  - Switches `agents.defaults.memorySearch.provider`
  - Makes a timestamped backup of `~/.openclaw/openclaw.json`
  - Restarts the gateway after switching
- `clawkeeper backup-plan [--json]`
  - Prints recommended daily/weekly backup coverage
  - `--json` emits machine-readable include/exclude structure
- `clawkeeper verify-backup <path.tgz>`
  - Validates that a backup tarball contains required OpenClaw paths
  - Exits non-zero when critical paths are missing
- `clawkeeper restore-guide`
  - Prints a safe restore procedure for a new machine
- `clawkeeper restore-apply <path.tgz> [--restart-gateway]`
  - Safe default: renames existing `~/.openclaw` before extracting backup
  - Does **not** restart the gateway unless `--restart-gateway` is explicitly passed

## Install / run

### Local dev
```bash
npm install
npm run build
node dist/cli.js --help
```

### Global install
```bash
npm install -g .
clawkeeper --help
```

Compatibility alias is also kept for now:
```bash
memops --help
```

## Usage
```bash
clawkeeper doctor
clawkeeper switch ollama
clawkeeper switch openai
clawkeeper backup-plan
clawkeeper backup-plan --json
clawkeeper verify-backup ~/openclaw-backup.tgz
clawkeeper restore-guide
clawkeeper restore-apply ~/openclaw-backup.tgz
clawkeeper restore-apply ~/openclaw-backup.tgz --restart-gateway
```

## Safety notes
This tool edits `~/.openclaw/openclaw.json`.
- Always makes a timestamped backup before modifying config.
- Never prints secrets; reports only whether keys are present.
- `restore-apply` uses safe mode by default.
- Gateway restart is opt-in during restore because restart/install flows can be disruptive on a live machine.

## Non-goals
- Replacing OpenClaw memory-core
- Uploading user memory content to Git
- Automatically making risky service changes during restore without explicit request

## Requirements
- OpenClaw CLI installed on the same machine
- Node.js 20+

## License
MIT
