import {
  IconArrowsShuffle,
  IconMaximize,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlayerSkipBack,
  IconPlayerSkipForward,
  IconRepeat,
  IconRewindBackward10,
  IconRewindForward10,
  IconVolume,
  IconVolumeOff,
} from "@/ui/icons";
import { useCallback, useRef } from "react";
import { cn } from "@/lib/utils";

const WAVEFORM_SEEK_BAR_COUNT = 72;

export function formatMediaTime(value) {
  if (!Number.isFinite(value) || value <= 0) return "0:00";
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const seconds = Math.floor(value % 60);
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds
      .toString()
      .padStart(2, "0")}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function sliderValue(event) {
  const value = Number(event.currentTarget.value);
  return Number.isFinite(value) ? value : 0;
}

function waveformSeekLevel(index, total) {
  const position = index / Math.max(total - 1, 1);
  const level =
    0.46 +
    Math.sin(position * Math.PI * 3.2) * 0.22 +
    Math.sin(position * Math.PI * 11.5) * 0.14;
  return clampNumber(level, 0.18, 0.96);
}

function WaveformSeekBar({ currentTime, duration, onSeek }) {
  const rootRef = useRef(null);
  const seekMax = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const safeCurrentTime = clampNumber(currentTime, 0, seekMax);
  const progress = seekMax > 0 ? safeCurrentTime / seekMax : 0;
  const commitSeek = useCallback(
    (value) => {
      if (seekMax <= 0) return;
      onSeek(clampNumber(value, 0, seekMax));
    },
    [onSeek, seekMax],
  );
  const seekFromClientX = useCallback(
    (clientX) => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect || seekMax <= 0) return;
      const ratio = clampNumber(
        (clientX - rect.left) / Math.max(rect.width, 1),
        0,
        1,
      );
      commitSeek(ratio * seekMax);
    },
    [commitSeek, seekMax],
  );
  const handlePointerDown = (event) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    seekFromClientX(event.clientX);
  };
  const handlePointerMove = (event) => {
    if (event.buttons !== 1) return;
    seekFromClientX(event.clientX);
  };
  const handleKeyDown = (event) => {
    if (seekMax <= 0) return;
    const step = event.shiftKey ? 30 : 5;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      commitSeek(safeCurrentTime - step);
    } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      commitSeek(safeCurrentTime + step);
    } else if (event.key === "Home") {
      event.preventDefault();
      commitSeek(0);
    } else if (event.key === "End") {
      event.preventDefault();
      commitSeek(seekMax);
    } else if (event.key === "PageDown") {
      event.preventDefault();
      commitSeek(safeCurrentTime - 30);
    } else if (event.key === "PageUp") {
      event.preventDefault();
      commitSeek(safeCurrentTime + 30);
    }
  };
  return (
    <div
      ref={rootRef}
      role="slider"
      tabIndex={seekMax > 0 ? 0 : -1}
      aria-disabled={seekMax <= 0}
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={Math.round(seekMax)}
      aria-valuenow={Math.round(safeCurrentTime)}
      aria-valuetext={`${formatMediaTime(safeCurrentTime)} of ${formatMediaTime(seekMax)}`}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      className="relative h-10 min-w-0 cursor-pointer overflow-hidden bg-transparent px-2 outline-none ring-1 ring-white/10 transition focus-visible:ring-2 focus-visible:ring-foreground/70 aria-disabled:cursor-default aria-disabled:opacity-50"
    >
      <div className="flex h-full items-center gap-px">
        {Array.from({ length: WAVEFORM_SEEK_BAR_COUNT }).map((_, index) => {
          const position = (index + 0.5) / WAVEFORM_SEEK_BAR_COUNT;
          const filled = seekMax > 0 && position <= progress;
          return (
            <span
              key={index}
              aria-hidden="true"
              className={cn(
                "block w-[3px] flex-1 transition-colors",
                filled
                  ? "bg-white shadow-[0_0_10px_rgba(255,255,255,0.58)]"
                  : "bg-zinc-500/70",
              )}
              style={{
                height: `${Math.round(waveformSeekLevel(index, WAVEFORM_SEEK_BAR_COUNT) * 82)}%`,
              }}
            />
          );
        })}
      </div>
      {seekMax > 0 ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-1 w-px bg-white/90 shadow-[0_0_10px_rgba(255,255,255,0.75)]"
          style={{ left: `${progress * 100}%` }}
        />
      ) : null}
    </div>
  );
}

