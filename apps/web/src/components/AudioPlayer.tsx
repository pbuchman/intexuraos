/**
 * Audio player component for WhatsApp audio messages.
 * Fetches signed URL and displays HTML5 audio player.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Pause, Loader2, AlertCircle } from 'lucide-react';
import { getMessageMediaUrl, ApiError } from '@/services';

interface AudioPlayerProps {
  messageId: string;
  accessToken: string;
}

export function AudioPlayer({ messageId, accessToken }: AudioPlayerProps): React.JSX.Element {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);

  const fetchAudioUrl = useCallback(async (): Promise<void> => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await getMessageMediaUrl(accessToken, messageId);
      setAudioUrl(response.url);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load audio');
    } finally {
      setIsLoading(false);
    }
  }, [accessToken, messageId]);

  useEffect(() => {
    void fetchAudioUrl();
  }, [fetchAudioUrl]);

  const handlePlayPause = (): void => {
    const audio = audioRef.current;
    if (audio === null) return;

    if (isPlaying) {
      audio.pause();
    } else {
      void audio.play();
    }
  };

  const handleTimeUpdate = (): void => {
    const audio = audioRef.current;
    if (audio === null) return;
    setProgress(audio.currentTime);
  };

  const handleLoadedMetadata = (): void => {
    const audio = audioRef.current;
    if (audio === null) return;
    setDuration(audio.duration);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const audio = audioRef.current;
    if (audio === null) return;
    const newTime = parseFloat(e.target.value);
    audio.currentTime = newTime;
    setProgress(newTime);
  };

  const handleEnded = (): void => {
    setIsPlaying(false);
    setProgress(0);
  };

  const formatTime = (time: number): string => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${String(minutes)}:${String(seconds).padStart(2, '0')}`;
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-slate-100 p-3">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
        <span className="text-sm text-slate-500">Loading audio...</span>
      </div>
    );
  }

  if (error !== null) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-red-50 p-3">
        <AlertCircle className="h-5 w-5 text-red-400" />
        <span className="text-sm text-red-600">{error}</span>
        <button
          onClick={(): void => {
            void fetchAudioUrl();
          }}
          className="ml-auto text-sm text-red-600 underline hover:no-underline"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 rounded-lg bg-slate-100 p-3">
      {audioUrl !== null && (
        <audio
          ref={audioRef}
          src={audioUrl}
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          onPlay={(): void => {
            setIsPlaying(true);
          }}
          onPause={(): void => {
            setIsPlaying(false);
          }}
          onEnded={handleEnded}
          preload="metadata"
        />
      )}

      {/* Play/Pause button */}
      <button
        onClick={handlePlayPause}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white transition hover:bg-blue-700"
        aria-label={isPlaying ? 'Pause' : 'Play'}
      >
        {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="ml-0.5 h-5 w-5" />}
      </button>

      {/* Progress bar and time */}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <input
          type="range"
          min={0}
          max={duration || 100}
          value={progress}
          onChange={handleSeek}
          className="h-2 w-full cursor-pointer appearance-none rounded-full bg-slate-300 accent-blue-600"
          aria-label="Audio progress"
        />
        <div className="flex justify-between text-xs text-slate-500">
          <span>{formatTime(progress)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>
    </div>
  );
}
