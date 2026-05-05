import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

export function loadDotEnv(cwd = process.cwd(), env = process.env) {
  const envPath = path.join(cwd, '.env');
  if (!fs.existsSync(envPath)) return env;
  for (const raw of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx < 1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!(key in env)) env[key] = value;
  }
  return env;
}

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

export function getConfig({ cwd = process.cwd(), env = process.env } = {}) {
  loadDotEnv(cwd, env);
  return {
    envPath: path.join(cwd, '.env'),
    dataDir: env.YOUTUBE_AGENT_DATA_DIR || path.join(cwd, '.agent-data'),
    youtube: {
      dryRun: bool(env.YOUTUBE_DRY_RUN, true),
      clientId: env.YOUTUBE_CLIENT_ID || '',
      clientSecret: env.YOUTUBE_CLIENT_SECRET || '',
      accessToken: env.YOUTUBE_ACCESS_TOKEN || '',
      refreshToken: env.YOUTUBE_REFRESH_TOKEN || '',
      accessTokenExpiresIn: Number(env.YOUTUBE_ACCESS_TOKEN_EXPIRES_IN || 0),
      baseUrl: env.YOUTUBE_BASE_URL || 'https://www.googleapis.com',
      privacyStatus: env.YOUTUBE_PRIVACY_STATUS || 'public',
      categoryId: env.YOUTUBE_CATEGORY_ID || '22',
      notifySubscribers: bool(env.YOUTUBE_NOTIFY_SUBSCRIBERS, false),
      endpoints: {
        oauthToken: env.YOUTUBE_ENDPOINT_OAUTH_TOKEN || 'https://oauth2.googleapis.com/token',
        videosInsert: env.YOUTUBE_ENDPOINT_VIDEOS_INSERT || '/upload/youtube/v3/videos',
        channelsList: env.YOUTUBE_ENDPOINT_CHANNELS_LIST || '/youtube/v3/channels',
        playlistItemsList: env.YOUTUBE_ENDPOINT_PLAYLIST_ITEMS_LIST || '/youtube/v3/playlistItems',
        videosList: env.YOUTUBE_ENDPOINT_VIDEOS_LIST || '/youtube/v3/videos'
      }
    },
    mcp: {
      host: env.YOUTUBE_MCP_HOST || '127.0.0.1',
      port: Number(env.YOUTUBE_MCP_PORT || 3032),
      allowedOrigin: env.YOUTUBE_MCP_ALLOWED_ORIGIN || ''
    }
  };
}

export function persistEnvValues(envPath, values) {
  const current = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8').split(/\r?\n/) : [];
  const keys = new Set(Object.keys(values));
  const seen = new Set();
  const next = current.map((line) => {
    const idx = line.indexOf('=');
    if (idx < 1) return line;
    const key = line.slice(0, idx);
    if (!keys.has(key)) return line;
    seen.add(key);
    return `${key}=${values[key] ?? ''}`;
  });
  for (const key of keys) {
    if (!seen.has(key)) next.push(`${key}=${values[key] ?? ''}`);
  }
  fs.writeFileSync(envPath, `${next.filter((line) => line !== '').join('\n')}\n`, { mode: 0o600 });
}
