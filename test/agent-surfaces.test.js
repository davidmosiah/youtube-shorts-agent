import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAgentManifest,
  buildConnectionStatus,
  buildPrivacyAudit
} from '../src/services/agent-surfaces.js';

test('YouTube Shorts agent manifest exposes upload-first agent guidance', () => {
  const manifest = buildAgentManifest({ client: 'codex' });

  assert.equal(manifest.project, 'youtube-shorts-agent');
  assert.equal(manifest.client, 'codex');
  assert.ok(manifest.supported_clients.includes('hermes'));
  assert.ok(manifest.recommended_first_calls.includes('youtube_connection_status'));
  assert.ok(manifest.standard_tools.includes('youtube_upload_short'));
  assert.doesNotMatch(JSON.stringify(manifest), /access_token|refresh_token|client_secret/i);
});

test('YouTube connection status reports OAuth readiness without exposing token values', () => {
  const status = buildConnectionStatus({
    env: {
      YOUTUBE_DRY_RUN: 'false',
      YOUTUBE_CLIENT_ID: 'client_id',
      YOUTUBE_CLIENT_SECRET: 'secret',
      YOUTUBE_ACCESS_TOKEN: ''
    }
  });

  assert.equal(status.ready_for_live_upload, false);
  assert.equal(status.configured.oauth_client, true);
  assert.equal(status.configured.access_token, false);
  assert.ok(status.missing.includes('YOUTUBE_ACCESS_TOKEN'));
  assert.doesNotMatch(JSON.stringify(status), /secret/);
});

test('YouTube privacy audit explains upload scope and synthetic media flag', () => {
  const audit = buildPrivacyAudit();

  assert.equal(audit.secrets_returned_to_agent, false);
  assert.ok(audit.oauth_scopes.some((scope) => scope.includes('youtube.upload')));
  assert.ok(audit.safety_rules.some((rule) => /containsSyntheticMedia/i.test(rule)));
});
