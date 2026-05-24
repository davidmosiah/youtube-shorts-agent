#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { YouTubeOfficialAdapter } from './adapters/youtube-official.js';
import { getConfig, persistEnvValues } from './config.js';
import { buildAgentManifest, buildConnectionStatus, buildPrivacyAudit, formatMarkdown } from './services/agent-surfaces.js';
import { buildAuthUrl, createPkcePair, persistSession } from './tools/youtube-oauth-lib.js';

const COMMANDS = new Set([
  'manifest',
  'doctor',
  'privacy-audit',
  'auth-url',
  'upload-short',
  'list-recent',
  'help'
]);

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith('--')) {
      args._.push(item);
      continue;
    }
    const key = item.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    if (args[key] === undefined) {
      args[key] = next;
    } else if (Array.isArray(args[key])) {
      args[key].push(next);
    } else {
      args[key] = [args[key], next];
    }
    i += 1;
  }
  return args;
}

function asArray(value) {
  if (Array.isArray(value)) return value.flatMap(asArray);
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function readText(args, key) {
  const file = args[`${key}-file`];
  if (file) return fs.readFileSync(String(file), 'utf8').trim();
  return String(args[key] || '').trim();
}

function readJson(value, fallback = {}) {
  if (!value) return fallback;
  return JSON.parse(String(value));
}


function safeConnectionStatus(status) {
  return {
    ok: status.ok,
    dry_run: status.dry_run,
    configured: {
      client_credentials: status.configured.oauth_client ? 'configured' : 'missing',
      access_token: status.configured.access_token ? 'configured' : 'missing',
      refresh_token: status.configured.refresh_token ? 'configured' : 'missing'
    },
    missing_count: status.missing.length,
    ready_for_live_upload: status.ready_for_live_upload,
    next_steps: status.next_steps
  };
}

function safePrivacyAudit(audit) {
  return {
    project: audit.project,
    secrets_returned_to_agent: audit.secrets_returned_to_agent,
    local_files_ignored: audit.local_files_ignored,
    external_services: audit.external_services,
    token_storage: audit.token_storage,
    safety_rules: audit.safety_rules,
    required_google_permission_count: Array.isArray(audit.oauth_scopes) ? audit.oauth_scopes.length : 0
  };
}

function safeOutput(data) {
  if (Array.isArray(data)) return data.map(safeOutput);
  if (!data || typeof data !== 'object') return data;
  const safe = {};
  for (const [key, value] of Object.entries(data)) {
    if (key === 'oauth_scopes' || key === 'stack') continue;
    if (key === 'error') {
      safe[key] = String(value).includes('\n') ? 'internal_error' : String(value);
      continue;
    }
    safe[key] = safeOutput(value);
  }
  return safe;
}

function output(data, args, title = 'Result') {
  const safeData = safeOutput(data);
  if (args.format === 'markdown') {
    console.log(formatMarkdown(title, safeData));
    return;
  }
  console.log(JSON.stringify(safeData, null, 2));
}

function createAdapter(cfg) {
  return new YouTubeOfficialAdapter(cfg.youtube, {
    onTokensUpdated: async (tokens) => persistEnvValues(cfg.envPath, {
      YOUTUBE_ACCESS_TOKEN: tokens.accessToken,
      YOUTUBE_REFRESH_TOKEN: tokens.refreshToken,
      YOUTUBE_ACCESS_TOKEN_EXPIRES_IN: tokens.accessTokenExpiresIn
    })
  });
}

function buildUploadJob(args) {
  const videoPath = String(args.video || args.file || '').trim();
  if (!videoPath) throw new Error('Missing --video <FILE>');
  const title = String(args.title || '').trim();
  const caption = readText(args, 'caption') || title;
  if (!title && !caption) throw new Error('Missing --title or --caption');
  const metadata = {
    ...readJson(args.metadata, {}),
    title,
    youtube_title: title || caption.slice(0, 100),
    youtube_tags: asArray(args.tags),
    youtube_privacy_status: String(args.privacy || args['privacy-status'] || '').trim() || undefined,
    youtube_contains_synthetic_media: args['contains-synthetic-media'] === false ? false : true,
    video_duration_sec: Number(args.duration || args['duration-sec'] || 0),
    video_aspect_ratio: String(args['aspect-ratio'] || '9:16')
  };
  return {
    id: String(args.id || `youtube_${Date.now()}`),
    platform: 'youtube',
    status: 'queued',
    createdAt: new Date().toISOString(),
    caption,
    targetUrl: String(args.url || args['target-url'] || '').trim(),
    mediaPaths: [videoPath],
    metadata
  };
}

function help() {
  return {
    name: 'youtube-shorts-agent',
    usage: [
      'youtube-shorts-agent doctor',
      'youtube-shorts-agent manifest --client codex',
      'youtube-shorts-agent auth-url --redirect-uri http://localhost:8787/callback',
      'youtube-shorts-agent upload-short --video ./short.mp4 --title "Launch title" --caption-file copy.txt',
      'youtube-shorts-agent list-recent --max-results 10'
    ],
    safety: 'Dry-run is enabled by default. Set YOUTUBE_DRY_RUN=false only after doctor is clean.'
  };
}

export async function runCliCommand(argv = process.argv.slice(2)) {
  const command = argv[0] || 'help';
  if (!COMMANDS.has(command)) return undefined;

  const args = parseArgs(argv.slice(1));
  const cfg = getConfig();

  if (command === 'help') {
    output(help(), args, 'YouTube Shorts Agent');
    return 0;
  }

  if (command === 'manifest') {
    output(buildAgentManifest({ client: args.client || 'generic' }), args, 'YouTube Shorts Agent Manifest');
    return 0;
  }

  if (command === 'doctor') {
    output(safeConnectionStatus(buildConnectionStatus({ env: process.env })), args, 'YouTube Connection Status');
    return 0;
  }

  if (command === 'privacy-audit') {
    output(safePrivacyAudit(buildPrivacyAudit()), args, 'YouTube Privacy Audit');
    return 0;
  }

  if (command === 'auth-url') {
    const redirectUri = String(args['redirect-uri'] || process.env.YOUTUBE_REDIRECT_URI || '').trim();
    if (!cfg.youtube.clientId) throw new Error('Missing YOUTUBE_CLIENT_ID');
    if (!redirectUri) throw new Error('Missing --redirect-uri or YOUTUBE_REDIRECT_URI');
    const pkce = createPkcePair();
    const state = String(args.state || crypto.randomUUID());
    const scopes = asArray(args.scopes || 'https://www.googleapis.com/auth/youtube.upload,https://www.googleapis.com/auth/youtube.readonly');
    const sessionPath = path.join(cfg.dataDir, '.youtube-oauth-session.json');
    fs.mkdirSync(cfg.dataDir, { recursive: true });
    persistSession(sessionPath, {
      provider: 'youtube',
      state,
      redirectUri,
      codeVerifier: pkce.verifier,
      scopes,
      createdAt: new Date().toISOString()
    });
    output({
      auth_url: buildAuthUrl({
        clientId: cfg.youtube.clientId,
        redirectUri,
        scopes,
        state,
        codeChallenge: pkce.challenge
      }),
      state,
      session_path: sessionPath,
      next_step: 'Open auth_url, complete OAuth, then exchange the callback code with your preferred OAuth handler.'
    }, args, 'YouTube OAuth URL');
    return 0;
  }

  const adapter = createAdapter(cfg);

  if (command === 'upload-short') {
    const job = buildUploadJob(args);
    const result = await adapter.publishDraft(job);
    output({ ok: true, dry_run: cfg.youtube.dryRun, job, result }, args, 'YouTube Upload Result');
    return 0;
  }

  if (command === 'list-recent') {
    output(await adapter.listRecentVideos({
      maxResults: Number(args['max-results'] || 10)
    }), args, 'YouTube Recent Videos');
    return 0;
  }

  return undefined;
}

function isMainModule() {
  if (!process.argv[1]) return false;
  return fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  try {
    const code = await runCliCommand();
    if (code === undefined) {
      output(help(), {}, 'YouTube Shorts Agent');
      process.exitCode = 1;
    } else {
      process.exitCode = code;
    }
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