function TransportButton({
  active = false,
  children,
  className,
  disabled = false,
  label,
  onClick,
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || !onClick}
      className={cn(
        "grid size-8 shrink-0 place-items-center border border-transparent text-muted-foreground transition hover:border-border hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-35",
        active && "border-border bg-muted text-foreground",
        className,
      )}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}

export function MediaPlayerControls({
  className,
  currentTime,
  density = "full",
  duration,
  isPlaying,
  muted,
  onMute,
  onNext,
  onOpen,
  onPlayPause,
  onPrevious,
  onRepeat,
  onSeek,
  onSeekBy,
  onShuffle,
  onVolume,
  repeat = false,
  seekVariant = "slider",
  shuffle = false,
  subtitle,
  title,
  volume,
}) {
  const compact = density === "compact";
  const seekMax = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const safeCurrentTime = clampNumber(currentTime, 0, seekMax);
  const safeVolume = clampNumber(volume, 0, 1);
  return (
    <div
      className={cn(
        "frame bg-background/95 p-3 backdrop-blur supports-[backdrop-filter]:bg-background/88",
        className,
      )}
    >
      <div className="mb-2 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 text-muted-foreground">
        <span>{formatMediaTime(safeCurrentTime)}</span>
        {seekVariant === "waveform" ? (
          <WaveformSeekBar
            currentTime={safeCurrentTime}
            duration={seekMax}
            onSeek={onSeek}
          />
        ) : (
          <input
            type="range"
            min={0}
            max={seekMax || 0}
            step={0.1}
            value={safeCurrentTime}
            onChange={(event) => onSeek(sliderValue(event))}
            className="h-2 w-full accent-foreground"
            aria-label="Seek"
          />
        )}
        <span>{formatMediaTime(duration)}</span>
      </div>

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <button
            type="button"
            onClick={onOpen}
            disabled={!onOpen}
            className="min-w-0 text-left disabled:pointer-events-none"
          >
            <p className="truncate">{title}</p>
            {subtitle ? (
              <p className="truncate text-muted-foreground">{subtitle}</p>
            ) : null}
          </button>
        </div>

        <div className="flex items-center justify-center gap-2">
          {!compact ? (
            <TransportButton
              active={shuffle}
              label="Shuffle"
              onClick={onShuffle}
            >
              <IconArrowsShuffle className="size-4" />
            </TransportButton>
          ) : null}
          <TransportButton label="Previous" onClick={onPrevious}>
            <IconPlayerSkipBack className="size-4" />
          </TransportButton>
          {!compact ? (
            <TransportButton
              label="Back 10 seconds"
              onClick={onSeekBy ? () => onSeekBy(-10) : undefined}
            >
              <IconRewindBackward10 className="size-4" />
            </TransportButton>
          ) : null}
          <button
            type="button"
            onClick={onPlayPause}
            className="grid size-10 shrink-0 place-items-center bg-foreground text-background transition hover:bg-foreground/90"
            aria-label={isPlaying ? "Pause" : "Play"}
            title={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? (
              <IconPlayerPause className="size-6" />
            ) : (
              <IconPlayerPlay className="size-6" />
            )}
          </button>
          {!compact ? (
            <TransportButton
              label="Forward 10 seconds"
              onClick={onSeekBy ? () => onSeekBy(10) : undefined}
            >
              <IconRewindForward10 className="size-4" />
            </TransportButton>
          ) : null}
          <TransportButton label="Next" onClick={onNext}>
            <IconPlayerSkipForward className="size-4" />
          </TransportButton>
          {!compact ? (
            <TransportButton active={repeat} label="Repeat" onClick={onRepeat}>
              <IconRepeat className="size-4" />
            </TransportButton>
          ) : null}
          {onOpen ? (
            <TransportButton label="Open" onClick={onOpen}>
              <IconMaximize className="size-4" />
            </TransportButton>
          ) : null}
        </div>

        <div className="hidden w-64 items-center gap-2 md:flex">
          <TransportButton label={muted ? "Unmute" : "Mute"} onClick={onMute}>
            {muted || safeVolume === 0 ? (
              <IconVolumeOff className="size-4" />
            ) : (
              <IconVolume className="size-4" />
            )}
          </TransportButton>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={safeVolume}
            onChange={(event) => onVolume?.(sliderValue(event))}
            className="h-2 w-full accent-foreground"
            aria-label="Volume"
          />
        </div>
      </div>
    </div>
  );
}
