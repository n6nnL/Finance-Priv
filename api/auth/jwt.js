// ============================================================
//  auth/jwt.js — JWT access + refresh token (cookie биш, mobile-д хялбар)
// ============================================================

import jwt from 'jsonwebtoken';

export function createJwt({ secret, accessTtl = '30m', refreshTtl = '30d' }) {
  /** Access token — богино настай, API дуудлагад */
  function signAccess(user) {
    return jwt.sign(
      { sub: user.id, email: user.email, role: user.role, typ: 'access' },
      secret,
      { expiresIn: accessTtl }
    );
  }
  /** Refresh token — урт настай, access шинэчлэхэд */
  function signRefresh(user) {
    return jwt.sign({ sub: user.id, typ: 'refresh' }, secret, { expiresIn: refreshTtl });
  }
  /** OAuth state — CSRF (cookie-гүй). verify(token,'oauth_state')-аар шалгана. */
  function signState(extra = {}, ttl = '10m') {
    return jwt.sign({ typ: 'oauth_state', ...extra }, secret, { expiresIn: ttl });
  }
  /** Token шалгах. Буруу/хугацаа дууссан бол null. */
  function verify(token, expectedTyp) {
    try {
      const p = jwt.verify(token, secret);
      if (expectedTyp && p.typ !== expectedTyp) return null;
      return p;
    } catch {
      return null;
    }
  }
  return { signAccess, signRefresh, signState, verify };
}

export default createJwt;
