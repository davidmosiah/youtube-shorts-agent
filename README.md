# YouTube Shorts Agent

[![npm version](https://img.shields.io/npm/v/youtube-shorts-agent.svg)](https://www.npmjs.com/package/youtube-shorts-agent)
[![CI](https://github.com/davidmosiah/youtube-shorts-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/davidmosiah/youtube-shorts-agent/actions/workflows/ci.yml)

Agent-first YouTube Shorts uploader for the YouTube Data API. It is designed for Codex, Claude, Cursor, Hermes, OpenClaw and any MCP client that needs a predictable upload workflow with dry-run safety, OAuth readiness checks and structured output.

## What Agents Get

- `youtube_agent_manifest` for install/runtime guidance
- `youtube_connection_status` before upload attempts
- `youtube_privacy_audit` for local token and media boundaries
- `youtube_oauth_authorize_url` with local PKCE session storage
- `youtube_upload_short` with `containsSyntheticMedia` support
- `youtube_list_recent_videos` for lightweight post-upload checks

## Install

```bash
npm install -g youtube-shorts-agent
```

Or run directly:

```bash
npx -y youtube-shorts-agent doctor
```

## CLI

```bash
youtube-shorts-agent manifest --client codex
youtube-shorts-agent doctor
youtube-shorts-agent privacy-audit
youtube-shorts-agent auth-url --redirect-uri http://localhost:8787/callback
youtube-shorts-agent upload-short --video ./short.mp4 --title "Launch title" --caption-file copy.txt
youtube-shorts-agent list-recent --max-results 10
```

Dry-run is enabled by default. Set `YOUTUBE_DRY_RUN=false` only when `doctor` reports a complete OAuth setup and you intend to call the live API.

## MCP

```bash
youtube-shorts-mcp
```

HTTP transport:

```bash
YOUTUBE_MCP_TRANSPORT=http youtube-shorts-mcp
```

Hermes-style config:

```yaml
mcp_servers:
  youtube_shorts:
    command: npx
    args: ["-y", "youtube-shorts-agent"]
    sampling:
      enabled: false
```

Recommended first calls:

1. `youtube_connection_status`
2. `youtube_privacy_audit`
3. `youtube_upload_short`

## Configuration

Copy `.env.example` to `.env`. Keep `.env` and `.agent-data/` out of Git.

The upload tool sets `containsSyntheticMedia=true` by default for AI-generated or AI-edited videos. Override only when that is not true for the asset.

## Safety Model

- OAuth tokens are never returned by CLI or MCP tools.
- PKCE verifier is stored locally in `.agent-data/`.
- Live upload requires `YOUTUBE_DRY_RUN=false`.
- The package uses the official YouTube Data API and does not automate Studio UI.

## Development

```bash
npm install
npm test
npm run check
```
