import { createHash } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { parseFile, selectCover } from "music-metadata";

export const AUDIO_EXTENSIONS = new Set([
  ".aac",
  ".flac",
  ".m4a",
  ".mp3",
  ".ogg",
  ".opus",
  ".wav",
  ".wma",
  ".aiff",
  ".aif",
]);
const ART_EXTENSIONS = new Set([".avif", ".jpeg", ".jpg", ".png", ".webp"]);
const ART_STEMS = new Set([
  "album",
  "art",
  "artwork",
  "cover",
  "folder",
  "front",
]);
const ART_FORMAT_EXTENSIONS = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/avif": ".avif",
};
const CONTENT_TYPES = {
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".wav": "audio/wav",
  ".wma": "audio/x-ms-wma",
  ".aiff": "audio/aiff",
  ".aif": "audio/aiff",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".avif": "image/avif",
};
const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;

export class LibraryError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export function contentTypeFor(name) {
  return (
    CONTENT_TYPES[path.extname(name).toLowerCase()] ||
    "application/octet-stream"
  );
}

export function isAudioFile(name) {
  return AUDIO_EXTENSIONS.has(path.extname(name).toLowerCase());
}

export function cleanRelativePath(value) {
  const text = String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .trim();
  if (!text) return "";
  const parts = text.split("/");
  if (
    parts.some(
      (part) => !part || part === "." || part === ".." || part.startsWith("."),
    )
  )
    return "";
  return parts.join("/");
}

function cleanText(value) {
  return String(value || "")
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanTitle(value) {
  return cleanText(value)
    .replace(/^\d{1,3}\s*[-_.]\s*/, "")
    .replace(/^\d{1,3}\s+/, "")
    .trim();
}

export function guessFromPath(relativePath) {
  const parts = relativePath.split("/").filter(Boolean);
  const fileName = parts.at(-1) || relativePath;
  const stem = fileName.replace(/\.[^.]+$/, "");
  let artist = parts.length >= 3 ? cleanText(parts[0]) : "";
  let album = parts.length >= 2 ? cleanText(parts.at(-2)) : "";
  let title = cleanTitle(stem);
  let trackNumber = null;
  const dashMatch = stem.match(
    /^(.+?)\s+-\s+(.+?)\s+-\s+(\d{1,3})\s+-\s+(.+)$/,
  );
  if (dashMatch) {
    artist = cleanText(dashMatch[1]) || artist;
    album = cleanText(dashMatch[2]) || album;
    trackNumber = Number(dashMatch[3]);
    title = cleanTitle(dashMatch[4]) || title;
  } else {
    const leading = stem.match(/^(\d{1,3})[\s._-]+(.+)$/);
    if (leading) {
      trackNumber = Number(leading[1]);
      title = cleanTitle(leading[2]) || title;
    }
  }
  return {
    artist,
    album,
    title: title || stem,
    trackNumber: Number.isFinite(trackNumber) ? trackNumber : null,
  };
}

export function createLibrary({ musicDir, dataDir }) {
  return {
    musicDir: path.resolve(musicDir),
    dataDir: path.resolve(dataDir),
    indexFile: path.join(path.resolve(dataDir), "index.json"),
    stateFile: path.join(path.resolve(dataDir), "library.json"),
    artDir: path.join(path.resolve(dataDir), "art"),
    index: null,
    state: null,
    scanning: null,
    queue: Promise.resolve(),
    artJobs: new Map(),
  };
}

function absolutePath(library, relativePath) {
  const clean = cleanRelativePath(relativePath);
  if (!clean) return null;
  const full = path.join(library.musicDir, clean);
  if (!full.startsWith(library.musicDir + path.sep)) return null;
  return full;
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error && error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + "\n");
  await rename(temporary, file);
}

function locked(library, task) {
  const next = library.queue.then(task, task);
  library.queue = next.catch(() => {});
  return next;
}

