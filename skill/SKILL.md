---
name: youtube-shorts
description: >
  YouTube Shorts Agent. Prefer MCP tools if connected; otherwise the package CLI.
---

# YouTube Shorts Agent — skill or MCP

Same package, two doors.

```bash
npx -y youtube-shorts-agent call youtube_connection_status --json '{}'
```

If MCP tools are already connected, use them. Do not invent mutation flags.

