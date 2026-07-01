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

export default { detectIsPos, isoDate };
