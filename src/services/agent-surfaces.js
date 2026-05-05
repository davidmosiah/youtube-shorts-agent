export const SUPPORTED_CLIENTS = ['generic', 'claude', 'codex', 'cursor', 'windsurf', 'hermes', 'openclaw'];

function safeClient(client = 'generic') {
  return SUPPORTED_CLIENTS.includes(client) ? client : 'generic';
}

function present(env, key) {
  return Boolean(String(env?.[key] || '').trim());
}

function enabled(env, key, fallback = false) {
  const value = env?.[key];
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

export function buildAgentManifest({ client = 'generic' } = {}) {
  return {
    project: 'youtube-shorts-agent',
    mcp_name: 'io.github.davidmosiah/youtube-shorts-agent',
    client: safeClient(client),
    package: {
      name: 'youtube-shorts-agent',
      install_command: 'npx -y youtube-shorts-agent',
      binary: 'youtube-shorts-agent'
    },
    supported_clients: SUPPORTED_CLIENTS,
    standard_tools: [
      'youtube_agent_manifest',
      'youtube_connection_status',
      'youtube_privacy_audit',
      'youtube_oauth_authorize_url',
      'youtube_upload_short',
      'youtube_list_recent_videos'
    ],
    recommended_first_calls: ['youtube_connection_status', 'youtube_privacy_audit'],
    hermes: {
      config_path: '~/.hermes/config.yaml',
      tool_name_prefix: 'mcp_youtube_',
      reload_after_config_change: '/reload-mcp or hermes mcp test youtube_shorts',
      recommended_config: 'mcp_servers:\n  youtube_shorts:\n    command: npx\n    args: ["-y", "youtube-shorts-agent"]\n    sampling:\n      enabled: false'
    },
    agent_rules: [
      'Call youtube_connection_status before upload tools.',
      'Default to dry-run until the user confirms live upload.',
      'Never reveal YouTube OAuth access tokens, refresh tokens or client secrets.',
      'Set containsSyntheticMedia=true for AI-generated or AI-edited videos.',
      'Only upload videos the user owns or has rights to publish.'
    ]
  };
}

export function buildConnectionStatus({ env = process.env } = {}) {
  const configured = {
    oauth_client: present(env, 'YOUTUBE_CLIENT_ID') && present(env, 'YOUTUBE_CLIENT_SECRET'),
    access_token: present(env, 'YOUTUBE_ACCESS_TOKEN'),
    refresh_token: present(env, 'YOUTUBE_REFRESH_TOKEN')
  };
  const dryRun = enabled(env, 'YOUTUBE_DRY_RUN', true);
  const missing = [];
  if (!configured.oauth_client) missing.push('YOUTUBE_OAUTH_CLIENT');
  if (!configured.access_token) missing.push('YOUTUBE_ACCESS_TOKEN');
  if (!configured.refresh_token) missing.push('YOUTUBE_REFRESH_TOKEN');

  return {
    ok: dryRun || missing.length === 0,
    dry_run: dryRun,
    configured,
    missing,
    ready_for_live_upload: !dryRun && missing.length === 0,
    next_steps: dryRun
      ? ['Current mode is dry-run. Validate metadata and agent flow before live uploads.']
      : missing.length
        ? [`Configure missing values: ${missing.join(', ')}`, 'Run youtube-shorts-agent auth-url or your OAuth flow, then rerun doctor.']
        : ['Ready for live YouTube Data API upload calls.']
  };
}

export function buildPrivacyAudit() {
  return {
    project: 'youtube-shorts-agent',
    secrets_returned_to_agent: false,
    oauth_scopes: ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly'],
    local_files_ignored: ['.env', '.agent-data/', '.youtube-oauth-session.json', 'node_modules/', 'coverage/'],
    external_services: ['YouTube Data API v3', 'Google OAuth 2.0'],
    token_storage: 'Environment variables or local .env with user-only file permissions; tokens are never returned by tools.',
    safety_rules: [
      'Dry-run is the default.',
      'Set status.containsSyntheticMedia for AI-generated or AI-edited shorts.',
      'Never commit OAuth client secrets, token files or generated upload artifacts.',
      'Use explicit confirmation before live public upload.',
      'Respect YouTube API Services policies and creator ownership boundaries.'
    ]
  };
}

export function formatMarkdown(title, data) {
  return [`# ${title}`, '', '```json', JSON.stringify(data, null, 2), '```'].join('\n');
}
