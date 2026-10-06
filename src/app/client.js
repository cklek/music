async function request(path, options = {}) {
  const response = await fetch(path, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.error)
    throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

const jsonInit = (method, body) => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const fetchLibrary = () => request("/api/library");
export const rescanLibrary = () => request("/api/rescan", { method: "POST" });
export const setFavorite = (path, favorite) =>
  request("/api/favorite", jsonInit("POST", { path, favorite }));
export const updateTrack = (path, patch) =>
  request("/api/track", jsonInit("PATCH", { path, ...patch }));
export const deleteTrack = (path) =>
  request(`/api/track?path=${encodeURIComponent(path)}`, { method: "DELETE" });
export const createPlaylist = (name, paths = []) =>
  request("/api/playlists", jsonInit("POST", { name, paths }));
export const updatePlaylist = (id, patch) =>
  request(`/api/playlists/${id}`, jsonInit("PATCH", patch));
export const deletePlaylist = (id) =>
  request(`/api/playlists/${id}`, { method: "DELETE" });

export function uploadFiles(files) {
  const form = new FormData();
  for (const file of files) form.append("files", file, file.name);
  return request("/api/upload", { method: "POST", body: form });
}
