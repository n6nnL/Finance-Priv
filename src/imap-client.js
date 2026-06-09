// ============================================================
//  imap-client.js — Gmail IMAP IDLE listener
//
//  Үүрэг:
//    - XOAUTH2-аар Gmail-д холбогдох (refresh_token → access_token)
//    - IDLE горимоор шинэ имэйл real-time сонсох
//    - Холболт тасрахад exponential backoff-той reconnect
//    - Token дуусахаас өмнө (50 мин) холболтыг refresh хийх
//    - Catch-up: lastSeenUid-ээс хойших имэйлийг гүйцэж боловсруулах
//    - UIDVALIDITY өөрчлөлтийг зохицуулах
//
//  Шинэ имэйл бүрт onMessage(parsedEmail, uid) callback дуудна.
//  (Боловсруулах логик index.js-д байх — энэ модуль зөвхөн тээвэрлэлт.)
// ============================================================

import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { OAuth2Client } from 'google-auth-library';
import { config } from './config.js';
import { logger } from './logger.js';
import { notifyError } from './logger.js';
import {
  getLastSeenUid,
  setLastSeenUid,
  handleUidValidityChange,
} from './db.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class ImapListener {
  /**
   * @param {(email: object, uid: number) => Promise<void>} onMessage
   */
  constructor(onMessage) {
    this.onMessage = onMessage;
    this.client = null;
    this.oauthClient = new OAuth2Client(
      config.oauth.clientId,
      config.oauth.clientSecret,
      config.oauth.redirectUri
    );
    this.oauthClient.setCredentials({ refresh_token: config.oauth.refreshToken });

    this.backoffMs = 1000; // эхлэх backoff (1с)
    this.maxBackoffMs = 60_000; // дээд тал (60с)
    this.stopped = false;
    this.refreshTimer = null;
    this.consecutiveFailures = 0;
    this.lastMessageAt = Date.now();
    // fetch-ийг цувралд оруулах mutex (catch-up ба exists давхцахгүй байх)
    this._fetchChain = Promise.resolve();
    this._closedPromise = null;
    this._resolveClosed = null;
  }

  /**
   * Дамжуулсан функцийг өмнөх fetch дуустал хүлээгээд цувралаар ажиллуулна.
   * Ингэснээр catch-up болон 'exists'-ийн fetchNew давхцаж UID давхар
   * боловсруулахаас сэргийлнэ.
   */
  _serialize(fn) {
    const next = this._fetchChain.then(fn, fn);
    // Алдаа гарсан ч гинжийг тасархгүй (catch хийж дараагийнхыг үргэлжлүүлнэ)
    this._fetchChain = next.catch(() => {});
    return next;
  }

  /**
   * refresh_token-оор шинэ access_token авна.
   */
  async getAccessToken() {
    const { token } = await this.oauthClient.getAccessToken();
    if (!token) throw new Error('Access token авч чадсангүй (хоосон буцлаа)');
    return token;
  }

  /**
   * Холболт үүсгэж, mailbox нээж, catch-up хийгээд IDLE-д орно.
   * Алдаа гарвал throw хийнэ → run() loop reconnect хийнэ.
   */
  async connectOnce() {
    const accessToken = await this.getAccessToken();

    this.client = new ImapFlow({
      host: 'imap.gmail.com',
      port: 993,
      secure: true,
      auth: {
        user: config.gmail.user,
        accessToken,
      },
      logger: false, // imapflow-ийн дотоод лог унтраана (өөрийн logger ашиглана)
      // socket удаан хариу өгвөл таслах
      socketTimeout: 5 * 60 * 1000,
    });

    // Холболтын түвшний алдаа — listener-ийг бүхэлд нь унтраахгүй,
    // зүгээр л logout эвдэрвэл run() loop reconnect хийнэ.
    this.client.on('error', (err) => {
      logger.warn({ err: err?.message }, 'IMAP client error event');
    });

    // Холболт хаагдвал run() loop-ийг үргэлжлүүлэх promise-ийг тайлна.
    // (softReconnect/token-refresh/тасрал бүгд энэ замаар дамжина.)
    this._closedPromise = new Promise((resolve) => {
      this._resolveClosed = resolve;
    });
    this.client.on('close', () => {
      logger.warn('IMAP холболт хаагдлаа (close event)');
      if (this._resolveClosed) this._resolveClosed();
    });

    await this.client.connect();
    logger.info({ user: config.gmail.user }, '✅ Gmail IMAP холбогдлоо');
    this.consecutiveFailures = 0;

    // mailbox нээх. imapflow нь mailbox нээгдсэний дараа сул зуураа
    // автоматаар IDLE барьж, шинэ имэйл ирэхэд 'exists' event асаана.
    const mailbox = await this.client.mailboxOpen(config.gmail.mailbox);

    // UIDVALIDITY шалгах (өөрчлөгдсөн бол lastSeenUid reset)
    if (mailbox?.uidValidity != null) {
      handleUidValidityChange(Number(mailbox.uidValidity));
    }

    // --- IDLE event listener-ийг эхлээд тавина (catch-up явж байх зуур
    //     ирсэн имэйлийг ч барихын тулд) ---
    this.attachExistsListener();

    // --- Catch-up: lastSeenUid-ээс хойших имэйлүүд (цувралд) ---
    await this._serialize(() => this.catchUp());

    // Token refresh timer тавих (50 мин тутамд softReconnect)
    this.scheduleTokenRefresh();

    // Холболт хаагдах (тасрал/refresh) хүртэл блоклоно.
    // Энэ хооронд imapflow background-д IDLE барина.
    await this._closedPromise;
  }

  /**
   * 'exists' event — mailbox-д шинэ имэйл нэмэгдэхэд асна.
   */
  attachExistsListener() {
    this.client.on('exists', (data) => {
      logger.debug({ count: data?.count, prev: data?.prevCount }, 'exists event — шинэ имэйл');
      // Цувралд оруулна (catch-up/өмнөх fetch дуустал хүлээнэ)
      this._serialize(() => this.fetchNew()).catch(async (err) => {
        // Нэг fetch алдаа listener-ийг унтраахгүй
        logger.error({ err: err?.message }, 'exists fetch алдаа');
        await notifyError('exists-fetch', err);
      });
    });
  }

  /**
   * Сервис асахад unread/шинэ имэйлүүдийг гүйцэж боловсруулах.
   * lastSeenUid-ээс хойших бүх UID-г авна.
   */
  async catchUp() {
    if (!this.client || this.client.usable === false) return;
    const lastUid = getLastSeenUid();
    const range = `${lastUid + 1}:*`;
    logger.info({ from: lastUid + 1 }, 'Catch-up эхэллээ');
    let processed = 0;
    try {
      // uid: true → range-г UID-ээр тайлбарлана
      for await (const msg of this.client.fetch(
        range,
        { uid: true, source: true, envelope: true },
        { uid: true }
      )) {
        // range "N:*" нь хамгийн багадаа нэг (хамгийн сүүлийн) мессеж буцаадаг.
        // lastUid-ээс хэтрэхгүй UID ирвэл алгасна (давхар боловсруулахаас сэргийлэх).
        if (msg.uid <= lastUid) continue;
        await this.handleRawMessage(msg);
        processed++;
      }
    } catch (err) {
      logger.error({ err: err?.message }, 'Catch-up алдаа');
      await notifyError('catch-up', err);
      throw err; // reconnect хийлгэнэ
    }
    logger.info({ processed }, 'Catch-up дууслаа');
  }

  /**
   * 'exists' event дээр шинэ имэйлүүдийг авах.
   */
  async fetchNew() {
    if (!this.client || this.client.usable === false) return;
    const lastUid = getLastSeenUid();
    const range = `${lastUid + 1}:*`;
    for await (const msg of this.client.fetch(
      range,
      { uid: true, source: true, envelope: true },
      { uid: true }
    )) {
      if (msg.uid <= lastUid) continue;
      await this.handleRawMessage(msg);
    }
  }

  /**
   * Нэг raw IMAP мессежийг parse хийж callback руу дамжуулна.
   * lastSeenUid-г энд шинэчилнэ (амжилттай уншсаны дараа).
   */
  async handleRawMessage(msg) {
    try {
      const parsed = await simpleParser(msg.source);
      this.lastMessageAt = Date.now();
      await this.onMessage(parsed, msg.uid);
    } catch (err) {
      // Нэг имэйлийн алдаа бусдыг зогсоохгүй
      logger.error({ uid: msg.uid, err: err?.message }, 'Имэйл боловсруулах алдаа');
      await notifyError('handle-message', err);
    } finally {
      // UID-г аль ч тохиолдолд урагшлуулна (parse алдаа гарсан ч дахин уншихгүй).
      // Идэмпотентность Message-ID-ээр давхар хамгаалагдсан.
      if (msg.uid > getLastSeenUid()) {
        setLastSeenUid(msg.uid);
      }
    }
  }

  /**
   * Token дуусахаас өмнө холболтыг сэргээх timer.
   * IDLE-г таслаад дахин холбоход шинэ access_token авна.
   */
  scheduleTokenRefresh() {
    this.clearTokenRefresh();
    const ms = config.tokenRefreshMinutes * 60 * 1000;
    this.refreshTimer = setTimeout(async () => {
      logger.info('Token refresh — холболтыг сэргээж шинэ access token авна');
      try {
        await this.softReconnect();
      } catch (err) {
        logger.error({ err: err?.message }, 'Token refresh reconnect алдаа');
        await notifyError('token-refresh', err);
      }
    }, ms);
    // Timer процессыг амьд барихгүй (graceful exit-д саад болохгүй)
    if (this.refreshTimer.unref) this.refreshTimer.unref();
  }

  clearTokenRefresh() {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  /**
   * IDLE-г эвдэж, холболтыг хаах → run() loop шинээр холбогдоно.
   */
  async softReconnect() {
    try {
      await this.closeClient();
    } catch {
      /* ignore */
    }
    // run() loop while-д буцаж шинэ connectOnce() дуудна
  }

  async closeClient() {
    this.clearTokenRefresh();
    if (this.client) {
      try {
        await this.client.logout();
      } catch {
        try {
          this.client.close();
        } catch {
          /* ignore */
        }
      }
      this.client = null;
    }
  }

  /**
   * Үндсэн loop: холбогдох → алдаа гарвал backoff-той reconnect.
   * Энэ функц stopped болтол буцахгүй.
   */
  async run() {
    while (!this.stopped) {
      try {
        await this.connectOnce();
        // connectOnce доторх idle() нь холболт тасрах/refresh хийх хүртэл блоклоно.
        // Эндээс гарвал = IDLE дууссан → дахин холбогдоно.
        if (!this.stopped) {
          logger.info('IDLE дууслаа — дахин холбогдоно');
        }
        // Амжилттай ажилласан тул backoff reset
        this.backoffMs = 1000;
      } catch (err) {
        this.consecutiveFailures++;
        logger.error(
          { err: err?.message, failures: this.consecutiveFailures, backoffMs: this.backoffMs },
          'Холболт алдаа — reconnect хийнэ'
        );
        // Дараалсан олон алдаа гарвал мэдэгдэнэ
        if (this.consecutiveFailures >= 5) {
          await notifyError('reconnect-failures', err);
        }
        await this.closeClient();
        if (this.stopped) break;
        await sleep(this.backoffMs);
        // Exponential backoff (дээд тал 60с)
        this.backoffMs = Math.min(this.backoffMs * 2, this.maxBackoffMs);
        continue;
      }
      // refresh/IDLE-ийн дараа богино амралт аваад дахин холбогдоно
      await this.closeClient();
      if (!this.stopped) await sleep(500);
    }
    logger.info('IMAP listener зогслоо');
  }

  /**
   * Graceful shutdown.
   */
  async stop() {
    this.stopped = true;
    await this.closeClient();
  }

  /** Сүүлийн имэйл хэдэн ms-ийн өмнө ирсэн (heartbeat-д) */
  msSinceLastMessage() {
    return Date.now() - this.lastMessageAt;
  }
}

export default ImapListener;
