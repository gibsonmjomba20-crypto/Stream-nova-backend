import express from 'express';
import axios from 'axios';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

const app = express();
const http = axios.create({ timeout: 8000, maxRedirects: 3 });
const tmdbKey = process.env.TMDB_API || process.env.TMBD;
const hlsAllowedHosts = new Set(
  (process.env.HLS_ALLOWED_HOSTS || '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean),
);

app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '32kb' }));
app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, limit: 120 }));

function sendError(res, status, message) {
  return res.status(status).json({ success: false, error: message });
}

function parsePositiveInteger(value, fallback, maximum) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

app.get('/', (_req, res) => res.json({ status: 'online' }));

app.get('/api/v1/discover', async (req, res) => {
  if (!tmdbKey) return sendError(res, 503, 'TMDB_API is not configured.');

  const type = req.query.type === 'tv' ? 'tv' : 'movie';
  const page = parsePositiveInteger(req.query.page, 1, 500);
  const params = {
    api_key: tmdbKey,
    page,
    sort_by: 'popularity.desc',
  };

  if (typeof req.query.genre === 'string' && /^\d+(,\d+)*$/.test(req.query.genre)) {
    params.with_genres = req.query.genre;
  }
  if (typeof req.query.country === 'string' && /^[A-Z]{2}$/.test(req.query.country)) {
    params.with_origin_country = req.query.country;
  }
  if (req.query.category === 'anime') {
    params.with_genres = '16';
    params.with_original_language = 'ja';
  }

  try {
    const { data } = await http.get(`https://api.themoviedb.org/3/discover/${type}`, { params });
    return res.json({ success: true, page: data.page, results: data.results ?? [] });
  } catch (error) {
    const status = error.response?.status === 401 ? 502 : 502;
    return sendError(res, status, 'TMDB could not complete the request.');
  }
});

app.get(['/api/v1/anime', '/api/v1/anime/extract'], async (req, res) => {
  if (!tmdbKey) return sendError(res, 503, 'TMDB_API is not configured.');

  const page = parsePositiveInteger(req.query.page, 1, 500);
  const title = typeof req.query.title === 'string' ? req.query.title.trim().slice(0, 120) : '';
  const endpoint = title
    ? 'https://api.themoviedb.org/3/search/tv'
    : 'https://api.themoviedb.org/3/discover/tv';
  try {
    const { data } = await http.get(endpoint, {
      params: {
        api_key: tmdbKey,
        page,
        ...(title ? { query: title } : { sort_by: 'popularity.desc' }),
        with_genres: '16',
        with_original_language: 'ja',
      },
    });
    return res.json({ success: true, page: data.page, results: data.results ?? [] });
  } catch {
    return sendError(res, 502, 'Anime catalog is temporarily unavailable.');
  }
});

app.get('/api/v1/player/:id/sources', (_req, res) =>
  sendError(res, 501, 'Stream extraction from third-party sites is not supported. Connect an authorized media provider instead.'),
);

app.get('/api/v1/proxy', async (req, res) => {
  const rawUrl = req.query.url;
  if (typeof rawUrl !== 'string') return sendError(res, 400, 'A playlist URL is required.');

  let target;
  try {
    target = new URL(rawUrl);
  } catch {
    return sendError(res, 400, 'The playlist URL is invalid.');
  }

  if (
    target.protocol !== 'https:' ||
    !target.pathname.toLowerCase().endsWith('.m3u8') ||
    !hlsAllowedHosts.has(target.hostname.toLowerCase())
  ) {
    return sendError(res, 400, 'Only HTTPS playlists on configured HLS_ALLOWED_HOSTS are permitted.');
  }

  const referer = req.query.referer;
  const headers = {};
  if (typeof referer === 'string') {
    try {
      const parsedReferer = new URL(referer);
      if (parsedReferer.protocol === 'https:') headers.Referer = parsedReferer.origin;
    } catch {
      return sendError(res, 400, 'The referer URL is invalid.');
    }
  }

  let upstream;
  try {
    upstream = await http.get(target.toString(), {
      responseType: 'stream',
      headers,
      maxContentLength: 5 * 1024 * 1024,
    });

    res.set({
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
      'Content-Type': upstream.headers['content-type'] || 'application/vnd.apple.mpegurl',
      'X-Content-Type-Options': 'nosniff',
    });
    upstream.data.on('error', () => {
      if (!res.headersSent) sendError(res, 502, 'Playlist stream failed.');
      else res.destroy();
    });
    upstream.data.pipe(res);
    res.on('close', () => upstream.data.destroy());
  } catch {
    upstream?.data?.destroy();
    return sendError(res, 502, 'Playlist provider is temporarily unavailable.');
  }
});

app.get('/api/v1/sports', async (_req, res) => {
  try {
    const { data } = await http.get(
      'https://site.api.espn.com/apis/site/v2/sports/soccer/all/scoreboard',
    );
    const events = (data.events ?? []).map((event) => {
      const competition = event.competitions?.[0] ?? {};
      return {
        id: event.id,
        name: event.name,
        date: event.date,
        status: competition.status?.type?.description ?? 'Scheduled',
        isLive: competition.status?.type?.state === 'in',
        homeTeam: competition.competitors?.find((team) => team.homeAway === 'home')?.team?.displayName ?? null,
        awayTeam: competition.competitors?.find((team) => team.homeAway === 'away')?.team?.displayName ?? null,
      };
    });
    return res.json({ success: true, events });
  } catch {
    return sendError(res, 502, 'Sports scores are temporarily unavailable.');
  }
});

app.use((_req, res) => sendError(res, 404, 'Route not found.'));
app.use((error, _req, res, _next) => {
  if (res.headersSent) return res.end();
  return sendError(res, 500, 'An unexpected server error occurred.');
});

export default app;
