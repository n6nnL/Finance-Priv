// ============================================================
//  telegram/jwtAuth.js — тухайн (chat_id-аар resolved) хэрэглэгчид зориулж
//  богино хугацаат access JWT-г ПРОЦЕСС ДОТРООС mint хийнэ (HTTP round-trip
//  хэрэггүй). api/auth/jwt.js-г ШУУД дахин ашиглана — алгоритм/payload бүтэц
//  100% ижил байх баталгаатай (API яг ЭНЭ модулиар verify хийдэг).
//
//  ⚠️ config.jwtSecret нь api/config.js-ийн jwt.secret-тэй ИЖИЛ байх ЁСТОЙ.
//  Токен 5 минутын дараа дуусдаг тул алдаад ч эрсдэл бага (mint-per-action).
// ============================================================

import { createJwt } from '../api/auth/jwt.js';
import { config } from './config.js';

const jwt = createJwt({ secret: config.jwtSecret, accessTtl: config.jwtAccessTtl });

/** @param {{id:number, email:string, role:string}} user */
export function mintAccessToken(user) {
  return jwt.signAccess(user);
}

export default { mintAccessToken };
