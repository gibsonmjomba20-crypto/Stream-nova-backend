 import axios from 'axios';

export async function getDirectStream(tmdbId, type, season, episode) {
    const sources = [];

    // 1. Try VidLink (Fast, direct .m3u8, highly reliable)
    try {
        const url = type === 'movie' 
            ? `https://vidlink.pro/api/b/movie/${tmdbId}`
            : `https://vidlink.pro/api/b/tv/${tmdbId}/${season}/${episode}`;
        const { data } = await axios.get(url, { timeout: 8000 });
        if (data?.stream?.playlist) {
            sources.push({
                provider: 'VidLink',
                url: data.stream.playlist,
                type: 'hls',
                referer: 'https://vidlink.pro/'
            });
        }
    } catch (e) { /* Ignore and try next */ }

    // 2. Try VidSrc (Fallback scraper)
    if (sources.length === 0) {
        try {
            const url = type === 'movie'
                ? `https://vidsrc.xyz/embed/movie/${tmdbId}`
                : `https://vidsrc.xyz/embed/tv/${tmdbId}/${season}/${episode}`;
            
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

    return sources; 
}
