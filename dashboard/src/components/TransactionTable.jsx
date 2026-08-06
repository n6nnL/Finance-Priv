import { useState } from 'react';
import { money, catLabel, catEmoji, catHex, hexTint, displayDesc, txnTimeLabel, txnTimeTitle } from '../lib/format.js';
import { exclusionMarker } from '../lib/debt.js';
import { api } from '../lib/api.js';
import {
  ACTION_SET_CATEGORY, APPLY_TO_ALL_CONFIRM, detailFieldFor, findAction,
} from '../../../config/transactionActions.js';
import { isCategoryAllowedFor } from '../../../config/categories.js';

// Гүйлгээний жагсаалт. Мөр дээр дарахад expand панель нээгдэж ангилал өөрчлөх,
// талбар (POS→Газрын нэр / бусад→Шалтгаан) засах, applyToAll (default OFF,
// баталгаажуулалттай) — аль үйлдэл, ямар талбар вэ гэдэг нь config/
// transactionActions.js-ээс (Discord/Telegram-тай ИЖИЛ капабилити).
export default function TransactionTable({ data, total, limit, offset, loading, categories = [], onPage }) {
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.max(1, Math.ceil(total / limit));
  const [expandedId, setExpandedId] = useState(null);
  // Optimistic override: id → өөрчлөгдсөн талбарууд (refetch хүртэл server-ийн
  // оронд харагдана; алдаа үед RowPanel rollback хийж хуучин утгыг буцаана).
  const [patches, setPatches] = useState({});
  const applyPatch = (id, fields) =>
    setPatches((p) => ({ ...p, [id]: { ...(p[id] || {}), ...fields } }));

  if (!loading && data.length === 0) {
    return (
      <div className="bg-cream-card border border-dashed border-cream-input rounded-card pt-[40px] px-[20px] pb-[40px] text-center text-[#A39A8A]">
        <div className="text-[32px] mb-[10px]">🔍</div>
        <div className="text-[14px]">Тохирох гүйлгээ олдсонгүй</div>
      </div>
    );
  }

  const rows = data.map((t) => (patches[t.id] ? { ...t, ...patches[t.id] } : t));

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-[10px]">
        <div className="font-display font-semibold text-[16px] text-[#2A2722]">
          Гүйлгээ <span className="font-body font-normal text-[13px] text-[#A39A8A]">({total})</span>
        </div>
        {loading && <span className="text-[13px] text-[#A39A8A]">Ачаалж байна...</span>}
      </div>

      {/* List */}
      <div className="bg-cream-card border border-cream-border rounded-card overflow-hidden">
        {rows.map((t, i) => {
          const hex = catHex(t.category);
          const isIncome = t.type === 'income';
          const expanded = expandedId === t.id;
          // Хасалтын тэмдэглэгээ: ангиллын нийлбэр яагаад мөрийн дүнгээс бага
          // байгааг тайлбарлана. ⚠️ Мөрөнд ҮРГЭЛЖ БҮТЭН дүн харагдана (үлдэгдэлд
          // бүтнээрээ тоологдсон) — цэвэр дүнг доор нь жижгээр нэмнэ.
          const excl = exclusionMarker(t);
          return (
            <div key={t.id} className={i < rows.length - 1 ? 'border-b border-[#F2EADC]' : ''}>
              <div
                onClick={() => setExpandedId(expanded ? null : t.id)}
                title="Дэлгэрэнгүй засах"
                className={`flex items-start sm:items-center gap-[14px] py-[14px] px-[18px] cursor-pointer ${expanded ? 'bg-[#FBF6EC]' : 'hover:bg-[#FCF8F0]'}`}
              >
                {/* Icon (fixed) */}
                <div
                  className="w-[42px] h-[42px] shrink-0 rounded-[12px] flex items-center justify-center text-[20px]"
                  style={{ background: hexTint(hex, 0.12) }}
                >
                  {catEmoji(t.category)}
                </div>

                {/* Flexible region: stacks on mobile, icon·info·amount on sm+ */}
                <div className="min-w-0 flex-1 flex flex-col gap-[4px] sm:flex-row sm:items-center sm:justify-between sm:gap-[14px]">
                  {/* Info */}
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-[14.5px] truncate" title={t.description}>
                      {displayDesc(t)}
                    </div>
                    <div className="flex flex-wrap items-center gap-[8px] mt-[3px]">
                      <span className="text-[13px] font-semibold px-[8px] py-[2px] rounded-full whitespace-nowrap" style={{ color: hex, background: hexTint(hex, 0.12) }}>
                        {catLabel(t.category)}
                      </span>
                      {t.account_last4 && <span className="text-[13px] text-[#A39A8A] whitespace-nowrap">••{t.account_last4}</span>}
                      {t.is_pos === 1 && <span className="text-[13px] text-[#3FA9A0] whitespace-nowrap">POS</span>}
                      {excl && (
                        <span
                          className="text-[13px] font-medium px-[8px] py-[2px] rounded-full whitespace-nowrap"
                          style={{ color: '#3FA9A0', background: 'rgba(63,169,160,.12)' }}
                          title={excl.full
                            ? 'Энэ гүйлгээ бүхэлдээ төсөв/ангиллын тооцооноос хасагдсан (үлдэгдэлд хэвээр).'
                            : 'Гүйлгээний зарим хэсэг бусдын хувь тул төсөв/ангиллаас хасагдсан (үлдэгдэлд бүтнээрээ хэвээр).'}
                        >
                          {excl.full ? '↩ Төсвөөс хасагдсан' : `↩ ${money(excl.excluded)} буцаагдсан`}
                        </span>
                      )}
                    </div>
                    {t.note && (
                      <div className="mt-[2px] text-[13px] text-[#8C8578] truncate">📝 {t.note}</div>
                    )}
                  </div>

                  {/* Amount + date */}
                  <div className="text-left sm:text-right shrink-0">
                    <div className="font-display font-semibold text-[15.5px] whitespace-nowrap" style={{ color: isIncome ? '#2E9E5B' : '#D8483B' }}>
                      {isIncome ? '+' : '−'}{money(t.amount)}
                    </div>
                    {excl && !excl.full && (
                      <div className="text-[13px] text-[#6E665A] mt-[2px] whitespace-nowrap">цэвэр {money(excl.net)}</div>
                    )}
                    {/* Огноо — үндсэн харагдац ХЭВЭЭР. Банкны мэдэгдэл ирсэн цаг нь
                        нэмэлт давхарга: hover дээр tooltip (мөрийг товшвол доорх
                        панелд бас харагдана). Цаггүй мөрд title огт нэмэгдэхгүй. */}
                    <div
                      className="text-[13px] text-[#A39A8A] mt-[2px] whitespace-nowrap"
                      title={txnTimeTitle(t)}
                    >
                      {t.txn_date || '-'}
                    </div>
                  </div>
                </div>
              </div>

              {expanded && (
                <RowPanel
                  row={t}
                  categories={categories}
                  applyPatch={applyPatch}
                  onClose={() => setExpandedId(null)}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between mt-[14px]">
        <button
          onClick={() => onPage(offset - limit)}
          disabled={offset <= 0}
          className="h-[38px] px-[16px] border border-cream-border bg-cream-card rounded-[10px] font-body text-[13.5px] text-[#6E665A] cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
        >
          ← Өмнөх
        </button>
        <span className="text-[13px] text-[#A39A8A]">{page} / {pages}</span>
        <button
          onClick={() => onPage(offset + limit)}
          disabled={offset + limit >= total}
          className="h-[38px] px-[16px] border border-cream-border bg-cream-card rounded-[10px] font-body text-[13.5px] text-[#6E665A] cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
        >
          Дараах →
        </button>
      </div>
    </div>
  );
}

// Expand панель: ангилал chip-үүд + талбар (модулиас) + applyToAll (default OFF).
// Optimistic: хадгалахад applyPatch-аар шууд харагдац шинэчлэгдэж, алдаа гарвал
// хуучин утгууд руу rollback хийнэ.
function RowPanel({ row, categories, applyPatch, onClose }) {
  const catAction = findAction(row, ACTION_SET_CATEGORY);
  const detail = detailFieldFor(row);
  // Зөвхөн энэ ТӨРЛИЙН гүйлгээнд утгатай ангилал (зарлагад "Орлого" гарахгүй).
  // Шийдвэрийг config/categories.js гаргана — энд дүрэм давхардуулахгүй.
  const catOptions = categories.filter((c) => isCategoryAllowedFor(c, row.type));
  const [cat, setCat] = useState(row.category ?? null);
  const [text, setText] = useState(detail.current || '');
  const [applyAll, setApplyAll] = useState(false); // ⚠️ default OFF — санамсаргүй override үүсэхгүй
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const trimmed = text.trim();
  const catChanged = cat != null && cat !== (row.category ?? null);
  const textChanged = (trimmed || null) !== (detail.current ?? null);
  const dirty = catChanged || textChanged;

  async function save() {
    if (!dirty) { onClose(); return; }
    setBusy(true); setErr('');
    // Optimistic — хадгалахын өмнөх утгуудыг rollback-д хадгална
    const prev = { category: row.category ?? null, status: row.status, [detail.rowField]: detail.current ?? null };
    const optimistic = { [detail.rowField]: trimmed || null };
    if (catChanged) { optimistic.category = cat; optimistic.status = 'classified'; }
    applyPatch(row.id, optimistic);
    try {
      if (catChanged) {
        // Ангилал (+ шинэ утгатай талбар) нэг PATCH-аар; applyToAll = зөвхөн
        // хэрэглэгчийн сонгосон checkbox (default OFF)
        await api.patchCategory(row.id, {
          category: cat,
          applyToAll: applyAll,
          ...(textChanged && trimmed ? { [detail.apiField]: trimmed } : {}),
        });
        // /category-ийн талбар нь COALESCE (устгаж чадахгүй) — хоослосон бол тусад нь
        if (textChanged && !trimmed) await api.updateFields(row.id, { [detail.apiField]: '' });
      } else {
        await api.updateFields(row.id, { [detail.apiField]: trimmed });
      }
      onClose();
    } catch (e) {
      applyPatch(row.id, prev); // rollback
      setErr(e.message || 'Хадгалахад алдаа гарлаа');
      setBusy(false);
    }
  }

  return (
    <div className="border-t border-[#F0E6D4] bg-[#FBF6EC] py-[16px] px-[18px]">
      {/* Мэдэгдэл ирсэн цаг (touch дээр tooltip харагдахгүй тул энд ч харуулна).
          email_received_at NULL бол энэ мөр огт гарахгүй — цаггүй хэвээр. */}
      {txnTimeLabel(row) && (
        <div className="text-[13px] text-[#A39A8A] mb-[12px]">
          🕒 Банкны мэдэгдэл ирсэн: {row.txn_date} · {txnTimeLabel(row)}
        </div>
      )}

      {/* Ангилал сонгох/өөрчлөх */}
      <div className="text-[13px] font-medium text-[#6E665A] mb-[8px]">{catAction.label}</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-[8px] mb-[16px]">
        {catOptions.map((c) => {
          const sel = cat === c;
          const hx = catHex(c);
          return (
            <button
              key={c}
              onClick={() => setCat(c)}
              className="flex items-center gap-[9px] py-[10px] px-[12px] border-[1.5px] rounded-[12px] cursor-pointer font-body text-[13.5px] text-left min-h-[44px]"
              style={{
                borderColor: sel ? hx : '#EFE6D6',
                background: sel ? hexTint(hx, 0.14) : '#FFFDF9',
                fontWeight: sel ? 600 : 500,
                color: sel ? hx : '#4A453D',
              }}
            >
              <span className="text-[16px] shrink-0">{catEmoji(c)}</span>
              <span className="flex-1 truncate">{catLabel(c)}</span>
            </button>
          );
        })}
      </div>

      {/* Талбар — POS→Газрын нэр / бусад→Шалтгаан (модулиас) */}
      <label className="block text-[13px] font-medium text-[#6E665A] mb-[7px]">{detail.label}</label>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={detail.maxLength}
        placeholder={detail.placeholder}
        className="w-full h-[44px] px-[14px] border-[1.5px] border-cream-input rounded-[12px] bg-white font-body text-[14px] text-[#2A2722] outline-none mb-[14px]"
      />

      {/* applyToAll — зөвхөн ангилал өөрчлөгдөх үед утгатай */}
      <label className={`flex items-start gap-[10px] mb-[16px] ${catChanged ? 'cursor-pointer' : 'opacity-45 cursor-not-allowed'}`}>
        <input
          type="checkbox"
          checked={applyAll}
          disabled={!catChanged}
          onChange={(e) => setApplyAll(e.target.checked)}
          className="mt-[2px] w-[18px] h-[18px] shrink-0 accent-[#1F7A6B]"
        />
        <span className="min-w-0">
          <span className="block text-[13.5px] font-semibold text-[#4A453D]">{APPLY_TO_ALL_CONFIRM.question}</span>
          <span className="block text-[13px] text-[#A39A8A] mt-[2px]">{APPLY_TO_ALL_CONFIRM.hint}</span>
        </span>
      </label>

      {err && <div className="text-[#D8483B] text-[13px] mb-[10px]">{err}</div>}

      {/* Товчнууд — 360px-д багана, sm+ мөр */}
      <div className="flex flex-col gap-[10px] sm:flex-row">
        <button
          onClick={onClose}
          className="h-[44px] px-[18px] border-[1.5px] border-cream-input bg-white rounded-[12px] font-body font-semibold text-[14px] text-[#6E665A] cursor-pointer"
        >
          Болих
        </button>
        <button
          onClick={save}
          disabled={busy || !dirty}
          className="flex-1 h-[44px] border-none rounded-[12px] font-body font-semibold text-[14.5px]"
          style={{
            background: busy || !dirty ? '#E7DECF' : '#1F7A6B',
            color: busy || !dirty ? '#B7AD9C' : '#fff',
            cursor: busy || !dirty ? 'not-allowed' : 'pointer',
          }}
        >
          {busy ? 'Хадгалж байна...' : 'Хадгалах'}
        </button>
      </div>
    </div>
  );
}
