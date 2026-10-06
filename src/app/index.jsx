import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AppLayout } from "@/shell/layout";
import { useAppMenu } from "@/shell/menu-context";
import { themeViewItems, useTheme } from "@/lib/theme";
import { useAppDialog } from "@/shell/dialog";
import { useSearchParam, useUpdateSearchParams } from "@/lib/url-query-state";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { ScrollArea } from "@/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import {
  IconChevronRight,
  IconCopy,
  IconDisc,
  IconList,
  IconLoader2,
  IconMusic,
  IconPencil,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlaylist,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconStar,
  IconTrash,
  IconUpload,
  IconUser,
  IconX,
} from "@/ui/icons";
import {
  MenubarCheckboxItem,
  MenubarItem,
  MenubarSeparator,
  MenubarShortcut,
} from "@/ui/menubar";
import {
  MediaPlayerControls,
  formatMediaTime,
} from "@/ui/media/player-controls";
import * as api from "./client";
import { Cover } from "./cover";
import { albumsFor, artistsFor, formatBytes, trackMatches } from "./library";
import { usePlayer } from "./player";
import { Visualizer } from "./visualizer";

const ACCEPT =
  "audio/aac,audio/flac,audio/mp4,audio/mpeg,audio/ogg,audio/wav,.m4a,.opus,.aiff";
const VIEWS = ["tracks", "albums", "artists", "favorites", "playlist"];

function countLabel(count, noun) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function isTypingTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
  );
}

function trackSubtitle(track) {
  return [track.artist, track.album].filter(Boolean).join(" / ");
}

