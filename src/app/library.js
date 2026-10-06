export function formatBytes(value) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size >= 10 || unit === 0 ? Math.round(size) : size.toFixed(1)} ${units[unit]}`;
}

export function albumsFor(tracks) {
  const albums = new Map();
  for (const track of tracks) {
    let album = albums.get(track.albumKey);
    if (!album) {
      album = {
        key: track.albumKey,
        album: track.album,
        artist: track.albumArtist || track.artist,
        year: track.year,
        coverTrack: track,
        tracks: [],
        size: 0,
      };
      albums.set(track.albumKey, album);
    }
    album.tracks.push(track);
    album.size += track.size || 0;
    if (!album.year && track.year) album.year = track.year;
  }
  return [...albums.values()].sort(
    (a, b) =>
      a.artist.localeCompare(b.artist) || a.album.localeCompare(b.album),
  );
}

export function artistsFor(tracks) {
  const artists = new Map();
  for (const track of tracks) {
    const name = track.albumArtist || track.artist;
    let artist = artists.get(name.toLowerCase());
    if (!artist) {
      artist = { key: name.toLowerCase(), name, tracks: [], albums: new Set() };
      artists.set(artist.key, artist);
    }
    artist.tracks.push(track);
    artist.albums.add(track.albumKey);
  }
  return [...artists.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function trackMatches(track, query) {
  if (!query) return true;
  const haystack =
    `${track.title} ${track.artist} ${track.albumArtist} ${track.album} ${track.genre} ${track.path}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

export function initialsFor(track) {
  const words = (track.album || "").split(/\s+/).filter(Boolean);
  const strong = words.filter((word) => /^[\p{Lu}\p{N}]/u.test(word));
  const initials = (strong.length ? strong : words)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase());
  return (
    initials.join("") || (track.artist || "").slice(0, 2).toUpperCase() || "M"
  );
}

const PALETTES = [
  { from: "#171717", via: "#9a3412", to: "#0f766e", text: "#fff7ed" },
  { from: "#18181b", via: "#881337", to: "#a16207", text: "#fff1f2" },
  { from: "#111827", via: "#155e75", to: "#365314", text: "#ecfeff" },
  { from: "#0a0a0a", via: "#7f1d1d", to: "#14532d", text: "#fef2f2" },
  { from: "#0f172a", via: "#1d4ed8", to: "#7c2d12", text: "#eff6ff" },
];

function hash(value) {
  let result = 0;
  for (let index = 0; index < value.length; index += 1) {
    result = (result << 5) - result + value.charCodeAt(index);
    result |= 0;
  }
  return Math.abs(result);
}

export function paletteFor(key) {
  return PALETTES[hash(key || "") % PALETTES.length];
}
