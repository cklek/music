import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { initialsFor, paletteFor } from "./library";

export function Cover({ className, track, preferArt = true }) {
  const [artFailed, setArtFailed] = useState(false);
  const palette = paletteFor(track.albumKey);
  const showArt = Boolean(preferArt && track.artUrl && !artFailed);
  useEffect(() => {
    setArtFailed(false);
  }, [track.artUrl]);
  return (
    <div
      className={cn(
        "relative isolate overflow-hidden frame bg-muted",
        className,
      )}
      style={
        showArt
          ? undefined
          : {
              background: `linear-gradient(135deg, ${palette.from}, ${palette.via} 52%, ${palette.to})`,
              color: palette.text,
            }
      }
    >
      {showArt ? (
        <img
          src={track.artUrl}
          alt=""
          loading="lazy"
          className="size-full object-cover"
          onError={() => setArtFailed(true)}
        />
      ) : (
        <>
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_20%,rgba(255,255,255,0.32),transparent_32%),radial-gradient(circle_at_80%_85%,rgba(255,255,255,0.18),transparent_30%)]" />
          <div className="absolute inset-x-0 bottom-0 h-1/2 bg-black/20" />
          <div className="relative grid size-full place-items-center p-1 text-center">
            <span>{initialsFor(track)}</span>
          </div>
        </>
      )}
    </div>
  );
}