export default function MusicPage() {
  const player = usePlayer();
  const dialog = useAppDialog();
  const updateSearchParams = useUpdateSearchParams();
  const viewParam = useSearchParam("view");
  const view = VIEWS.includes(viewParam) ? viewParam : "tracks";
  const albumParam = useSearchParam("album") || "";
  const artistParam = useSearchParam("artist") || "";
  const playlistParam = Number(useSearchParam("playlist")) || 0;
  const queryParam = useSearchParam("q") || "";
  const [query, setQuery] = useState(queryParam);
  const [library, setLibrary] = useState({
    tracks: [],
    playlists: [],
    musicDir: "",
  });
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [busyPath, setBusyPath] = useState(null);
  const fileInputRef = useRef(null);
  const restoredRef = useRef(false);
  const { selectTrack, setQueue, track: current, storedPath } = player;

  const load = useCallback(async ({ quiet = false } = {}) => {
    try {
      const next = await api.fetchLibrary();
      setLibrary(next);
      return next;
    } catch (error) {
      if (!quiet) toast.error(error.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setQuery(queryParam);
  }, [queryParam]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      if (query !== queryParam)
        updateSearchParams({ q: query || null }, { replace: true });
    }, 200);
    return () => window.clearTimeout(timeout);
  }, [query, queryParam, updateSearchParams]);

  const tracks = library.tracks;
  const albums = useMemo(() => albumsFor(tracks), [tracks]);
  const artists = useMemo(() => artistsFor(tracks), [tracks]);
  const trackByPath = useMemo(
    () => new Map(tracks.map((track) => [track.path, track])),
    [tracks],
  );
  const playlist =
    library.playlists.find((entry) => entry.id === playlistParam) || null;
  const album = albumParam
    ? albums.find((entry) => entry.key === albumParam) || null
    : null;
  const artist = artistParam
    ? artists.find((entry) => entry.key === artistParam) || null
    : null;

  const visible = useMemo(() => {
    let list = tracks;
    if (view === "favorites") list = tracks.filter((track) => track.favorite);
    else if (view === "playlist")
      list = playlist
        ? playlist.paths.map((path) => trackByPath.get(path)).filter(Boolean)
        : [];
    else if (album) list = album.tracks;
    else if (artist) list = artist.tracks;
    return list.filter((track) => trackMatches(track, queryParam));
  }, [album, artist, playlist, queryParam, trackByPath, tracks, view]);

  useEffect(() => {
    if (current) return;
    const track = tracks.find((entry) => entry.path === storedPath);
    if (!track && restoredRef.current) return;
    restoredRef.current = true;
    if (track) selectTrack(track, { queue: tracks, resumeStored: true });
  }, [current, selectTrack, storedPath, tracks]);

  useEffect(() => {
    if (!current) return;
    const fresh = trackByPath.get(current.path);
    if (
      fresh &&
      fresh !== current &&
      (fresh.title !== current.title ||
        fresh.artist !== current.artist ||
        fresh.album !== current.album ||
        fresh.favorite !== current.favorite)
    ) {
      selectTrack(fresh);
    }
  }, [current, selectTrack, trackByPath]);

  const playTrack = useCallback(
    (track) => {
      if (current?.path === track.path) player.togglePlay();
      else
        selectTrack(track, {
          autoplay: true,
          queue: visible.length ? visible : [track],
        });
    },
    [current?.path, player, selectTrack, visible],
  );

  const playAll = useCallback(() => {
    if (!visible.length) return;
    const start = player.shuffle
      ? visible[Math.floor(Math.random() * visible.length)]
      : visible[0];
    selectTrack(start, { autoplay: true, queue: visible });
  }, [player.shuffle, selectTrack, visible]);

  const openView = useCallback(
    (nextView, extra = {}) =>
      updateSearchParams({
        view: nextView === "tracks" ? null : nextView,
        album: null,
        artist: null,
        playlist: null,
        ...extra,
      }),
    [updateSearchParams],
  );

  const toggleFavorite = useCallback(
    async (track) => {
      setBusyPath(track.path);
      try {
        await api.setFavorite(track.path, !track.favorite);
        await load({ quiet: true });
      } catch (error) {
        toast.error(error.message);
      } finally {
        setBusyPath(null);
      }
    },
    [load],
  );

  const editTrack = useCallback(
    async (track) => {
      const title = await dialog.prompt({
        title: "Title",
        defaultValue: track.title,
        inputLabel: "Track title",
        confirmLabel: "Next",
      });
      if (title === null) return;
      const artistName = await dialog.prompt({
        title: "Artist",
        defaultValue: track.artist,
        inputLabel: "Artist",
        confirmLabel: "Next",
      });
      if (artistName === null) return;
      const albumName = await dialog.prompt({
        title: "Album",
        defaultValue: track.album,
        inputLabel: "Album",
        confirmLabel: "Save",
      });
      if (albumName === null) return;
      try {
        await api.updateTrack(track.path, {
          title,
          artist: artistName,
          album: albumName,
        });
        await load({ quiet: true });
        toast.success("Tags saved (the file itself is untouched)");
      } catch (error) {
        toast.error(error.message);
      }
    },
    [dialog, load],
  );

  const resetTrack = useCallback(
    async (track) => {
      try {
        await api.updateTrack(track.path, { reset: true });
        await load({ quiet: true });
      } catch (error) {
        toast.error(error.message);
      }
    },
    [load],
  );

  const removeTrack = useCallback(
    async (track) => {
      const ok = await dialog.confirm({
        title: `Delete "${track.title}"?`,
        description:
          "The file is removed from the music folder. This cannot be undone.",
        tone: "destructive",
      });
      if (!ok) return;
      try {
        const index = visible.findIndex((entry) => entry.path === track.path);
        await api.deleteTrack(track.path);
        const next = await load({ quiet: true });
        if (current?.path === track.path) {
          const remaining = visible.filter(
            (entry) => entry.path !== track.path,
          );
          const replacement = remaining[Math.min(index, remaining.length - 1)];
          if (replacement && next)
            selectTrack(replacement, { queue: remaining });
          else player.clear();
        }
        toast.success("Deleted");
      } catch (error) {
        toast.error(error.message);
      }
    },
    [current?.path, dialog, load, player, selectTrack, visible],
  );

  const copyLink = useCallback(async (track) => {
    try {
      await navigator.clipboard.writeText(
        new URL(track.url, window.location.href).href,
      );
      toast.success("Link copied");
    } catch {
      toast.error("Clipboard unavailable");
    }
  }, []);

  const newPlaylist = useCallback(
    async (paths = []) => {
      const name = await dialog.prompt({
        title: "New playlist",
        inputLabel: "Name",
        confirmLabel: "Create",
      });
      if (!name) return null;
      try {
        const { playlist: created } = await api.createPlaylist(name, paths);
        await load({ quiet: true });
        return created;
      } catch (error) {
        toast.error(error.message);
        return null;
      }
    },
    [dialog, load],
  );

  const addToPlaylist = useCallback(
    async (target, track) => {
      try {
        await api.updatePlaylist(target.id, { add: [track.path] });
        await load({ quiet: true });
        toast.success(`Added to ${target.name}`);
      } catch (error) {
        toast.error(error.message);
      }
    },
    [load],
  );

  const removeFromPlaylist = useCallback(
    async (target, track) => {
      try {
        await api.updatePlaylist(target.id, { remove: [track.path] });
        await load({ quiet: true });
      } catch (error) {
        toast.error(error.message);
      }
    },
    [load],
  );

  const renamePlaylist = useCallback(
    async (target) => {
      const name = await dialog.prompt({
        title: "Rename playlist",
        defaultValue: target.name,
        inputLabel: "Name",
        confirmLabel: "Rename",
      });
      if (!name) return;
      try {
        await api.updatePlaylist(target.id, { name });
        await load({ quiet: true });
      } catch (error) {
        toast.error(error.message);
      }
    },
    [dialog, load],
  );

  const removePlaylist = useCallback(
    async (target) => {
      const ok = await dialog.confirm({
        title: `Delete playlist "${target.name}"?`,
        description: "The tracks stay in the library.",
        tone: "destructive",
      });
      if (!ok) return;
      try {
        await api.deletePlaylist(target.id);
        if (playlistParam === target.id) openView("tracks");
        await load({ quiet: true });
      } catch (error) {
        toast.error(error.message);
      }
    },
    [dialog, load, openView, playlistParam],
  );

  const rescan = useCallback(async () => {
    setScanning(true);
    try {
      const result = await api.rescanLibrary();
      await load({ quiet: true });
      toast.success(`${result.count} tracks, ${result.parsed} newly read`);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setScanning(false);
    }
  }, [load]);

  const upload = useCallback(
    async (files) => {
      const list = Array.from(files || []).filter((file) => file.size > 0);
      if (!list.length) return;
      setUploading(true);
      try {
        const result = await api.uploadFiles(list);
        await load({ quiet: true });
        if (result.uploaded.length)
          toast.success(
            `Added ${result.uploaded.length} ${result.uploaded.length === 1 ? "track" : "tracks"}`,
          );
        for (const rejected of result.rejected) toast.error(rejected.error);
      } catch (error) {
        toast.error(error.message);
      } finally {
        setUploading(false);
      }
    },
    [load],
  );

  const pickFiles = useCallback(() => fileInputRef.current?.click(), []);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (
        isTypingTarget(event.target) ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      )
        return;
      if (event.key === " ") {
        event.preventDefault();
        if (current) player.togglePlay();
        else playAll();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        if (event.shiftKey) player.playRelative(1);
        else player.seekBy(10);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        if (event.shiftKey) player.playRelative(-1);
        else player.seekBy(-10);
      } else if (event.key === "/") {
        event.preventDefault();
        document.getElementById("music-search")?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [current, playAll, player]);

  useEffect(() => {
    if (player.error) toast.error(player.error);
  }, [player.error]);

  const heading =
    view === "favorites"
      ? "Favorites"
      : view === "playlist"
        ? playlist?.name || "Playlist"
        : view === "albums" && !album
          ? "Albums"
          : view === "artists" && !artist
            ? "Artists"
            : album
              ? album.album
              : artist
                ? artist.name
                : "All tracks";
  const showGrid =
    (view === "albums" && !album) || (view === "artists" && !artist);
  const subheading = album
    ? `${album.artist}${album.year ? ` / ${album.year}` : ""} / ${countLabel(album.tracks.length, "track")} / ${formatBytes(album.size)}`
    : artist
      ? `${countLabel(artist.albums.size, "album")} / ${countLabel(artist.tracks.length, "track")}`
      : showGrid && view === "albums"
        ? countLabel(albums.length, "album")
        : showGrid
          ? countLabel(artists.length, "artist")
          : countLabel(visible.length, "track");
  const currentAlbum = current
    ? albums.find((entry) => entry.key === current.albumKey)
    : null;

  return (
    <AppLayout showHeader={false}>
      <PlayerMenus
        onUpload={pickFiles}
        onRescan={rescan}
        onNewPlaylist={() => void newPlaylist()}
        onPlayAll={playAll}
        onView={openView}
        view={view}
        hasTracks={visible.length > 0}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPT}
        multiple
        className="hidden"
        onChange={(event) => {
          void upload(event.target.files);
          event.target.value = "";
        }}
      />
      <div
        className={cn(
          "relative flex h-full min-h-0",
          current && "pb-36 md:pb-32",
        )}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes("Files")) {
            event.preventDefault();
            setDragging(true);
          }
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget))
            setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void upload(event.dataTransfer.files);
        }}
      >
        <aside className="hidden w-52 shrink-0 flex-col rule-r md:flex">
          <ScrollArea className="min-h-0 flex-1" viewportClassName="py-1">
            <p className="flex h-8 items-center px-3 text-muted-foreground uppercase">
              Library
            </p>
            <SidebarItem
              icon={IconMusic}
              label="Tracks"
              count={tracks.length}
              active={view === "tracks" && !album && !artist}
              onClick={() => openView("tracks")}
            />
            <SidebarItem
              icon={IconDisc}
              label="Albums"
              count={albums.length}
              active={view === "albums" || Boolean(album)}
              onClick={() => openView("albums")}
            />
            <SidebarItem
              icon={IconUser}
              label="Artists"
              count={artists.length}
              active={view === "artists" || Boolean(artist)}
              onClick={() => openView("artists")}
            />
            <SidebarItem
              icon={IconStar}
              label="Favorites"
              count={tracks.filter((track) => track.favorite).length}
              active={view === "favorites"}
              onClick={() => openView("favorites")}
            />
            <div className="mt-2 flex h-8 items-center justify-between px-3">
              <p className="text-muted-foreground uppercase">Playlists</p>
              <button
                type="button"
                onClick={() => void newPlaylist()}
                className="grid size-6 place-items-center text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="New playlist"
                title="New playlist"
              >
                <IconPlus className="size-4" />
              </button>
            </div>
            {library.playlists.length === 0 ? (
              <p className="px-3 py-2 text-muted-foreground">None yet.</p>
            ) : null}
            {library.playlists.map((entry) => (
              <SidebarItem
                key={entry.id}
                icon={IconPlaylist}
                label={entry.name}
                count={entry.paths.length}
                active={view === "playlist" && playlistParam === entry.id}
                onClick={() =>
                  openView("playlist", { playlist: String(entry.id) })
                }
              />
            ))}
          </ScrollArea>
          {library.musicDir ? (
            <p
              className="truncate rule-t px-3 py-2 text-muted-foreground"
              title={library.musicDir}
            >
              {library.musicDir}
            </p>
          ) : null}
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-12 shrink-0 items-center gap-2 rule-b px-3">
            <div className="relative min-w-0 flex-1 md:max-w-sm">
              <IconSearch className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="music-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search title, artist, album"
                className="h-8 pl-7"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="absolute top-1/2 right-2 grid size-6 -translate-y-1/2 place-items-center text-muted-foreground hover:text-foreground"
                  aria-label="Clear search"
                >
                  <IconX className="size-4" />
                </button>
              ) : null}
            </div>
            <div className="ml-auto flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={rescan}
                disabled={scanning}
                className="h-8 gap-2"
              >
                <IconRefresh
                  className={cn("size-4", scanning && "animate-spin")}
                />
                <span className="hidden sm:inline">Rescan</span>
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={pickFiles}
                disabled={uploading}
                className="h-8 gap-2"
              >
                {uploading ? (
                  <IconLoader2 className="size-4 animate-spin" />
                ) : (
                  <IconUpload className="size-4" />
                )}
                Upload
              </Button>
            </div>
          </div>

          <div className="flex shrink-0 items-end justify-between gap-4 px-3 py-4">
            <div className="min-w-0">
              {album || artist ? (
                <button
                  type="button"
                  onClick={() => openView(album ? "albums" : "artists")}
                  className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
                >
                  {album ? "Albums" : "Artists"}
                  <IconChevronRight className="size-3" />
                </button>
              ) : null}
              <h1 className="truncate">{heading}</h1>
              <p className="truncate text-muted-foreground">{subheading}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {playlist ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void renamePlaylist(playlist)}
                    className="h-8"
                  >
                    Rename
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void removePlaylist(playlist)}
                    className="h-8 hover:bg-destructive hover:text-destructive-foreground"
                  >
                    Delete
                  </Button>
                </>
              ) : null}
              {!showGrid && visible.length ? (
                <Button
                  type="button"
                  size="sm"
                  onClick={playAll}
                  className="h-8 gap-2"
                >
                  <IconPlayerPlay className="size-4" />
                  Play {player.shuffle ? "shuffled" : "all"}
                </Button>
              ) : null}
            </div>
          </div>

          <ScrollArea className="min-h-0 flex-1" viewportClassName="pb-4">
            {loading ? (
              <p className="px-3 py-10 text-muted-foreground">
                Reading the library…
              </p>
            ) : tracks.length === 0 ? (
              <EmptyLibrary musicDir={library.musicDir} onUpload={pickFiles} />
            ) : showGrid && view === "albums" ? (
              <div
                className="grid gap-4 px-3"
                style={{
                  /* Fixed 144px tiles, not `1fr`: a fractional column width would put a
                   * fractional-width square cover above the caption, and the
                   * caption off the grid with it. */
                  gridTemplateColumns: "repeat(auto-fill, 144px)",
                }}
              >
                {albums
                  .filter(
                    (entry) =>
                      !queryParam ||
                      entry.tracks.some((track) =>
                        trackMatches(track, queryParam),
                      ),
                  )
                  .map((entry) => (
                    <AlbumCard
                      key={entry.key}
                      album={entry}
                      playing={Boolean(
                        current &&
                          player.isPlaying &&
                          current.albumKey === entry.key,
                      )}
                      onSelect={() => openView("albums", { album: entry.key })}
                    />
                  ))}
              </div>
            ) : showGrid && view === "artists" ? (
              <div>
                {artists
                  .filter(
                    (entry) =>
                      !queryParam ||
                      entry.tracks.some((track) =>
                        trackMatches(track, queryParam),
                      ),
                  )
                  .map((entry) => (
                    <button
                      key={entry.key}
                      type="button"
                      onClick={() => openView("artists", { artist: entry.key })}
                      className="flex w-full items-center gap-3 rule-b px-3 py-2 text-left hover:bg-muted/50"
                    >
                      {/* One character is a 7px advance, and centring an odd
                       * width in an even box puts it on a half pixel. `pr-px`
                       * takes the content box to 31px so the glyph lands on
                       * 12 exactly; the tile itself is still 32px. */}
                      <span className="grid size-8 place-items-center pr-px frame bg-muted">
                        {entry.name.slice(0, 1).toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{entry.name}</span>
                        <span className="block truncate text-muted-foreground">
                          {countLabel(entry.albums.size, "album")} /{" "}
                          {countLabel(entry.tracks.length, "track")}
                        </span>
                      </span>
                      <IconChevronRight className="size-4 text-muted-foreground" />
                    </button>
                  ))}
              </div>
            ) : visible.length === 0 ? (
              <p className="px-3 py-10 text-muted-foreground">
                {queryParam
                  ? "No tracks match."
                  : view === "favorites"
                    ? "Star a track to keep it here."
                    : view === "playlist"
                      ? "Add tracks from a track’s menu."
                      : "Nothing here."}
              </p>
            ) : (
              <div className="rule-t">
                {visible.map((track) => (
                  <TrackRow
                    key={track.path}
                    track={track}
                    selected={current?.path === track.path}
                    isPlaying={current?.path === track.path && player.isPlaying}
                    busy={busyPath === track.path}
                    playlists={library.playlists}
                    inPlaylist={playlist}
                    onPlay={() => playTrack(track)}
                    onSelect={() => selectTrack(track, { queue: visible })}
                    onStar={() => void toggleFavorite(track)}
                    onEdit={() => void editTrack(track)}
                    onReset={() => void resetTrack(track)}
                    onCopy={() => void copyLink(track)}
                    onDelete={() => void removeTrack(track)}
                    onAddToPlaylist={(target) =>
                      void addToPlaylist(target, track)
                    }
                    onNewPlaylist={() => void newPlaylist([track.path])}
                    onRemoveFromPlaylist={
                      playlist
                        ? () => void removeFromPlaylist(playlist, track)
                        : null
                    }
                  />
                ))}
              </div>
            )}
          </ScrollArea>
        </section>

        <aside className="hidden w-72 shrink-0 flex-col rule-l lg:flex xl:w-80">
          <NowPlaying
            track={current}
            album={currentAlbum}
            player={player}
            onStar={current ? () => void toggleFavorite(current) : undefined}
            onEdit={current ? () => void editTrack(current) : undefined}
            onDelete={current ? () => void removeTrack(current) : undefined}
            busy={Boolean(current && busyPath === current.path)}
          />
        </aside>

        {dragging ? (
          <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center bg-background/80 backdrop-blur-sm">
            <div className="border border-dashed border-foreground/50 px-6 py-4">
              Drop audio files to add them
            </div>
          </div>
        ) : null}

        {current ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 p-2 md:p-3">
            <MediaPlayerControls
              className="pointer-events-auto mx-auto max-w-5xl"
              title={current.title}
              subtitle={trackSubtitle(current)}
              currentTime={player.currentTime}
              duration={player.duration || current.duration || 0}
              isPlaying={player.isPlaying}
              muted={player.muted}
              volume={player.volume}
              shuffle={player.shuffle}
              repeat={player.repeat}
              seekVariant="waveform"
              onPlayPause={player.togglePlay}
              onNext={() => player.playRelative(1)}
              onPrevious={() => player.playRelative(-1)}
              onSeek={player.seek}
              onSeekBy={player.seekBy}
              onShuffle={player.toggleShuffle}
              onRepeat={player.toggleRepeat}
              onMute={player.toggleMute}
              onVolume={player.setVolume}
            />
          </div>
        ) : null}
      </div>
    </AppLayout>
  );
}