async function loadState(library) {
  if (library.state) return library.state;
  const parsed = await readJson(library.stateFile, {});
  library.state = {
    favorites: Array.isArray(parsed.favorites) ? parsed.favorites : [],
    playlists: Array.isArray(parsed.playlists) ? parsed.playlists : [],
    overrides:
      parsed.overrides && typeof parsed.overrides === "object"
        ? parsed.overrides
        : {},
    nextPlaylistId: Number(parsed.nextPlaylistId) || 1,
  };
  return library.state;
}

async function saveState(library) {
  await writeJson(library.stateFile, library.state);
}

async function walk(library, dir, prefix, out) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === "ENOENT") return out;
    throw error;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory())
      await walk(library, path.join(dir, entry.name), relative, out);
    else if (entry.isFile() && isAudioFile(entry.name)) out.push(relative);
  }
  return out;
}

async function readTags(fullPath, relativePath) {
  const guess = guessFromPath(relativePath);
  try {
    const metadata = await parseFile(fullPath, {
      duration: true,
      skipCovers: false,
    });
    const common = metadata.common || {};
    return {
      title: cleanText(common.title) || guess.title,
      artist:
        cleanText(
          common.artist || common.albumartist || (common.artists || [])[0],
        ) || guess.artist,
      albumArtist: cleanText(common.albumartist) || "",
      album: cleanText(common.album) || guess.album,
      trackNumber: common.track?.no || guess.trackNumber,
      discNumber: common.disk?.no || null,
      year: common.year || null,
      genre: cleanText((common.genre || [])[0]) || "",
      duration: Number.isFinite(metadata.format?.duration)
        ? Math.round(metadata.format.duration * 10) / 10
        : null,
      bitrate: Number.isFinite(metadata.format?.bitrate)
        ? Math.round(metadata.format.bitrate / 1000)
        : null,
      hasEmbeddedArt: Boolean(selectCover(common.picture)),
      tagged: Boolean(common.title || common.artist || common.album),
    };
  } catch {
    return {
      ...guess,
      albumArtist: "",
      discNumber: null,
      year: null,
      genre: "",
      duration: null,
      bitrate: null,
      hasEmbeddedArt: false,
      tagged: false,
    };
  }
}

export function scan(library, { force = false } = {}) {
  if (library.scanning) return library.scanning;
  library.scanning = (async () => {
    try {
      await mkdir(library.musicDir, { recursive: true });
      const previous = force
        ? {}
        : library.index || (await readJson(library.indexFile, {})).tracks || {};
      const paths = await walk(library, library.musicDir, "", []);
      const tracks = {};
      let parsed = 0;
      for (const relativePath of paths) {
        const fullPath = path.join(library.musicDir, relativePath);
        const info = await stat(fullPath);
        const key = `${info.size}:${info.mtimeMs}`;
        const cached = previous[relativePath];
        if (cached && cached.key === key) {
          tracks[relativePath] = cached;
          continue;
        }
        parsed += 1;
        tracks[relativePath] = {
          key,
          size: info.size,
          updatedAt: info.mtime.toISOString(),
          ...(await readTags(fullPath, relativePath)),
        };
      }
      library.index = tracks;
      await writeJson(library.indexFile, {
        version: 1,
        scannedAt: new Date().toISOString(),
        tracks,
      });
      return { count: paths.length, parsed };
    } finally {
      library.scanning = null;
    }
  })();
  return library.scanning;
}

function albumKeyFor(track) {
  return `${(track.albumArtist || track.artist || "unknown artist").toLowerCase()}::${(track.album || "loose tracks").toLowerCase()}`;
}

function serializeTrack(library, relativePath, entry, state) {
  const override = state.overrides[relativePath] || {};
  const artist = cleanText(override.artist) || entry.artist || "Unknown artist";
  const album = cleanText(override.album) || entry.album || "Loose tracks";
  const track = {
    path: relativePath,
    url: `/api/file?path=${encodeURIComponent(relativePath)}`,
    artUrl: `/api/art?path=${encodeURIComponent(relativePath)}`,
    title: cleanText(override.title) || entry.title,
    artist,
    albumArtist: entry.albumArtist || artist,
    album,
    trackNumber: override.trackNumber ?? entry.trackNumber ?? null,
    discNumber: entry.discNumber,
    year: override.year ?? entry.year ?? null,
    genre: cleanText(override.genre) || entry.genre || "",
    duration: entry.duration,
    bitrate: entry.bitrate,
    size: entry.size,
    updatedAt: entry.updatedAt,
    tagged: entry.tagged,
    favorite: state.favorites.includes(relativePath),
    edited: Object.keys(override).length > 0,
  };
  track.albumKey = albumKeyFor(track);
  return track;
}

