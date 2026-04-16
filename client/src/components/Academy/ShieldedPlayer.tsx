import React, { useEffect, useRef, useState } from 'react';
import { Play, Pause, Volume2, VolumeX, Maximize } from 'lucide-react';

interface ShieldedPlayerProps {
    videoId: string;
    onProgress?: (currentTime: number) => void;
    onEnded?: () => void;
}

declare global {
    interface Window {
        YT: any;
        onYouTubeIframeAPIReady: () => void;
    }
}

export const ShieldedPlayer: React.FC<ShieldedPlayerProps> = ({ videoId, onProgress, onEnded }) => {
    const playerRef = useRef<any>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [isMuted, setIsMuted] = useState(false);
    const [progress, setProgress] = useState(0);

    useEffect(() => {
        // Load YouTube API
        if (!window.YT) {
            const tag = document.createElement('script');
            tag.src = 'https://www.youtube.com/iframe_api';
            const firstScriptTag = document.getElementsByTagName('script')[0];
            firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);
            
            window.onYouTubeIframeAPIReady = initPlayer;
        } else {
            initPlayer();
        }

        function initPlayer() {
            playerRef.current = new window.YT.Player('yt-player', {
                videoId: videoId,
                playerVars: {
                    controls: 0,
                    disablekb: 1,
                    modestbranding: 1,
                    rel: 0,
                    showinfo: 0,
                    iv_load_policy: 3,
                    fs: 0
                },
                events: {
                    onStateChange: onPlayerStateChange
                }
            });
        }

        return () => {
            if (playerRef.current) {
                playerRef.current.destroy();
            }
        };
    }, [videoId]);

    useEffect(() => {
        const interval = setInterval(() => {
            if (playerRef.current && playerRef.current.getCurrentTime && isPlaying) {
                const currentTime = playerRef.current.getCurrentTime();
                const duration = playerRef.current.getDuration();
                if (duration > 0) {
                    setProgress((currentTime / duration) * 100);
                    if (onProgress) onProgress(currentTime);
                }
            }
        }, 1000);
        return () => clearInterval(interval);
    }, [isPlaying, onProgress]);

    const onPlayerStateChange = (event: any) => {
        if (event.data === window.YT.PlayerState.PLAYING) {
            setIsPlaying(true);
        } else if (event.data === window.YT.PlayerState.PAUSED) {
            setIsPlaying(false);
        } else if (event.data === window.YT.PlayerState.ENDED) {
            setIsPlaying(false);
            if (onEnded) onEnded();
        }
    };

    const togglePlay = () => {
        if (playerRef.current) {
            if (isPlaying) {
                playerRef.current.pauseVideo();
            } else {
                playerRef.current.playVideo();
            }
        }
    };

    const toggleMute = () => {
        if (playerRef.current) {
            if (isMuted) {
                playerRef.current.unMute();
            } else {
                playerRef.current.mute();
            }
            setIsMuted(!isMuted);
        }
    };

    const toggleFullscreen = () => {
        if (containerRef.current) {
            if (!document.fullscreenElement) {
                containerRef.current.requestFullscreen().catch(err => {
                    console.error(`Error attempting to enable fullscreen: ${err.message}`);
                });
            } else {
                document.exitFullscreen();
            }
        }
    };

    return (
        <div ref={containerRef} className="relative w-full aspect-video bg-black rounded-xl overflow-hidden group">
            {/* The actual YouTube Iframe */}
            <div id="yt-player" className="absolute top-0 left-0 w-full h-full pointer-events-none"></div>
            
            {/* The Shield Overlay - Blocks right click and interactions */}
            <div 
                className="absolute top-0 left-0 w-full h-[calc(100%-48px)] z-10 cursor-pointer"
                onClick={togglePlay}
                onContextMenu={(e) => e.preventDefault()}
            ></div>

            {/* Custom Controls */}
            <div className="absolute bottom-0 left-0 w-full h-12 bg-gradient-to-t from-black/90 to-transparent flex items-center px-4 z-20 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                <button onClick={togglePlay} className="text-white hover:text-blue-400 transition-colors mr-4">
                    {isPlaying ? <Pause size={20} /> : <Play size={20} />}
                </button>
                
                <button onClick={toggleMute} className="text-white hover:text-blue-400 transition-colors mr-4">
                    {isMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
                </button>

                {/* Progress Bar */}
                <div className="flex-1 h-1.5 bg-white/20 rounded-full mx-4 overflow-hidden">
                    <div 
                        className="h-full bg-blue-500 transition-all duration-200 ease-linear"
                        style={{ width: `${progress}%` }}
                    ></div>
                </div>

                <button onClick={toggleFullscreen} className="text-white hover:text-blue-400 transition-colors ml-4">
                    <Maximize size={20} />
                </button>
            </div>
        </div>
    );
};
