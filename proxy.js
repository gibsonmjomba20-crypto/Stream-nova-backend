import express from 'express';
import axios from 'axios';

const router = express.Router();

router.get('/m3u8-proxy', async (req, res) => {
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

        // Forward content type and CORS headers
        res.setHeader('Content-Type', response.headers['content-type'] || 'application/vnd.apple.mpegurl');
        res.setHeader('Access-Control-Allow-Origin', '*');
        
        // Pipe the video stream to the frontend
        response.data.pipe(res);
    } catch (error) {
        console.error("Proxy Error:", error.message);
        res.status(500).send('Proxy Error');
    }
});

export default router; 
