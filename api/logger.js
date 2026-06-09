// ============================================================
//  logger.js — Энгийн structured logger (нэмэлт пакетгүй)
//  timestamp + level + JSON context. Production-д JSON мөр хэвлэнэ.
// ============================================================

const LEVELS = { trace: 10, debug: 20, info: 30, warn: 40, error: 50 };
const current = LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? 30;

function log(level, msg, ctx) {
  if (LEVELS[level] < current) return;
  const line = {
    t: new Date().toISOString(),
    level,
    msg,
    ...(ctx && typeof ctx === 'object' ? ctx : ctx !== undefined ? { ctx } : {}),
  };
  const out = JSON.stringify(line);
  if (level === 'error' || level === 'warn') console.error(out);
  else console.log(out);
}

export const logger = {
  trace: (msg, ctx) => log('trace', msg, ctx),
  debug: (msg, ctx) => log('debug', msg, ctx),
  info: (msg, ctx) => log('info', msg, ctx),
  warn: (msg, ctx) => log('warn', msg, ctx),
  error: (msg, ctx) => log('error', msg, ctx),
};

export default logger;
