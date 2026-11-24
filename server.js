import 'dotenv/config';
import express from 'express';
import axios from 'axios';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import * as cheerio from 'cheerio';

const app = express();
app.set('trust proxy', 1);

app.use(helmet({ crossOriginResourcePolicy: false, contentSecurityPolicy: false }));
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, max: 300 }));

const TMDB_API = process.env.TMDB_API || '89f2639942a0749f947521e02248fb7c';

// ==========================================
// 1. TMDB Discover
// ==========================================
app.get('/api/v1/discover', async (req, res) => {
    try {
        const { type = 'movie', category = 'trending', page = 1, country, genre, startYear = 1994, endYear = 2030 } = req.query;
        let url = `https://api.themoviedb.org/3/discover/${type}?api_key=${TMDB_API}&page=${page}`;
        if (category === 'trending') { url += `&sort_by=vote_count.desc`; } else { url += `&sort_by=popularity.desc`; }
        
        const dateField = type === 'movie' ? 'primary_release_date' : 'first_air_date';
        url += `&${dateField}.gte=${startYear}-01-01&${dateField}.lte=${endYear}-12-31`;
        
        if (category === 'anime') url += `&with_genres=16&with_original_language=ja`;
        if (country && country !== 'all') url += `&with_origin_country=${country}`;
        if (genre && genre !== 'all') url += `&with_genres=${genre}`;

        const response = await axios.get(url, { timeout: 8000 });
        res.json({ success: true, page: parseInt(page), results: response.data.results });
    } catch (error) { 
        res.status(500).json({ success: false, error: "TMDB unavailable" }); 
    }
});

// ==========================================
// 2. Ad-Free Player Sources (VidLink + VidSrc)
// ==========================================
app.get('/api/v1/player/:id/sources', async (req, res) => {
    const { id } = req.params;
    const { type = 'movie', season = 1, episode = 1 } = req.query;
    const sources = [];

    // Try VidLink First (Fast, Direct HLS)
    try {
        const url = type === 'movie' 
            ? `https://vidlink.pro/api/b/movie/${id}`
            : `https://vidlink.pro/api/b/tv/${id}/${season}/${episode}`;
        const { data } = await axios.get(url, { timeout: 8000 });
        if (data?.stream?.playlist) {
            sources.push({
                provider: 'VidLink',
                url: data.stream.playlist,
                type: 'hls',
                referer: 'https://vidlink.pro/'
            });
        }
    } catch (e) { /* Move to next */ }

    // Fallback: Try VidSrc
    if (sources.length === 0) {
        try {
            const url = type === 'movie'
                ? `https://vidsrc.xyz/embed/movie/${id}`
                : `https://vidsrc.xyz/embed/tv/${id}/${season}/${episode}`;
            const { data } = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000 });
            const match = data.match(/src:\s*'([^']*\.m3u8)'/);
            if (match) {
                sources.push({
                    provider: 'VidSrc',
                    url: match[1],
                    type: 'hls',
                    referer: 'https://vidsrc.xyz/'
                });
            }
        } catch (e) { /* Failed */ }
    }

    if (sources.length > 0) {
        res.json({ success: true, sources });
    } else {
        res.status(404).json({ success: false, error: "No streams found for this title." });
    }
});

// ==========================================
// 3. Anime API
// ==========================================
app.get('/api/v1/anime/extract', async (req, res) => {
    const { title, episode = 1, dub = 'true' } = req.query;
    if (!title) return res.status(400).json({ error: "Title required" });
    
    try {
        const API = "https://hianime-api-iy4s.onrender.com/api";
        const search = await axios.get(`${API}/search`, { params: { keyword: title, page: 1 }, timeout: 8000 });
        if (!search.data?.animes?.length) return res.status(404).json({ success: false, error: "Anime not found" });
        
        const epList = await axios.get(`${API}/episodes/${search.data.animes[0].id}`, { timeout: 8000 });
        const targetEp = epList.data.episodes.find(e => e.number === parseInt(episode)) || epList.data.episodes[0];
        
        const servers = await axios.get(`${API}/servers`, { params: { id: targetEp.id }, timeout: 8000 });
        const serverList = (dub === 'true' && servers.data.dub?.length > 0) ? servers.data.dub : servers.data.sub;
        
        if (!serverList?.length) return res.status(404).json({ success: false, error: "No servers found" });

        const stream = await axios.get(`${API}/stream`, { params: { id: targetEp.id, type: dub === 'true' ? 'dub' : 'sub', server: serverList[0].name }, timeout: 8000 });
        const source = stream.data.sources.find(s => s.isM3U8) || stream.data.sources[0];
        
        if (!source) throw new Error("Stream link not found");

        res.json({ 
            success: true, 
            provider: `HiAnime (${serverList[0].name})`, 
            title: search.data.animes[0].title, 
            streamUrl: source.url, 
            headers: source.headers || { "Referer": "https://hianime.to/" }, 
            type: 'hls' 
        });
    } catch (error) { 
        res.status(500).json({ success: false, error: "Anime API timed out." }); 
    }
});

// ==========================================
// 4. Sports
// ==========================================
app.get('/api/v1/sports', async (req, res) => {
    try {
        const espn = await axios.get('https://site.api.espn.com/apis/site/v2/sports/soccer/all/scoreboard', { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const events = (espn.data.events || []).map(e => {
            const c = e.competitions?.[0] || {};
            const status = c.status?.type?.description || 'Scheduled';
            return { id: e.id, name: e.name, date: e.date, status, isLive: status === 'In Progress', homeTeam: c.competitors?.find(x => x.homeAway === 'home')?.team?.displayName, awayTeam: c.competitors?.find(x => x.homeAway === 'away')?.team?.displayName };
        });
        res.json({ success: true, events });
    } catch (e) { res.status(500).json({ success: false, error: "Sports failed" }); }
});

// ==========================================
// 5. Proxy Route (Bypasses CORS/403 for Frontend)
// ==========================================
app.get('/api/v1/proxy', async (req, res) => {
    const { url, referer } = req.query;
    if (!url) return res.status(400).send('URL required');

    try {
        const response = await axios({
            method: 'get',
            url: url,
            responseType: 'stream',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                'Referer': referer || 'https://vidlink.pro/',
                'Origin': referer || 'https://vidlink.pro/'
            }
        });
        res.setHeader('Content-Type', response.headers['content-type'] || 'application/vnd.apple.mpegurl');
        res.setHeader('Access-Control-Allow-Origin', '*');
        response.data.pipe(res);
    } catch (error) {
        res.status(500).send('Proxy Error');
    }
});

app.get('/', (req, res) => res.json({ status: "online" }));

export default app;
