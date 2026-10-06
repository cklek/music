# music headless CLI

The CLI calls this app's existing HTTP API. It needs Bun and a running app
server, and runs without a browser, prompts, or a terminal UI. Every concrete
API method has a named command; `request METHOD /api/path` is also available.

## Start and connect

From this repository, start the API-only server in one terminal:

```sh
bun install
HOST=127.0.0.1 PORT=3000 bun run headless
```

It uses the same data-directory and upstream settings as `bun dev` and
`bun start`. `HEADLESS=1` skips importing the HTML and frontend; the root and
other non-API routes return JSON 404. The existing web server also accepts
CLI requests, so a second server is unnecessary if the app is already running.

In another terminal:

```sh
bun run cli --help
bun run cli library list --base-url http://localhost:3000
```

The URL precedence is `--base-url`, then `MUSIC_API_URL`, then
`http://localhost:3000`. `PORT` selects the server's listening port; set the
CLI URL to match. Give simultaneously running apps different ports. Optional
reverse-proxy path prefixes are supported in the base URL.

`bun cli.js ...` and `./cli.js ...` work too. The package declares the
`music-cli` executable, available after an optional `bun link` in this repo.
The binary name avoids collisions with existing tools such as `code`.

## Examples

```sh
bun run cli library list
bun run cli upload --upload ./song.wav
bun run cli file get --path 'Artist/Album/song.wav' --output ./download.wav
bun run cli favorite set --json '{"path":"Artist/Album/song.wav","favorite":true}'
bun run cli playlists create --json '{"name":"Favorites","paths":["Artist/Album/song.wav"]}'
```

Media paths in these examples are illustrative. Use the exact path returned
by `upload` or `library list`; uploads may be organized into folders by the API.
Repeat `--upload` to send multiple files. Playlists, collections, and albums
are included in `library list`; updates accept `paths`, `add`, or `remove`.

## Commands

Append `--help` to any command for its required path parameters, query flags,
and body format. All query values are strings: flags such as `--fresh 1`,
`--force 1`, and `--rescan 1` use the API's explicit `1` value.

| Command            | HTTP API                    | Purpose / body                                               |
| ------------------ | --------------------------- | ------------------------------------------------------------ |
| `library list`     | `GET /api/library`          | List media, favorites, and saved groups; rescan=1 refreshes. |
| `rescan`           | `POST /api/rescan`          | Scan media; force=1 rereads metadata.                        |
| `file get`         | `GET /api/file`             | Download original bytes; use --output FILE or pipe stdout.   |
| `art get`          | `GET /api/art`              | Download artwork/preview bytes; use --output FILE.           |
| `upload`           | `POST /api/upload`          | Upload one or more media files.                              |
| `track update`     | `PATCH /api/track`          | Update metadata with {path, ...fields}.                      |
| `track delete`     | `DELETE /api/track`         | Delete a track.                                              |
| `favorite set`     | `POST /api/favorite`        | Set {path, favorite}; false removes the favorite.            |
| `playlists create` | `POST /api/playlists`       | Create {name, paths?}.                                       |
| `playlists update` | `PATCH /api/playlists/:id`  | Update {name?, paths?}.                                      |
| `playlists delete` | `DELETE /api/playlists/:id` | Delete the saved group.                                      |

## Input and output

- `--json '{"key":"value"}'` sends JSON. `--json @file.json` reads a file;
  `--json -` reads stdin. Booleans, arrays, nested objects, and all API fields
  keep their JSON types. The API performs domain validation.
- `--query 'key=value'` appends a query parameter. Repeat it or a named query
  flag for repeated keys. Values are encoded safely, including spaces, `&`,
  and Unicode.
- `--upload FILE` adds a multipart `files` entry. `--field 'key=value'` adds
  text fields. Repeat either; the multipart boundary is set automatically.
- `--file FILE` sends raw bytes; `--file -` reads raw bytes from stdin. Body
  formats are mutually exclusive. Named commands reject unsupported formats.
- `--header 'Name:value'` adds a header, including authorization or byte ranges
  where the API supports them. For example, `--header 'Range:bytes=0-99'`.
- JSON responses are pretty-printed to stdout. Text and binary responses are
  copied unchanged; pipe them or use `--output FILE`. `--output -` explicitly
  selects stdout. Output files are replaced only after the response is fully
  received; a failed transfer preserves an existing file.
- `--timeout SECONDS` sets a 300-second default request/response timeout;
  use `--timeout 0` for no timeout. Ctrl-C cancels the request and exits 130;
  SIGTERM exits 143.

Errors are one JSON object on stderr, with `error`, and `status` / `details`
when available. Successful payloads stay on stdout. Exit 0 means success,
1 means API, network, stream, or operation failure, and 2 means invalid CLI
usage. Upload rejections, RSS per-feed errors, and Notebook execution errors
exit 1 even if the server returned HTTP 200; their response remains on stdout
so a script can inspect partial results. Requests are not automatically retried.

For direct API access:

```sh
bun run cli request GET /api/library
```

Use `request` with the same JSON, multipart, raw body, query, header, and output
options. It accepts an `/api` path, not an arbitrary second server URL.

## Verification

```sh
bun run test:cli
```
