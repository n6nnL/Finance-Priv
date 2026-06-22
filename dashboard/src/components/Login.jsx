import { useState } from 'react';
import { login } from '../lib/api.js';

// Email/нууц үгээр нэвтрэх (JWT). Seed admin нь "admin"/нууц үг.
export default function Login({ onLogin }) {
  const [email, setEmail] = useState('admin');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setErr('');
    setLoading(true);
    try {
      const user = await login(email.trim(), password);
      onLogin(user);
    } catch (e2) {
      setErr(e2.status === 401 ? 'Email эсвэл нууц үг буруу' : 'Холбогдож чадсангүй: ' + e2.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <form onSubmit={submit} className="bg-white rounded-xl shadow p-6 w-full max-w-sm">
        <h1 className="text-lg font-semibold mb-1">💳 Гүйлгээний Dashboard</h1>
        <p className="text-sm text-slate-500 mb-4">Нэвтрэх</p>
        <label className="block text-xs text-slate-500 mb-1">Email / нэр</label>
        <input type="text" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username"
          className="w-full border rounded-lg px-3 py-2 mb-3 focus:outline-none focus:ring-2 focus:ring-indigo-400" />
        <label className="block text-xs text-slate-500 mb-1">Нууц үг</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" autoFocus
          className="w-full border rounded-lg px-3 py-2 mb-3 focus:outline-none focus:ring-2 focus:ring-indigo-400" />
        {err && <div className="text-sm text-red-600 mb-3">{err}</div>}
        <button type="submit" disabled={loading || !password}
          className="w-full bg-indigo-600 text-white rounded-lg py-2 font-medium disabled:opacity-50">
          {loading ? 'Шалгаж байна...' : 'Нэвтрэх'}
        </button>
      </form>
    </div>
  );
}
