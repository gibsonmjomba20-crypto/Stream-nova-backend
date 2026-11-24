import React, { useEffect, useRef } from 'react';
import Hls from 'hls.js';

export default function VideoPlayer({ videoData }) {
  const videoRef = useRef(null);
  
  // Example videoData structure:
  // { url: "https://...m3u8", referer: "https://vidlink.pro/", title: "Avengers" }
  // NOTE: If you are using your Vercel backend, you can play the video by passing the URL through your proxy:
  // const proxyUrl = `https://stream-nova-backend-z9s5.vercel.app/api/v1/proxy?url=${encodeURIComponent(videoData.url)}&referer=${encodeURIComponent(videoData.referer)}`;

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoData?.url) return;

    let hls;

    if (Hls.isSupported()) {
      hls = new Hls({
        // Inject headers directly into the video requests (no ads!)
        xhrSetup: (xhr) => {
          xhr.setRequestHeader('Referer', videoData.referer || 'https://vidlink.pro/');
          xhr.setRequestHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
        }
      });
      
      // If you prefer using your Vercel proxy (safer), use the proxyUrl here instead of videoData.url
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

  // --- 📥 DOWNLOAD LOGIC ---
  const handleDownload = () => {
    if (!videoData?.url) return;

    // If it's a direct MP4, download it directly
    if (videoData.url.endsWith('.mp4')) {
        const a = document.createElement('a');
        a.href = videoData.url;
        a.download = `${videoData.title || 'video'}.mp4`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        return;
    }

    // If it's an HLS stream (.m3u8), browsers cannot natively download it.
    // We copy the link so the user can paste it into 1DM or VLC.
    alert(`This is an HLS stream. To download it, copy this link and paste it into a download manager like "1DM" or VLC Player:\n\n${videoData.url}`);
    navigator.clipboard.writeText(videoData.url);
  };

  // --- 📺 EXTERNAL PLAYER LOGIC (VLC / MX Player) ---
  const handleOpenExternalPlayer = () => {
    if (!videoData?.url) return;

    const headers = `["Referer: ${videoData.referer || 'https://vidlink.pro/'}", "User-Agent: Mozilla/5.0"]`;
    const encodedTitle = encodeURIComponent(videoData.title || 'Video');
    const cleanUrl = videoData.url.replace(/^https?:\/\//, '');
    
    // Default targeting VLC (package=org.videolan.vlc)
    // Change to package=com.mxtech.videoplayer.ad for MX Player
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
      
      {/* HEADER CONTROLS */}
      <div className="flex justify-between items-center p-4 bg-zinc-900 text-white">
        <h2 className="text-lg font-bold">{videoData.title || 'Now Playing'}</h2>
        
        <div className="flex gap-2">
          {/* EXTERNAL PLAYER BUTTON */}
          <button 
            onClick={handleOpenExternalPlayer}
            className="px-4 py-2 bg-blue-600 rounded text-sm font-semibold hover:bg-blue-700 transition"
          >
            Open in VLC
          </button>

          {/* DOWNLOAD BUTTON */}
          <button 
            onClick={handleDownload}
            className="px-4 py-2 bg-green-600 rounded text-sm font-semibold hover:bg-green-700 transition flex items-center gap-2"
          >
            Download
          </button>
        </div>
      </div>

      {/* VIDEO PLAYER */}
      <div className="relative w-full aspect-video bg-black flex items-center justify-center">
        <video
          ref={videoRef}
          controls
          className="w-full h-full max-h-[80vh]"
        />
      </div>
      
    </div>
  );
}
