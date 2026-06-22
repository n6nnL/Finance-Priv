// ============================================================
//  auth/passwordHash.js — нууц үг hash (bcryptjs, pure-JS, native compile-гүй)
// ============================================================

import bcrypt from 'bcryptjs';

const COST = 10; // зохистой cost (хэт өндөр бол удаан)

export async function hashPassword(plain) {
  return bcrypt.hash(String(plain), COST);
}

export async function verifyPassword(plain, hash) {
  if (!hash) return false;
  try {
    return await bcrypt.compare(String(plain), hash);
  } catch {
    return false;
  }
}

// Seed admin-д ашиглах синхрон hash (server эхлэхэд нэг удаа)
export function hashPasswordSync(plain) {
  return bcrypt.hashSync(String(plain), COST);
}

export default { hashPassword, verifyPassword, hashPasswordSync };
