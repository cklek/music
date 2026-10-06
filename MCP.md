# music MCP server

The app is a [Model Context Protocol](https://modelcontextprotocol.io) server:
every HTTP API route is a tool, so an agent can drive music the way the page
and the headless CLI do. The tools call the same `/api` routes, so what a
tool can do is exactly what the API can do, no more and no less.

There are two ways in:

- **Streamable HTTP**, built into the app server at `POST /mcp`. It is there
  whenever the app is running, in `bun dev`, `bun start` or
  `bun run headless`. Nothing extra to start.
- **stdio**, `bun run mcp`, for clients that launch a server process. It
  connects to a running app server, or starts its own API-only one with
  `--start`.

## Connect

With the app running on port 3000:

```sh
claude mcp add --transport http music http://localhost:3000/mcp
```

For a client that launches processes (Claude Desktop, Codex, Claude Code with
stdio), point it at `mcp.js` and let it start its own server:

```json
{
  "mcpServers": {
    "music": {
      "command": "bun",
      "args": ["/path/to/music/mcp.js", "--start"]
    }
  }
}
```

`--start` runs `HEADLESS=1 HOST=127.0.0.1 PORT=0 bun server.js` from this
repository, with the same data directory and environment as `bun dev`, and
stops it when the client disconnects. Do not use it while another server is
already running against the same data directory: connect to that server
instead. Without `--start`, the URL precedence is `--base-url`, then
`MUSIC_API_URL`, then `http://localhost:3000`. `bun run mcp --help` lists the
tools without needing a server.

The package declares the `music-mcp` executable, available after an optional
`bun link`, alongside `music-cli`.

## Tools

| Tool                     | HTTP API                    | Purpose                                                                                                                                                      |
| ------------------------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `music_library_list`     | `GET /api/library`          | Every track with its tags (overrides applied), favorites, and the playlists.                                                                                 |
| `music_rescan`           | `POST /api/rescan`          | Walk the music folder again, picking up files added outside the app. force re-reads every file's tags.                                                       |
| `music_file_get`         | `GET /api/file`             | The audio file. Answers with a link to the API (audio is too large to inline); output saves the file locally instead.                                        |
| `music_art_get`          | `GET /api/art`              | The cover: a sidecar image, the embedded picture, or a generated SVG placeholder. Images come back inline; output saves the file locally instead.            |
| `music_upload`           | `POST /api/upload`          | Add audio files from the local disk (paths on the machine running the app). Returns the library paths under uploaded and any refused files under rejected.   |
| `music_track_update`     | `PATCH /api/track`          | Override a track's title, artist, album, genre, track number or year without rewriting the file. An empty value clears that override; reset clears them all. |
| `music_track_delete`     | `DELETE /api/track`         | Delete the audio file from disk, along with its cached art, favorite and playlist entries. Cannot be undone.                                                 |
| `music_favorite_set`     | `POST /api/favorite`        | Mark or unmark a track as a favorite.                                                                                                                        |
| `music_playlists_create` | `POST /api/playlists`       | Create a playlist, optionally with tracks in it, in order.                                                                                                   |
| `music_playlists_update` | `PATCH /api/playlists/:id`  | Rename a playlist, replace its tracks with paths, or change them with add and remove.                                                                        |
| `music_playlists_delete` | `DELETE /api/playlists/:id` | Delete a playlist. The tracks stay in the library.                                                                                                           |

Every tool takes one JSON object. Its schema (from `tools/list`) names each
argument and marks the required ones; the runtime rejects a missing required
argument, a wrong type, a value outside an enum, or an argument the tool does
not have, before anything is sent. Path parameters (`:id`) and query
parameters are filled from the arguments of the same name; whatever is left
becomes the JSON body. The API applies its own domain rules after that, the
same ones the page and the CLI get.

Paths in these examples are illustrative: use the exact path `music_upload`
or `music_library_list` returns, since uploads are filed under
`Artist/Album`. Audio is never inlined: `music_file_get` answers with a link
unless `output` names a local file. `music_track_delete` deletes the file
itself.

## Examples

Tool calls, as name and arguments:

```
music_library_list {"rescan":true}
music_upload {"files":["/home/me/Music/song.flac"]}
music_track_update {"path":"Artist/Album/song.flac","artist":"Artist","album":"Album","year":2026}
music_art_get {"path":"Artist/Album/song.flac"}
music_playlists_create {"name":"Late","paths":["Artist/Album/song.flac"]}
```

## Verification

```sh
bun run test:mcp     # protocol, transport and every tool against a real server
bun run test         # the CLI suite too
```
