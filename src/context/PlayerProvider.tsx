import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

declare global {
  interface Window {
    gapi?: {
      load: (name: string, callback: () => void) => void;
    };
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (response: { access_token?: string; error?: string }) => void;
          }) => {
            requestAccessToken: (options?: { prompt?: string }) => void;
          };
        };
      };
      picker?: {
        Action: { PICKED: string; CANCEL: string };
        Response: { ACTION: string; DOCUMENTS: string };
        Document: { ID: string; NAME: string };
        DocsView: new () => {
          setIncludeFolders: (include: boolean) => unknown;
          setSelectFolderEnabled: (enabled: boolean) => unknown;
          setMimeTypes: (mimeTypes: string) => unknown;
        };
        PickerBuilder: new () => {
          setDeveloperKey: (key: string) => unknown;
          setAppId: (appId: string) => unknown;
          setOAuthToken: (token: string) => unknown;
          addView: (view: unknown) => unknown;
          setCallback: (callback: (data: Record<string, unknown>) => void) => unknown;
          build: () => { setVisible: (visible: boolean) => void };
        };
      };
    };
  }
}

type TrackInput =
  | string
  | {
      url: string;
      title?: string;
      thumbnail?: string | null;
    };

type ActiveTrack = {
  id: string;
  url: string;
  title: string;
  thumbnail?: string | null;
  source: "external" | "uploaded";
  file?: File;
  baseName?: string;
};

type PlaylistTrack = ActiveTrack & {
  file: File;
  baseName: string;
  source: "uploaded";
};

type PlayerContextValue = {
  play: (track: TrackInput) => void;
};

const PlayerContext = createContext<PlayerContextValue | null>(null);
const VISUALIZER_BARS = 24;
const MONEY_BILLS = 54;
const GOOGLE_API_SCRIPT_SRC = "https://apis.google.com/js/api.js";
const GOOGLE_IDENTITY_SCRIPT_SRC = "https://accounts.google.com/gsi/client";
const DRIVE_READONLY_SCOPE = "https://www.googleapis.com/auth/drive.readonly";

