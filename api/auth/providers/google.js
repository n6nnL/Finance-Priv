// ============================================================
//  auth/providers/google.js — Google OAuth provider (хүний нэвтрэлт)
//
//  local.js-ийн pluggable provider загвартай ижил санаа, гэхдээ OAuth нь
//  redirect урсгал тул { getAuthUrl, exchangeCode } интерфэйстэй.
//
//  Хоёр тусдаа хэрэглээ (тус бүрдээ өөр scope/offline тохиргоотой provider
//  instance үүсгэнэ, routes/auth.js): нэвтрэлт (минимал, offline=false) ба
//  Calendar холбох (readonly, offline=true → refresh_token).
//  google-auth-library-ийн OAuth2Client (scripts/get-token.js-тэй ижил загвар).
// ============================================================

import { OAuth2Client } from 'google-auth-library';

/** Нэвтрэлт (Sign in with Google) — зөвхөн identity, "баталгаажаагүй апп" анхааруулга гаргахгүй. */
export const LOGIN_SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];

/** Календарь холбох (Settings-ээс opt-in, sensitive scope). */
export const CALENDAR_SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/calendar.readonly',
];

/** Gmail холбох (Settings-ээс opt-in, restricted scope — listener IMAP-д).
 *  openid заавал — exchangeCode id_token-оор баталгаажуулдаг (email-ийг мэдэх). */
export const GMAIL_SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://mail.google.com/',
];

export function createGoogleProvider({ clientId, clientSecret, redirectUri, scopes = LOGIN_SCOPES, offline = false }) {
  const client = new OAuth2Client(clientId, clientSecret, redirectUri);

  return {
    name: 'google',
    /** Тохируулагдсан эсэх (clientId/secret байгаа) */
    get enabled() {
      return Boolean(clientId && clientSecret);
    },
    /** Consent URL — state нь CSRF-д (signed JWT). offline+consent → refresh_token. */
    getAuthUrl(state) {
      return client.generateAuthUrl({
        ...(offline ? { access_type: 'offline', prompt: 'consent' } : {}),
        scope: scopes,
        include_granted_scopes: true,
        state,
      });
    },
    /**
     * Callback code → токен + хэрэглэгчийн мэдээлэл.
     * id_token-г audience=clientId-ээр баталгаажуулна (email/sub-д итгэх).
     * @returns {Promise<{ email, sub, picture, refreshToken, scope }>}
     */
    async exchangeCode(code) {
      const { tokens } = await client.getToken(code);
      const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: clientId });
      const payload = ticket.getPayload() || {};
      return {
        email: payload.email ? String(payload.email).toLowerCase() : '',
        emailVerified: payload.email_verified === true,
        sub: payload.sub || '',
        picture: payload.picture || null,
        refreshToken: tokens.refresh_token || null,
        scope: tokens.scope || '',
      };
    },
  };
}

export default createGoogleProvider;
