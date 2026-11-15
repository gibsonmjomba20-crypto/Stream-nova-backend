const express = require('express');
const axios = require('axios');
const cors = require('cors');
const scraper = require('liyanaarachchi-thenkiri-scrap');

const app = express();
app.use(cors());
app.use(express.json());

const TMDB_API = '04c35731a5ee918f014970082a0088b1';

// 1. DYNAMIC PROXY ENGINE (Ad-Stripping)
app.get('/proxy', async (req, res) => {
    let targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('Missing URL');
    if (!targetUrl.startsWith('http')) targetUrl = Buffer.from(targetUrl, 'base64').toString('utf8');

    const isM3U8 = targetUrl.includes('.m3u8');
    const HEADERS = { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 
        'Accept': '*/*', 
        'Origin': new URL(targetUrl).origin, 
        'Referer': new URL(targetUrl).origin + '/' 
    };

    const currentHost = req.get('host');
    const protocol = req.protocol;

    try {
        if (isM3U8) {
            const response = await axios.get(targetUrl, { headers: HEADERS });
            let m3u8Text = response.data;
            const lines = m3u8Text.split('\n');
            const newLines = [];
            for (let line of lines) {
                line = line.trim();
                if (line.startsWith('#EXTINF:')) {
                    const duration = parseFloat(line.split(':')[1].split(',')[0]);
                    if (duration < 6.0) continue; // Strip short ads
                }
                if (line && !line.startsWith('#')) {
                    const absoluteUrl = new URL(line, targetUrl).href;
                    const encodedUrl = Buffer.from(absoluteUrl).toString('base64');
                    line = `${protocol}://${currentHost}/proxy?url=${encodedUrl}`;
                }
                newLines.push(line);
            }
            res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
            res.setHeader('Access-Control-Allow-Origin', '*');
            return res.send(newLines.join('\n'));
        } else {
            const range = req.headers.range;
            if (range) HEADERS['Range'] = range;
            const response = await axios({ method: 'GET', url: targetUrl, headers: HEADERS, responseType: 'stream' });
            res.setHeader('Content-Type', response.headers['content-type'] || 'video/mp4');
            if (response.headers['content-range']) { res.setHeader('Content-Range', response.headers['content-range']); res.status(206); }
            res.setHeader('Access-Control-Allow-Origin', '*');
            response.data.pipe(res);
        }
    } catch (error) { res.status(500).send('Stream blocked'); }
});

// 2. DISCOVERY (Hulu Categories + Asian Dramas)
app.get('/api/discover', async (req, res) => {
    try {
        const { type = 'movie', category, page = 1, country, lang } = req.query;
        let url = `https://api.themoviedb.org/3/discover/${type}?api_key=${TMDB_API}&page=${page}`;

        if (category === 'trending') url = `https://api.themoviedb.org/3/trending/${type}/week?api_key=${TMDB_API}&page=${page}`;
        else if (category === 'top_rated') url += `&sort_by=vote_average.desc&vote_count.gte=200`;
        else if (category === 'popular') url += `&sort_by=popularity.desc`;
        else if (category === 'dubbed') url += `&with_original_language=ja|ko|zh|fr|es|hi|tr&with_spoken_languages=en&sort_by=popularity.desc`;
        
        // Asian Dramas (Forced TV type)
        else if (category === 'kdrama') url = `https://api.themoviedb.org/3/discover/tv?api_key=${TMDB_API}&with_origin_country=KR&sort_by=popularity.desc&page=${page}`;
        else if (category === 'chdrama') url = `https://api.themoviedb.org/3/discover/tv?api_key=${TMDB_API}&with_origin_country=CN&sort_by=popularity.desc&page=${page}`;
        else if (category === 'thaidrama') url = `https://api.themoviedb.org/3/discover/tv?api_key=${TMDB_API}&with_origin_country=TH&sort_by=popularity.desc&page=${page}`;
        
        else url += `&sort_by=popularity.desc`;

        if (country) url += `&with_origin_country=${country}`;
        if (lang && category !== 'dubbed') url += `&with_original_language=${lang}`;

        const response = await axios.get(url, { timeout: 5000 });
        res.json({ results: response.data.results });
    } catch (error) { res.status(500).json({ error: "API Error" }); }
});

