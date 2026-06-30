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
// Локал error log + бие даасан Discord webhook сэрэмжлүүлэг (ops-notify).
// Бүх catch block ба process-level handler энэ цэгээр дамждаг тул
// сэрэмжлүүлгийг ЭНД залгаснаар бүгдийг автоматаар хамруулна.
// ------------------------------------------------------------
export async function notifyError(context, error) {
  logger.error(
    { context, err: error?.message ?? String(error), stack: error?.stack },
    `🚨 NOTIFY: ${context}`
  );
  // ops-notify нь debounce-той, scrub-той, хэзээ ч throw хийхгүй.
  // Динамик import — циклик хамаарал (logger ↔ ops-notify) болон
  // webhook тохируулаагүй үед ачааллыг хөнгөн байлгана.
  try {
    const { notifyOps } = await import('./ops-notify.js');
    await notifyOps(context, error);
  } catch {
    /* сэрэмжлүүлэгч хэзээ ч үндсэн урсгалыг зогсоохгүй */
  }
}

export default logger;
