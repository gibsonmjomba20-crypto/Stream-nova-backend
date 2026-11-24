import React, { useEffect, useRef } from 'react';
import Hls from 'hls.js';

export default function VideoPlayer({ videoData }) {
  const videoRef = useRef(null);
  
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoData?.url) return;

    let hls;

    if (Hls.isSupported()) {
      hls = new Hls({
        // Injects headers so the CDN doesn't block us (403 error)
        xhrSetup: (xhr) => {
          xhr.setRequestHeader('Referer', videoData.referer || 'https://vidlink.pro/');
          xhr.setRequestHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
        }
      });
      
      // We use the direct URL, but if it buffers, use the Proxy: 
      // hls.loadSource(`https://stream-nova-backend-q5vb.vercel.app/api/v1/proxy?url=${encodeURIComponent(videoData.url)}&referer=${encodeURIComponent(videoData.referer)}`);
      
      hls.loadSource(videoData.url); 
      hls.attachMedia(video);
      
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(e => console.log("Autoplay blocked by browser"));
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = videoData.url;
    }

    return () => {
      if (hls) hls.destroy();
    };
  }, [videoData]);

  // 📥 Download Logic
  const handleDownload = () => {
    if (!videoData?.url) return;
    alert(`To download this video, copy this link and paste it into 1DM or VLC:\n\n${videoData.url}`);
    navigator.clipboard.writeText(videoData.url);
  };

  // 📺 External Player Logic (VLC / MX Player)
  const handleOpenExternalPlayer = () => {
    if (!videoData?.url) return;

    const headers = `["Referer: ${videoData.referer || 'https://vidlink.pro/'}", "User-Agent: Mozilla/5.0"]`;
    const encodedTitle = encodeURIComponent(videoData.title || 'Video');
    const cleanUrl = videoData.url.replace(/^https?:\/\//, '');
    
    // Target VLC Player by default
    const intentUrl = `intent://${cleanUrl}#Intent;scheme=https;type=video/*;package=org.videolan.vlc;S.title=${encodedTitle};S.headers=${headers};end`;

    try {
      window.location.href = intentUrl;
    } catch (error) {
      alert("Could not open VLC. Please make sure VLC is installed on your device.");
    }
  };

  if (!videoData) return <div className="text-white text-center p-8">Loading stream...</div>;

  return (
    <div className="flex flex-col w-full bg-black min-h-screen">
      <div className="flex justify-between items-center p-4 bg-zinc-900 text-white">
        <h2 className="text-lg font-bold">{videoData.title || 'Now Playing'}</h2>
        
        <div className="flex gap-2">
          <button onClick={handleOpenExternalPlayer} className="px-4 py-2 bg-blue-600 rounded text-sm font-semibold hover:bg-blue-700">
            Open in VLC
          </button>
          <button onClick={handleDownload} className="px-4 py-2 bg-green-600 rounded text-sm font-semibold hover:bg-green-700">
            Download
          </button>
        </div>
      </div>

      <div className="relative w-full aspect-video bg-black flex items-center justify-center">
        <video ref={videoRef} controls className="w-full h-full max-h-[80vh]" />
      </div>
    </div>
  );
}
