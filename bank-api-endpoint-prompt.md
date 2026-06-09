# Prompt: Гүйлгээ хүлээн авах вэбсайтын API endpoint

## Зорилго

Banking email listener service (тусдаа Node.js процесс) -аас илгээсэн гүйлгээний өгөгдлийг хүлээн авч, баталгаажуулж, давхардлыг таслаж, өгөгдлийн санд хадгалдаг **API endpoint** бичнэ үү. Энэ endpoint нь listener-ийн "хүлээн авах тал" бөгөөд аль аль тал нь ижил гэрээтэй (contract) байх ёстой.

## Контекст — listener тал юу илгээдэг вэ

Тусдаа ажилладаг listener service дараах хэлбэрээр POST хүсэлт илгээнэ:

- **Method:** `POST`
- **Content-Type:** `application/json`
- **Header:** authentication-д API key (эсвэл HMAC гарын үсэг)
- **Header эсвэл body:** идэмпотентность түлхүүр болгон имэйлийн `Message-ID`
- **Body (JSON) жишээ бүтэц:**
  ```json
  {
    "messageId": "<unique-email-message-id>",
    "amount": 25000,
    "currency": "MNT",
    "date": "2026-06-08",
    "description": "POS гүйлгээ - дэлгүүрийн нэр",
    "type": "expense",
    "category": "Хүнс",
    "accountLast4": "1234",
    "raw": "имэйлийн түүхий текст (хязгаарлагдмал урт)"
  }
  ```

> Тэмдэглэл: зарим талбар (`accountLast4`, `category`) байхгүй/null байж болно. API нь дутуу талбарыг зохицуулна.

## Технологийн стек

- **Хэл/framework:** Node.js + Express (хэрэв танай вэбсайт өөр стек дээр бол тэр стекийн дагуу адаптацлана — REST зарчим ижил)
- **DB:** одоо байгаа вэбсайтын өгөгдлийн санг ашиглах (PostgreSQL эсвэл SQLite). Хэрэв шинээр бол PostgreSQL санал болго.
- **Validation:** `zod` эсвэл түүнтэй адил schema validation

## Заавал хэрэгжүүлэх шаардлагууд

### 1. Endpoint

- `POST /api/transactions` маршрут үүсгэ.
- JSON body хүлээн авч, доорх дарааллаар боловсруул: auth шалгах → schema validate → давхардал шалгах → DB-д хадгалах → хариу буцаах.

### 2. Authentication (заавал)

- Хүсэлт бүрийн header-аас API key уншиж шалгана (жишээ: `Authorization: Bearer <key>` эсвэл `X-API-Key`).
- Зөв key-г env-ээс (`LISTENER_API_KEY`) уншина. Тохирохгүй бол `401 Unauthorized` буцаана.
- (Сонголт, илүү найдвартай) HMAC хувилбар: listener body-г secret-ээр sign хийж, API тал дахин тооцоолж тулгана. Хэрэв хэрэгжүүлбэл хоёр талд ижил secret env ашиглана. Эхлэхэд энгийн API key хангалттай — гэхдээ кодыг HMAC руу шилжихэд хялбар бүтэцтэй бай.
- Authentication байхгүй бол хэн ч хуурамч гүйлгээ илгээж болохыг анхаар.

### 3. Validation

- Body-г schema-аар шалгана: `messageId` (заавал, string), `amount` (заавал, эерэг тоо), `currency`, `date` (ISO формат), `type` (`expense` | `income`), бусад optional талбарууд.
- Буруу/дутуу бол `400 Bad Request` + ямар талбар буруу болохыг тодорхой буцаана.

### 4. Идэмпотентность (давхардал хамгаалалт) — критик

- `messageId`-г unique түлхүүр болгож DB-д хадгална (`UNIQUE` constraint).
- Хүсэлт ирэхэд эхлээд тэр `messageId` аль хэдийн орсон эсэхийг шалгана.
  - Орсон бол: шинээр **үүсгэхгүй**, `200 OK` буцаана (`{ "status": "duplicate", "id": <existing> }`). Алдаа биш — амжилттай гэж үзнэ, ингэснээр listener retry хийхэд асуудалгүй.
  - Ороогүй бол: шинээр insert хийнэ.
