// telegram/stockAlertEngine.js — تنبيهات المخزون "عند التغيّر فقط" (بدل الإغراق اليومي)
//
// المشكلة القديمة: فحص كل ساعة كان بيبعت رسالة لكل منتج منخفض/نافد كل يوم (آلاف الرسائل).
// الحل: بنخزّن "حالة" كل منتج (low/out) في جدول stock_alert_state، وبنبعت تنبيه فقط عند:
//   سليم → قارب ينفد   |   سليم → نفد   |   قارب ينفد → نفد
// وفي نفس الدورة كل التغييرات بتتجمع في رسالة (أو اتنين/تلاتة) مش رسالة لكل منتج.
// لو المنتج اتوفّر تاني (فوق الحد) حالته بتتمسح بهدوء، فلو نزل بعد كده بيتنبّه مرة جديدة.
// أول تشغيل بعد النشر = "خط أساس": المنتجات الناقصة حاليًا بتتسجّل كمعروفة من غير ما تتبعت (عشان مفيش طوفان).
const { all, get, run } = require('../db/database');
const { getAllLowStockProducts } = require('../utils/stockAlerts');
const notifier = require('../notifications/telegramNotifier');
const cfg = require('./config');
const { esc, qtyFmt } = require('./reports');

const PER_MESSAGE = 10, MAX_MESSAGES = 3;
let running = false, timer = null;

function buildCurrent(items) {
  const cur = new Map();
  for (const it of items) {
    if (it.low_stock_mode === 'per_location') {
      for (const l of it.low_locations || []) {
        cur.set(`${it.product_id}|loc:${l.location_id}`, { product_id: it.product_id, scope: `loc:${l.location_id}`, state: Number(l.quantity) <= 0 ? 'out' : 'low', qty: Number(l.quantity), threshold: Number(l.threshold), sku: it.sku, name: it.name, where: l.location_name });
      }
    } else {
      const total = Number(it.total_quantity) || 0;
      cur.set(`${it.product_id}|all`, { product_id: it.product_id, scope: 'all', state: total <= 0 ? 'out' : 'low', qty: total, threshold: Number(it.min_stock_threshold) || 0, sku: it.sku, name: it.name, where: null });
    }
  }
  return cur;
}

function line(x) {
  return `📦 <b>${esc(x.name)}</b>\n   🏷 <code>${esc(x.sku || '—')}</code>\n   المتبقي: <b>${qtyFmt(x.qty)}</b> · حد التنبيه: ${qtyFmt(x.threshold)}${x.where ? ` · المخزن: ${esc(x.where)}` : ''}`;
}
function buildMessages(newlyOut, newlyLow) {
  const msgs = []; const mk = (head, list) => {
    for (let i = 0; i < list.length && msgs.length < MAX_MESSAGES; i += PER_MESSAGE) {
      const chunk = list.slice(i, i + PER_MESSAGE);
      msgs.push(`${head}${i === 0 ? ` (${list.length})` : ' — تابع'}\n──────────────\n${chunk.map(line).join('\n')}`);
    }
  };
  mk('🚨 <b>نفد من المخزون</b>', newlyOut); mk('⚠️ <b>قارب على النفاد</b>', newlyLow);
  const shown = Math.min(msgs.length, MAX_MESSAGES) * PER_MESSAGE; const total = newlyOut.length + newlyLow.length;
  if (total > shown) msgs[msgs.length - 1] += `\n──────────────\n… و<b>${total - shown}</b> منتج آخر — اطلب التقرير الكامل بالزر تحت 👇`;
  return msgs;
}
const REPORT_KEYBOARD = { inline_keyboard: [[{ text: '📄 تقرير الناقص (PDF)', callback_data: 'sr:both:p' }, { text: '📋 قائمة البوت', callback_data: 'm:main' }]] };

