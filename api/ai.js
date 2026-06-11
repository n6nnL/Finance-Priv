// ============================================================
//  ai.js — Claude API ангилал санал (categorize fallback)
//
//  createAi({ apiKey, model }) → { enabled, aiCategorize(description) }
//
//  ⚠️ Голомтын мерчант код 16 тэмдэгтэд таслагдсан, товчилсон тул AI ч
//  таних боломжгүй байж болно. Тийм үед 'other' + low confidence буцаахыг
//  prompt-д тодорхой зааж, БУРУУ таамаглахаас сэргийлнэ.
//
//  Нууц утга (ANTHROPIC_API_KEY) env-ээс. Дуудалт амжилтгүй бол алдаа
//  шиднэ — дуудагч тал catch хийж 'other'-оор үлдээнэ (систем унтрахгүй).
// ============================================================

import { listCategories } from './categorize.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

export function createAi({ apiKey, model, enabled: toggle = true } = {}) {
  // AI идэвхтэй = toggle асаалттай БА key байгаа. Аль нэг нь дутвал унтраалттай.
  const enabled = !!toggle && !!apiKey;
  const categories = listCategories();

  // Давтагдах systemийг cache_control-оор кэшилнэ (prompt caching).
  const systemBlocks = [
    {
      type: 'text',
      text:
        'Чи Монголын банкны (Голомт) гүйлгээний мерчант тайлбарыг ангилдаг туслах. ' +
        'Зөвхөн дараах ангиллын аль нэгийг сонгоно: ' +
        categories.join(', ') +
        '. Тайлбарууд нь POS терминалын мөр бөгөөд 16 тэмдэгтэд таслагдсан, товчилсон, ' +
        'танихад хэцүү байж болно (жишээ: "0930 STOREBOM", "THE LBOM"). ' +
        'Хэрэв ИТГЭЛТЭЙ танихгүй бол заавал category="other", confidence="low" буцаа. ' +
        'Буруу таамаглахаас сэргийл. ' +
        'Хариуг ЗӨВХӨН JSON хэлбэрээр буцаа: {"category":"<нэг ангилал>","confidence":"low|medium|high"}.',
      cache_control: { type: 'ephemeral' },
    },
  ];

  /**
   * @param {string} description
   * @returns {Promise<{category: string, confidence: 'low'|'medium'|'high'}>}
   */
  async function aiCategorize(description) {
    if (!enabled) return { category: 'other', confidence: 'low', disabled: true };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: model || 'claude-haiku-4-5',
          max_tokens: 64,
          system: systemBlocks,
          messages: [
            { role: 'user', content: `Мерчант тайлбар: "${String(description || '').slice(0, 120)}"` },
          ],
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`Anthropic HTTP ${res.status}: ${txt.slice(0, 150)}`);
      }
      const data = await res.json();
      const text = data?.content?.[0]?.text ?? '';
      return parseAiResult(text, categories);
    } finally {
      clearTimeout(timer);
    }
  }

  return { enabled, aiCategorize, categories };
}

/** AI-ийн текст хариунаас JSON-г найдвартай задлах */
export function parseAiResult(text, categories) {
  let category = 'other';
  let confidence = 'low';
  try {
    const m = String(text).match(/\{[\s\S]*\}/);
    if (m) {
      const obj = JSON.parse(m[0]);
      if (obj.category) category = String(obj.category).toLowerCase().trim();
      if (obj.confidence) confidence = String(obj.confidence).toLowerCase().trim();
    }
  } catch {
    /* задрахгүй бол other/low */
  }
  // Танихгүй ангилал буцаавал 'other' болгоно (хамгаалалт)
  if (categories && !categories.includes(category)) category = 'other';
  if (!['low', 'medium', 'high'].includes(confidence)) confidence = 'low';
  return { category, confidence };
}

export default createAi;
