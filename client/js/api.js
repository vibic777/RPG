// Обёртка над REST API сервера. Токен сессии хранится в localStorage.
const TOKEN_KEY = 'rm_token';

export const session = {
  get token() { return localStorage.getItem(TOKEN_KEY); },
  set token(v) { v ? localStorage.setItem(TOKEN_KEY, v) : localStorage.removeItem(TOKEN_KEY); },
};

export async function api(method, url, body, { keepalive = false } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (session.token) headers.Authorization = 'Bearer ' + session.token;
  let res;
  try {
    res = await fetch(url, { method, headers, keepalive, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw Object.assign(new Error('Нет связи с сервером.'), { status: 0 });
  }
  let data = {};
  try { data = await res.json(); } catch { /* пустой ответ */ }
  if (!res.ok) throw Object.assign(new Error(data.error || `Ошибка ${res.status}`), { status: res.status, data });
  return data;
}

export const Api = {
  register: (username, password) => api('POST', '/api/register', { username, password }),
  login: (username, password) => api('POST', '/api/login', { username, password }),
  logout: () => api('POST', '/api/logout', {}),
  config: () => api('GET', '/api/config'),
  me: () => api('GET', '/api/me'),
  listCharacters: () => api('GET', '/api/characters'),
  createCharacter: (data) => api('POST', '/api/characters', data),
  deleteCharacter: (id) => api('DELETE', '/api/characters/' + encodeURIComponent(id)),
  exportCharacter: (id) => api('GET', `/api/characters/${encodeURIComponent(id)}/export`),
  importCharacter: (file, name) => api('POST', '/api/characters/import', name === undefined ? { file } : { file, name }),
  getCharacter: (id) => api('GET', '/api/characters/' + encodeURIComponent(id)),
  savePosition: (id, pos, opts) => api('POST', `/api/characters/${encodeURIComponent(id)}/position`, pos, opts),
  listWorlds: () => api('GET', '/api/worlds'),
  createWorld: (data) => api('POST', '/api/worlds', data),
  getWorld: (id) => api('GET', '/api/worlds/' + encodeURIComponent(id)),
  resetWorldStory: (id) => api('POST', `/api/worlds/${encodeURIComponent(id)}/story-reset`, {}),
  deleteWorld: (id) => api('DELETE', '/api/worlds/' + encodeURIComponent(id)),
  shareWorld: (id, data) => api('POST', `/api/worlds/${encodeURIComponent(id)}/share`, data),
  joinWorld: (code) => api('POST', '/api/worlds/join', { code }),
  leaveWorld: (id) => api('POST', `/api/worlds/${encodeURIComponent(id)}/leave`, {}),
};