// 3. DETAILS
app.get('/api/details', async (req, res) => {
    try {
        const { id, type } = req.query;
        const url = `https://api.themoviedb.org/3/${type}/${id}?api_key=${TMDB_API}&append_to_response=credits,similar,videos`;
        const response = await axios.get(url, { timeout: 5000 });
        res.json(response.data);
    } catch (error) { res.status(500).json({ error: "Failed to load details" }); }
});

// 4. SEARCH
app.get('/api/search', async (req, res) => {
    try {
        const query = req.query.q;
        const response = await axios.get(`https://api.themoviedb.org/3/search/multi?api_key=${TMDB_API}&query=${encodeURIComponent(query)}`, { timeout: 5000 });
        res.json({ results: response.data.results });
    } catch (error) { res.status(500).json({ error: "Search failed" }); }
});

// 5. LIVE SPORTS
app.get('/api/sports', async (req, res) => {
    try {
        const liveRes = await axios.get('https://www.thesportsdb.com/api/v1/json/3/livescore.php?s=Soccer');
        const upcomingRes = await axios.get('https://www.thesportsdb.com/api/v1/json/3/eventsnextleague.php?id=4328');
        res.json({ live: liveRes.data.events || [], upcoming: upcomingRes.data.events || [] });
    } catch (error) { res.status(500).json({ error: "Failed to load sports data" }); }
});

// 6. ULTIMATE STREAM WATERFALL (4 Native Scrapers -> Iframe)
app.get('/api/stream', async (req, res) => {
    const { id, type, title, season = 1, episode = 1 } = req.query;
    const currentHost = req.get('host');
    const protocol = req.protocol;
    const proxyBase = `${protocol}://${currentHost}/proxy?url=`;

    // 1. VidLink
    try {
        let vidLinkUrl = `https://vidlink.pro/api/b/${type}/${id}`;
        if (type === 'tv') vidLinkUrl += `/${season}/${episode}`;
        const vidLinkRes = await axios.get(vidLinkUrl, { timeout: 4000 });
        if (vidLinkRes.data?.stream?.playlist) {
            return res.json({ success: true, mode: 'native', streamUrl: `${proxyBase}${encodeURIComponent(vidLinkRes.data.stream.playlist)}` });
        }
    } catch (e) { }

    // 2. Nkiri
    if (type === 'movie') {
        try {
            const results = await scraper.searchMovie(title);
            if (results && results.length > 0) {
                const options = await scraper.getDownloadOptions(results[0].link);
                if (options && options.length > 0) {
                    const directLink = await scraper.bypassDownloadwella(options[0].link);
                    return res.json({ success: true, mode: 'native', streamUrl: `${proxyBase}${encodeURIComponent(directLink)}` });
                }
            }
        } catch (e) { }
    }

    // 3. VidSrc.cc API
    try {
        let vidsrcApi = `https://vidsrc.cc/api/source/${id}`;
        if (type === 'tv') vidsrcApi = `https://vidsrc.cc/api/source/${id}?s=${season}&e=${episode}`;
        const vidsrcRes = await axios.get(vidsrcApi, { timeout: 4000 });
        if (vidsrcRes.data?.data?.source) {
            return res.json({ success: true, mode: 'native', streamUrl: `${proxyBase}${encodeURIComponent(vidsrcRes.data.data.source)}` });
        }
    } catch (e) { }

    // 4. SuperEmbed API
    try {
        let superEmbedApi = `https://multiembed.mov/directstream.php?video_id=${id}&tmdb=1`;
        if (type === 'tv') superEmbedApi += `&s=${season}&e=${episode}`;
        const superRes = await axios.get(superEmbedApi, { timeout: 4000 });
        const match = superRes.data.match(/(https?:\/\/[^"']+\.m3u8[^"']*)/);
        if (match && match[0]) {
            return res.json({ success: true, mode: 'native', streamUrl: `${proxyBase}${encodeURIComponent(match[0])}` });
        }
    } catch (e) { }

    // 5. IFRAME FALLBACK
    let iframeUrls = type === 'movie' 
        ? [`https://vidsrc.to/embed/movie/${id}`, `https://vidsrc.xyz/embed/movie/${id}`, `https://www.2embed.cc/embed/${id}`]
        : [`https://vidsrc.to/embed/tv/${id}/${season}/${episode}`, `https://vidsrc.xyz/embed/tv/${id}/${season}/${episode}`, `https://www.2embed.cc/embedtv/${id}&s=${season}&e=${episode}`];

    return res.json({ success: true, mode: 'iframe', iframeUrls: iframeUrls });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 SERVER running on port ${PORT}`));