async function upsertState(x) {
  await run(`INSERT INTO stock_alert_state (product_id, scope, state, last_qty, notified_at) VALUES (?, ?, ?, ?, NOW())
             ON CONFLICT (product_id, scope) DO UPDATE SET state = EXCLUDED.state, last_qty = EXCLUDED.last_qty, notified_at = NOW()`, [x.product_id, x.scope, x.state, x.qty]);
}

async function sweep() {
  if (running) return { skipped: 'busy' };
  running = true;
  try {
    const settings = await get('SELECT notifications_enabled, notify_low_stock FROM settings WHERE id = 1');
    const alertsOn = !settings || (settings.notifications_enabled && settings.notify_low_stock);
    const cur = buildCurrent(await getAllLowStockProducts());
    const known = new Map((await all('SELECT product_id, scope, state FROM stock_alert_state')).map((r) => [`${r.product_id}|${r.scope}`, r.state]));
    const baselined = await get(`SELECT value FROM bot_meta WHERE key = 'stock_alert_baseline'`);

    if (!baselined) { // أول مرة: سجّل الوضع الحالي كمعروف من غير إرسال
      for (const x of cur.values()) await upsertState(x);
      await run(`INSERT INTO bot_meta (key, value) VALUES ('stock_alert_baseline', ?) ON CONFLICT (key) DO NOTHING`, [new Date().toISOString()]);
      return { baseline: cur.size };
    }

    const newlyOut = [], newlyLow = [], silent = [];
    for (const [k, x] of cur) {
      const prev = known.get(k);
      if (!prev) (x.state === 'out' ? newlyOut : newlyLow).push(x);
      else if (prev === 'low' && x.state === 'out') newlyOut.push(x);
      else if (prev !== x.state) silent.push(x); // نفد → قارب (اتوفّر جزء): تحديث هادي
    }
    const recovered = [...known.keys()].filter((k) => !cur.has(k));

    for (const x of silent) await upsertState(x);
    for (const k of recovered) { const [pid, scope] = k.split('|'); await run('DELETE FROM stock_alert_state WHERE product_id = ? AND scope = ?', [Number(pid), scope]); }

    const toNotify = [...newlyOut, ...newlyLow];
    if (!toNotify.length) return { notified: 0, recovered: recovered.length };
    if (!alertsOn) { // الإشعارات متوقفة: نسجّل الحالة بدون إرسال (عشان ما تتجمّع وتتبعت كلها لما تتفعّل)
      for (const x of toNotify) await upsertState(x);
      return { notified: 0, muted: toNotify.length };
    }
    newlyOut.sort((a, b) => a.name.localeCompare(b.name, 'ar')); newlyLow.sort((a, b) => a.qty - b.qty);
    const msgs = buildMessages(newlyOut, newlyLow);
    let allSent = true;
    for (let i = 0; i < msgs.length; i++) {
      const ok = await notifier.sendText(msgs[i], i === msgs.length - 1 ? { reply_markup: REPORT_KEYBOARD } : {});
      if (!ok) { allSent = false; break; }
    }
    // نسجّل الحالة فقط لو الإرسال نجح (لو فشل بنجرّب تاني في الدورة الجاية بدل ما التنبيه يضيع)
    if (allSent) for (const x of toNotify) await upsertState(x);
    return { notified: allSent ? toNotify.length : 0, messages: msgs.length, failed: !allSent };
  } finally { running = false; }
}

function start() {
  if (timer) return;
  const every = cfg.alertIntervalSec() * 1000;
  console.log(`✓ تنبيهات المخزون (عند التغيّر فقط) كل ${cfg.alertIntervalSec()} ثانية`);
  setTimeout(() => sweep().catch((e) => console.error('[StockAlerts]', e.message)), 45 * 1000);
  timer = setInterval(() => sweep().catch((e) => console.error('[StockAlerts]', e.message)), every);
  timer.unref();
}

module.exports = { sweep, start, buildCurrent, buildMessages };
