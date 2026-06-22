import { useState } from 'react';
import { login } from '../lib/api.js';

export default function Login({ onLogin }) {
  const [email, setEmail] = useState('');
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
      setErr(e2.status === 401 ? 'И-мэйл эсвэл нууц үг буруу' : 'Холбогдож чадсангүй: ' + e2.message);
    } finally {
      setLoading(false);
    }
  }

  const inp = {
    width: '100%', height: 50, padding: '0 16px',
    border: '1.5px solid #E3DACB', borderRadius: 13,
    background: '#FFFDF9', fontFamily: 'Onest', fontSize: 15,
    color: '#2A2722', outline: 'none', boxSizing: 'border-box',
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'stretch' }}>
      {/* Left: form */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
        <form onSubmit={submit} style={{ width: '100%', maxWidth: 400 }}>
          {/* Logo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 36 }}>
            <div style={{ width: 42, height: 42, borderRadius: 13, background: 'linear-gradient(135deg,#1F7A6B,#2E9E7E)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 6px 16px rgba(31,122,107,.28)' }}>
              <div style={{ width: 18, height: 18, border: '3px solid #fff', borderRadius: '50%', borderRightColor: 'transparent', transform: 'rotate(-45deg)' }} />
            </div>
            <span style={{ fontFamily: 'Rubik', fontWeight: 600, fontSize: 21, letterSpacing: '-.3px' }}>Санхүү</span>
          </div>

          <h1 style={{ fontFamily: 'Rubik', fontWeight: 600, fontSize: 30, lineHeight: 1.2, letterSpacing: '-.6px', margin: '0 0 8px' }}>Тавтай морил</h1>
          <p style={{ margin: '0 0 32px', color: '#8C8578', fontSize: 15, lineHeight: 1.5 }}>Санхүүгээ нэг дороос хянаарай. Гүйлгээ автоматаар бүртгэгдэнэ.</p>

          <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#6E665A', marginBottom: 7 }}>И-мэйл</label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            autoComplete="username"
            style={{ ...inp, marginBottom: 18 }}
          />

          <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#6E665A', marginBottom: 7 }}>Нууц үг</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete="current-password"
            autoFocus
            style={{ ...inp, marginBottom: 26 }}
          />

          {err && (
            <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, padding: '10px 14px', color: '#D8483B', fontSize: 14, marginBottom: 20 }}>
              {err}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !password || !email}
            style={{
              width: '100%', height: 52, border: 'none', borderRadius: 13,
              background: loading || !password || !email ? '#C8DDD9' : '#1F7A6B',
              color: '#fff', fontFamily: 'Onest', fontWeight: 600, fontSize: 16,
              cursor: loading || !password || !email ? 'not-allowed' : 'pointer',
              boxShadow: '0 6px 16px rgba(31,122,107,.25)',
            }}
          >
            {loading ? 'Шалгаж байна...' : 'Нэвтрэх'}
          </button>
        </form>
      </div>

      {/* Right: illustration — desktop only */}
      <div className="hidden lg:flex" style={{
        flex: 1, background: 'linear-gradient(155deg,#1F7A6B 0%,#176055 60%,#124b43 100%)',
        position: 'relative', overflow: 'hidden', alignItems: 'center', justifyContent: 'center', padding: 48,
      }}>
        <div style={{ position: 'absolute', width: 420, height: 420, borderRadius: '50%', background: 'rgba(255,255,255,.06)', top: -120, right: -120 }} />
        <div style={{ position: 'absolute', width: 300, height: 300, borderRadius: '50%', background: 'rgba(255,255,255,.05)', bottom: -100, left: -80 }} />
        <div style={{ position: 'relative', maxWidth: 380, color: '#fff' }}>
          <div style={{ fontSize: 46, marginBottom: 18 }}>📊</div>
          <h2 style={{ fontFamily: 'Rubik', fontWeight: 600, fontSize: 28, lineHeight: 1.25, margin: '0 0 14px', letterSpacing: '-.4px' }}>
            Мөнгө чинь хаашаа урсаж байгааг нэг харж мэдээрэй
          </h2>
          <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: 'rgba(255,255,255,.78)' }}>
            Банкны мэдэгдлээ холбоход систем гүйлгээг автоматаар барьж, ангилж, дүрсэлж өгнө.
          </p>
        </div>
      </div>
    </div>
  );
}
