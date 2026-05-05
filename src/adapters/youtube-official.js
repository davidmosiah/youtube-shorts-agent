import fs from 'node:fs';

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v', '.webm']);

export class YouTubeOfficialAdapter {
  constructor(cfg, { fetchImpl = fetch, onTokensUpdated = null } = {}) {
    this.cfg = cfg;
    this.fetchImpl = fetchImpl;
    this.onTokensUpdated = onTokensUpdated;
    this.refreshPromise = null;
  }

  async publishDraft(job) {
    if (this.cfg.dryRun) {
      return {
        provider: 'youtube_official',
        platformPostId: `dryrun_${Date.now()}`,
        releaseUrl: 'https://www.youtube.com',
        raw: { dryRun: true, jobId: job.id }
      };
    }

    this.#assertConfig();
    this.#assertJob(job);

    const filePath = job.mediaPaths[0];
    const stat = fs.statSync(filePath);
    const metadata = this.#buildMetadata(job);

    const location = await this.#initResumableUpload({
      metadata,
      filePath,
      size: stat.size,
      notifySubscribers: this.#resolveNotifySubscribers(job)
    });

    const data = await this.#uploadVideoFile({
      location,
      filePath,
      size: stat.size,
      contentType: this.#contentTypeForFile(filePath)
    });

    const videoId = data?.id || null;
    return {
      provider: 'youtube_official',
      platformPostId: videoId,
      releaseUrl: videoId ? `https://www.youtube.com/watch?v=${videoId}` : '',
      raw: data
    };
  }

  async listRecentVideos({ maxResults = 10 } = {}) {
    if (this.cfg.dryRun) {
      return { items: [] };
    }

    this.#assertConfig();

    const channelsUrl = new URL(this.cfg.endpoints.channelsList, this.cfg.baseUrl);
    channelsUrl.searchParams.set('part', 'contentDetails');
    channelsUrl.searchParams.set('mine', 'true');
    const channels = await this.#requestJson(channelsUrl.toString());
    const uploadsPlaylistId = channels?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploadsPlaylistId) {
      return { items: [] };
    }

    const playlistUrl = new URL(this.cfg.endpoints.playlistItemsList, this.cfg.baseUrl);
    playlistUrl.searchParams.set('part', 'contentDetails');
    playlistUrl.searchParams.set('playlistId', uploadsPlaylistId);
    playlistUrl.searchParams.set('maxResults', String(Math.max(1, Math.min(50, Number(maxResults) || 10))));
    const playlist = await this.#requestJson(playlistUrl.toString());
    const ids = (playlist?.items || [])
      .map((item) => item?.contentDetails?.videoId)
      .filter(Boolean);

    if (!ids.length) {
      return { items: [] };
    }

    const videosUrl = new URL(this.cfg.endpoints.videosList, this.cfg.baseUrl);
    videosUrl.searchParams.set('part', 'snippet,statistics,status');
    videosUrl.searchParams.set('id', ids.join(','));
    const videos = await this.#requestJson(videosUrl.toString());

    return {
      items: (videos?.items || []).map((item) => ({
        id: item.id,
        title: item?.snippet?.title || '',
        published_at: item?.snippet?.publishedAt || '',
        privacy_status: item?.status?.privacyStatus || '',
        views: Number(item?.statistics?.viewCount || 0),
        likes: Number(item?.statistics?.likeCount || 0),
        comments: Number(item?.statistics?.commentCount || 0),
        url: item?.id ? `https://www.youtube.com/watch?v=${item.id}` : ''
      }))
    };
  }

  #assertConfig() {
    if (!this.cfg.accessToken) throw new Error('Missing YOUTUBE_ACCESS_TOKEN');
    if (!this.cfg.clientId) throw new Error('Missing YOUTUBE_CLIENT_ID');
    if (!this.cfg.clientSecret) throw new Error('Missing YOUTUBE_CLIENT_SECRET');
  }

  #assertJob(job) {
    if (!Array.isArray(job.mediaPaths) || job.mediaPaths.length !== 1) {
      throw new Error('YouTube publishing requires exactly one video file');
    }
    const filePath = job.mediaPaths[0];
    if (!VIDEO_EXTENSIONS.has(this.#ext(filePath))) {
      throw new Error('YouTube publishing currently supports only video files');
    }
  }

  #buildMetadata(job) {
    const title = this.#resolveTitle(job);
    const description = this.#resolveDescription(job);
    const tags = this.#extractTags(job);
    return {
      snippet: {
        title,
        description,
        categoryId: String(job.metadata?.youtube_category_id || this.cfg.categoryId || '20'),
        ...(tags.length ? { tags } : {})
      },
      status: {
        privacyStatus: this.#resolvePrivacyStatus(job),
        selfDeclaredMadeForKids: Boolean(job.metadata?.youtube_made_for_kids || false),
        containsSyntheticMedia: Boolean(
          job.metadata?.youtube_contains_synthetic_media ?? true
        )
      }
    };
  }

  #resolveTitle(job) {
    const raw = String(job.metadata?.youtube_title || job.metadata?.title || job.caption || '').trim();
    if (!raw) throw new Error('Missing YouTube title');
    return raw.slice(0, 100);
  }

  #resolveDescription(job) {
    const caption = String(job.caption || '').trim();
    const targetUrl = String(job.targetUrl || job.articleUrl || '').trim();
    const blocks = [];
    if (caption) blocks.push(caption);
    if (targetUrl && !caption.includes(targetUrl)) blocks.push(targetUrl);
    let description = blocks.join('\n\n').trim();
    if (this.#isShort(job) && !/#shorts\b/i.test(description)) {
      description = [description, '#shorts'].filter(Boolean).join('\n\n');
    }
    return description.slice(0, 5000);
  }

  #extractTags(job) {
    const explicit = Array.isArray(job.metadata?.youtube_tags)
      ? job.metadata.youtube_tags.map((tag) => String(tag).trim().replace(/^#/, ''))
      : [];
    const hashtags = [...String(job.caption || '').matchAll(/#([a-z0-9_]+)/gi)]
      .map((match) => match[1].trim().toLowerCase());
    const base = [...explicit, ...hashtags];
    if (this.#isShort(job)) {
      base.push('shorts');
    }
    return [...new Set(base.filter(Boolean))].slice(0, 15);
  }

  #resolvePrivacyStatus(job) {
    return String(
      job.metadata?.youtube_privacy_status || this.cfg.privacyStatus || 'public'
    ).trim().toLowerCase();
  }

  #resolveNotifySubscribers(job) {
    if (typeof job.metadata?.youtube_notify_subscribers === 'boolean') {
      return job.metadata.youtube_notify_subscribers;
    }
    return Boolean(this.cfg.notifySubscribers);
  }

  #isShort(job) {
    const duration = Number(job.metadata?.video_duration_sec || 0);
    const ratio = String(job.metadata?.video_aspect_ratio || '').trim();
    return duration > 0 && duration <= 60 && (ratio === '9:16' || ratio === 'vertical');
  }

  async #initResumableUpload({ metadata, filePath, size, notifySubscribers }) {
    const url = new URL(this.cfg.endpoints.videosInsert, this.cfg.baseUrl);
    url.searchParams.set('uploadType', 'resumable');
    url.searchParams.set('part', 'snippet,status');
    url.searchParams.set('notifySubscribers', String(Boolean(notifySubscribers)));

    const res = await this.#request(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Length': String(size),
        'X-Upload-Content-Type': this.#contentTypeForFile(filePath)
      },
      body: JSON.stringify(metadata)
    });

    const location = res.headers.get('location');
    if (!location) {
      const text = await res.text();
      throw new Error(`YouTube resumable upload init missing location header: ${text.slice(0, 300)}`);
    }
    return location;
  }

  async #uploadVideoFile({ location, filePath, size, contentType }) {
    const buffer = fs.readFileSync(filePath);
    const res = await this.fetchImpl(location, {
      method: 'PUT',
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(size)
      },
      body: buffer
    });

    const text = await res.text();
    let json = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`YouTube upload response is not JSON: ${text.slice(0, 300)}`);
    }

    if (!res.ok) {
      throw new Error(`YouTube upload failed ${res.status}: ${JSON.stringify(json).slice(0, 400)}`);
    }

    return json;
  }

  async #request(url, options = {}, allowRetry = true) {
    const res = await this.fetchImpl(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.cfg.accessToken}`,
        ...(options.headers || {})
      }
    });

    if (res.status === 401 && allowRetry && this.cfg.refreshToken) {
      await this.#refreshAccessToken();
      return this.#request(url, options, false);
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`YouTube API ${res.status}: ${text.slice(0, 400)}`);
    }

    return res;
  }

  async #requestJson(url, options = {}, allowRetry = true) {
    const res = await this.#request(url, options, allowRetry);
    return res.json();
  }

  async #refreshAccessToken() {
    if (this.refreshPromise) {
      await this.refreshPromise;
      return;
    }

    this.refreshPromise = (async () => {
      const body = new URLSearchParams({
        client_id: this.cfg.clientId,
        client_secret: this.cfg.clientSecret,
        refresh_token: this.cfg.refreshToken,
        grant_type: 'refresh_token'
      }).toString();

      const res = await this.fetchImpl(this.cfg.endpoints.oauthToken, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body
      });
      const json = await res.json();
      if (!res.ok || !json?.access_token) {
        throw new Error(`YouTube token refresh failed: ${JSON.stringify(json).slice(0, 400)}`);
      }

      this.cfg.accessToken = json.access_token;
      if (json.refresh_token) {
        this.cfg.refreshToken = json.refresh_token;
      }

      if (this.onTokensUpdated) {
        await this.onTokensUpdated({
          accessToken: this.cfg.accessToken,
          refreshToken: this.cfg.refreshToken,
          accessTokenExpiresIn: Number(json.expires_in || 0)
        });
      }
    })();

    try {
      await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  #contentTypeForFile(filePath) {
    const ext = this.#ext(filePath);
    if (ext === '.mp4' || ext === '.m4v') return 'video/mp4';
    if (ext === '.mov') return 'video/quicktime';
    if (ext === '.webm') return 'video/webm';
    return 'application/octet-stream';
  }

  #ext(filePath) {
    const idx = String(filePath).lastIndexOf('.');
    return idx > -1 ? String(filePath).slice(idx).toLowerCase() : '';
  }
}
