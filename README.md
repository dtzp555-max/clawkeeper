# clawkeeper

Clawkeeper is a Memory Ops Kit for OpenClaw.

Goals:
- Make OpenClaw memory *operationally reliable* (no more silent failures when embeddings billing breaks).
- Keep recovery simple: restore agents (SOUL + config + memory) on a fresh machine.
- Prefer OpenClaw built-in memory-core; provide optional glue and guardrails.

## Features (v0.1)
- `memops doctor`: sanity checks for memory + embeddings provider health.
- `memops switch openai|ollama`: switch `agents.defaults.memorySearch.provider` and restart gateway.
- `memops backup-plan`: print/emit backup include list for disaster recovery.

## Non-goals
- Replacing OpenClaw memory-core.
- Uploading any user memory content to Git.

## Requirements
- OpenClaw CLI installed on the same machine.
- Node.js 20+.

## Usage (planned)
```bash
memops doctor
memops switch ollama
memops switch openai
memops backup-plan
```

## Safety
This tool edits `~/.openclaw/openclaw.json`.
- Always makes a timestamped backup before modifying.
- Never prints secrets; reports only whether keys are present.

## License
MIT
