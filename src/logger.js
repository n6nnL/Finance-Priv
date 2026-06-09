// ============================================================
//  logger.js — Structured logging (pino) + алдааны мэдэгдэл hook
// ============================================================

import pino from 'pino';
import { config } from './config.js';

// Терминалд хүн уншихад ойлгомжтой, timestamp-тай.
// Production-д JSON хэвээр хадгалах бол LOG_PRETTY=0 болгож болно.
const usePretty = process.env.LOG_PRETTY !== '0';

export const logger = pino({
  level: config.logLevel,
  ...(usePretty
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'yyyy-mm-dd HH:MM:ss.l',
            ignore: 'pid,hostname',
          },
        },
      }
    : {}),
});

// ------------------------------------------------------------
// notifyError() — Чухал алдаа гарвал дуудах ганц цэг.
// Одоохондоо зүгээр л error log хийнэ. Дараа Telegram/имэйл/Slack
// залгахад энэ функцийн дотор нэмнэ (интерфэйс өөрчлөгдөхгүй).
// ------------------------------------------------------------
export async function notifyError(context, error) {
  logger.error(
    { context, err: error?.message ?? String(error), stack: error?.stack },
    `🚨 NOTIFY: ${context}`
  );
  // TODO: энд Telegram bot / имэйл / Slack webhook залгаж болно.
  // Жишээ:
  //   await fetch(TELEGRAM_URL, { method: 'POST', body: ... });
}

export default logger;