export async function listLibrary(library) {
  if (!library.index) await scan(library);
  const state = await loadState(library);
  const tracks = Object.entries(library.index)
    .map(([relativePath, entry]) =>
      serializeTrack(library, relativePath, entry, state),
    )
    .sort(
      (a, b) =>
        a.artist.localeCompare(b.artist) ||
        a.album.localeCompare(b.album) ||
        (a.discNumber || 0) - (b.discNumber || 0) ||
        (a.trackNumber || 0) - (b.trackNumber || 0) ||
        a.title.localeCompare(b.title),
    );
  return { tracks, playlists: state.playlists, musicDir: library.musicDir };
}

export async function trackFile(library, relativePath) {
  const fullPath = absolutePath(library, relativePath);
  if (!fullPath || !isAudioFile(fullPath))
    throw new LibraryError("Invalid track path.");
  const info = await stat(fullPath).catch(() => null);
  if (!info || !info.isFile()) throw new LibraryError("Track not found.", 404);
  return { fullPath, size: info.size, contentType: contentTypeFor(fullPath) };
}

export function parseRange(value, size) {
  if (size <= 0 || !value) return null;
  const match = value.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return null;
  if (!rawStart) {
    const suffix = Number(rawEnd);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    return { start: Math.max(size - suffix, 0), end: size - 1 };
  }
  const start = Number(rawStart);
  const end = rawEnd ? Number(rawEnd) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    start >= size
  )
    return null;
  return { start, end: Math.min(end, size - 1) };
}