function loadExternalScript(src: string, id: string) {
  return new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(id) as HTMLScriptElement | null;
    if (existing) {
      if (existing.dataset.loaded === "true") {
        resolve();
        return;
      }
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.id = id;
    script.src = src;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      script.dataset.loaded = "true";
      resolve();
    };
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

function Visualizer({ bars, compact = false }: { bars: number[]; compact?: boolean }) {
  return (
    <div
      className={`flex items-end gap-1 ${
        compact ? "h-6" : "h-12"
      } rounded-lg bg-gradient-to-r from-emerald-900/20 via-emerald-700/25 to-lime-500/20 px-2 py-1`}
    >
      {bars.map((value, index) => (
        <div
          key={index}
          className="flex-1 rounded-full bg-gradient-to-t from-emerald-700 via-emerald-500 to-lime-300 transition-all duration-100"
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

function toBaseName(name: string) {
  return name.replace(/\.[^/.]+$/, "").trim().toLowerCase();
}

function isWavFile(file: File) {
  const name = file.name.toLowerCase();
  return file.type === "audio/wav" || file.type === "audio/x-wav" || name.endsWith(".wav");
}

function normalizeTrack(input: TrackInput): ActiveTrack | null {
  if (typeof input === "string") {
    const url = input.trim();
    if (!url) return null;
    return { id: `external-${url}`, url, title: "Now Playing", thumbnail: null, source: "external" };
  }
  const url = input.url.trim();
  if (!url) return null;
  return {
    id: `external-${url}`,
    url,
    title: input.title?.trim() || "Now Playing",
    thumbnail: input.thumbnail || null,
    source: "external",
  };
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUploadInputRef = useRef<HTMLInputElement | null>(null);
  const imageUploadInputRef = useRef<HTMLInputElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const lowFilterRef = useRef<BiquadFilterNode | null>(null);
  const midFilterRef = useRef<BiquadFilterNode | null>(null);
  const highFilterRef = useRef<BiquadFilterNode | null>(null);
  const frameRef = useRef<number | null>(null);
  const visualizerCanvasFrameRef = useRef<number | null>(null);
  const moneyFrameRef = useRef<number | null>(null);
  const freqDataRef = useRef<Uint8Array | null>(null);
  const visualizerCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const moneyCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragSourceIndexRef = useRef<number | null>(null);
  const imageMapRef = useRef<Record<string, string>>({});
  const playlistRef = useRef<PlaylistTrack[]>([]);
  const currentIndexRef = useRef(-1);

  const [track, setTrack] = useState<ActiveTrack | null>(null);
  const [playlist, setPlaylist] = useState<PlaylistTrack[]>([]);
  const [imageByBaseName, setImageByBaseName] = useState<Record<string, string>>({});
  const [currentPlaylistId, setCurrentPlaylistId] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [lowGain, setLowGain] = useState(0);
  const [midGain, setMidGain] = useState(0);
  const [highGain, setHighGain] = useState(0);
  const [isAudioDragOver, setIsAudioDragOver] = useState(false);
  const [isImageDragOver, setIsImageDragOver] = useState(false);
  const [isDriveImporting, setIsDriveImporting] = useState(false);
  const [visualizerBars, setVisualizerBars] = useState<number[]>(
    Array.from({ length: VISUALIZER_BARS }, () => 0.12),
  );
  const hasHydratedRef = useRef(false);
  const lastPersistRef = useRef(0);

  const persistedState = useQuery(api.player.getPlaybackState);
  const upsertPlaybackState = useMutation(api.player.upsertPlaybackState);

  useEffect(() => {
    playlistRef.current = playlist;
    currentIndexRef.current = currentIndex;
    imageMapRef.current = imageByBaseName;
  }, [currentIndex, imageByBaseName, playlist]);

  const buildPersistPayload = (
    activeTrack: ActiveTrack | null,
    payload: { currentTime: number; duration: number; isPlaying: boolean },
  ) => {
    if (!activeTrack || activeTrack.url.startsWith("blob:")) {
      return { currentTime: payload.currentTime, duration: payload.duration, isPlaying: payload.isPlaying };
    }
    return {
      trackUrl: activeTrack.url,
      trackTitle: activeTrack.title,
      trackThumbnail: activeTrack.thumbnail || undefined,
      currentTime: payload.currentTime,
      duration: payload.duration,
      isPlaying: payload.isPlaying,
    };
  };

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

  const playTrack = (nextTrack: ActiveTrack, resetTime = true) => {
    const isSameTrack = track?.url === nextTrack.url;
    setTrack(nextTrack);
    window.setTimeout(() => {
      const audio = audioRef.current;
      if (!audio) return;
      if (resetTime || !isSameTrack) audio.currentTime = 0;
      void audio.play();
      void persistState(
        buildPersistPayload(nextTrack, {
          currentTime: audio.currentTime || 0,
          duration: audio.duration || 0,
          isPlaying: true,
        }),
        true,
      );
    }, 40);
  };

  const playPlaylistTrack = (index: number) => {
    if (index < 0 || index >= playlistRef.current.length) return;
    const next = playlistRef.current[index];
    setCurrentPlaylistId(next.id);
    setCurrentIndex(index);
    playTrack(next, true);
  };

  useEffect(() => {
    if (hasHydratedRef.current) return;
    if (persistedState === undefined) return;
    hasHydratedRef.current = true;
    if (!persistedState?.trackUrl) return;

    const restoredTrack: ActiveTrack = {
      id: `external-${persistedState.trackUrl}`,
      url: persistedState.trackUrl,
      title: persistedState.trackTitle || "Now Playing",
      thumbnail: persistedState.trackThumbnail || null,
      source: "external",
    };
    setTrack(restoredTrack);
    setCurrentTime(persistedState.currentTime || 0);
    setDuration(persistedState.duration || 0);

    window.setTimeout(() => {
      const audio = audioRef.current;
      if (!audio) return;
      if (persistedState.currentTime > 0) audio.currentTime = persistedState.currentTime;
      if (persistedState.isPlaying) void audio.play();
    }, 120);
  }, [persistedState]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.crossOrigin = "anonymous";
    audio.volume = volume;

    if (!audioContextRef.current) {
      const AudioCtx =
        window.AudioContext ||
        (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        const audioContext = new AudioCtx();
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 128;
        analyser.smoothingTimeConstant = 0.82;

        try {
          const source = audioContext.createMediaElementSource(audio);
          const lowFilter = audioContext.createBiquadFilter();
          lowFilter.type = "lowshelf";
          lowFilter.frequency.value = 320;
          lowFilter.gain.value = lowGain;

          const midFilter = audioContext.createBiquadFilter();
          midFilter.type = "peaking";
          midFilter.frequency.value = 1000;
          midFilter.Q.value = 1;
          midFilter.gain.value = midGain;

          const highFilter = audioContext.createBiquadFilter();
          highFilter.type = "highshelf";
          highFilter.frequency.value = 3200;
          highFilter.gain.value = highGain;

          source.connect(lowFilter);
          lowFilter.connect(midFilter);
          midFilter.connect(highFilter);
          highFilter.connect(analyser);
          analyser.connect(audioContext.destination);

          analyserRef.current = analyser;
          lowFilterRef.current = lowFilter;
          midFilterRef.current = midFilter;
          highFilterRef.current = highFilter;
          freqDataRef.current = new Uint8Array(analyser.frequencyBinCount);
          audioContextRef.current = audioContext;
        } catch {
          // Ignore unsupported media element source errors.
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
    const onEnded = () => {
      setIsPlaying(false);
      const nextIndex =
        currentIndexRef.current >= 0 && playlistRef.current.length > 0
          ? (currentIndexRef.current + 1) % playlistRef.current.length
          : -1;
      if (nextIndex >= 0) window.setTimeout(() => playPlaylistTrack(nextIndex), 60);
    };

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
  }, [highGain, lowGain, midGain, volume]);

  useEffect(() => {
    if (lowFilterRef.current) lowFilterRef.current.gain.value = lowGain;
  }, [lowGain]);
  useEffect(() => {
    if (midFilterRef.current) midFilterRef.current.gain.value = midGain;
  }, [midGain]);
  useEffect(() => {
    if (highFilterRef.current) highFilterRef.current.gain.value = highGain;
  }, [highGain]);

  useEffect(() => {
    const tick = () => {
      const analyser = analyserRef.current;
      const data = freqDataRef.current;
      if (analyser && data && isPlaying) {
        analyser.getByteFrequencyData(data);
        const nextBars = Array.from({ length: VISUALIZER_BARS }, (_, index) => {
          const dataIndex = Math.floor((index / VISUALIZER_BARS) * data.length);
          return Math.max(0.08, (data[dataIndex] || 0) / 255);
        });
        setVisualizerBars(nextBars);
      } else {
        setVisualizerBars((previous) => previous.map((value) => Math.max(0.08, value * 0.9)));
      }
      frameRef.current = window.requestAnimationFrame(tick);
    };
    frameRef.current = window.requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    };
  }, [isPlaying]);

  useEffect(() => {
    const canvas = visualizerCanvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const onResize = () => {
      canvas.width = Math.max(280, Math.min(560, window.innerWidth - 56));
      canvas.height = 88;
    };
    onResize();
    window.addEventListener("resize", onResize);

    const draw = () => {
      const analyser = analyserRef.current;
      const data = freqDataRef.current;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "rgba(15, 23, 15, 0.55)";
      context.fillRect(0, 0, canvas.width, canvas.height);
      if (analyser && data) {
        analyser.getByteFrequencyData(data);
        const barWidth = canvas.width / data.length;
        let x = 0;
        for (let i = 0; i < data.length; i += 1) {
          const barHeight = Math.max(2, (data[i] / 255) * (canvas.height - 10));
          context.fillStyle = `hsl(${110 + Math.floor((i / data.length) * 80)}, 95%, 55%)`;
          context.fillRect(x, canvas.height - barHeight, Math.max(2, barWidth - 1), barHeight);
          x += barWidth;
        }
      }
      visualizerCanvasFrameRef.current = window.requestAnimationFrame(draw);
    };
    visualizerCanvasFrameRef.current = window.requestAnimationFrame(draw);
    return () => {
      window.removeEventListener("resize", onResize);
      if (visualizerCanvasFrameRef.current !== null) {
        window.cancelAnimationFrame(visualizerCanvasFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isExpanded) {
      if (moneyFrameRef.current !== null) window.cancelAnimationFrame(moneyFrameRef.current);
      return;
    }
    const canvas = moneyCanvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const bills = Array.from({ length: MONEY_BILLS }, () => ({
      x: Math.random() * window.innerWidth,
      y: Math.random() * -window.innerHeight,
      size: 16 + Math.random() * 22,
      speed: 0.8 + Math.random() * 1.8,
      angle: Math.random() * Math.PI * 2,
      turn: 0.01 + Math.random() * 0.04,
    }));

    const onResize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    onResize();
    window.addEventListener("resize", onResize);

    const draw = () => {
      const data = freqDataRef.current;
      let bass = 0;
      if (data && data.length > 0) bass = data.slice(0, 14).reduce((sum, value) => sum + value, 0) / 14;
      const glow = bass / 3;

      context.clearRect(0, 0, canvas.width, canvas.height);
      bills.forEach((bill) => {
        context.save();
        context.translate(bill.x, bill.y);
        context.rotate(bill.angle);
        context.font = `bold ${bill.size + glow * 0.08}px Arial`;
        context.fillStyle = `hsl(${100 + glow * 0.4}, 90%, 55%)`;
        context.shadowColor = `hsl(${95 + glow * 0.35}, 95%, 55%)`;
        context.shadowBlur = 16 + glow * 0.18;
        context.fillText("$", 0, 0);
        context.restore();
        bill.y += bill.speed + glow * 0.012;
        bill.angle += bill.turn;
        if (bill.y > canvas.height + 20) {
          bill.x = Math.random() * canvas.width;
          bill.y = -20 - Math.random() * 140;
        }
      });
      moneyFrameRef.current = window.requestAnimationFrame(draw);
    };

    moneyFrameRef.current = window.requestAnimationFrame(draw);
    return () => {
      window.removeEventListener("resize", onResize);
      if (moneyFrameRef.current !== null) window.cancelAnimationFrame(moneyFrameRef.current);
    };
  }, [isExpanded]);

  useEffect(() => {
    if (!currentPlaylistId) {
      setCurrentIndex(-1);
      return;
    }
    const nextIndex = playlist.findIndex((item) => item.id === currentPlaylistId);
    if (nextIndex === -1) {
      setCurrentPlaylistId(null);
      setCurrentIndex(-1);
      return;
    }
    setCurrentIndex(nextIndex);
  }, [currentPlaylistId, playlist]);

  useEffect(() => {
    return () => {
      playlistRef.current.forEach((item) => {
        if (item.url.startsWith("blob:")) URL.revokeObjectURL(item.url);
      });
      Object.values(imageMapRef.current).forEach((url) => {
        if (url.startsWith("blob:")) URL.revokeObjectURL(url);
      });
    };
  }, []);

  const play = (input: TrackInput) => {
    const nextTrack = normalizeTrack(input);
    if (!nextTrack) return;
    setCurrentPlaylistId(null);
    setCurrentIndex(-1);
    playTrack(nextTrack, true);
  };

  const togglePlayPause = () => {
    const audio = audioRef.current;
    if (!audio || !track) return;
    if (audio.paused) void audio.play();
    else audio.pause();
    void persistState(
      buildPersistPayload(track, {
        currentTime: audio.currentTime || currentTime,
        duration: audio.duration || duration,
        isPlaying: !audio.paused,
      }),
      true,
    );
  };

  const progressPercent = useMemo(() => {
    if (!duration) return 0;
    return Math.max(0, Math.min(100, (currentTime / duration) * 100));
  }, [currentTime, duration]);

  const seekTo = (event: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    audio.currentTime = ratio * duration;
    setCurrentTime(audio.currentTime);
  };

  const addAudioFiles = (files: FileList | File[]) => {
    const wavFiles = Array.from(files).filter(isWavFile);
    if (!wavFiles.length) return;
    const additions: PlaylistTrack[] = wavFiles.map((file) => {
      const baseName = toBaseName(file.name);
      return {
        id: `uploaded-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        url: URL.createObjectURL(file),
        title: file.name.replace(/\.[^/.]+$/, ""),
        thumbnail: imageMapRef.current[baseName] || null,
        source: "uploaded",
        file,
        baseName,
      };
    });
    setPlaylist((prev) => {
      const next = [...prev, ...additions];
      if (!track && next.length > 0) window.setTimeout(() => playPlaylistTrack(prev.length), 40);
      return next;
    });
  };

  const addImageFiles = (files: FileList | File[]) => {
    const imageFiles = Array.from(files).filter((file) => file.type.startsWith("image/"));
    if (!imageFiles.length) return;
    const incoming: Record<string, string> = {};
    imageFiles.forEach((file) => {
      incoming[toBaseName(file.name)] = URL.createObjectURL(file);
    });

    setImageByBaseName((prev) => ({ ...prev, ...incoming }));
    setPlaylist((prev) => prev.map((item) => (incoming[item.baseName] ? { ...item, thumbnail: incoming[item.baseName] } : item)));
    setTrack((prev) =>
      prev?.source === "uploaded" && prev.baseName && incoming[prev.baseName]
        ? { ...prev, thumbnail: incoming[prev.baseName] }
        : prev,
    );
  };

  const importFromGoogleDrive = async () => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
    const apiKey = import.meta.env.VITE_GOOGLE_API_KEY as string | undefined;
    const appId = import.meta.env.VITE_GOOGLE_APP_ID as string | undefined;

    if (!clientId || !apiKey || !appId) {
      window.alert("Missing Google Drive config. Set VITE_GOOGLE_CLIENT_ID, VITE_GOOGLE_API_KEY, and VITE_GOOGLE_APP_ID.");
      return;
    }

    const requestAccessToken = async () =>
      new Promise<string>((resolve, reject) => {
        const tokenClient = window.google?.accounts?.oauth2?.initTokenClient({
          client_id: clientId,
          scope: DRIVE_READONLY_SCOPE,
          callback: (response) => {
            if (response.error || !response.access_token) {
              reject(new Error(response.error || "Could not authorize Google Drive access."));
              return;
            }
            resolve(response.access_token);
          },
        });

        if (!tokenClient) {
          reject(new Error("Google Identity Services is unavailable."));
          return;
        }
        tokenClient.requestAccessToken({ prompt: "consent" });
      });

    const pickDriveFile = async (token: string) =>
      new Promise<{ id: string; name: string }>((resolve, reject) => {
        const picker = window.google?.picker;
        if (!picker) {
          reject(new Error("Google Picker API is unavailable."));
          return;
        }

        const docsView = new picker.DocsView()
          .setIncludeFolders(false)
          .setSelectFolderEnabled(false)
          .setMimeTypes("audio/wav,audio/x-wav");

        const builtPicker = new picker.PickerBuilder()
          .setDeveloperKey(apiKey)
          .setAppId(appId)
          .setOAuthToken(token)
          .addView(docsView)
          .setCallback((data) => {
            const action = String(data[picker.Response.ACTION] ?? "");
            if (action === picker.Action.CANCEL) {
              reject(new Error("Drive file picking was canceled."));
              return;
            }
            if (action !== picker.Action.PICKED) return;
            const docs = (data[picker.Response.DOCUMENTS] as Record<string, unknown>[] | undefined) || [];
            const first = docs[0];
            const id = String(first?.[picker.Document.ID] ?? "");
            const name = String(first?.[picker.Document.NAME] ?? "drive-track.wav");
            if (!id) {
              reject(new Error("No Drive file selected."));
              return;
            }
            resolve({ id, name });
          })
          .build();

        builtPicker.setVisible(true);
      });

    try {
      setIsDriveImporting(true);
      await loadExternalScript(GOOGLE_API_SCRIPT_SRC, "google-api-script");
      await loadExternalScript(GOOGLE_IDENTITY_SCRIPT_SRC, "google-identity-script");
      await new Promise<void>((resolve, reject) => {
        if (!window.gapi?.load) {
          reject(new Error("Google API client failed to initialize."));
          return;
        }
        window.gapi.load("picker", () => resolve());
      });

      const accessToken = await requestAccessToken();
      const selected = await pickDriveFile(accessToken);
      const mediaResponse = await fetch(
        `https://www.googleapis.com/drive/v3/files/${selected.id}?alt=media&supportsAllDrives=true`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      );
      if (!mediaResponse.ok) {
        throw new Error("Failed to download the selected file from Google Drive.");
      }

      const blob = await mediaResponse.blob();
      const normalizedName = selected.name.toLowerCase().endsWith(".wav") ? selected.name : `${selected.name}.wav`;
      const wavFile = new File([blob], normalizedName, { type: blob.type || "audio/wav" });
      if (!isWavFile(wavFile)) {
        throw new Error("Selected file is not a WAV file.");
      }
      addAudioFiles([wavFile]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Google Drive import failed.";
      if (message.toLowerCase().includes("canceled")) return;
      window.alert(message);
    } finally {
      setIsDriveImporting(false);
    }
  };

  const playNext = () => {
    if (!playlist.length) return;
    playPlaylistTrack(currentIndex >= 0 ? (currentIndex + 1) % playlist.length : 0);
  };

  const playPrevious = () => {
    if (!playlist.length) return;
    playPlaylistTrack(
      currentIndex >= 0 ? (currentIndex - 1 + playlist.length) % playlist.length : playlist.length - 1,
    );
  };

  const shareCurrentTrack = async () => {
    if (!track) return;
    if (!navigator.share) {
      window.alert("Sharing is not supported in this browser.");
      return;
    }
    try {
      if (track.file && typeof navigator.canShare === "function" && navigator.canShare({ files: [track.file] })) {
        await navigator.share({
          files: [track.file],
          title: "Profit Boy Mini Player",
          text: `Check out this track: ${track.title}`,
        });
      } else {
        await navigator.share({
          title: "Profit Boy Mini Player",
          text: `Listening to ${track.title}`,
          url: window.location.href,
        });
      }
    } catch {
      // ignore share cancellation
    }
  };

  useEffect(() => {
    if (!track) return;
    const id = window.setInterval(() => {
      const audio = audioRef.current;
      if (!audio) return;
      void persistState(
        buildPersistPayload(track, {
          currentTime: audio.currentTime || 0,
          duration: audio.duration || 0,
          isPlaying: !audio.paused,
        }),
      );
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
          <>
            <canvas ref={moneyCanvasRef} className="fixed inset-0 z-[9998] pointer-events-none" />
            <section className="fixed bottom-20 left-4 right-4 md:left-1/2 md:right-auto md:w-[640px] md:-translate-x-1/2 z-[9999] bg-[#0d140d]/95 text-white border border-emerald-500/30 shadow-2xl rounded-2xl p-5 space-y-4 overflow-hidden">
              <div className="flex items-start gap-4 relative z-10">
                {track?.thumbnail ? (
                  <img
                    src={track.thumbnail}
                    alt={track.title}
                    className="h-20 w-20 rounded-xl object-cover border border-emerald-400/30"
                  />
                ) : (
                  <div className="h-20 w-20 rounded-xl bg-gradient-to-br from-emerald-500 to-lime-500 text-black flex items-center justify-center text-3xl">
                    $
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-xs uppercase tracking-wide text-emerald-200 font-semibold">Now playing</p>
                  <h3 className="text-lg font-semibold truncate">{track ? track.title : "Mini Player Ready"}</h3>
                  <p className="text-xs text-emerald-100/70 truncate">
                    {track ? track.url : "Drop WAV files to build your local playlist."}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsExpanded(false)}
                  className="px-2 py-1 text-xs rounded-lg border border-emerald-400/30 text-emerald-100 hover:bg-emerald-700/20"
                >
                  Close
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 relative z-10">
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => audioUploadInputRef.current?.click()}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setIsAudioDragOver(true);
                  }}
                  onDragLeave={() => setIsAudioDragOver(false)}
                  onDrop={(event) => {
                    event.preventDefault();
                    setIsAudioDragOver(false);
                    if (event.dataTransfer.files?.length) addAudioFiles(event.dataTransfer.files);
                  }}
                  className={`rounded-xl border-2 border-dashed px-4 py-4 text-center text-sm cursor-pointer transition ${
                    isAudioDragOver
                      ? "border-lime-300 bg-lime-500/20"
                      : "border-emerald-500/60 bg-emerald-900/30 hover:bg-emerald-800/30"
                  }`}
                >
                  Drop or Upload WAV Files
                </div>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => imageUploadInputRef.current?.click()}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setIsImageDragOver(true);
                  }}
                  onDragLeave={() => setIsImageDragOver(false)}
                  onDrop={(event) => {
                    event.preventDefault();
                    setIsImageDragOver(false);
                    if (event.dataTransfer.files?.length) addImageFiles(event.dataTransfer.files);
                  }}
                  className={`rounded-xl border-2 border-dashed px-4 py-4 text-center text-sm cursor-pointer transition ${
                    isImageDragOver
                      ? "border-lime-300 bg-lime-500/20"
                      : "border-emerald-500/60 bg-emerald-900/30 hover:bg-emerald-800/30"
                  }`}
                >
                  Drop or Upload Album Art
                </div>
              </div>

              <div className="space-y-2 relative z-10">
                <canvas ref={visualizerCanvasRef} className="w-full rounded-xl border border-emerald-500/25 bg-black/45" />
                <div className="h-2 bg-emerald-900/50 rounded-full overflow-hidden cursor-pointer" onClick={seekTo}>
                  <div className="h-full bg-emerald-400 rounded-full transition-all duration-150" style={{ width: `${progressPercent}%` }} />
                </div>
                <div className="flex items-center justify-between text-xs text-emerald-100/70">
                  <span>{formatTime(currentTime)}</span>
                  <span>{formatTime(duration)}</span>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-center gap-2 relative z-10">
                <button type="button" onClick={playPrevious} disabled={!playlist.length} className="px-3 py-2 rounded-lg bg-emerald-500 text-black font-semibold hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed">Prev</button>
                <button type="button" onClick={togglePlayPause} disabled={!track} className="px-4 py-2 rounded-lg bg-emerald-500 text-black font-semibold hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed">{isPlaying ? "Pause" : "Play"}</button>
                <button type="button" onClick={playNext} disabled={!playlist.length} className="px-3 py-2 rounded-lg bg-emerald-500 text-black font-semibold hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed">Next</button>
                <button type="button" onClick={shareCurrentTrack} disabled={!track} className="px-3 py-2 rounded-lg border border-emerald-400/40 text-emerald-100 hover:bg-emerald-700/25 disabled:opacity-50 disabled:cursor-not-allowed">Share</button>
                <button type="button" onClick={importFromGoogleDrive} disabled={isDriveImporting} className="px-3 py-2 rounded-lg border border-emerald-400/40 text-emerald-100 hover:bg-emerald-700/25 disabled:opacity-50 disabled:cursor-not-allowed">{isDriveImporting ? "Drive..." : "Drive WAV"}</button>
                <label className="flex items-center gap-2 text-sm text-emerald-100/80">
                  Volume
                  <input type="range" min={0} max={1} step={0.01} value={volume} onChange={(event) => setVolume(Number(event.target.value))} className="accent-emerald-400" />
                </label>
              </div>

              <div className="relative z-10 rounded-xl border border-emerald-500/35 bg-black/25 p-3 space-y-2">
                <h3 className="text-sm font-semibold text-emerald-200">Equalizer</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <label className="text-xs text-emerald-100/85">Low<input type="range" min={-30} max={30} step={1} value={lowGain} onChange={(event) => setLowGain(Number(event.target.value))} className="w-full accent-lime-300" /></label>
                  <label className="text-xs text-emerald-100/85">Mid<input type="range" min={-30} max={30} step={1} value={midGain} onChange={(event) => setMidGain(Number(event.target.value))} className="w-full accent-lime-300" /></label>
                  <label className="text-xs text-emerald-100/85">High<input type="range" min={-30} max={30} step={1} value={highGain} onChange={(event) => setHighGain(Number(event.target.value))} className="w-full accent-lime-300" /></label>
                </div>
              </div>

              <div className="relative z-10 rounded-xl border border-emerald-500/30 bg-black/30 p-3">
                <h3 className="text-sm font-semibold text-emerald-200 mb-2">Playlist</h3>
                <div className="max-h-56 overflow-y-auto space-y-2 pr-1">
                  {playlist.length === 0 ? (
                    <p className="text-xs text-emerald-100/65">No songs uploaded yet.</p>
                  ) : (
                    playlist.map((item, index) => (
                      <div
                        key={item.id}
                        draggable
                        onDragStart={() => {
                          dragSourceIndexRef.current = index;
                        }}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={() => {
                          const sourceIndex = dragSourceIndexRef.current;
                          dragSourceIndexRef.current = null;
                          if (sourceIndex === null || sourceIndex === index) return;
                          setPlaylist((prev) => {
                            const next = [...prev];
                            const [moved] = next.splice(sourceIndex, 1);
                            next.splice(index, 0, moved);
                            return next;
                          });
                        }}
                        onClick={() => playPlaylistTrack(index)}
                        className={`flex items-center gap-2 rounded-lg p-2 cursor-pointer border transition ${
                          currentPlaylistId === item.id ? "border-lime-300/80 bg-emerald-500/20" : "border-emerald-700/50 bg-emerald-900/30 hover:bg-emerald-800/35"
                        }`}
                      >
                        {item.thumbnail ? (
                          <img src={item.thumbnail} alt={item.title} className="h-10 w-10 rounded object-cover" />
                        ) : (
                          <div className="h-10 w-10 rounded bg-emerald-500/20 text-emerald-100 flex items-center justify-center text-xs">WAV</div>
                        )}
                        <span className="min-w-0 flex-1 truncate text-sm">{item.title}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </section>
          </>
        ) : null}

        <section
          className="fixed bottom-3 left-3 right-3 md:left-1/2 md:right-auto md:w-[560px] md:-translate-x-1/2 z-[9999] bg-white/95 backdrop-blur-md border shadow-xl rounded-2xl px-3 py-2"
          onClick={() => setIsExpanded(true)}
          role="button"
          aria-label="Open player"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setIsExpanded(true);
            }
          }}
        >
          <div className="flex items-center gap-3">
            {track?.thumbnail ? (
              <img src={track.thumbnail} alt={track.title} className="h-11 w-11 rounded-lg object-cover border border-gray-200" />
            ) : (
              <div className="h-11 w-11 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 text-white flex items-center justify-center text-lg">🎵</div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-gray-900 truncate">{track ? track.title : "Mini Player Ready"}</p>
              {!track ? <p className="text-xs text-gray-500">Tap to open. Start any track from the feed.</p> : <Visualizer bars={visualizerBars} compact />}
            </div>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                audioUploadInputRef.current?.click();
              }}
              className="h-10 px-3 rounded-full border border-gray-200 text-xs font-semibold text-gray-700 bg-white hover:bg-gray-50"
            >
              Upload
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                void importFromGoogleDrive();
              }}
              disabled={isDriveImporting}
              className="h-10 px-3 rounded-full border border-gray-200 text-xs font-semibold text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isDriveImporting ? "..." : "Drive"}
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

        <input ref={audioUploadInputRef} type="file" multiple accept=".wav,audio/wav,audio/x-wav" onChange={(event) => { if (event.target.files?.length) addAudioFiles(event.target.files); event.target.value = ""; }} className="hidden" />
        <input ref={imageUploadInputRef} type="file" multiple accept="image/*" onChange={(event) => { if (event.target.files?.length) addImageFiles(event.target.files); event.target.value = ""; }} className="hidden" />
      </>
    </PlayerContext.Provider>
  );
}

export function usePlayer() {
  const context = useContext(PlayerContext);
  if (!context) throw new Error("usePlayer must be used within a PlayerProvider");
  return context;
}