function PlayerMenus({
  onUpload,
  onRescan,
  onNewPlaylist,
  onPlayAll,
  onView,
  view,
  hasTracks,
}) {
  const player = usePlayer();
  const { isPlaying, muted, repeat, shuffle, track } = player;
  const theme = useTheme();
  useAppMenu(
    {
      file: [
        { id: "upload", label: "Upload audio…", onSelect: onUpload },
        { id: "rescan", label: "Rescan library", onSelect: onRescan },
        { id: "sep", kind: "separator" },
        { id: "playlist", label: "New playlist…", onSelect: onNewPlaylist },
      ],
      menus: [
        {
          id: "playback",
          label: "Playback",
          content: (
            <>
              <MenubarItem
                disabled={!track && !hasTracks}
                onClick={track ? player.togglePlay : onPlayAll}
              >
                {track ? (isPlaying ? "Pause" : "Play") : "Play all"}
                <MenubarShortcut>Space</MenubarShortcut>
              </MenubarItem>
              <MenubarItem
                disabled={!track}
                onClick={() => player.playRelative(1)}
              >
                Next track
                <MenubarShortcut>Shift →</MenubarShortcut>
              </MenubarItem>
              <MenubarItem
                disabled={!track}
                onClick={() => player.playRelative(-1)}
              >
                Previous track
                <MenubarShortcut>Shift ←</MenubarShortcut>
              </MenubarItem>
              <MenubarSeparator />
              <MenubarCheckboxItem
                checked={shuffle}
                onCheckedChange={player.toggleShuffle}
              >
                Shuffle
              </MenubarCheckboxItem>
              <MenubarCheckboxItem
                checked={repeat}
                onCheckedChange={player.toggleRepeat}
              >
                Repeat queue
              </MenubarCheckboxItem>
              <MenubarCheckboxItem
                checked={muted}
                onCheckedChange={player.toggleMute}
              >
                Mute
              </MenubarCheckboxItem>
            </>
          ),
        },
      ],
      view: [
        {
          id: "tracks",
          kind: "checkbox",
          label: "Tracks",
          checked: view === "tracks",
          onSelect: () => onView("tracks"),
        },
        {
          id: "albums",
          kind: "checkbox",
          label: "Albums",
          checked: view === "albums",
          onSelect: () => onView("albums"),
        },
        {
          id: "artists",
          kind: "checkbox",
          label: "Artists",
          checked: view === "artists",
          onSelect: () => onView("artists"),
        },
        {
          id: "favorites",
          kind: "checkbox",
          label: "Favorites",
          checked: view === "favorites",
          onSelect: () => onView("favorites"),
        },
        { id: "theme-sep", kind: "separator" },
        ...themeViewItems(theme),
      ],
    },
    [
      theme.id,
      isPlaying,
      muted,
      repeat,
      shuffle,
      Boolean(track),
      view,
      hasTracks,
    ],
  );
  return null;
}