async function sidecarArt(fullPath) {
  let entries;
  try {
    entries = await readdir(path.dirname(fullPath), { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const extension = path.extname(entry.name).toLowerCase();
    if (
      ART_EXTENSIONS.has(extension) &&
      ART_STEMS.has(path.basename(entry.name, extension).toLowerCase())
    ) {
      return path.join(path.dirname(fullPath), entry.name);
    }
  }
  return null;
}

function artBase(library, relativePath) {
  const key = library.index?.[relativePath]?.key || "";
  return path.join(
    library.artDir,
    createHash("sha1").update(`${relativePath}\n${key}`).digest("hex"),
  );
}

async function embeddedArt(library, relativePath, fullPath) {
  const base = artBase(library, relativePath);
  for (const extension of Object.values(ART_FORMAT_EXTENSIONS)) {
    const candidate = `${base}${extension}`;
    if (
      await stat(candidate)
        .then((info) => info.isFile())
        .catch(() => false)
    )
      return candidate;
  }
  const running = library.artJobs.get(base);
  if (running) return running;
  const job = (async () => {
    try {
      const metadata = await parseFile(fullPath, {
        duration: false,
        skipCovers: false,
      });
      const picture = selectCover(metadata.common.picture);
      const extension =
        picture && ART_FORMAT_EXTENSIONS[String(picture.format).toLowerCase()];
      if (!picture || !extension) return null;
      await mkdir(library.artDir, { recursive: true });
      const target = `${base}${extension}`;
      await writeFile(`${target}.tmp`, picture.data);
      await rename(`${target}.tmp`, target);
      return target;
    } catch {
      return null;
    } finally {
      library.artJobs.delete(base);
    }
  })();
  library.artJobs.set(base, job);
  return job;
}

export async function artFile(library, relativePath) {
  const fullPath = absolutePath(library, relativePath);
  if (!fullPath) throw new LibraryError("Invalid track path.");
  const found =
    (await sidecarArt(fullPath)) ||
    (await embeddedArt(library, relativePath, fullPath));
  return found ? { fullPath: found, contentType: contentTypeFor(found) } : null;
}

const FALLBACK_PALETTES = [
  ["#171717", "#9a3412", "#0f766e", "#fff7ed"],
  ["#18181b", "#881337", "#a16207", "#fff1f2"],
  ["#111827", "#155e75", "#365314", "#ecfeff"],
  ["#0a0a0a", "#7f1d1d", "#14532d", "#fef2f2"],
  ["#0f172a", "#1d4ed8", "#7c2d12", "#eff6ff"],
];

export function fallbackArtSvg(relativePath) {
  const album =
    path.dirname(relativePath).split("/").filter(Boolean).at(-1) ||
    path.basename(relativePath);
  const words = album
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const strong = words.filter((word) => /^[\p{Lu}\p{N}]/u.test(word));
  const initials = (
    (strong.length ? strong : words)
      .slice(0, 2)
      .map((word) => word[0].toUpperCase())
      .join("") || "M"
  ).replace(/[<>&]/g, "");
  const hash = createHash("sha1")
    .update(path.dirname(relativePath) || relativePath)
    .digest("hex");
  const [from, via, to, text] =
    FALLBACK_PALETTES[
      Number.parseInt(hash.slice(0, 8), 16) % FALLBACK_PALETTES.length
    ];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="0.55" stop-color="${via}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="512" height="512" fill="url(#g)"/><circle cx="420" cy="420" r="170" fill="#ffffff" opacity="0.14"/><text x="256" y="286" text-anchor="middle" dominant-baseline="middle" fill="${text}" font-family="Georgia,serif" font-size="132" font-weight="700">${initials}</text></svg>`;
}

function safeSegment(value, fallback) {
  const text = cleanText(value)
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/^\.+/, "")
    .slice(0, 120);
  return text || fallback;
}

export async function saveUpload(library, file) {
  if (!file || typeof file.name !== "string")
    throw new LibraryError("No file.");
  if (!isAudioFile(file.name))
    throw new LibraryError(`${file.name}: not an audio file.`);
  if (file.size > MAX_UPLOAD_BYTES)
    throw new LibraryError(
      `${file.name}: over ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`,
    );
  await mkdir(library.musicDir, { recursive: true });
  const staging = path.join(
    library.musicDir,
    `.upload-${process.pid}-${Date.now()}${path.extname(file.name)}`,
  );
  await writeFile(staging, new Uint8Array(await file.arrayBuffer()));
  try {
    const tags = await readTags(staging, file.name);
    const extension = path.extname(file.name).toLowerCase();
    const number = tags.trackNumber
      ? `${String(tags.trackNumber).padStart(2, "0")} `
      : "";
    const fileName = tags.tagged
      ? `${number}${safeSegment(tags.title, "Untitled")}${extension}`
      : safeSegment(path.basename(file.name, extension), "track") + extension;
    const folder = path.join(
      safeSegment(tags.albumArtist || tags.artist, "Unknown artist"),
      safeSegment(tags.album, "Unknown album"),
    );
    await mkdir(path.join(library.musicDir, folder), { recursive: true });
    let relativePath = `${folder}/${fileName}`.replace(/\\/g, "/");
    for (
      let index = 2;
      await stat(path.join(library.musicDir, relativePath))
        .then(() => true)
        .catch(() => false);
      index += 1
    ) {
      relativePath = `${folder}/${fileName.replace(/(\.[^.]+)$/, ` (${index})$1`)}`;
    }
    await rename(staging, path.join(library.musicDir, relativePath));
    return relativePath;
  } catch (error) {
    await rm(staging, { force: true });
    throw error;
  }
}

export async function deleteTrack(library, relativePath) {
  const { fullPath } = await trackFile(library, relativePath);
  const artBasePath = artBase(library, relativePath);
  await rm(fullPath);
  for (const extension of Object.values(ART_FORMAT_EXTENSIONS))
    await rm(`${artBasePath}${extension}`, { force: true });
  return locked(library, async () => {
    const state = await loadState(library);
    state.favorites = state.favorites.filter((entry) => entry !== relativePath);
    for (const playlist of state.playlists)
      playlist.paths = playlist.paths.filter((entry) => entry !== relativePath);
    delete state.overrides[relativePath];
    await saveState(library);
    if (library.index) delete library.index[relativePath];
  });
}

export function setFavorite(library, relativePath, favorite) {
  return locked(library, async () => {
    if (!cleanRelativePath(relativePath))
      throw new LibraryError("Invalid track path.");
    const state = await loadState(library);
    const has = state.favorites.includes(relativePath);
    if (favorite && !has) state.favorites.push(relativePath);
    if (!favorite && has)
      state.favorites = state.favorites.filter(
        (entry) => entry !== relativePath,
      );
    await saveState(library);
    return { favorite: Boolean(favorite) };
  });
}

const OVERRIDE_FIELDS = ["title", "artist", "album", "genre"];

export function setOverride(library, relativePath, patch) {
  return locked(library, async () => {
    if (!cleanRelativePath(relativePath))
      throw new LibraryError("Invalid track path.");
    const state = await loadState(library);
    const current = { ...(state.overrides[relativePath] || {}) };
    for (const field of OVERRIDE_FIELDS) {
      if (!Object.hasOwn(patch, field)) continue;
      const value = cleanText(patch[field]).slice(0, 200);
      if (value) current[field] = value;
      else delete current[field];
    }
    for (const field of ["trackNumber", "year"]) {
      if (!Object.hasOwn(patch, field)) continue;
      const value = Number(patch[field]);
      if (Number.isInteger(value) && value > 0) current[field] = value;
      else delete current[field];
    }
    if (patch.reset)
      for (const key of Object.keys(current)) delete current[key];
    if (Object.keys(current).length) state.overrides[relativePath] = current;
    else delete state.overrides[relativePath];
    await saveState(library);
    return { override: state.overrides[relativePath] || null };
  });
}

function cleanPlaylistName(value) {
  return cleanText(value).slice(0, 120);
}

function cleanPaths(value) {
  const seen = new Set();
  return (Array.isArray(value) ? value : [])
    .map(cleanRelativePath)
    .filter((entry) => entry && !seen.has(entry) && seen.add(entry));
}

export function createPlaylist(library, body) {
  return locked(library, async () => {
    const name = cleanPlaylistName(body?.name);
    if (!name) throw new LibraryError("Playlist name is required.");
    const state = await loadState(library);
    const now = new Date().toISOString();
    const playlist = {
      id: state.nextPlaylistId,
      name,
      paths: cleanPaths(body?.paths),
      createdAt: now,
      updatedAt: now,
    };
    state.nextPlaylistId += 1;
    state.playlists.push(playlist);
    await saveState(library);
    return { playlist };
  });
}

export function updatePlaylist(library, id, body) {
  return locked(library, async () => {
    const state = await loadState(library);
    const playlist = state.playlists.find((entry) => entry.id === id);
    if (!playlist) throw new LibraryError("Playlist not found.", 404);
    if (Object.hasOwn(body, "name")) {
      const name = cleanPlaylistName(body.name);
      if (!name) throw new LibraryError("Playlist name is required.");
      playlist.name = name;
    }
    if (Object.hasOwn(body, "paths")) playlist.paths = cleanPaths(body.paths);
    if (Array.isArray(body.add))
      playlist.paths = cleanPaths([...playlist.paths, ...body.add]);
    if (Array.isArray(body.remove)) {
      const gone = new Set(body.remove.map(cleanRelativePath));
      playlist.paths = playlist.paths.filter((entry) => !gone.has(entry));
    }
    playlist.updatedAt = new Date().toISOString();
    await saveState(library);
    return { playlist };
  });
}

export function deletePlaylist(library, id) {
  return locked(library, async () => {
    const state = await loadState(library);
    const index = state.playlists.findIndex((entry) => entry.id === id);
    if (index < 0) throw new LibraryError("Playlist not found.", 404);
    const [deleted] = state.playlists.splice(index, 1);
    await saveState(library);
    return { deleted };
  });
}
