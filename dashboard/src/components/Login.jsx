import { loginWithGoogle } from '../lib/api.js';

// Алдааны кодыг (callback ?error=...) ойлгомжтой мессеж болгох.
const ERR_MSG = {
  not_allowed: 'Энэ Google хаягт нэвтрэх зөвшөөрөл олгоогүй байна.',
  email_unverified: 'Google и-мэйл баталгаажаагүй байна.',
  bad_state: 'Нэвтрэлтийн сесс хүчингүй болсон. Дахин оролдоно уу.',
  google_denied: 'Зөвшөөрөл өгөөгүй тул нэвтэрсэнгүй.',
  google_failed: 'Нэвтрэлт амжилтгүй боллоо. Дахин оролдоно уу.',
  no_code: 'Нэвтрэлт амжилтгүй боллоо. Дахин оролдоно уу.',
  user_failed: 'Бүртгэл үүсгэхэд алдаа гарлаа.',
};

function GoogleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.4 29.2 35.5 24 35.5c-6.3 0-11.5-5.2-11.5-11.5S17.7 12.5 24 12.5c2.9 0 5.5 1.1 7.5 2.9l5.7-5.7C33.6 6.5 29 4.5 24 4.5 13.2 4.5 4.5 13.2 4.5 24S13.2 43.5 24 43.5 43.5 34.8 43.5 24c0-1.2-.1-2.3-.3-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12.5 24 12.5c2.9 0 5.5 1.1 7.5 2.9l5.7-5.7C33.6 6.5 29 4.5 24 4.5 16.3 4.5 9.7 8.9 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 43.5c5.1 0 9.7-1.9 13.2-5.1l-6.1-5.2c-2 1.5-4.5 2.3-7.1 2.3-5.2 0-9.6-3.1-11.3-7.5l-6.5 5C9.6 39 16.2 43.5 24 43.5z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.5l6.1 5.2c-.4.4 6.6-4.8 6.6-14.7 0-1.2-.1-2.3-.3-3.5z" />
    </svg>
  );
}

export default function Login() {
  const errorCode = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('error')
    : null;
  const err = errorCode ? (ERR_MSG[errorCode] || 'Нэвтрэлт амжилтгүй боллоо.') : '';

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'stretch' }}>
      {/* Left: sign-in */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
        <div style={{ width: '100%', maxWidth: 400 }}>
          {/* Logo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 36 }}>
            <div style={{ width: 42, height: 42, borderRadius: 13, background: 'linear-gradient(135deg,#1F7A6B,#2E9E7E)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 6px 16px rgba(31,122,107,.28)' }}>
              <div style={{ width: 18, height: 18, border: '3px solid #fff', borderRadius: '50%', borderRightColor: 'transparent', transform: 'rotate(-45deg)' }} />
            </div>
            <span style={{ fontFamily: 'Rubik', fontWeight: 600, fontSize: 21, letterSpacing: '-.3px' }}>Санхүү</span>
          </div>

          <h1 style={{ fontFamily: 'Rubik', fontWeight: 600, fontSize: 30, lineHeight: 1.2, letterSpacing: '-.6px', margin: '0 0 8px' }}>Тавтай морил</h1>
          <p style={{ margin: '0 0 32px', color: '#8C8578', fontSize: 15, lineHeight: 1.5 }}>
            Google хаягаараа нэвтэрнэ үү.
          </p>

          {err && (
            <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, padding: '10px 14px', color: '#D8483B', fontSize: 14, marginBottom: 20 }}>
              {err}
            </div>
          )}

          <button
            type="button"
            onClick={loginWithGoogle}
            style={{
              width: '100%', height: 52, padding: '0 18px',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
              border: '1.5px solid #E3DACB', borderRadius: 13,
              background: '#FFFFFF', color: '#2A2722',
              fontFamily: 'Onest', fontWeight: 600, fontSize: 16, cursor: 'pointer',
              boxShadow: '0 4px 14px rgba(42,39,34,.06)',
            }}
          >
            <GoogleIcon />
            <span style={{ whiteSpace: 'nowrap' }}>Google-ээр нэвтрэх</span>
          </button>

          <p style={{ margin: '18px 0 0', color: '#A39A8A', fontSize: 13, lineHeight: 1.5 }}>
            Зөвхөн зөвшөөрөгдсөн Google хаягууд нэвтэрнэ.
          </p>
        </div>
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
