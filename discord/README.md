# Discord bot — гүйлгээний мэдэгдэл + товчоор ангилах

Голомт гүйлгээ бүртгэгчид Discord нэмэлт. Шинэ гүйлгээ бүрд Discord суваг руу
мэдэгдэл илгээж, **танигдаагүй** гүйлгээнд ангиллын товч + modal дагалдана.
Хэрэглэгч утаснаасаа Discord апп нээж, товч даран ангилна (сайт руу орохгүй).

- **Тусдаа pm2 процесс** (`bank-discord`) — listener/API-д нөлөөлөхгүй
- DB-г polling хийж шинэ гүйлгээ илрүүлнэ; **бичихдээ одоо байгаа API** (`PATCH
  /api/transactions/:id/category`, applyToAll + learned override) ашиглана
- Discord ба dashboard **ижил DB/API** — хоёр тал ижил өгөгдөл

## Архитектур

- **Мэдэгдэл (Listener → Discord):** Bot нь API-ийн SQLite DB-г `DISCORD_POLL_SECONDS`
  (default 15с) тутамд polling хийж, өмнө мэдэгдээгүй гүйлгээг (`id > lastNotifiedId`)
  олж мэдэгдэнэ. **Анх асахад одоогийн max id-ээс эхэлдэг** тул хуучин catch-up
  түүхийг МЭДЭГДЭХГҮЙ. `lastNotifiedId`-г `.bot-state.json`-д хадгална (давхар
  мэдэгдэхгүй — идэмпотентность).
- **classified** гүйлгээ → зөвхөн мэдээллийн embed. **pending_review** → embed +
  10 ангиллын товч (2 эгнээ × 5).
- Товч дарах → **POS** (is_pos) бол "Газрын нэр", бусад бол "Шалтгаан" **modal**
  (заавал биш) → `PATCH .../category` (applyToAll) → мессеж "✅ [ангилал]" болж edit.

## Тохиргоо (root `.env`)

```
DISCORD_BOT_TOKEN=        # Developer Portal → Bot → Reset Token
DISCORD_CHANNEL_ID=       # суваг дээр баруун товч → Copy Channel ID (Developer Mode)
# bot нь WEBSITE_API_KEY-г ашиглана (dashboard/listener-тэй ижил)
# DISCORD_API_BASE=http://localhost:3000
# DISCORD_POLL_SECONDS=15
```

## Bot үүсгэх / урих

1. https://discord.com/developers/applications → New Application → Bot.
2. **Bot token** авах (Reset Token) → `.env`-д `DISCORD_BOT_TOKEN`.
3. **Privileged Intents:** товч/modal-д шаардлагагүй (interaction тусдаа). Message
   Content Intent ХЭРЭГГҮЙ.
4. **Server-т урих** (OAuth2 URL, зөв эрхтэй — Send Messages + Embed Links +
   Read Message History):
   ```
   https://discord.com/api/oauth2/authorize?client_id=<APP_CLIENT_ID>&permissions=83968&scope=bot
   ```
5. Суваг дээр баруун товч → **Copy Channel ID** → `.env`-д `DISCORD_CHANNEL_ID`
   (Settings → Advanced → Developer Mode асаасан байх).

## Суулгах / ажиллуулах

```bash
cd discord
npm install
npm start                 # эсвэл pm2-оор:
# pm2 start ../ecosystem.config.cjs --only bank-discord
```

API асаалттай (`bank-api`), DB байх ёстой (bot polling + PATCH-д).

## Бүтэц

```
discord/
  bot.js          # client, polling, interaction (товч→modal→PATCH→edit)
  notify.js       # embed + товчлуур бүтээх, мэдэгдэл илгээх
  categories.js   # 10 ангилал → товч mapping, customId кодлол
  apiClient.js    # PATCH /api/.../category (retry)
  config.js       # root .env-ээс тохиргоо
  test/categories.test.js
```

## Найдвартай байдал

- Тусдаа pm2 процесс, `autorestart`. discord.js автомат reconnect.
- API дуудлага амжилтгүй бол retry (3 удаа), алдааг log — **bot унтрахгүй**.
- Идэмпотентность: `lastNotifiedId` (`.bot-state.json`) → нэг гүйлгээнд давхар
  мэдэгдэхгүй (restart-д ч).
- AI-аас хамаарахгүй — зүгээр хэрэглэгчийн товч/modal-аар ангилна.
