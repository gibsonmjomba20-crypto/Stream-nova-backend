import 'dotenv/config';
import express from 'express';
import axios from 'axios';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { getVidLinkProVideo } from 'vidsrc-bypass';

const app = express();
app.set('trust proxy', 1);

app.use(helmet({ crossOriginResourcePolicy: false, contentSecurityPolicy: false }));
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, max: 300 }));

const TMDB_API = process.env.TMDB_API || '89f2639942a0749f947521e02248fb7c';

// 1. TMDB Discover
app.get('/api/v1/discover', async (req, res) => {
    try {
        const { type = 'movie', category = 'trending', page = 1 } = req.query;
        let url = `https://api.themoviedb.org/3/discover/${type}?api_key=${TMDB_API}&page=${page}`;
        if (category === 'trending') url += `&sort_by=vote_count.desc`;
        const response = await axios.get(url, { timeout: 8000 });
        res.json({ success: true, page: parseInt(page), results: response.data.results });
    } catch (error) { 
        res.status(500).json({ success: false, error: "TMDB unavailable" }); 
    }
});

// 2. Player Sources (Using vidsrc-bypass)
app.get('/api/v1/player/:id/sources', async (req, res) => {
    const { id } = req.params;
    const { type = 'movie', season = 1, episode = 1 } = req.query;
    const sources = [];

    try {
        const params = { id: String(id), type, fallback: true };
        if (type === 'tv') {
            params.season = parseInt(season, 10);
            params.episode = parseInt(episode, 10);
        }

        const videoData = await getVidLinkProVideo(params);
        const streamList = Array.isArray(videoData) ? videoData : [videoData];

        for (const stream of streamList) {
            if (stream && stream.file) {
                sources.push({
                    provider: stream.label || 'VidLink',
                    url: stream.file,
                    type: 'hls',
                    referer: 'https://vidlink.pro/'
                });
            }
        }
    } catch (e) { console.log("Extraction failed:", e.message); }

    if (sources.length > 0) res.json({ success: true, sources });
    else res.status(404).json({ success: false, error: "No streams found." });
});

// 3. Secure Proxy Route (Prevents SSRF)
app.get('/api/v1/proxy', async (req, res) => {
    const { url, referer } = req.query;
    if (!url) return res.status(400).send('URL required');

    // Security patch: Only allow requests to trusted streaming domains
    const allowedHosts = ['vidlink.pro', 'vidsrc.xyz', 'mux.dev'];
    const targetHost = new URL(url).hostname;
    if (!allowedHosts.some(host => targetHost.includes(host))) {
        return res.status(403).send('Forbidden: Unauthorized host');
    }

    try {
        const response = await axios({
            method: 'get', url: url, responseType: 'stream',
            headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': referer || 'https://vidlink.pro/' }
        });
        res.setHeader('Content-Type', response.headers['content-type'] || 'application/vnd.apple.mpegurl');
        res.setHeader('Access-Control-Allow-Origin', '*');
        response.data.pipe(res);
    } catch (error) { res.status(500).send('Proxy Error'); }
});

// 4. Anime (External API)
app.get('/api/v1/anime/extract', async (req, res) => {
    const { title, episode = 1, dub = 'true' } = req.query;
    if (!title) return res.status(400).json({ error: "Title required" });
    try {
        const API = "https://hianime-api-iy4s.onrender.com/api";
        const search = await axios.get(`${API}/search`, { params: { keyword: title, page: 1 }, timeout: 9000 });
        if (!search.data?.animes?.length) return res.status(404).json({ success: false, error: "Anime not found" });
        
        const epList = await axios.get(`${API}/episodes/${search.data.animes[0].id}`, { timeout: 9000 });
        const targetEp = epList.data.episodes.find(e => e.number === parseInt(episode)) || epList.data.episodes[0];
        
        const servers = await axios.get(`${API}/servers`, { params: { id: targetEp.id }, timeout: 9000 });
        const serverList = (dub === 'true' && servers.data.dub?.length > 0) ? servers.data.dub : servers.data.sub;
        
        const stream = await axios.get(`${API}/stream`, { params: { id: targetEp.id, type: dub === 'true' ? 'dub' : 'sub', server: serverList[0].name }, timeout: 9000 });
        const source = stream.data.sources.find(s => s.isM3U8) || stream.data.sources[0];

        res.json({ success: true, provider: `HiAnime`, title: search.data.animes[0].title, streamUrl: source.url, headers: source.headers || { "Referer": "https://hianime.to/" }, type: 'hls' });
    } catch (error) { res.status(500).json({ success: false, error: "Anime API timed out." }); }
});

// 5. Sports
app.get('/api/v1/sports', async (req, res) => {
    try {
        const espn = await axios.get('https://site.api.espn.com/apis/site/v2/sports/soccer/all/scoreboard', { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const events = (espn.data.events || []).map(e => {
            const c = e.competitions?.[0] || {};
            return { id: e.id, name: e.name, date: e.date, status: c.status?.type?.description || 'Scheduled', isLive: c.status?.type?.description === 'In Progress', homeTeam: c.competitors?.find(x => x.homeAway === 'home')?.team?.displayName, awayTeam: c.competitors?.find(x => x.homeAway === 'away')?.team?.displayName };
        });
        res.json({ success: true, events });
    } catch (e) { res.status(500).json({ success: false, error: "Sports failed" }); }
});

app.get('/', (req, res) => res.json({ status: "online" }));

export default app;
