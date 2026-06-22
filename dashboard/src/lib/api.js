// API client — JWT (access + refresh) token. Бүх дуудалт relative '/api/...'
// (dev-д Vite proxy, prod-д ижил origin). 401 үед refresh-оор нэг удаа дахин оролдоно.

const AT = 'accessToken';
const RT = 'refreshToken';

export const getAccess = () => localStorage.getItem(AT) || '';
export const getRefresh = () => localStorage.getItem(RT) || '';
export const isAuthed = () => !!getAccess();
function setTokens(access, refresh) {
  if (access) localStorage.setItem(AT, access);
  if (refresh) localStorage.setItem(RT, refresh);
}
export function clearTokens() {
  localStorage.removeItem(AT);
  localStorage.removeItem(RT);
}

async function tryRefresh() {
  const rt = getRefresh();
  if (!rt) return false;
  try {
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: rt }),
    });
    if (!res.ok) return false;
    const j = await res.json();
    if (j.accessToken) { setTokens(j.accessToken, null); return true; }
    return false;
  } catch {
    return false;
  }
}

async function rawReq(path, { method = 'GET', body } = {}) {
  return fetch(path, {
    method,
    headers: {
      Authorization: `Bearer ${getAccess()}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function req(path, opts = {}) {
  let res = await rawReq(path, opts);
  if (res.status === 401) {
    // access хугацаа дууссан байж магадгүй → refresh-оор нэг удаа дахин оролдоно
    if (await tryRefresh()) {
      res = await rawReq(path, opts);
    }
    if (res.status === 401) {
      clearTokens();
      const e = new Error('Unauthorized');
      e.status = 401;
      throw e;
    }
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(json.error || `HTTP ${res.status}`);
    e.status = res.status;
    e.body = json;
    throw e;
  }
  return json;
}

function qs(params = {}) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === '') continue;
    if (Array.isArray(v)) { if (v.length) u.set(k, v.join(',')); }
    else u.set(k, v);
  }
  const s = u.toString();
  return s ? '?' + s : '';
}

// ---- Auth ----
export async function login(email, password) {
  const res = await fetch('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(j.error || `HTTP ${res.status}`); e.status = res.status; throw e; }
  setTokens(j.accessToken, j.refreshToken);
  return j.user;
}
export async function register(email, password) {
  const res = await fetch('/api/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(j.error || `HTTP ${res.status}`); e.status = res.status; throw e; }
  setTokens(j.accessToken, j.refreshToken);
  return j.user;
}

export const api = {
  me: () => req('/api/auth/me'),
  transactions: (filters) => req('/api/transactions' + qs(filters)),
  pending: (p) => req('/api/transactions/pending' + qs(p)),
  summary: (filters) => req('/api/summary' + qs(filters)),
  monthly: (months) => req('/api/monthly' + qs({ months })),
  categories: () => req('/api/categories'),
  overrides: () => req('/api/overrides'),
  patchCategory: (id, { category, applyToAll, merchantPlace, note }) =>
    req(`/api/transactions/${id}/category`, { method: 'PATCH', body: { category, applyToAll, merchantPlace: merchantPlace || undefined, note: note || undefined } }),
  updateNote: (id, note) => req(`/api/transactions/${id}/note`, { method: 'PATCH', body: { note } }),
};

export default api;
