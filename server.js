const headless = process.env.HEADLESS === "1";
const index = headless ? null : (await import("./index.html")).default;
import mcpConfig from "./src/mcp/tools.js";
import { createMcpHttpHandler, loopbackUrl } from "./src/mcp/runtime.js";
import {
  LibraryError,
  artFile,
  createLibrary,
  createPlaylist,
  deletePlaylist,
  deleteTrack,
  fallbackArtSvg,
  listLibrary,
  parseRange,
  saveUpload,
  scan,
  setFavorite,
  setOverride,
  trackFile,
  updatePlaylist,
} from "./src/server/library.js";

const library = createLibrary({
  musicDir: process.env.MUSIC_DIR || "./music",
  dataDir: process.env.MUSIC_DATA_DIR || "./data",
});

const json = (body, status = 200) => Response.json(body, { status });

async function jsonBody(req) {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? body : null;
  } catch {
    return null;
  }
}

function wrap(handler) {
  return async (req) => {
    try {
      return await handler(req, new URL(req.url));
    } catch (error) {
      if (error instanceof LibraryError)
        return json({ error: error.message }, error.status);
      return json(
        { error: error instanceof Error ? error.message : "Request failed." },
        500,
      );
    }
  };
}

function playlistId(req) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0)
    throw new LibraryError("Invalid playlist id.");
  return id;
}

/* MCP over streamable HTTP: the same API, as tools. The handler calls back
 * into this server over loopback, so it needs the address after the fact. */
const mcp = createMcpHttpHandler(mcpConfig, {
  baseUrl: () => loopbackUrl(server),
});

const server = Bun.serve({
  port: Number(process.env.PORT || 3000),
  hostname: process.env.HOST || "0.0.0.0",
  development: process.env.NODE_ENV !== "production",
  idleTimeout: 120,
  maxRequestBodySize: 2 * 1024 * 1024 * 1024,
  routes: {
    ...(headless ? {} : { "/": index }),
    "/api/library": {
      GET: wrap(async (req, url) => {
        if (url.searchParams.get("rescan") === "1") await scan(library);
        return json(await listLibrary(library));
      }),
    },
    "/api/rescan": {
      POST: wrap(async (req, url) => {
        const result = await scan(library, {
          force: url.searchParams.get("force") === "1",
        });
        return json(result);
      }),
    },
    "/api/file": {
      GET: wrap(async (req, url) => {
        const { fullPath, size, contentType } = await trackFile(
          library,
          url.searchParams.get("path"),
        );
        const range = parseRange(req.headers.get("range"), size);
        const headers = {
          "Accept-Ranges": "bytes",
          "Cache-Control": "private, max-age=3600",
          "Content-Type": contentType,
        };
        if (range) {
          return new Response(
            Bun.file(fullPath).slice(range.start, range.end + 1),
            {
              status: 206,
              headers: {
                ...headers,
                "Content-Length": String(range.end - range.start + 1),
                "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
              },
            },
          );
        }
        return new Response(Bun.file(fullPath), {
          headers: { ...headers, "Content-Length": String(size) },
        });
      }),
    },
    "/api/art": {
      GET: wrap(async (req, url) => {
        const relativePath = url.searchParams.get("path") || "";
        const art = await artFile(library, relativePath);
        if (art)
          return new Response(Bun.file(art.fullPath), {
            headers: {
              "Content-Type": art.contentType,
              "Cache-Control": "private, max-age=86400",
            },
          });
        return new Response(fallbackArtSvg(relativePath), {
          headers: {
            "Content-Type": "image/svg+xml; charset=utf-8",
            "Cache-Control": "private, max-age=86400",
          },
        });
      }),
    },
    "/api/upload": {
      POST: wrap(async (req) => {
        const form = await req.formData().catch(() => null);
        if (!form) return json({ error: "Expected multipart form data." }, 400);
        const uploaded = [];
        const rejected = [];
        for (const entry of form.getAll("files")) {
          try {
            uploaded.push(await saveUpload(library, entry));
          } catch (error) {
            rejected.push({
              name: entry?.name || "file",
              error: error instanceof Error ? error.message : "Rejected.",
            });
          }
        }
        if (uploaded.length) await scan(library);
        return json({ uploaded, rejected });
      }),
    },
    "/api/track": {
      PATCH: wrap(async (req) => {
        const body = await jsonBody(req);
        if (!body) return json({ error: "Invalid JSON body" }, 400);
        return json(await setOverride(library, body.path, body));
      }),
      DELETE: wrap(async (req, url) => {
        await deleteTrack(library, url.searchParams.get("path"));
        return json({ deleted: true });
      }),
    },
    "/api/favorite": {
      POST: wrap(async (req) => {
        const body = await jsonBody(req);
        if (!body) return json({ error: "Invalid JSON body" }, 400);
        return json(
          await setFavorite(library, body.path, body.favorite !== false),
        );
      }),
    },
    "/api/playlists": {
      POST: wrap(async (req) => {
        const body = await jsonBody(req);
        if (!body) return json({ error: "Invalid JSON body" }, 400);
        return json(await createPlaylist(library, body), 201);
      }),
    },
    "/api/playlists/:id": {
      PATCH: wrap(async (req) => {
        const body = await jsonBody(req);
        if (!body) return json({ error: "Invalid JSON body" }, 400);
        return json(await updatePlaylist(library, playlistId(req), body));
      }),
      DELETE: wrap(async (req) =>
        json(await deletePlaylist(library, playlistId(req))),
      ),
    },
    "/mcp": mcp,
    "/api/*": () => json({ error: "Not found" }, 404),
  },
  fetch: () => headless ? json({ error: "Not found" }, 404) : new Response(index),
});

scan(library)
  .then((result) =>
    console.log(
      `music  http://localhost:${server.port}  ${result.count} tracks in ${library.musicDir} (${result.parsed} newly read)`,
    ),
  )
  .catch((error) => console.error("scan failed:", error));
