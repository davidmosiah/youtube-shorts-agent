import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { YouTubeOfficialAdapter } from '../src/adapters/youtube-official.js';

test('YouTubeOfficialAdapter uploads a Shorts video with resumable upload metadata', async () => {
  const requests = [];
  const tempVideoPath = path.join(os.tmpdir(), `youtube-short-${Date.now()}.mp4`);
  fs.writeFileSync(tempVideoPath, 'video-binary');

  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, options });

    if (url === 'https://upload.youtube.example/resumable') {
      assert.equal(options.method, 'PUT');
      assert.equal(options.headers['Content-Type'], 'video/mp4');
      assert.equal(options.body.toString(), 'video-binary');
      return new Response(JSON.stringify({
        id: 'yt_video_123',
        status: { uploadStatus: 'uploaded' }
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({}), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        location: 'https://upload.youtube.example/resumable'
      }
    });
  };

  const adapter = new YouTubeOfficialAdapter({
    accessToken: 'yt_access_123',
    refreshToken: 'yt_refresh_123',
    clientId: 'yt_client_id',
    clientSecret: 'yt_client_secret',
    dryRun: false,
    baseUrl: 'https://www.googleapis.com',
    privacyStatus: 'public',
    categoryId: '20',
    notifySubscribers: false,
    endpoints: {
      videosInsert: '/upload/youtube/v3/videos',
      oauthToken: 'https://oauth2.googleapis.com/token'
    }
  }, { fetchImpl });

  const result = await adapter.publishDraft({
    id: 'job-youtube-1',
    caption: 'Isso aqui vai pro Shorts #roblox #gaming',
    targetUrl: 'https://robloxdrop.app/posts/roblox-ugc-creator-workflow-2026/',
    mediaPaths: [tempVideoPath],
    metadata: {
      title: 'Meu squad me julgou e depois copiou',
      media_type: 'VIDEO',
      youtube_privacy_status: 'public',
      video_duration_sec: 8,
      video_aspect_ratio: '9:16'
    }
  });

  assert.equal(result.platformPostId, 'yt_video_123');
  assert.equal(result.releaseUrl, 'https://www.youtube.com/watch?v=yt_video_123');
  assert.equal(requests.length, 2);
  assert.match(requests[0].url, /uploadType=resumable/);
  assert.match(requests[0].url, /part=snippet%2Cstatus/);

  const metadata = JSON.parse(requests[0].options.body);
  assert.equal(metadata.snippet.title, 'Meu squad me julgou e depois copiou');
  assert.equal(metadata.status.privacyStatus, 'public');
  assert.equal(metadata.status.containsSyntheticMedia, true);
  assert.equal(metadata.snippet.categoryId, '20');
  assert.ok(metadata.snippet.tags.includes('shorts'));
  assert.ok(metadata.snippet.tags.includes('roblox'));
  assert.match(metadata.snippet.description, /#shorts/i);

  fs.unlinkSync(tempVideoPath);
});

