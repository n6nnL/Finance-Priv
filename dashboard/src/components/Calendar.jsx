import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { api } from '../lib/api.js';
import { money } from '../lib/format.js';
import {
  MONTHS_MN, WEEKDAYS_MN, mondayIndex, ymd, parseYmd,
  monthMarkers, getCycle,
} from '../lib/budget.js';
import Planner from './Planner.jsx';
import Settings from './Settings.jsx';
import BudgetTracker from './BudgetTracker.jsx';
import BalanceHistory from './BalanceHistory.jsx';

const TYPE = {
  income: { dot: '#2E9E5B', tint: 'rgba(46,158,91,0.12)', label: 'Цалин' },
  subscription: { dot: '#E0A33E', tint: 'rgba(224,163,62,0.14)' },
  personal: { dot: '#D86A92', tint: 'rgba(216,106,146,0.14)' },
};
const PRIORITY = ['income', 'personal', 'subscription'];

function markerAmount(mk) {
  if (mk.type === 'subscription') return `$${mk.amountUsd} · ${money(mk.amountMnt)}`;
  if (mk.amountMnt != null) return money(mk.amountMnt);
  return '';
}

export default function Calendar() {
  const today = new Date();
  const [view, setView] = useState({ y: today.getFullYear(), m: today.getMonth() });
  const [settings, setSettings] = useState(null);   // null = ачаалж байна
  const [events, setEvents] = useState([]);
  const [showSettings, setShowSettings] = useState(false);
  const [saveState, setSaveState] = useState('');   // '' | 'saving' | 'saved' | 'error'
  const [form, setForm] = useState({ title: '', date: '', amount: '' });
  const saveTimer = useRef(null);

  // ── Анхны ачаалал: тохиргоо + event ──
  useEffect(() => {
    let alive = true;
    api.getSettings().then((r) => { if (alive) setSettings(r.settings); }).catch(() => {});
    api.events().then((r) => { if (alive) setEvents(r.data || []); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  // Calendar/Gmail холбох flow-оос буцахад (?settings=1 / алдааны query) Settings панелийг шууд нээнэ.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('settings') === '1' || params.get('calendarError') === '1' || params.get('gmailError') === '1') {
      setShowSettings(true);
      params.delete('settings');
      params.delete('calendarError');
      params.delete('gmailError');
      const qs = params.toString();
      history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));
    }
  }, []);

  // Тохиргоо хадгалах (optimistic + debounced PUT + баталгаажуулалт)
  const persist = useCallback((next) => {
    setSettings(next);
    setSaveState('saving');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await api.saveSettings(next);
        setSaveState('saved');
        setTimeout(() => setSaveState(''), 2000);
      } catch {
        setSaveState('error');
      }
    }, 500);
  }, []);

  // Settings панелийн Save (sanitize-г Settings хийсэн) — шууд PUT, await
  const saveSettingsNow = useCallback(async (clean) => {
    setSettings(clean);
    setSaveState('saving');
    try {
      const r = await api.saveSettings(clean);
      setSettings(r.settings);
      setSaveState('saved');
      setTimeout(() => setSaveState(''), 2000);
    } catch {
      setSaveState('error');
      throw new Error('save failed');
    }
  }, []);

  const onAllocChange = (index, raw) => {
    const n = raw === '' ? 0 : Math.max(0, Math.trunc(Number(raw) || 0));
    const next = {
      ...settings,
      categoryAllocations: settings.categoryAllocations.map((a, i) => (i === index ? { ...a, amountMnt: n } : a)),
    };
    persist(next);
  };

  const markers = useMemo(
    () => (settings ? monthMarkers(view.y, view.m, settings, events) : []),
    [view, settings, events]
  );
  const byDay = useMemo(() => {
    const map = {};
    for (const mk of markers) (map[mk.date] ||= []).push(mk);
    return map;
  }, [markers]);

  const cycle = useMemo(
    () => getCycle(view.y, view.m, settings?.paydayDay),
    [view, settings]
  );

  const firstOfMonth = new Date(view.y, view.m, 1);
  const offset = mondayIndex(firstOfMonth);
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
  const totalCells = Math.ceil((offset + daysInMonth) / 7) * 7;
  const todayStr = ymd(today);

  const shiftMonth = (delta) => {
    setView((v) => {
      const d = new Date(v.y, v.m + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });
  };

  const addEvent = async () => {
    const title = form.title.trim();
    if (!title || !form.date) return;
    const amt = form.amount.trim() === '' ? null : Math.max(0, Math.trunc(Number(form.amount) || 0));
    try {
      const r = await api.addEvent({ title, date: form.date, amountMnt: amt });
      setEvents((evs) => [...evs, r.event]);
      setForm({ title: '', date: '', amount: '' });
    } catch { /* зөвхөн UI — алдааг чимээгүй орхино */ }
  };

  const deleteEvent = async (eventId) => {
    try {
      await api.deleteEvent(eventId);
      setEvents((evs) => evs.filter((e) => e.id !== eventId));
    } catch { /* ignore */ }
  };

  const inputCls = 'h-[42px] px-[12px] border-[1.5px] border-cream-input rounded-[10px] bg-white font-body text-[14px] text-[#2A2722] outline-none';

  // ── Ачаалж байна ──
  if (!settings) {
    return <div className="bg-cream-card border border-cream-border rounded-card p-[24px] text-[14px] text-[#8C8578]">Ачаалж байна…</div>;
  }

  return (
    <div className="flex flex-col gap-[18px]">
      {/* Тохиргоо мөр */}
      <div className="flex items-center justify-end gap-[12px]">
        {saveState === 'saving' && <span className="text-[13px] text-[#A39A8A] whitespace-nowrap">Хадгалж байна…</span>}
        {saveState === 'saved' && <span className="text-[13px] font-medium text-[#1F7A6B] whitespace-nowrap">✓ Хадгалагдлаа</span>}
        {saveState === 'error' && <span className="text-[13px] font-medium text-[#D8483B] whitespace-nowrap">Хадгалахад алдаа</span>}
        <button onClick={() => setShowSettings((v) => !v)}
          className="h-[40px] px-[16px] border border-cream-border bg-cream-card rounded-[10px] text-[14px] font-medium text-[#4A453D] cursor-pointer whitespace-nowrap flex items-center gap-[7px]">
          ⚙️ Тохиргоо
        </button>
      </div>

      {showSettings && (
        <Settings settings={settings} onSave={saveSettingsNow} onClose={() => setShowSettings(false)} saving={saveState === 'saving'} />
      )}

      {/* Real-time tracker — тусдаа view (Planner-г хөндөхгүй) */}
      <BudgetTracker />

      {/* Үлдэгдлийн график — өөр нэг ТУСДАА, НЭМЭЛТ view (BudgetTracker-г хөндөхгүй) */}
      <BalanceHistory budgetFloor={settings.budgetFloor} onOpenSettings={() => setShowSettings(true)} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-[18px] items-start">
        {/* ── Left: calendar ── */}
        <div className="flex flex-col gap-[18px]">
          <div className="bg-cream-card border border-cream-border rounded-card p-[18px]">
            {/* Month header */}
            <div className="flex items-center justify-between mb-[14px]">
              <button onClick={() => shiftMonth(-1)} aria-label="Өмнөх сар"
                className="w-[36px] h-[36px] rounded-[10px] border border-cream-border bg-cream-card text-[#6E665A] text-[16px] cursor-pointer flex items-center justify-center">‹</button>
              <div className="font-display font-semibold text-[17px] whitespace-nowrap">{view.y} оны {MONTHS_MN[view.m]}</div>
              <button onClick={() => shiftMonth(1)} aria-label="Дараа сар"
                className="w-[36px] h-[36px] rounded-[10px] border border-cream-border bg-cream-card text-[#6E665A] text-[16px] cursor-pointer flex items-center justify-center">›</button>
            </div>

            {/* Weekday labels */}
            <div className="grid grid-cols-7 gap-[4px] mb-[4px]">
              {WEEKDAYS_MN.map((w) => (
                <div key={w} className="text-center text-[13px] font-medium text-[#A39A8A] py-[2px]">{w}</div>
              ))}
            </div>

            {/* Day grid */}
            <div className="grid grid-cols-7 gap-[4px]">
              {Array.from({ length: totalCells }, (_, i) => {
                const dayNum = i - offset + 1;
                if (dayNum < 1 || dayNum > daysInMonth) return <div key={i} />;
                const dateStr = ymd(new Date(view.y, view.m, dayNum));
                const dayMarkers = byDay[dateStr] || [];
                const top = PRIORITY.find((t) => dayMarkers.some((mk) => mk.type === t));
                const tint = top ? TYPE[top].tint : undefined;
                const isToday = dateStr === todayStr;
                return (
                  <div
                    key={i}
                    className={`min-h-[46px] sm:min-h-[68px] rounded-[8px] p-[4px] flex flex-col gap-[3px] ${isToday ? 'ring-2 ring-brand' : ''}`}
                    style={{ background: tint || '#FBF7EF' }}
                  >
                    <div className="text-[13px] font-medium text-[#4A453D] leading-none">{dayNum}</div>
                    {/* dots (always) */}
                    <div className="flex flex-wrap gap-[3px]">
                      {dayMarkers.slice(0, 4).map((mk) => (
                        <span key={mk.id} className="w-[7px] h-[7px] rounded-full" style={{ background: TYPE[mk.type].dot }} />
                      ))}
                    </div>
                    {/* mini labels (sm+ only — cells big enough) */}
                    <div className="hidden sm:flex flex-col gap-[2px] mt-auto">
                      {dayMarkers.slice(0, 2).map((mk) => (
                        <span key={mk.id} className="text-[13px] leading-tight truncate" style={{ color: TYPE[mk.type].dot }}
                          title={mk.title}>
                          {mk.type === 'income' ? '💰 ' : ''}{mk.title}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Add personal event */}
          <div className="bg-cream-card border border-cream-border rounded-card p-[18px]">
            <div className="font-display font-semibold text-[15px] mb-[12px]">Хувийн event нэмэх</div>
            <div className="flex flex-col sm:flex-row gap-[8px]">
              <input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="Нэр (ж: Төрсөн өдөр)"
                className={`${inputCls} sm:flex-1 min-w-0`}
              />
              <input
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                className={inputCls}
              />
              <input
                type="number"
                inputMode="numeric"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                placeholder="Төсөв ₮"
                className={`${inputCls} sm:w-[120px]`}
              />
              <button
                onClick={addEvent}
                className="h-[42px] px-[18px] border-none bg-brand text-white font-body font-semibold text-[14px] rounded-[10px] cursor-pointer whitespace-nowrap"
              >
                Нэмэх
              </button>
            </div>
          </div>

          {/* This month's markers (legible list — good on mobile) */}
          <div className="bg-cream-card border border-cream-border rounded-card p-[18px]">
            <div className="font-display font-semibold text-[15px] mb-[12px]">Энэ сарын тэмдэглэгээ</div>
            {markers.length === 0 ? (
              <div className="text-[13px] text-[#A39A8A]">Тэмдэглэгээ алга</div>
            ) : (
              <div className="flex flex-col gap-[10px]">
                {markers.map((mk) => (
                  <div key={mk.id} className="flex items-center gap-[10px]">
                    <span className="w-[9px] h-[9px] rounded-full shrink-0" style={{ background: TYPE[mk.type].dot }} />
                    <span className="text-[13px] text-[#8C8578] whitespace-nowrap shrink-0 w-[44px]">{parseYmd(mk.date).getMonth() + 1}/{parseYmd(mk.date).getDate()}</span>
                    <span className="min-w-0 flex-1 truncate font-medium text-[14px]" title={mk.title}>
                      {mk.type === 'income' ? '💰 ' : ''}{mk.title}
                    </span>
                    <span className="text-[13px] text-[#6E665A] whitespace-nowrap shrink-0">{markerAmount(mk)}</span>
                    {mk.type === 'personal' && mk.eventId != null && (
                      <button onClick={() => deleteEvent(mk.eventId)} aria-label="Устгах"
                        className="shrink-0 w-[26px] h-[26px] rounded-[8px] border-none bg-transparent text-[#C2698F] text-[14px] cursor-pointer flex items-center justify-center">✕</button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Right: planner ── */}
        <Planner
          cycle={cycle}
          settings={settings}
          personalEvents={events}
          onAllocChange={onAllocChange}
          onOpenSettings={() => setShowSettings(true)}
        />
      </div>
    </div>
  );
}
