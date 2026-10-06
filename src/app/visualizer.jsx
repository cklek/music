import { useCallback, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { formatMediaTime } from "@/ui/media/player-controls";

function clampMusicTime(value, duration) {
  if (!Number.isFinite(value) || !Number.isFinite(duration) || duration <= 0) {
    return 0;
  }
  return Math.min(duration, Math.max(0, value));
}
export function Visualizer({
  active,
  analyserRef,
  className,
  currentTime = 0,
  duration = 0,
  onSeek,
}) {
  const canvasContainerRef = useRef(null);
  const canvasRef = useRef(null);
  const animationRef = useRef(undefined);
  const frequencyDataRef = useRef([]);
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const safeCurrentTime = clampMusicTime(currentTime, safeDuration);
  const progressRef = useRef(0);
  const canSeek = Boolean(onSeek && safeDuration > 0);
  useEffect(() => {
    progressRef.current =
      safeDuration > 0 ? Math.min(1, safeCurrentTime / safeDuration) : 0;
  }, [safeCurrentTime, safeDuration]);
  const commitSeek = useCallback(
    (value) => {
      if (!onSeek || safeDuration <= 0) return;
      onSeek(clampMusicTime(value, safeDuration));
    },
    [onSeek, safeDuration],
  );
  const seekFromClientX = useCallback(
    (clientX) => {
      const rect = canvasContainerRef.current?.getBoundingClientRect();
      if (!rect || safeDuration <= 0) return;
      const ratio = Math.min(
        1,
        Math.max(0, (clientX - rect.left) / Math.max(rect.width, 1)),
      );
      commitSeek(ratio * safeDuration);
    },
    [commitSeek, safeDuration],
  );
  const handlePointerDown = (event) => {
    if (!canSeek) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    seekFromClientX(event.clientX);
  };
  const handlePointerMove = (event) => {
    if (!canSeek || event.buttons !== 1) return;
    seekFromClientX(event.clientX);
  };
  const handleKeyDown = (event) => {
    if (!canSeek) return;
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
      commitSeek(safeDuration);
    }
  };
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = canvasContainerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const drawingCanvas = canvas;
    const drawingContainer = container;
    const drawingContext = ctx;
    let cachedWidth = 0;
    let cachedHeight = 0;
    let staticPattern = [];
    const barWidth = 3;
    const barGap = 2;
    const step = barWidth + barGap;
    function resizeCanvas() {
      const rect = drawingContainer.getBoundingClientRect();
      if (rect.width === cachedWidth && rect.height === cachedHeight) return;
      cachedWidth = rect.width;
      cachedHeight = rect.height;
      const dpr = window.devicePixelRatio || 1;
      drawingCanvas.width = rect.width * dpr;
      drawingCanvas.height = rect.height * dpr;
      drawingCanvas.style.width = "100%";
      drawingCanvas.style.height = "100%";
      drawingContext.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    function generateStaticPattern(barCount) {
      return Array.from({ length: barCount }, (_, index) => {
        const position = index / Math.max(barCount - 1, 1);
        const wave =
          Math.sin(position * Math.PI * 4) * 0.28 +
          Math.sin(position * Math.PI * 11) * 0.14;
        return Math.max(0.16, 0.36 + wave);
      });
    }
    function animate() {
      resizeCanvas();
      const width = cachedWidth;
      const height = cachedHeight;
      const centerY = height / 2;
      const barCount = Math.max(1, Math.floor(width / step));
      if (active && analyserRef.current) {
        const analyser = analyserRef.current;
        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(dataArray);
        const startFreq = Math.floor(dataArray.length * 0.04);
        const endFreq = Math.floor(dataArray.length * 0.68);
        const relevantData = dataArray.slice(startFreq, endFreq);
        frequencyDataRef.current = Array.from(
          { length: barCount },
          (_, index) => {
            const dataIndex = Math.floor(
              (index / barCount) * relevantData.length,
            );
            return Math.max(0.08, (relevantData[dataIndex] || 0) / 255);
          },
        );
      }
      if (!active && staticPattern.length !== barCount) {
        staticPattern = generateStaticPattern(barCount);
      }
      const values =
        active && frequencyDataRef.current.length > 0
          ? frequencyDataRef.current
          : staticPattern;
      /* The canvas is transparent, so the theme's ground shows through; the
       * bars are its ink and muted, read off the element each frame so a
       * theme switch repaints them. */
      const palette = getComputedStyle(drawingCanvas);
      const ink = palette.getPropertyValue("--ink").trim() || "currentColor";
      const muted =
        palette.getPropertyValue("--muted").trim() || "currentColor";
      drawingContext.clearRect(0, 0, width, height);
      drawingContext.shadowBlur = 0;
      drawingContext.shadowColor = "transparent";
      for (let index = 0; index < barCount; index += 1) {
        const value = values[index % Math.max(values.length, 1)] || 0.12;
        const barHeight = Math.max(3, value * height * 0.86);
        const x = index * step;
        const y = centerY - barHeight / 2;
        const barPosition = (index + 0.5) / barCount;
        const progressed = barPosition <= progressRef.current;
        drawingContext.globalAlpha = progressed ? 1 : active ? 0.72 : 0.34;
        drawingContext.fillStyle = progressed ? ink : muted;
        drawingContext.fillRect(x, y, barWidth, barHeight);
      }
      animationRef.current = requestAnimationFrame(animate);
    }
    const resizeObserver = new ResizeObserver(resizeCanvas);
    resizeObserver.observe(drawingContainer);
    animate();
    return () => {
      resizeObserver.disconnect();
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [active, analyserRef]);
  return (
    <div
      ref={canvasContainerRef}
      role="slider"
      tabIndex={canSeek ? 0 : -1}
      aria-disabled={!canSeek}
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={Math.round(safeDuration)}
      aria-valuenow={Math.round(safeCurrentTime)}
      aria-valuetext={`${formatMediaTime(safeCurrentTime)} of ${formatMediaTime(safeDuration)}`}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      className={cn(
        "h-16 cursor-pointer overflow-hidden bg-transparent outline-none ring-1 ring-border transition focus-visible:ring-2 focus-visible:ring-foreground/60 aria-disabled:cursor-default",
        className,
      )}
    >
      <canvas ref={canvasRef} className="block size-full" />
    </div>
  );
}