function SidebarItem({ icon: Icon, label, count, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-2 text-left transition hover:bg-muted/60",
        active
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {typeof count === "number" ? (
        <span className="text-muted-foreground/80">{count}</span>
      ) : null}
    </button>
  );
}

function EmptyLibrary({ musicDir, onUpload }) {
  return (
    <div className="max-w-md px-3 py-16">
      <IconMusic className="size-8 text-muted-foreground" />
      <h2 className="mt-4">The library is empty</h2>
      <p className="mt-2 text-muted-foreground">
        Drop audio files anywhere on this page, or copy them into
        {musicDir ? (
          <>
            {" "}
            <code className="text-foreground/80">{musicDir}</code>{" "}
          </>
        ) : (
          " the music folder "
        )}
        and rescan. Tags are read from the files; folders named Artist/Album
        fill in the rest.
      </p>
      <Button type="button" size="sm" onClick={onUpload} className="mt-4 gap-2">
        <IconUpload className="size-4" />
        Upload audio
      </Button>
    </div>
  );
}

function AlbumCard({ album, playing, onSelect }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "group block min-w-0 inset-ring-1 bg-card p-2 text-left transition hover:bg-muted/40",
        playing ? "inset-ring-foreground/70" : "inset-ring-border",
      )}
    >
      <Cover track={album.coverTrack} className="aspect-square w-full" />
      <p className="mt-2 truncate">{album.album}</p>
      <p className="truncate text-muted-foreground">
        {album.artist} / {countLabel(album.tracks.length, "track")}
      </p>
    </button>
  );
}