test('YouTubeOfficialAdapter refreshes token on 401 and retries once', async () => {
  const requests = [];
  const refreshed = [];
  const tempVideoPath = path.join(os.tmpdir(), `youtube-short-refresh-${Date.now()}.mp4`);
  fs.writeFileSync(tempVideoPath, 'video-binary');

  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, options });

    if (String(url).includes('/upload/youtube/v3/videos') && options.headers.Authorization === 'Bearer yt_access_old') {
      return new Response(JSON.stringify({
        error: {
          code: 401,
          message: 'Invalid Credentials'
        }
      }), {
        status: 401,
        headers: { 'content-type': 'application/json' }
      });
    }

    if (url === 'https://oauth2.googleapis.com/token') {
      return new Response(JSON.stringify({
        access_token: 'yt_access_new',
        refresh_token: 'yt_refresh_new',
        expires_in: 3600
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }

    if (String(url).includes('/upload/youtube/v3/videos') && options.headers.Authorization === 'Bearer yt_access_new') {
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          location: 'https://upload.youtube.example/resumable-refresh'
        }
      });
    }

    if (url === 'https://upload.youtube.example/resumable-refresh') {
      return new Response(JSON.stringify({ id: 'yt_video_refresh_123' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  };

  const adapter = new YouTubeOfficialAdapter({
    accessToken: 'yt_access_old',
    refreshToken: 'yt_refresh_old',
    clientId: 'yt_client_id',
    clientSecret: 'yt_client_secret',
    dryRun: false,
    baseUrl: 'https://www.googleapis.com',
    privacyStatus: 'public',
    categoryId: '20',
    notifySubscribers: false,
    endpoints: {
      videosInsert: '/upload/youtube/v3/videos',
      oauthToken: 'https://oauth2.googleapis.com/token'
    }
  }, {
    fetchImpl,
    onTokensUpdated: async (tokens) => refreshed.push(tokens)
  });

  const result = await adapter.publishDraft({
    id: 'job-youtube-refresh',
    caption: 'caption #roblox',
    mediaPaths: [tempVideoPath],
    metadata: {
      title: 'title',
      media_type: 'VIDEO',
      video_duration_sec: 8,
      video_aspect_ratio: '9:16'
    }
  });

  assert.equal(result.platformPostId, 'yt_video_refresh_123');
  assert.equal(refreshed.length, 1);
  assert.equal(refreshed[0].accessToken, 'yt_access_new');
  assert.equal(refreshed[0].refreshToken, 'yt_refresh_new');

  fs.unlinkSync(tempVideoPath);
});

test('YouTubeOfficialAdapter lists recent uploaded videos with metrics', async () => {
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url: String(url), options });

    if (String(url).includes('/youtube/v3/channels?')) {
      return new Response(JSON.stringify({
        items: [
          {
            contentDetails: {
              relatedPlaylists: {
                uploads: 'UU_UPLOADS_123'
              }
            }
          }
        ]
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }

    if (String(url).includes('/youtube/v3/playlistItems?')) {
      return new Response(JSON.stringify({
        items: [
          { contentDetails: { videoId: 'yt_one' } },
          { contentDetails: { videoId: 'yt_two' } }
        ]
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }

    if (String(url).includes('/youtube/v3/videos?')) {
      return new Response(JSON.stringify({
        items: [
          {
            id: 'yt_one',
            snippet: {
              title: 'Meu duo me zoou por 5 minutos e depois copiou exatamente isso',
              publishedAt: '2026-03-18T18:38:40Z'
            },
            status: { privacyStatus: 'public' },
            statistics: {
              viewCount: '1946',
              likeCount: '23',
              commentCount: '0'
            }
          },
          {
            id: 'yt_two',
            snippet: {
              title: 'A gente culpava a mira, mas o problema era esse detalhe ridículo',
              publishedAt: '2026-03-19T11:32:53Z'
            },
            status: { privacyStatus: 'public' },
            statistics: {
              viewCount: '9',
              likeCount: '0',
              commentCount: '0'
            }
          }
        ]
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }

    throw new Error(`Unexpected request: ${url}`);
  };

  const adapter = new YouTubeOfficialAdapter({
    accessToken: 'yt_access_123',
    refreshToken: 'yt_refresh_123',
    clientId: 'yt_client_id',
    clientSecret: 'yt_client_secret',
    dryRun: false,
    baseUrl: 'https://www.googleapis.com',
    privacyStatus: 'public',
    categoryId: '20',
    notifySubscribers: false,
    endpoints: {
      oauthToken: 'https://oauth2.googleapis.com/token',
      channelsList: '/youtube/v3/channels',
      playlistItemsList: '/youtube/v3/playlistItems',
      videosList: '/youtube/v3/videos',
      videosInsert: '/upload/youtube/v3/videos'
    }
  }, { fetchImpl });

  const data = await adapter.listRecentVideos({ maxResults: 2 });

  assert.equal(data.items.length, 2);
  assert.deepEqual(data.items[0], {
    id: 'yt_one',
    title: 'Meu duo me zoou por 5 minutos e depois copiou exatamente isso',
    published_at: '2026-03-18T18:38:40Z',
    privacy_status: 'public',
    views: 1946,
    likes: 23,
    comments: 0,
    url: 'https://www.youtube.com/watch?v=yt_one'
  });
  assert.match(requests[0].url, /part=contentDetails/);
  assert.match(requests[1].url, /playlistId=UU_UPLOADS_123/);
  assert.match(requests[2].url, /id=yt_one%2Cyt_two|id=yt_one,yt_two/);
});
