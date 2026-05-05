#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

import { YouTubeOfficialAdapter } from './adapters/youtube-official.js';
import { getConfig, persistEnvValues } from './config.js';
import { runCliCommand } from './cli.js';
import { makeError, makeResponse, toMarkdown } from './mcp-utils.js';
import { buildAgentManifest, buildConnectionStatus, buildPrivacyAudit, formatMarkdown } from './services/agent-surfaces.js';
import { buildAuthUrl, createPkcePair, persistSession } from './tools/youtube-oauth-lib.js';

const SERVER_NAME = 'youtube-shorts-agent';
const SERVER_VERSION = '0.1.0';
const ResponseFormatSchema = z.enum(['json', 'markdown']).default('json');

function createAdapter(cfg) {
  return new YouTubeOfficialAdapter(cfg.youtube, {
    onTokensUpdated: async (tokens) => persistEnvValues(cfg.envPath, {
      YOUTUBE_ACCESS_TOKEN: tokens.accessToken,
      YOUTUBE_REFRESH_TOKEN: tokens.refreshToken,
      YOUTUBE_ACCESS_TOKEN_EXPIRES_IN: tokens.accessTokenExpiresIn
    })
  });
}

function registerTools(server) {
  server.registerTool('youtube_agent_manifest', {
    title: 'YouTube Shorts Agent Manifest',
    description: 'Machine-readable install, client, runtime and safety guidance for agents.',
    inputSchema: {
      client: z.string().default('generic'),
      response_format: ResponseFormatSchema
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ client, response_format }) => {
    const manifest = buildAgentManifest({ client });
    return makeResponse(manifest, response_format, formatMarkdown('YouTube Shorts Agent Manifest', manifest));
  });

  server.registerTool('youtube_connection_status', {
    title: 'YouTube Connection Status',
    description: 'Check dry-run mode, OAuth readiness and live upload readiness without exposing tokens.',
    inputSchema: { response_format: ResponseFormatSchema },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ response_format }) => {
    const status = buildConnectionStatus({ env: process.env });
    return makeResponse(status, response_format, toMarkdown('YouTube Connection Status', status));
  });

  server.registerTool('youtube_privacy_audit', {
    title: 'YouTube Privacy Audit',
    description: 'Return OAuth scope, synthetic media and live-upload safety boundaries.',
    inputSchema: { response_format: ResponseFormatSchema },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ response_format }) => {
    const audit = buildPrivacyAudit();
    return makeResponse(audit, response_format, toMarkdown('YouTube Privacy Audit', audit));
  });

  server.registerTool('youtube_oauth_authorize_url', {
    title: 'YouTube OAuth Authorize URL',
    description: 'Create a Google OAuth authorization URL and persist the PKCE verifier locally without returning it to the agent.',
    inputSchema: {
      redirect_uri: z.string(),
      state: z.string().optional(),
      scopes: z.array(z.string()).default([
        'https://www.googleapis.com/auth/youtube.upload',
        'https://www.googleapis.com/auth/youtube.readonly'
      ]),
      response_format: ResponseFormatSchema
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, async ({ redirect_uri, state, scopes, response_format }) => {
    try {
      const cfg = getConfig();
      if (!cfg.youtube.clientId) throw new Error('Missing YOUTUBE_CLIENT_ID');
      const pkce = createPkcePair();
      const finalState = state || crypto.randomUUID();
      const sessionPath = path.join(cfg.dataDir, '.youtube-oauth-session.json');
      fs.mkdirSync(cfg.dataDir, { recursive: true });
      persistSession(sessionPath, {
        provider: 'youtube',
        state: finalState,
        redirectUri: redirect_uri,
        codeVerifier: pkce.verifier,
        scopes,
        createdAt: new Date().toISOString()
      });
      const payload = {
        auth_url: buildAuthUrl({
          clientId: cfg.youtube.clientId,
          redirectUri: redirect_uri,
          scopes,
          state: finalState,
          codeChallenge: pkce.challenge
        }),
        state: finalState,
        session_path: sessionPath
      };
      return makeResponse(payload, response_format, toMarkdown('YouTube OAuth URL', payload));
    } catch (error) {
      return makeError(error);
    }
  });

  server.registerTool('youtube_upload_short', {
    title: 'Upload YouTube Short',
    description: 'Upload one vertical video as a YouTube Short. Dry-run is enabled by default; live mode requires YOUTUBE_DRY_RUN=false.',
    inputSchema: {
      video_path: z.string(),
      title: z.string(),
      caption: z.string().default(''),
      tags: z.array(z.string()).default([]),
      privacy_status: z.enum(['public', 'unlisted', 'private']).default('public'),
      contains_synthetic_media: z.boolean().default(true),
      response_format: ResponseFormatSchema
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, async (params) => {
    try {
      const cfg = getConfig();
      const result = await createAdapter(cfg).publishDraft({
        id: `youtube_${Date.now()}`,
        platform: 'youtube',
        status: 'queued',
        createdAt: new Date().toISOString(),
        caption: params.caption || params.title,
        targetUrl: '',
        mediaPaths: [params.video_path],
        metadata: {
          title: params.title,
          youtube_title: params.title,
          youtube_tags: params.tags,
          youtube_privacy_status: params.privacy_status,
          youtube_contains_synthetic_media: params.contains_synthetic_media,
          video_aspect_ratio: '9:16'
        }
      });
      const payload = { ok: true, dry_run: cfg.youtube.dryRun, result };
      return makeResponse(payload, params.response_format, toMarkdown('YouTube Upload Result', payload));
    } catch (error) {
      return makeError(error);
    }
  });

  server.registerTool('youtube_list_recent_videos', {
    title: 'List Recent YouTube Videos',
    description: 'List recent videos from the configured YouTube channel.',
    inputSchema: {
      max_results: z.number().int().min(1).max(50).default(10),
      response_format: ResponseFormatSchema
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async ({ max_results, response_format }) => {
    try {
      const result = await createAdapter(getConfig()).listRecentVideos({ maxResults: max_results });
      return makeResponse(result, response_format, toMarkdown('YouTube Recent Videos', result));
    } catch (error) {
      return makeError(error);
    }
  });
}

function createServer() {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  registerTools(server);
  return server;
}

async function runStdio() {
  const server = createServer();
  await server.connect(new StdioServerTransport());
}

async function runHttp() {
  const cfg = getConfig();
  const app = express();
  const allowedOrigin = cfg.mcp.allowedOrigin || `http://${cfg.mcp.host}:${cfg.mcp.port}`;
  app.use(express.json({ limit: '2mb' }));
  app.use(cors({ origin: allowedOrigin }));
  app.get('/health', (_req, res) => res.json({ ok: true, name: SERVER_NAME, version: SERVER_VERSION }));
  app.post('/mcp', async (req, res) => {
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      transport.close().catch(() => undefined);
      server.close().catch(() => undefined);
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error('MCP HTTP request failed:', error);
      if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
    }
  });
  app.listen(cfg.mcp.port, cfg.mcp.host, () => {
    console.error(`${SERVER_NAME} HTTP transport listening on http://${cfg.mcp.host}:${cfg.mcp.port}/mcp`);
  });
}

let cliResult;
try {
  cliResult = await runCliCommand(process.argv.slice(2));
} catch (error) {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

if (cliResult !== undefined) {
  process.exitCode = cliResult;
} else if (process.exitCode === undefined) {
  const args = new Set(process.argv.slice(2));
  const transport = process.env.YOUTUBE_MCP_TRANSPORT || (args.has('--http') ? 'http' : 'stdio');
  if (transport === 'http') await runHttp();
  else await runStdio();
}