function TrackRow({
  track,
  selected,
  isPlaying,
  busy,
  playlists,
  inPlaylist,
  onPlay,
  onSelect,
  onStar,
  onEdit,
  onReset,
  onCopy,
  onDelete,
  onAddToPlaylist,
  onNewPlaylist,
  onRemoveFromPlaylist,
}) {
  return (
    <div
      className={cn(
        "group flex min-h-12 w-full items-center gap-3 rule-b px-3 py-2 text-left transition hover:bg-muted/50",
        selected && "bg-muted/70",
      )}
      onDoubleClick={onPlay}
    >
      <div className="relative size-8 shrink-0">
        <Cover track={track} className="size-8" />
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onPlay();
          }}
          className={cn(
            "absolute inset-0 grid place-items-center bg-black/45 text-white opacity-0 transition group-hover:opacity-100 hover:opacity-100 focus-visible:opacity-100",
            isPlaying && "opacity-100",
          )}
          aria-label={isPlaying ? "Pause track" : "Play track"}
        >
          {isPlaying ? (
            <IconPlayerPause className="size-4" />
          ) : (
            <IconPlayerPlay className="size-4" />
          )}
        </button>
      </div>
      <button
        type="button"
        onClick={onSelect}
        className="min-w-0 flex-1 text-left outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <p className={cn("truncate", selected && "text-foreground")}>
          {track.title}
        </p>
        <p className="truncate text-muted-foreground">{trackSubtitle(track)}</p>
      </button>
      <div className="ml-auto flex items-center gap-1">
        {track.edited ? (
          <span
            className="hidden text-muted-foreground/70 sm:inline"
            title="Tags edited here"
          >
            edited
          </span>
        ) : null}
        <span className="hidden w-8 text-right text-muted-foreground/75 sm:inline">
          {track.trackNumber ? String(track.trackNumber).padStart(2, "0") : ""}
        </span>
        <span className="hidden w-10 text-right text-muted-foreground/75 sm:inline">
          {track.duration ? formatMediaTime(track.duration) : ""}
        </span>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onStar();
          }}
          disabled={busy}
          className={cn(
            "grid size-8 place-items-center border border-transparent text-muted-foreground transition hover:border-border hover:bg-background hover:text-foreground disabled:cursor-wait disabled:opacity-60",
            track.favorite && "text-amber-300",
          )}
          aria-label={
            track.favorite ? "Remove from favorites" : "Add to favorites"
          }
          aria-pressed={track.favorite}
          title={track.favorite ? "Unfavorite" : "Favorite"}
        >
          <IconStar
            className={cn("size-4", track.favorite && "fill-current")}
          />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger
            className="grid size-8 place-items-center border border-transparent text-muted-foreground transition hover:border-border hover:bg-background hover:text-foreground data-[popup-open]:border-border data-[popup-open]:bg-background"
            aria-label="Track actions"
            title="More"
          >
            <IconList className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <IconPlaylist className="size-4" /> Add to playlist
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {playlists.map((entry) => (
                  <DropdownMenuItem
                    key={entry.id}
                    onClick={() => onAddToPlaylist(entry)}
                    disabled={entry.paths.includes(track.path)}
                  >
                    {entry.name}
                  </DropdownMenuItem>
                ))}
                {playlists.length ? <DropdownMenuSeparator /> : null}
                <DropdownMenuItem onClick={onNewPlaylist}>
                  <IconPlus className="size-4" /> New playlist…
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            {onRemoveFromPlaylist ? (
              <DropdownMenuItem onClick={onRemoveFromPlaylist}>
                <IconX className="size-4" /> Remove from {inPlaylist?.name}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onEdit}>
              <IconPencil className="size-4" /> Edit tags…
            </DropdownMenuItem>
            {track.edited ? (
              <DropdownMenuItem onClick={onReset}>
                <IconRefresh className="size-4" /> Use file tags
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem onClick={onCopy}>
              <IconCopy className="size-4" /> Copy link
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              <IconTrash className="size-4" /> Delete file
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function NowPlaying({ track, album, player, onStar, onEdit, onDelete, busy }) {
  if (!track) {
    return (
      <div className="px-3 py-16 text-muted-foreground">Select a track.</div>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScrollArea className="min-h-0 flex-1" viewportClassName="p-3">
        <Cover track={track} className="aspect-square w-full shadow-lg" />
        <div className="mt-3 min-w-0">
          <h2 className="break-words">{track.title}</h2>
          <p className="break-words text-muted-foreground">
            {trackSubtitle(track)}
          </p>
        </div>
        <Visualizer
          active={player.isPlaying}
          analyserRef={player.analyserRef}
          className="mt-3"
          currentTime={player.currentTime}
          duration={player.duration || track.duration || 0}
          onSeek={player.seek}
        />
        <dl className="mt-3 grid grid-cols-2 gap-2">
          <Stat label="Album">
            {album
              ? `${album.tracks.length} ${album.tracks.length === 1 ? "track" : "tracks"}`
              : "1 track"}
          </Stat>
          <Stat label="Size">{formatBytes(track.size)}</Stat>
          <Stat label="Year">{track.year || "—"}</Stat>
          <Stat label="Bitrate">
            {track.bitrate ? `${track.bitrate} kb/s` : "—"}
          </Stat>
          {track.genre ? <Stat label="Genre">{track.genre}</Stat> : null}
          <Stat label="File" className={track.genre ? "col-span-2" : ""}>
            <span className="break-all">{track.path}</span>
          </Stat>
        </dl>
      </ScrollArea>
      <div className="grid grid-cols-3 gap-2 rule-t p-2">
        <Button
          type="button"
          variant="outline"
          onClick={onStar}
          disabled={busy}
          className={cn(
            "h-8 gap-2 px-2",
            track.favorite
              ? "border-amber-300/60 text-amber-300"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <IconStar
            className={cn("size-4", track.favorite && "fill-current")}
          />
          Star
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={onEdit}
          className="h-8 gap-2 px-2 text-muted-foreground hover:text-foreground"
        >
          <IconPencil className="size-4" />
          Edit
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={onDelete}
          className="h-8 px-2 text-muted-foreground hover:bg-destructive hover:text-destructive-foreground"
        >
          Delete
        </Button>
      </div>
    </div>
  );
}

function Stat({ label, children, className }) {
  return (
    <div className={cn("min-w-0 frame p-2", className)}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate">{children}</dd>
    </div>
  );
}
