// API client — X-API-Key-г localStorage-оос авна (нэвтрэх дэлгэцээр оруулна).
// Бүх дуудалт relative '/api/...' → dev-д Vite proxy, prod-д ижил origin.

const KEY_STORE = 'bankApiKey';

export function getApiKey() {
  return localStorage.getItem(KEY_STORE) || '';
}
export function setApiKey(k) {
  localStorage.setItem(KEY_STORE, k);
}
export function clearApiKey() {
  localStorage.removeItem(KEY_STORE);
}

async function req(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: {
      'X-API-Key': getApiKey(),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    const e = new Error('Unauthorized');
    e.status = 401;
    throw e;
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

// Шүүлтийн объектыг query string болгох
function qs(params = {}) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === '') continue;
    if (Array.isArray(v)) {
      if (v.length) u.set(k, v.join(','));
    } else {
      u.set(k, v);
    }
  }
  const s = u.toString();
  return s ? '?' + s : '';
}

export const api = {
  transactions: (filters) => req('/api/transactions' + qs(filters)),
  pending: (p) => req('/api/transactions/pending' + qs(p)),
  summary: (filters) => req('/api/summary' + qs(filters)),
  categories: () => req('/api/categories'),
  overrides: () => req('/api/overrides'),
  // Баталгаажуулах: POS бол merchantPlace, POS биш бол note дамжуулна
  patchCategory: (id, { category, applyToAll, merchantPlace, note }) =>
    req(`/api/transactions/${id}/category`, {
      method: 'PATCH',
      body: {
        category,
        applyToAll,
        merchantPlace: merchantPlace || undefined,
        note: note || undefined,
      },
    }),
  // Зөвхөн тэмдэглэл засах (inline)
  updateNote: (id, note) =>
    req(`/api/transactions/${id}/note`, { method: 'PATCH', body: { note } }),
  addOverride: (merchantPattern, category) =>
    req('/api/overrides', { method: 'POST', body: { merchantPattern, category } }),
  // Нэвтрэх шалгалт
  ping: () => req('/api/categories'),
};

export default api;