- Race condition-оос хамгаалах: insert хийхдээ DB-ийн `UNIQUE` constraint-д найдах (зэрэг ирсэн хоёр ижил хүсэлт — нэг нь insert, нөгөө нь conflict → duplicate гэж зохицуулах). `ON CONFLICT DO NOTHING` (Postgres) эсвэл `INSERT OR IGNORE` (SQLite) ашигла.

### 5. Өгөгдлийн сангийн бүтэц

`transactions` хүснэгт (доор PostgreSQL жишээ, SQLite-д адаптацлана):

```sql
CREATE TABLE transactions (
  id            BIGSERIAL PRIMARY KEY,
  message_id    TEXT NOT NULL UNIQUE,
  amount        NUMERIC(18,2) NOT NULL,
  currency      TEXT NOT NULL DEFAULT 'MNT',
  txn_date      DATE,
  description   TEXT,
  type          TEXT CHECK (type IN ('expense','income')),
  category      TEXT,
  account_last4 TEXT,
  raw           TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_txn_date ON transactions (txn_date);
CREATE INDEX idx_txn_category ON transactions (category);
```

- Миграцийг код эсвэл SQL файлаар гарга.

### 6. Хариу (Response)

- Амжилттай insert: `201 Created` + `{ "status": "created", "id": <new_id> }`
- Давхардал: `200 OK` + `{ "status": "duplicate", "id": <existing_id> }`
- Validation алдаа: `400` + дэлгэрэнгүй
- Auth алдаа: `401`
- Серверийн алдаа: `500` + log (listener retry хийх боломжтой)

### 7. Аюулгүй байдал

- Бүх нууц утга (`LISTENER_API_KEY`, DB холболтын мэдээлэл) env-ээс уншина.
- `.env.example` гарга. `.gitignore`-д `.env` оруул.
- Body хэмжээний хязгаар тавь (жишээ: `express.json({ limit: '100kb' })`) — `raw` талбар хэт том байхаас сэргийлэх.
- SQL injection-аас хамгаалах: parameterized query эсвэл ORM ашигла.
- Rate limiting нэмбэл сайн (нэг IP/key-д хязгаар).

### 8. Нэмэлт (унших API — frontend-д хэрэг болно)

- `GET /api/transactions` — гүйлгээний жагсаалт буцаах. Query параметр дэмжих: `from`, `to` (огнооны хүрээ), `category`, `type`, `limit`, `offset` (pagination).
- Энэ GET endpoint-д ч authentication тавьж, хувийн санхүүгийн өгөгдлийг хамгаална.

## Бүтэц

- `routes/transactions.js` (POST + GET маршрутууд)
- `middleware/auth.js` (API key/HMAC шалгах)
- `db.js` (холболт, query функцууд)
- `schema.js` (validation schema)
- `migrations/` (SQL миграци)
- README: суулгах, DB үүсгэх, миграци ажиллуулах, env бөглөх, **listener талын `WEBSITE_API_URL` болон `WEBSITE_API_KEY`-тэй яаж тааруулахыг** тодорхой бич.

## Чанарын шаардлага

- Бүх route try/catch-тэй, алдаа гарвал зөв HTTP status + log.
- Идэмпотентность болон auth-д unit/integration test нэм (давхардсан messageId → 200 duplicate; буруу key → 401; зөв хүсэлт → 201).
- Кодод MN/EN тайлбар comment бич.

## Чухал тэмдэглэл агентад

- Энэ API нь **listener prompt-той ижил гэрээтэй** байх ёстой: ижил body бүтэц, ижил `messageId` idempotency key, ижил API key механизм. Хоёр талын env нэр таарч байгааг README-д тодорхой тэмдэглэ (`LISTENER_API_KEY` ↔ listener талын `WEBSITE_API_KEY`).
- Хэрэв вэбсайт нь Express биш (жишээ нь Next.js, Django, Laravel) дээр бол REST зарчмыг хадгалж тэр framework-ийн route handler хэлбэрээр адаптацла.
