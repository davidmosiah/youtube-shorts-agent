#!/usr/bin/env node
import fs from 'node:fs';
import http from 'node:http';
import { exec } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import {
  buildAuthUrl,
  createPkcePair,
  loadSession,
  persistSession
} from './youtube-oauth-lib.js';

function loadEnvFile(fp) {
  if (!fs.existsSync(fp)) return;
  for (const raw of fs.readFileSync(fp, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx < 1) continue;
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1).trim();
    if (!(k in process.env)) process.env[k] = v;
  }
}

function arg(name, fallback = '') {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}

const cmd = process.argv[2];
const envPath = path.resolve(process.cwd(), '.env');
const sessionPath = path.resolve(process.cwd(), '.youtube-oauth-session.json');
loadEnvFile(envPath);

const clientId = process.env.YOUTUBE_CLIENT_ID || '';
const clientSecret = process.env.YOUTUBE_CLIENT_SECRET || '';
const redirectUri = arg('redirect', process.env.YOUTUBE_REDIRECT_URI || 'http://localhost:8788/callback');
const scopes = arg(
  'scopes',
  'https://www.googleapis.com/auth/youtube.upload,https://www.googleapis.com/auth/youtube.readonly'
).split(',').map((s) => s.trim()).filter(Boolean);

if (!clientId || !clientSecret) {
  console.error('Missing YOUTUBE_CLIENT_ID or YOUTUBE_CLIENT_SECRET in .env');
  process.exit(1);
}

async function exchangeCode(code, codeVerifier) {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
    code_verifier: codeVerifier
  });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Token response is not JSON: ${text.slice(0, 500)}`);
  }

  if (!res.ok || !json.access_token) {
    throw new Error(`YouTube token exchange failed: ${JSON.stringify(json, null, 2)}`);
  }

  return json;
}

function persistTokens(json) {
  const env = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8').split('\n') : [];
  let hasToken = false;
  let hasRefresh = false;
  let hasExpires = false;

  const next = env.map((line) => {
    if (line.startsWith('YOUTUBE_ACCESS_TOKEN=')) {
      hasToken = true;
      return `YOUTUBE_ACCESS_TOKEN=${json.access_token}`;
    }
    if (line.startsWith('YOUTUBE_REFRESH_TOKEN=')) {
      hasRefresh = true;
      return `YOUTUBE_REFRESH_TOKEN=${json.refresh_token || ''}`;
    }
    if (line.startsWith('YOUTUBE_ACCESS_TOKEN_EXPIRES_IN=')) {
      hasExpires = true;
      return `YOUTUBE_ACCESS_TOKEN_EXPIRES_IN=${json.expires_in || ''}`;
    }
    return line;
  });

  if (!hasToken) next.push(`YOUTUBE_ACCESS_TOKEN=${json.access_token}`);
  if (!hasRefresh) next.push(`YOUTUBE_REFRESH_TOKEN=${json.refresh_token || ''}`);
  if (!hasExpires) next.push(`YOUTUBE_ACCESS_TOKEN_EXPIRES_IN=${json.expires_in || ''}`);

  fs.writeFileSync(envPath, next.filter(Boolean).join('\n') + '\n', 'utf8');
}

function maybeOpenBrowser(url) {
  if (process.platform === 'darwin') {
    exec(`open "${url}"`);
  }
}

function startSession(state) {
  const pkce = createPkcePair();
  persistSession(sessionPath, {
    state,
    redirectUri,
    codeVerifier: pkce.verifier,
    createdAt: new Date().toISOString()
  });
  return buildAuthUrl({
    clientId,
    redirectUri,
    scopes,
    state,
    codeChallenge: pkce.challenge
  });
}

if (cmd === 'auth-url') {
  const state = arg('state', `delx_yt_${Date.now()}`);
  const url = startSession(state);
  console.log(url);
  process.exit(0);
}

if (cmd === 'exchange-code') {
  const code = arg('code');
  if (!code) {
    console.error('Use: node src/tools/youtube-oauth.js exchange-code --code <CODE> [--redirect <URI>]');
    process.exit(1);
  }
  const session = loadSession(sessionPath);
  const codeVerifier = arg('code-verifier', session?.codeVerifier || '');
  if (!codeVerifier) {
    console.error('Missing code verifier. Run auth-url/start-auth first or pass --code-verifier.');
    process.exit(1);
  }
  try {
    const json = await exchangeCode(code, codeVerifier);
    persistTokens(json);
    console.log('YouTube tokens saved to .env');
    console.log(JSON.stringify({
      scope: json.scope,
      expires_in: json.expires_in,
      refresh_token_present: Boolean(json.refresh_token)
    }, null, 2));
    process.exit(0);
  } catch (error) {
    console.error(String(error));
    process.exit(1);
  }
}

if (cmd === 'start-auth') {
  const state = arg('state', `delx_yt_${Date.now()}`);
  const authUrl = startSession(state);
  const callbackUrl = new URL(redirectUri);
  if (!['localhost', '127.0.0.1'].includes(callbackUrl.hostname)) {
    console.log(`Remote redirect detected: ${redirectUri}`);
    console.log('Open this URL, complete Google auth, then copy the code from the callback URL and run the exchange command locally.');
    console.log(authUrl);
    maybeOpenBrowser(authUrl);
    process.exit(0);
  }

  const port = Number(callbackUrl.port || '80');
  const expectedPath = callbackUrl.pathname || '/';
  const server = http.createServer(async (req, res) => {
    const reqUrl = new URL(req.url || '/', redirectUri);
    if (reqUrl.pathname !== expectedPath) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }

    const code = reqUrl.searchParams.get('code');
    const returnedState = reqUrl.searchParams.get('state');
    const error = reqUrl.searchParams.get('error');

    if (error) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end(`Google returned error: ${error}`);
      console.error(`Google returned error: ${error}`);
      server.close();
      return;
    }

    if (!code || returnedState !== state) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Missing code or invalid state');
      console.error('Missing code or invalid state');
      server.close();
      return;
    }

    try {
      const session = loadSession(sessionPath);
      if (!session?.codeVerifier) {
        throw new Error('Missing PKCE code verifier in session file');
      }
      const json = await exchangeCode(code, session.codeVerifier);
      persistTokens(json);
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('YouTube auth complete. You can close this tab.');
      console.log('YouTube tokens saved to .env');
      console.log(JSON.stringify({
        scope: json.scope,
        expires_in: json.expires_in,
        refresh_token_present: Boolean(json.refresh_token)
      }, null, 2));
    } catch (exchangeError) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Token exchange failed. Check terminal output.');
      console.error(String(exchangeError));
    } finally {
      server.close();
    }
  });

  server.listen(port, callbackUrl.hostname, () => {
    console.log(`Listening on ${redirectUri}`);
    console.log(authUrl);
    maybeOpenBrowser(authUrl);
  });

  process.on('SIGINT', () => {
    server.close();
    process.exit(130);
  });
  await new Promise(() => {});
}

console.error('Usage:');
console.error('  node src/tools/youtube-oauth.js auth-url [--redirect <URI>] [--scopes ...] [--state ...]');
console.error('  node src/tools/youtube-oauth.js exchange-code --code <CODE> [--redirect <URI>] [--code-verifier <PKCE_VERIFIER>]');
console.error('  node src/tools/youtube-oauth.js start-auth [--redirect <URI>] [--scopes ...]');
process.exit(1);
