import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useConvex, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";

type TrackInput =
  | string
  | {
      url: string;
      title?: string;
      thumbnail?: string | null;
    };

type ActiveTrack = {
  url: string;
  title: string;
  thumbnail?: string | null;
};

type PlayerContextValue = {
  play: (track: TrackInput) => void;
};

const PlayerContext = createContext<PlayerContextValue | null>(null);
const VISUALIZER_BARS = 24;

function Visualizer({ bars, compact = false }: { bars: number[]; compact?: boolean }) {
  return (
    <div
      className={`flex items-end gap-1 ${
        compact ? "h-6" : "h-12"
      } rounded-lg bg-gradient-to-r from-blue-50 via-indigo-50 to-emerald-50 px-2 py-1`}
    >
      {bars.map((value, index) => (
        <div
          key={index}
          className="flex-1 rounded-full bg-gradient-to-t from-blue-600 via-indigo-500 to-emerald-400 transition-all duration-100"
          style={{
            height: `${Math.max(compact ? 18 : 12, value * (compact ? 24 : 42))}px`,
            opacity: 0.45 + value * 0.55,
          }}
        />
      ))}
    </div>
  );
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function normalizeTrack(input: TrackInput): ActiveTrack | null {
  if (typeof input === "string") {
    const url = input.trim();
    if (!url) return null;
    return {
      url,
      title: "Now Playing",
      thumbnail: null,
    };
  }

  const url = input.url.trim();
  if (!url) return null;

  return {
    url,
    title: input.title?.trim() || "Now Playing",
    thumbnail: input.thumbnail || null,
  };
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const convex = useConvex();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const frameRef = useRef<number | null>(null);
  const freqDataRef = useRef<Uint8Array | null>(null);
  const [track, setTrack] = useState<ActiveTrack | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [visualizerBars, setVisualizerBars] = useState<number[]>(
    Array.from({ length: VISUALIZER_BARS }, () => 0.12),
  );
  const hasHydratedRef = useRef(false);
  const lastPersistRef = useRef(0);

  const persistedState = useQuery(api.player.getPlaybackState);
  const upsertPlaybackState = useMutation(api.player.upsertPlaybackState);
  const generateUploadUrl = useMutation(api.files.generateUploadUrl);

  const persistState = async (
    next: {
      trackUrl?: string;
      trackTitle?: string;
      trackThumbnail?: string;
      currentTime: number;
      duration: number;
      isPlaying: boolean;
    },
    force = false,
  ) => {
    const now = Date.now();
    if (!force && now - lastPersistRef.current < 1200) return;
    lastPersistRef.current = now;
    try {
      await upsertPlaybackState(next);
    } catch {
      // non-blocking persistence
    }
  };

  useEffect(() => {
    if (hasHydratedRef.current) return;
    if (persistedState === undefined) return;
    hasHydratedRef.current = true;

    if (!persistedState?.trackUrl) return;

    const restoredTrack = {
      url: persistedState.trackUrl,
      title: persistedState.trackTitle || "Now Playing",
      thumbnail: persistedState.trackThumbnail || null,
    };
    setTrack(restoredTrack);
    setCurrentTime(persistedState.currentTime || 0);
    setDuration(persistedState.duration || 0);

    window.setTimeout(() => {
      const audio = audioRef.current;
      if (!audio) return;
      if (persistedState.currentTime > 0) {
        audio.currentTime = persistedState.currentTime;
      }
      if (persistedState.isPlaying) {
        void audio.play();
      }
    }, 120);
  }, [persistedState]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.crossOrigin = "anonymous";

    if (!audioContextRef.current) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        const audioContext = new AudioCtx();
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 128;
        analyser.smoothingTimeConstant = 0.82;

        try {
          const source = audioContext.createMediaElementSource(audio);
          source.connect(analyser);
          analyser.connect(audioContext.destination);
          sourceRef.current = source;
          analyserRef.current = analyser;
          freqDataRef.current = new Uint8Array(analyser.frequencyBinCount);
          audioContextRef.current = audioContext;
        } catch {
          // Some browsers can throw if source node already exists; ignore gracefully.
        }
      }
    }

    const onPlay = () => {
      setIsPlaying(true);
      void audioContextRef.current?.resume();
    };
    const onPause = () => setIsPlaying(false);
    const onTimeUpdate = () => setCurrentTime(audio.currentTime || 0);
    const onLoadedMetadata = () => setDuration(audio.duration || 0);
    const onEnded = () => setIsPlaying(false);

    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("ended", onEnded);

    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("ended", onEnded);
    };
  }, []);

  useEffect(() => {
    const tick = () => {
      const analyser = analyserRef.current;
      const data = freqDataRef.current;

      if (analyser && data && isPlaying) {
        analyser.getByteFrequencyData(data);
        const nextBars = Array.from({ length: VISUALIZER_BARS }, (_, index) => {
          const dataIndex = Math.floor((index / VISUALIZER_BARS) * data.length);
          const value = (data[dataIndex] || 0) / 255;
          return Math.max(0.08, value);
        });
        setVisualizerBars(nextBars);
      } else {
        setVisualizerBars((previous) => previous.map((value) => Math.max(0.08, value * 0.9)));
      }

      frameRef.current = window.requestAnimationFrame(tick);
    };

    frameRef.current = window.requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
      }
    };
  }, [isPlaying]);

  const play = (input: TrackInput) => {
    const nextTrack = normalizeTrack(input);
    if (!nextTrack) return;

    const isSameTrack = track?.url === nextTrack.url;
    setTrack(nextTrack);
    setIsExpanded(false);

    window.setTimeout(() => {
      const audio = audioRef.current;
      if (!audio) return;

      if (!isSameTrack) {
        audio.currentTime = 0;
      }
      void audio.play();
      void persistState(
        {
          trackUrl: nextTrack.url,
          trackTitle: nextTrack.title,
          trackThumbnail: nextTrack.thumbnail || undefined,
          currentTime: 0,
          duration: audio.duration || 0,
          isPlaying: true,
        },
        true,
      );
    }, 40);
  };

  const togglePlayPause = () => {
    const audio = audioRef.current;
    if (!audio || !track) return;
    if (audio.paused) {
      void audio.play();
    } else {
      audio.pause();
    }

    if (track) {
      void persistState(
        {
          trackUrl: track.url,
          trackTitle: track.title,
          trackThumbnail: track.thumbnail || undefined,
          currentTime: audio.currentTime || currentTime,
          duration: audio.duration || duration,
          isPlaying: !audio.paused,
        },
        true,
      );
    }
  };

  const progressPercent = useMemo(() => {
    if (!duration) return 0;
    return Math.max(0, Math.min(100, (currentTime / duration) * 100));
  }, [currentTime, duration]);

  const openUploadPicker = () => {
    uploadInputRef.current?.click();
  };

  const handleUploadTrack = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("audio/")) {
      event.target.value = "";
      return;
    }

    try {
      setIsUploading(true);
      const uploadUrl = await generateUploadUrl({});
      const uploadResult = await fetch(uploadUrl, {
        method: "POST",
        body: file,
        headers: { "Content-Type": file.type },
      });
      if (!uploadResult.ok) throw new Error("Upload failed");

      const { storageId } = (await uploadResult.json()) as { storageId: Id<"_storage"> };
      const playableUrl = await convex.query(api.files.getImageUrl, { storageId });
      if (!playableUrl) throw new Error("Could not resolve uploaded file URL");

      play({
        url: playableUrl,
        title: file.name.replace(/\.[^/.]+$/, "") || "Uploaded Track",
      });
    } catch {
      // non-blocking in player context
    } finally {
      setIsUploading(false);
      event.target.value = "";
    }
  };

  useEffect(() => {
    if (!track) return;
    const id = window.setInterval(() => {
      const audio = audioRef.current;
      if (!audio) return;
      void persistState({
        trackUrl: track.url,
        trackTitle: track.title,
        trackThumbnail: track.thumbnail || undefined,
        currentTime: audio.currentTime || 0,
        duration: audio.duration || 0,
        isPlaying: !audio.paused,
      });
    }, 5000);

    return () => window.clearInterval(id);
  }, [track]);

  return (
    <PlayerContext.Provider value={{ play }}>
      {children}

      <audio ref={audioRef} src={track?.url ?? undefined} preload="metadata" />

      <>
        {isExpanded ? (
          <div className="fixed inset-0 z-[9998] bg-black/45 backdrop-blur-sm" onClick={() => setIsExpanded(false)} />
        ) : null}

        {isExpanded ? (
          <section className="fixed bottom-20 left-4 right-4 md:left-1/2 md:right-auto md:w-[560px] md:-translate-x-1/2 z-[9999] bg-white rounded-2xl border shadow-2xl p-5 space-y-4">
            {track ? (
              <div className="flex items-start gap-4">
                {track.thumbnail ? (
                  <img
                    src={track.thumbnail}
                    alt={track.title}
                    className="h-20 w-20 rounded-xl object-cover border border-gray-200"
                  />
                ) : (
                  <div className="h-20 w-20 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white flex items-center justify-center text-3xl">
                    🎵
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-xs uppercase tracking-wide text-gray-500 font-semibold">Now playing</p>
                  <h3 className="text-lg font-semibold text-gray-900 truncate">{track.title}</h3>
                  <p className="text-xs text-gray-500 truncate">{track.url}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsExpanded(false)}
                  className="px-2 py-1 text-xs rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
                >
                  Close
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <h3 className="text-lg font-semibold text-gray-900">Mini Player Ready</h3>
                <p className="text-sm text-gray-600">
                  Start a track from the feed to play music while you browse.
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Visualizer bars={visualizerBars} />
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-600 rounded-full transition-all duration-150"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration)}</span>
              </div>
            </div>

            <div className="flex items-center justify-center">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={openUploadPicker}
                  disabled={isUploading}
                  className="px-4 py-2 rounded-xl border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isUploading ? "Uploading..." : "Upload"}
                </button>
                <button
                  type="button"
                  onClick={togglePlayPause}
                  disabled={!track}
                  className="px-5 py-2 rounded-xl bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isPlaying ? "Pause" : "Play"}
                </button>
              </div>
            </div>
          </section>
        ) : null}

        <section
          className="fixed bottom-3 left-3 right-3 md:left-1/2 md:right-auto md:w-[560px] md:-translate-x-1/2 z-[9999] bg-white/95 backdrop-blur-md border shadow-xl rounded-2xl px-3 py-2"
          onClick={() => setIsExpanded(true)}
          role="button"
          aria-label="Open player"
          tabIndex={0}
        >
          <div className="flex items-center gap-3">
            {track?.thumbnail ? (
              <img
                src={track.thumbnail}
                alt={track.title}
                className="h-11 w-11 rounded-lg object-cover border border-gray-200"
              />
            ) : (
              <div className="h-11 w-11 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 text-white flex items-center justify-center text-lg">
                🎵
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-gray-900 truncate">
                {track ? track.title : "Mini Player Ready"}
              </p>
              {!track ? (
                <p className="text-xs text-gray-500">Tap to open. Start any track from the feed.</p>
              ) : (
                <Visualizer bars={visualizerBars} compact />
              )}
            </div>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                openUploadPicker();
              }}
              disabled={isUploading}
              className="h-10 px-3 rounded-full border border-gray-200 text-xs font-semibold text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isUploading ? "..." : "Upload"}
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                togglePlayPause();
              }}
              disabled={!track}
              className="h-10 w-10 rounded-full bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center"
            >
              {isPlaying ? "II" : "▶"}
            </button>
          </div>
        </section>

        <input
          ref={uploadInputRef}
          type="file"
          accept="audio/*"
          onChange={handleUploadTrack}
          className="hidden"
        />
      </>
    </PlayerContext.Provider>
  );
}

export function usePlayer() {
  const context = useContext(PlayerContext);
  if (!context) {
    throw new Error("usePlayer must be used within a PlayerProvider");
  }
  return context;
}
