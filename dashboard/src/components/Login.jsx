import { useState } from 'react';
import { setApiKey, api } from '../lib/api.js';

// API key оруулах энгийн нэвтрэх дэлгэц. Key-г localStorage-д хадгална.
// (Ирээдүйд token-д суурилсан auth болгоход энэ хэсгийг солино.)
export default function Login({ onLogin }) {
  const [key, setKey] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setErr('');
    setLoading(true);
    setApiKey(key.trim());
    try {
      await api.ping(); // key зөв эсэхийг шалгана
      onLogin();
    } catch (e2) {
      setErr(e2.status === 401 ? 'API key буруу байна' : 'Холбогдож чадсангүй: ' + e2.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <form onSubmit={submit} className="bg-white rounded-xl shadow p-6 w-full max-w-sm">
        <h1 className="text-lg font-semibold mb-1">Гүйлгээний Dashboard</h1>
        <p className="text-sm text-slate-500 mb-4">API key-ээ оруулна уу</p>
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="X-API-Key"
          className="w-full border rounded-lg px-3 py-2 mb-3 focus:outline-none focus:ring-2 focus:ring-indigo-400"
          autoFocus
        />
        {err && <div className="text-sm text-red-600 mb-3">{err}</div>}
        <button
          type="submit"
          disabled={loading || !key.trim()}
          className="w-full bg-indigo-600 text-white rounded-lg py-2 font-medium disabled:opacity-50"
        >
          {loading ? 'Шалгаж байна...' : 'Нэвтрэх'}
        </button>
      </form>
    </div>
  );
}
