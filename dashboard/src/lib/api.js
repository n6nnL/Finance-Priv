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
/** Google нэвтрэлт рүү шилжих (сервер consent руу redirect хийнэ). */
export function loginWithGoogle() {
  window.location.assign('/api/auth/google');
}

/**
 * Google Calendar холбох (Settings-ээс, JWT шаардсан). Эхлээд Authorization
 * header-тэй fetch-ээр consent URL авч, дараа нь browser-г өөрөө тийш нь
 * navigate хийнэ (JWT localStorage-д байгаа тул шууд navigate хийвэл header
 * дамжихгүй — access token URL-д хэзээ ч орохгүй байх зорилготой).
 */
export async function connectCalendar() {
  const r = await req('/api/auth/google/calendar');
  if (r.url) window.location.assign(r.url);
}

/** Gmail (банкны мэдэгдэл) холбох — calendar-тай ижил загвар. */
export async function connectGmail() {
  const r = await req('/api/auth/gmail/connect');
  if (r.url) window.location.assign(r.url);
}

/**
 * OAuth callback: browser-ийн URL fragment (#access=...&refresh=...)-аас JWT
 * задлаж localStorage-д хадгална. Дараа нь fragment-г цэвэрлэнэ (token түүхэнд
 * үлдээхгүй). Токен олдвол true.
 */
export function consumeAuthFragment() {
  const hash = typeof window !== 'undefined' ? window.location.hash || '' : '';
  if (!hash.includes('access=')) return false;
  const params = new URLSearchParams(hash.slice(1));
  const access = params.get('access');
  const refresh = params.get('refresh');
  if (!access) return false;
  setTokens(access, refresh);
  history.replaceState(null, '', window.location.pathname + window.location.search);
  return true;
}

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
  balance: () => req('/api/balance'),
  balanceHistory: (from) => req('/api/balance-history' + qs({ from })),
  monthly: (months) => req('/api/monthly' + qs({ months })),
  byCategory: (month) => req('/api/analytics/by-category' + qs({ month })),
  categories: () => req('/api/categories'),
  overrides: () => req('/api/overrides'),
  patchCategory: (id, { category, applyToAll, merchantPlace, note }) =>
    req(`/api/transactions/${id}/category`, { method: 'PATCH', body: { category, applyToAll, merchantPlace: merchantPlace || undefined, note: note || undefined } }),
  updateNote: (id, note) => req(`/api/transactions/${id}/note`, { method: 'PATCH', body: { note } }),
  // ---- Төсөв: тохиргоо + хувийн event ----
  getSettings: () => req('/api/settings'),
  saveSettings: (settings) => req('/api/settings', { method: 'PUT', body: settings }),
  events: () => req('/api/events'),
  addEvent: (e) => req('/api/events', { method: 'POST', body: e }),
  deleteEvent: (id) => req(`/api/events/${id}`, { method: 'DELETE' }),
  // ---- Real-time tracker ----
  budgetStatus: () => req('/api/budget-status?cycle=current'),
  budgetAllocations: () => req('/api/budget-allocations'),
  saveBudgetAllocations: (allocations) => req('/api/budget-allocations', { method: 'PUT', body: { allocations } }),
  // ---- Google Calendar холболт (Settings) ----
  connectCalendar,
  disconnectCalendar: () => req('/api/auth/google/calendar/disconnect', { method: 'POST' }),
  // ---- Gmail холболт (Settings — банкны мэдэгдэл сонсох) ----
  connectGmail,
  disconnectGmail: () => req('/api/auth/gmail/disconnect', { method: 'POST' }),
  // ---- Telegram холболт (Settings — мэдэгдэл + товчоор ангилах) ----
  telegramLinkCode: () => req('/api/telegram/link-code', { method: 'POST' }),
  disconnectTelegram: () => req('/api/telegram/unlink', { method: 'POST' }),
};

export default api;
