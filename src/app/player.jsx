import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

const STORAGE_KEY = "music-player-v1";
const PlayerContext = createContext(null);

function readStored() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeStored(state) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable */
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

export function PlayerProvider({ children }) {
  const [stored] = useState(readStored);
  const [track, setTrack] = useState(null);
  const [queue, setQueueState] = useState([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(() =>
    clamp(typeof stored.volume === "number" ? stored.volume : 0.82, 0, 1),
  );
  const [muted, setMuted] = useState(stored.muted === true);
  const [shuffle, setShuffle] = useState(stored.shuffle === true);
  const [repeat, setRepeat] = useState(stored.repeat === true);
  const [error, setError] = useState(null);
  const audioRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const sourceRef = useRef(null);
  const sourceElementRef = useRef(null);
  const pendingSeekRef = useRef(null);
  const queuedAutoplayRef = useRef(false);
  const storedPath = typeof stored.path === "string" ? stored.path : null;

  const ensureAudioGraph = useCallback(async () => {
    const audio = audioRef.current;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!audio || !AudioContextClass) return;
    if (!audioContextRef.current)
      audioContextRef.current = new AudioContextClass();
    if (!analyserRef.current) {
      const analyser = audioContextRef.current.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.78;
      analyserRef.current = analyser;
    }
    if (sourceRef.current && sourceElementRef.current !== audio) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    if (!sourceRef.current) {
      sourceRef.current =
        audioContextRef.current.createMediaElementSource(audio);
      sourceElementRef.current = audio;
      sourceRef.current.connect(analyserRef.current);
      analyserRef.current.connect(audioContextRef.current.destination);
    }
    if (audioContextRef.current.state === "suspended")
      await audioContextRef.current.resume();
  }, []);

  const play = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio || !track) return;
    try {
      await ensureAudioGraph();
      await audio.play();
      setIsPlaying(true);
      setError(null);
    } catch (playError) {
      if (playError?.name === "AbortError") return;
      setError("Playback failed.");
    }
  }, [ensureAudioGraph, track]);

  const pause = useCallback(() => {
    audioRef.current?.pause();
    setIsPlaying(false);
  }, []);

  const seek = useCallback(
    (value) => {
      const audio = audioRef.current;
      const nextTime = clamp(value, 0, Math.max((duration || 0) - 0.05, 0));
      if (audio) audio.currentTime = nextTime;
      setCurrentTime(nextTime);
    },
    [duration],
  );

  const seekBy = useCallback(
    (delta) => seek((audioRef.current?.currentTime || currentTime) + delta),
    [currentTime, seek],
  );

  const setVolume = useCallback((value) => {
    const next = clamp(value, 0, 1);
    setVolumeState(next);
    if (next > 0) setMuted(false);
  }, []);

  const setQueue = useCallback((nextQueue) => {
    setQueueState((current) => {
      const currentKey = current.map((entry) => entry.path).join("\n");
      const nextKey = nextQueue.map((entry) => entry.path).join("\n");
      return currentKey === nextKey ? current : nextQueue;
    });
  }, []);

  const selectTrack = useCallback(
    (nextTrack, options = {}) => {
      if (options.queue) setQueue(options.queue);
      const same = track?.path === nextTrack.path;
      const nextSeek =
        typeof options.seekTo === "number"
          ? Math.max(0, options.seekTo)
          : options.resumeStored && nextTrack.path === storedPath
            ? Math.max(
                0,
                typeof stored.currentTime === "number" ? stored.currentTime : 0,
              )
            : null;
      if (same) {
        if (nextSeek !== null) seek(nextSeek);
        if (options.autoplay) void play();
        return;
      }
      pendingSeekRef.current = nextSeek;
      queuedAutoplayRef.current = options.autoplay === true;
      setDuration(0);
      setCurrentTime(nextSeek || 0);
      setError(null);
      setIsPlaying(false);
      setTrack(nextTrack);
    },
    [play, seek, setQueue, stored.currentTime, storedPath, track?.path],
  );

  const clear = useCallback(() => {
    audioRef.current?.pause();
    setTrack(null);
    setQueueState([]);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setError(null);
  }, []);

  const playRelative = useCallback(
    (delta, options = {}) => {
      const playQueue = queue.length > 0 ? queue : track ? [track] : [];
      if (playQueue.length === 0) return;
      const currentIndex = playQueue.findIndex(
        (entry) => entry.path === track?.path,
      );
      let nextIndex = currentIndex >= 0 ? currentIndex + delta : 0;
      if (shuffle && delta > 0 && playQueue.length > 1) {
        do {
          nextIndex = Math.floor(Math.random() * playQueue.length);
        } while (nextIndex === currentIndex);
      }
      const wrap = options.wrap !== false;
      if (nextIndex < 0) nextIndex = wrap ? playQueue.length - 1 : 0;
      if (nextIndex >= playQueue.length) {
        if (!wrap) {
          pause();
          return;
        }
        nextIndex = 0;
      }
      const nextTrack = playQueue[nextIndex];
      if (nextTrack)
        selectTrack(nextTrack, { autoplay: true, queue: playQueue });
    },
    [pause, queue, selectTrack, shuffle, track],
  );

  const togglePlay = useCallback(() => {
    if (isPlaying) pause();
    else void play();
  }, [isPlaying, pause, play]);
  const toggleMute = useCallback(() => setMuted((current) => !current), []);
  const toggleRepeat = useCallback(() => setRepeat((current) => !current), []);
  const toggleShuffle = useCallback(
    () => setShuffle((current) => !current),
    [],
  );

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = volume;
    audio.muted = muted;
  }, [muted, volume, track]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      writeStored({
        currentTime,
        muted,
        repeat,
        path: track?.path || null,
        shuffle,
        volume,
      });
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [currentTime, track?.path, muted, repeat, shuffle, volume]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const session = navigator.mediaSession;
    if (track) {
      session.metadata = new window.MediaMetadata({
        title: track.title,
        artist: track.artist,
        album: track.album,
        artwork: track.artUrl
          ? [
              {
                src: new URL(track.artUrl, window.location.href).href,
                sizes: "512x512",
              },
            ]
          : [],
      });
    }
    session.playbackState = track ? (isPlaying ? "playing" : "paused") : "none";
  }, [track, isPlaying]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const session = navigator.mediaSession;
    const handlers = {
      play: () => void play(),
      pause,
      previoustrack: () => playRelative(-1),
      nexttrack: () => playRelative(1),
      seekbackward: (details) => seekBy(-(details?.seekOffset || 10)),
      seekforward: (details) => seekBy(details?.seekOffset || 10),
      seekto: (details) =>
        typeof details?.seekTime === "number" && seek(details.seekTime),
    };
    for (const [action, handler] of Object.entries(handlers)) {
      try {
        session.setActionHandler(action, handler);
      } catch {
        /* unsupported action */
      }
    }
  }, [pause, play, playRelative, seek, seekBy]);

  useEffect(() => () => void audioContextRef.current?.close(), []);

  const value = useMemo(
    () => ({
      analyserRef,
      clear,
      currentTime,
      duration,
      error,
      isPlaying,
      muted,
      pause,
      play,
      playRelative,
      queue,
      repeat,
      seek,
      seekBy,
      selectTrack,
      setQueue,
      setVolume,
      shuffle,
      storedPath,
      toggleMute,
      togglePlay,
      toggleRepeat,
      toggleShuffle,
      track,
      volume,
    }),
    [
      clear,
      currentTime,
      duration,
      error,
      isPlaying,
      muted,
      pause,
      play,
      playRelative,
      queue,
      repeat,
      seek,
      seekBy,
      selectTrack,
      setQueue,
      setVolume,
      shuffle,
      storedPath,
      toggleMute,
      togglePlay,
      toggleRepeat,
      toggleShuffle,
      track,
      volume,
    ],
  );

  return (
    <PlayerContext.Provider value={value}>
      {children}
      {track ? (
        <audio
          ref={audioRef}
          src={track.url}
          preload="metadata"
          crossOrigin="anonymous"
          onLoadedMetadata={(event) => {
            const audio = event.currentTarget;
            const nextDuration = Number.isFinite(audio.duration)
              ? audio.duration
              : 0;
            setDuration(nextDuration);
            const pendingSeek = pendingSeekRef.current;
            if (pendingSeek !== null && nextDuration > 0) {
              const nextTime = clamp(
                pendingSeek,
                0,
                Math.max(0, nextDuration - 1),
              );
              audio.currentTime = nextTime;
              setCurrentTime(nextTime);
              pendingSeekRef.current = null;
            }
            if (queuedAutoplayRef.current) {
              queuedAutoplayRef.current = false;
              void play();
            }
          }}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => playRelative(1, { wrap: repeat })}
          onTimeUpdate={(event) =>
            setCurrentTime(event.currentTarget.currentTime)
          }
          onDurationChange={(event) =>
            setDuration(
              Number.isFinite(event.currentTarget.duration)
                ? event.currentTarget.duration
                : 0,
            )
          }
          onError={() => {
            setIsPlaying(false);
            setError("This file could not be played.");
          }}
        />
      ) : null}
    </PlayerContext.Provider>
  );
}

export function usePlayer() {
  const context = useContext(PlayerContext);
  if (!context) throw new Error("usePlayer must be used inside PlayerProvider");
  return context;
}
