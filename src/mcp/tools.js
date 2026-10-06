import commands from "../cli/commands.js";

const path = {
  type: "string",
  description:
    "Track path relative to the music folder, exactly as music_library_list returns it (forward slashes, no dot segments).",
};
const paths = {
  type: "array",
  items: { type: "string" },
  description: "Track paths, as returned by music_library_list.",
};
const output = {
  type: "string",
  description:
    "Save the bytes to this local file path (on the machine running the app) instead of returning them.",
};

export default {
  ...commands,
  title: "Music",
  instructions: `
Tools for the music app: a music library that is a folder of audio files on
disk, read for their tags, with cover art, favorites, tag overrides and
playlists kept beside it. Paths are always relative to the music folder and
come from music_library_list; uploads are filed under Artist/Album, so use the
path the upload returns. Audio files are large: music_file_get answers with a
link unless output names a file to save to. music_track_delete removes the
file itself and cannot be undone.`,
  tools: {
    "library list": {
      title: "List library",
      description:
        "Every track with its tags (overrides applied), favorites, and the playlists.",
      inputSchema: {
        type: "object",
        properties: {
          rescan: { type: "boolean", description: "Walk the folder first." },
        },
      },
    },
    rescan: {
      title: "Rescan folder",
      description:
        "Walk the music folder again, picking up files added outside the app. force re-reads every file's tags.",
      inputSchema: {
        type: "object",
        properties: {
          force: {
            type: "boolean",
            description: "Re-read every file, not only the changed ones.",
          },
        },
      },
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    "file get": {
      title: "Get audio bytes",
      description:
        "The audio file. Answers with a link to the API (audio is too large to inline); output saves the file locally instead.",
      inputSchema: { type: "object", properties: { path, output } },
      download: true,
    },
    "art get": {
      title: "Get cover art",
      description:
        "The cover: a sidecar image, the embedded picture, or a generated SVG placeholder. Images come back inline; output saves the file locally instead.",
      inputSchema: { type: "object", properties: { path, output } },
      download: true,
    },
    upload: {
      title: "Upload tracks",
      description:
        "Add audio files from the local disk (paths on the machine running the app). Returns the library paths under uploaded and any refused files under rejected.",
      inputSchema: {
        type: "object",
        properties: {
          files: {
            type: "array",
            items: { type: "string" },
            description: "Local file paths of audio files to add.",
          },
        },
        required: ["files"],
      },
      annotations: { destructiveHint: false },
    },
    "track update": {
      title: "Update track tags",
      description:
        "Override a track's title, artist, album, genre, track number or year without rewriting the file. An empty value clears that override; reset clears them all.",
      inputSchema: {
        type: "object",
        properties: {
          path,
          title: { type: "string" },
          artist: { type: "string" },
          album: { type: "string" },
          genre: { type: "string" },
          trackNumber: { type: "integer" },
          year: { type: "integer" },
          reset: { type: "boolean", description: "Clear every override." },
        },
        required: ["path"],
      },
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    "track delete": {
      title: "Delete track",
      description:
        "Delete the audio file from disk, along with its cached art, favorite and playlist entries. Cannot be undone.",
      inputSchema: { type: "object", properties: { path }, required: ["path"] },
    },
    "favorite set": {
      title: "Set favorite",
      description: "Mark or unmark a track as a favorite.",
      inputSchema: {
        type: "object",
        properties: {
          path,
          favorite: {
            type: "boolean",
            description: "Defaults to true; false removes the favorite.",
          },
        },
        required: ["path"],
      },
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    "playlists create": {
      title: "Create playlist",
      description: "Create a playlist, optionally with tracks in it, in order.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Playlist name." },
          paths,
        },
        required: ["name"],
      },
      annotations: { destructiveHint: false },
    },
    "playlists update": {
      title: "Update playlist",
      description:
        "Rename a playlist, replace its tracks with paths, or change them with add and remove.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "integer", description: "Playlist id." },
          name: { type: "string" },
          paths: {
            ...paths,
            description: "Replace the playlist's tracks, in order.",
          },
          add: { ...paths, description: "Tracks to append." },
          remove: { ...paths, description: "Tracks to remove." },
        },
        required: ["id"],
      },
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    "playlists delete": {
      title: "Delete playlist",
      description: "Delete a playlist. The tracks stay in the library.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "integer", description: "Playlist id." } },
        required: ["id"],
      },
    },
  },
};
