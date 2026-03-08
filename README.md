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
- `clawkeeper switch openai|ollama [--dry-run]`
  - `--dry-run` previews the provider/config change without writing config or restarting the gateway
  - Real switches update `agents.defaults.memorySearch.provider`
  - Switching to `ollama` removes `memorySearch.remote` from that section to avoid stale OpenAI config there
  - Makes a timestamped backup of `~/.openclaw/openclaw.json` before any real write
  - Restarts the gateway after a real config change
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
clawkeeper switch ollama --dry-run
clawkeeper switch openai --dry-run
clawkeeper backup-plan
clawkeeper backup-plan --json
clawkeeper verify-backup ~/openclaw-backup.tgz
clawkeeper restore-guide
clawkeeper restore-apply ~/openclaw-backup.tgz
clawkeeper restore-apply ~/openclaw-backup.tgz --restart-gateway
```

## Repo rule detector (script)
If you need to quickly see what GitHub repo rules might block merges (repo rulesets + classic branch protection), run:

```bash
node scripts/repo-rule-detector.mjs dtzp555-max/ocm --branch main
```

Example summary (dtzp555-max/ocm):

- PRs required before merging: yes
- Linear history required: yes
- Non-fast-forward pushes blocked: yes
- Allowed merge methods: merge, squash, rebase

Minimal JSON view:

```json
{
  "repo": "dtzp555-max/ocm",
  "branch": "main",
  "summary": {
    "pullRequestRequired": true,
    "linearHistoryRequired": true,
    "nonFastForwardBlocked": true,
    "allowedMergeMethods": ["merge", "squash", "rebase"]
  }
}
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

## Related Projects

- [ocm](https://github.com/dtzp555-max/ocm) — local dashboard and built-in CLI for operating OpenClaw with less config friction.
- [execution-agent-planner](https://github.com/dtzp555-max/execution-agent-planner) — skill for deciding when to keep work with one execution agent vs split across multiple workers.
- [gh-pr-release-flow](https://github.com/dtzp555-max/gh-pr-release-flow) — skill for PR-first GitHub workflows, protected branches, and release-after-merge habits.

## License
MIT
