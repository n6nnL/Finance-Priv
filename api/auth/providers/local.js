// ============================================================
//  auth/providers/local.js — Email/нууц үг provider
//
//  Pluggable auth интерфэйс: provider бүр { name, authenticate(creds, ctx) }
//  гэсэн ижил гэрээтэй. Дараа DAN (иргэн, OIDC), ХУР (байгууллага) нэмэхэд
//  зөвхөн шинэ provider файл нэмнэ — үндсэн кодыг хөндөхгүй.
//    auth/providers/dan.js   (ирээдүйд — OAuth2/OIDC)
//    auth/providers/khur.js  (ирээдүйд — байгууллага)
// ============================================================

import { verifyPassword } from '../passwordHash.js';

export function createLocalProvider({ db }) {
  return {
    name: 'local',
    /**
     * @param {{ email: string, password: string }} creds
     * @returns {Promise<object|null>} user эсвэл null
     */
    async authenticate({ email, password } = {}) {
      if (!email || !password) return null;
      const user = db.getUserByEmail(email);
      if (!user) return null;
      const ok = await verifyPassword(password, user.password_hash);
      return ok ? user : null;
    },
  };
}

export default createLocalProvider;
