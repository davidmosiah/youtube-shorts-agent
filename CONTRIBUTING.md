# Contributing

Contributions are welcome around upload planning, OAuth readiness, dry-run safety, synthetic-media metadata, MCP ergonomics, tests and docs.

## Local development

```bash
npm ci
npm run check
npm test
npm run doctor
npm run manifest
npm run privacy
```

## Design rules

- Keep dry-run behavior the default for agent workflows.
- Never commit OAuth credentials, refresh tokens, private video assets, upload logs with account data or local config.
- Keep live upload behavior behind explicit user intent.
- Preserve manifest, connection status, privacy audit and metadata checks.

## Pull request checklist

- `npm run check` passes.
- `npm test` passes.
- README, `llms.txt` and examples are updated when commands or tools change.
