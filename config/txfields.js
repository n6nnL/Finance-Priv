// ============================================================
//  config/txfields.js — гүйлгээний талбарын дундын цэвэр туслах функц
//
//  Parser (src/) БА API (api/) хоёул эндээс дуудна — давхардлыг нэгтгэв.
//  Зөвхөн цэвэр функц (dependency-гүй) — хоёр талд аюулгүй импортлогдоно.
// ============================================================

/**
 * POS (картаар тодорхой газар) гүйлгээ эсэх — description нь BOM үгээр төгссөн/агуулсан.
 * (Голомтын таслагдсан мерчант код: STOREBOM, THE LBOM г.м → үгийн төгсгөлд BOM.)
 * @param {string} description
 * @returns {boolean}
 */
export function detectIsPos(description) {
  if (!description) return false;
  return /BOM\b/i.test(description);
}

/**
 * 'YYYY/MM/DD' | 'YYYY.MM.DD' | 'YYYY-MM-DD' → 'YYYY-MM-DD' (ISO). Танихгүй → null.
 *  • anchored=false (default): текст доторх ЭХНИЙ огноог олно (parser-ийн зан төлөв).
 *  • anchored=true: зөвхөн мөрийн ЭХЭНД тааруулна (API normalizeDate-ийн зан төлөв).
 * @param {string} s
 * @param {{anchored?: boolean}} [opts]
 * @returns {string|null}
 */
export function isoDate(s, { anchored = false } = {}) {
  if (!s) return null;
  const re = anchored ? /^(\d{4})[-/.](\d{2})[-/.](\d{2})/ : /(\d{4})[-/.](\d{2})[-/.](\d{2})/;
  const m = String(s).match(re);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/**
 * Имэйлийн `Date:` header (simpleParser-ийн `parsed.date`, JS Date) → ISO 8601 UTC
 * string. Утга байхгүй/буруу бол **null** — одоогийн цагаар ХЭЗЭЭ Ч нөхөхгүй
 * (хуурамч цаг гаргахгүй; balance-ийн зан төлөвтэй ижил).
 * @param {Date|string|number|null|undefined} value
 * @returns {string|null} ж: '2026-08-05T06:32:00.000Z'
 */
export function isoInstant(value) {
  if (value == null || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  const t = d.getTime();
  return Number.isFinite(t) ? d.toISOString() : null;
}

// УБ (Asia/Ulaanbaatar) цаг. Intl (IANA бүс) нь зөв арга — DST/offset өөрчлөлтийг
// ICU-аас уншина. ICU-гүй Node build дээр throw хийж болзошгүй тул нэг удаа
// туршиж, амжилтгүй бол balanceHistory.js-ийн ЯГ ТЭР fallback (хатуу UTC+8)
// руу шилжинэ — 2017-оос хойш Монгол DST хэрэглэдэггүй тул үр дүн ижил.
const UB_TZ = 'Asia/Ulaanbaatar';
const _ubTimeFmt = (() => {
  try {
    const f = new Intl.DateTimeFormat('en-GB', {
      timeZone: UB_TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    });
    f.format(new Date(0)); // ICU байгаа эсэхийг шалгах
    return f;
  } catch {
    return null;
  }
})();

/**
 * ISO 8601 UTC timestamp → УБ-ийн цаг 'HH:mm'. Утга байхгүй/буруу бол null
 * (дуудагч тал цаггүй харагдацаа хэвээр үлдээнэ — "00:00" ХЭЗЭЭ Ч гаргахгүй).
 * @param {string|Date|null|undefined} iso
 * @returns {string|null}
 */
export function ubTimeLabel(iso) {
  if (iso == null || iso === '') return null;
  const d = iso instanceof Date ? iso : new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  if (_ubTimeFmt) return _ubTimeFmt.format(d);
  const shifted = new Date(d.getTime() + 8 * 3600 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`;
}

export default { detectIsPos, isoDate, isoInstant, ubTimeLabel };
