import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  buildAuthUrl,
  createPkcePair,
  loadSession,
  persistSession
} from '../src/tools/youtube-oauth-lib.js';

test('buildAuthUrl includes Google OAuth parameters and PKCE', () => {
  const pkce = createPkcePair();
  const url = new URL(buildAuthUrl({
    clientId: 'google_client_id',
    redirectUri: 'http://localhost:8788/callback',
    scopes: [
      'https://www.googleapis.com/auth/youtube.upload',
      'https://www.googleapis.com/auth/youtube.readonly'
    ],
    state: 'state_yt_123',
    codeChallenge: pkce.challenge
  }));

  assert.equal(url.searchParams.get('client_id'), 'google_client_id');
  assert.equal(url.searchParams.get('redirect_uri'), 'http://localhost:8788/callback');
  assert.equal(url.searchParams.get('state'), 'state_yt_123');
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('prompt'), 'consent');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('code_challenge'), pkce.challenge);
  assert.ok(pkce.verifier.length >= 43);
  assert.match(pkce.challenge, /^[A-Za-z0-9_-]{43,128}$/);
});

test('persistSession and loadSession preserve YouTube PKCE state', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'delx-youtube-oauth-'));
  const sessionPath = path.join(dir, 'session.json');
  const session = {
    state: 'state_yt_abc',
    redirectUri: 'http://localhost:8788/callback',
    codeVerifier: 'verifier_yt_xyz'
  };

  persistSession(sessionPath, session);
  const loaded = loadSession(sessionPath);

  assert.deepEqual(loaded, session);
});
