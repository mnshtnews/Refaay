// telegram/invoiceFlow.js — إنشاء فاتورة مبيعات من تيليجرام (للأدمن فقط)، خطوة بخطوة بأزرار.
//
// مهم جدًا: الفاتورة ما بتتكتبش في الداتابيز من هنا. بنستدعي نفس API النظام (POST /api/invoices ثم /confirm)
// بجلسة حقيقية لحساب النظام المُعيَّن، فكل قواعد العمل (حد الائتمان، المخزون، الخصم، العمولة، الإشعارات،
// سجل التدقيق) بتتطبّق بالظبط زي الإنشاء من الشاشة، ومفيش منطق مكرر ممكن يتفرّق عن النظام.
const { get, all } = require('../db/database');
const tg = require('./tg');
const cfg = require('./config');
const { likeAll, esc, num, qtyFmt, searchProducts } = require('./reports');
const { createSession, revokeSession } = require('../utils/sessions');
const { generateToken } = require('../middleware/auth');

const TTL_MS = 20 * 60 * 1000;
const states = new Map(); // `${chatId}:${userId}` -> state
const keyOf = (chatId, userId) => `${chatId}:${userId}`;
setInterval(() => { const now = Date.now(); for (const [k, s] of states) if (now - s.at > TTL_MS) states.delete(k); }, 5 * 60 * 1000).unref();

const kb = (rows) => ({ inline_keyboard: rows });
const CANCEL_ROW = [{ text: '❌ إلغاء الفاتورة', callback_data: 'inv:x' }];
const forceReply = (ph) => ({ force_reply: true, selective: true, input_field_placeholder: ph });

const hasActive = (chatId, userId) => states.has(keyOf(chatId, userId));
const cancel = (chatId, userId) => states.delete(keyOf(chatId, userId));

function cartTotal(st) { return st.cart.reduce((s, it) => s + Math.round(it.qty * it.unit_price * (1 - (it.discount_pct || 0) / 100) * 100) / 100, 0); }
function cartText(st) {
  const lines = st.cart.map((it, i) => `${i + 1}. ${esc(it.name)} — <code>${esc(it.sku || '')}</code>\n    ${qtyFmt(it.qty)} × ${num(it.unit_price)}${it.discount_pct ? ` (خصم ${it.discount_pct}%)` : ''} = <b>${num(it.qty * it.unit_price * (1 - (it.discount_pct || 0) / 100))}</b>`);
  return `🛒 <b>بنود الفاتورة</b>\n${lines.join('\n') || '— لا يوجد بنود —'}\n──────────────\n💰 الإجمالي: <b>${num(cartTotal(st))}</b> ج.م`;
}
const header = (st) => `🧾 <b>فاتورة جديدة</b>${st.customer ? `\n👤 ${esc(st.customer.name)}` : ''}${st.location ? `  ·  🏬 ${esc(st.location.name)}` : ''}`;

async function begin(chat, from) {
  states.set(keyOf(chat.id, from.id), { step: 'cust', cart: [], at: Date.now(), by: from.first_name || '' });
  await tg.sendMessage(chat.id, '🧾 <b>فاتورة جديدة</b>\nاكتب <b>اسم العميل</b> أو رقم تليفونه أو كوده:\n<i>(للإلغاء: /cancel)</i>', { reply_markup: forceReply('اسم العميل أو رقمه') });
}

async function onText(chat, from, text) {
  const st = states.get(keyOf(chat.id, from.id)); if (!st) return false;
  st.at = Date.now(); const q = String(text || '').trim(); if (!q) return true;
  if (st.step === 'cust') {
    const { where, params } = likeAll(['name', 'phone', 'code'], q);
    const rows = await all(`SELECT id, name, phone, code FROM customers WHERE is_active = 1 AND ${where} ORDER BY name LIMIT 6`, params);
    if (!rows.length) { await tg.sendMessage(chat.id, 'مفيش عميل بالاسم ده 🤔 جرّب جزء تاني من الاسم أو الرقم.', { reply_markup: forceReply('اسم العميل أو رقمه') }); return true; }
    await tg.sendMessage(chat.id, 'اختار العميل:', { reply_markup: kb([...rows.map((r) => [{ text: `${r.name}${r.phone ? ' · ' + r.phone : ''}`.slice(0, 60), callback_data: `inv:c:${r.id}` }]), CANCEL_ROW]) });
    return true;
  }
  if (st.step === 'prod') {
    const rows = await searchProducts(q, 8, st.location.id);
    if (!rows.length) { await tg.sendMessage(chat.id, 'مفيش منتج بالاسم/الكود ده 🤔 جرّب تاني.', { reply_markup: forceReply('اسم المنتج أو كوده') }); return true; }
    await tg.sendMessage(chat.id, `اختار المنتج (المتاح في ${esc(st.location.name)}):`, { reply_markup: kb([...rows.map((r) => [{ text: `${r.name} · ${r.sku || ''} · متاح ${qtyFmt(r.loc_qty)}`.slice(0, 62), callback_data: `inv:p:${r.id}` }]), CANCEL_ROW]) });
    return true;
  }
  if (st.step === 'qty') { await setQty(chat, from, st, q.replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))); return true; }
  return true;
}

async function setQty(chat, from, st, raw) {
  const qty = Number(String(raw).replace(',', '.'));
  const p = st.pending;
  if (!Number.isFinite(qty) || qty <= 0 || (!p.fractional && !Number.isInteger(qty))) { await tg.sendMessage(chat.id, 'اكتب كمية صحيحة (رقم أكبر من صفر).'); return; }
  const inCart = st.cart.filter((c) => c.product_id === p.id).reduce((s, c) => s + c.qty, 0);
  if (qty + inCart > p.avail) { await tg.sendMessage(chat.id, `⛔ المتاح من «${esc(p.name)}» في ${esc(st.location.name)}: <b>${qtyFmt(p.avail - inCart)}</b> فقط. اكتب كمية أقل.`); return; }
  st.cart.push({ product_id: p.id, name: p.name, sku: p.sku, qty, unit_price: Number(p.sale_price) || 0, discount_pct: Number(st.customer.discount_pct) || 0 });
  st.pending = null; st.step = 'cart';
  await tg.sendMessage(chat.id, `${header(st)}\n\n${cartText(st)}`, { reply_markup: kb([[{ text: '➕ منتج تاني', callback_data: 'inv:more' }, { text: '↩️ احذف آخر بند', callback_data: 'inv:undo' }], [{ text: '✅ إنهاء وإكمال', callback_data: 'inv:done' }], CANCEL_ROW]) });
}

async function onCallback(chat, from, data, cbq) {
  const key = keyOf(chat.id, from.id); let st = states.get(key);
  const parts = data.split(':'); const act = parts[1];
  if (act === 'new') { await begin(chat, from); return; }
  if (!st) { await tg.answerCallbackQuery(cbq.id, 'انتهت جلسة الفاتورة، ابدأ من جديد من القائمة', true); return; }
  st.at = Date.now();
  if (act === 'x') { states.delete(key); await tg.sendMessage(chat.id, '❌ تم إلغاء الفاتورة.'); return; }

  if (act === 'c') { // اختيار عميل
    const c = await get('SELECT id, name, discount_pct FROM customers WHERE id = ? AND is_active = 1', [Number(parts[2])]);
    if (!c) { await tg.answerCallbackQuery(cbq.id, 'العميل غير متاح', true); return; }
    st.customer = c;
    const locs = await all('SELECT id, name FROM locations WHERE is_active = 1 ORDER BY id');
    if (locs.length === 1) { st.location = locs[0]; st.step = 'prod'; await tg.sendMessage(chat.id, `${header(st)}\n\nاكتب <b>اسم المنتج</b> أو كوده:`, { reply_markup: forceReply('اسم المنتج أو كوده') }); return; }
    st.step = 'loc';
    await tg.sendMessage(chat.id, `${header(st)}\n\nالبيع من أنهي مخزن؟`, { reply_markup: kb([...locs.map((l) => [{ text: `🏬 ${l.name}`, callback_data: `inv:l:${l.id}` }]), CANCEL_ROW]) });
    return;
  }
  if (act === 'l') {
    const l = await get('SELECT id, name FROM locations WHERE id = ? AND is_active = 1', [Number(parts[2])]);
    if (!l) { await tg.answerCallbackQuery(cbq.id, 'المخزن غير متاح', true); return; }
    st.location = l; st.step = 'prod';
    await tg.sendMessage(chat.id, `${header(st)}\n\nاكتب <b>اسم المنتج</b> أو كوده:`, { reply_markup: forceReply('اسم المنتج أو كوده') }); return;
  }
  if (act === 'more') { st.step = 'prod'; await tg.sendMessage(chat.id, 'اكتب اسم المنتج أو كوده:', { reply_markup: forceReply('اسم المنتج أو كوده') }); return; }
  if (act === 'p') {
    const p = await get(`SELECT id, name, sku, sale_price, allow_fractional_qty, COALESCE((SELECT quantity FROM inventory WHERE product_id = products.id AND location_id = ?),0) AS avail FROM products WHERE id = ? AND is_active = 1`, [st.location.id, Number(parts[2])]);
    if (!p) { await tg.answerCallbackQuery(cbq.id, 'المنتج غير متاح', true); return; }
    if (Number(p.avail) <= 0) { await tg.answerCallbackQuery(cbq.id, `«${p.name}» رصيده صفر في ${st.location.name}`, true); return; }
    st.pending = { id: p.id, name: p.name, sku: p.sku, sale_price: p.sale_price, avail: Number(p.avail), fractional: !!p.allow_fractional_qty }; st.step = 'qty';
    await tg.sendMessage(chat.id, `📦 <b>${esc(p.name)}</b>\n🏷 <code>${esc(p.sku || '')}</code> · السعر ${num(p.sale_price)} · المتاح <b>${qtyFmt(p.avail)}</b>\nاختار الكمية أو اكتبها:`, { reply_markup: kb([[1, 2, 3, 5, 10].map((n) => ({ text: String(n), callback_data: `inv:q:${n}` })), CANCEL_ROW]) });
    return;
  }
  if (act === 'q') { if (st.step === 'qty') await setQty(chat, from, st, parts[2]); return; }
  if (act === 'undo') { st.cart.pop(); await tg.sendMessage(chat.id, `${header(st)}\n\n${cartText(st)}`, { reply_markup: kb([[{ text: '➕ منتج تاني', callback_data: 'inv:more' }, { text: '↩️ احذف آخر بند', callback_data: 'inv:undo' }], st.cart.length ? [{ text: '✅ إنهاء وإكمال', callback_data: 'inv:done' }] : [], CANCEL_ROW].filter((r) => r.length)) }); return; }
  if (act === 'done') {
    if (!st.cart.length) { await tg.answerCallbackQuery(cbq.id, 'أضف منتج واحد على الأقل', true); return; }
    st.step = 'pay';
    await tg.sendMessage(chat.id, `${header(st)}\n\n${cartText(st)}\n\nطريقة الدفع؟`, { reply_markup: kb([[{ text: '💵 نقدي', callback_data: 'inv:t:cash' }, { text: '📒 آجل', callback_data: 'inv:t:credit' }], CANCEL_ROW]) }); return;
  }
  if (act === 't') {
    st.payment = parts[2] === 'credit' ? 'credit' : 'cash'; st.step = 'review';
    await tg.sendMessage(chat.id, `${header(st)}\n\n${cartText(st)}\n💳 الدفع: <b>${st.payment === 'cash' ? 'نقدي' : 'آجل'}</b>\n\nراجع الفاتورة ثم اختار:`, { reply_markup: kb([[{ text: '✅ حفظ وتأكيد (يخصم المخزون)', callback_data: 'inv:save:c' }], [{ text: '📝 حفظ كمسودة فقط', callback_data: 'inv:save:d' }], CANCEL_ROW]) }); return;
  }
  if (act === 'save') {
    if (st.step !== 'review' || st.executing) { await tg.answerCallbackQuery(cbq.id, 'جاري التنفيذ…'); return; }
    st.executing = true; await tg.answerCallbackQuery(cbq.id, 'جاري إنشاء الفاتورة…');
    try {
      const out = await createViaApi(st, parts[2] === 'c', from);
      states.delete(key);
      await tg.sendMessage(chat.id, `✅ <b>تم ${out.confirmed ? 'إنشاء وتأكيد' : 'حفظ'} الفاتورة</b>\n🧾 رقم: <code>${esc(out.number)}</code>\n👤 ${esc(st.customer.name)}\n💰 الإجمالي: <b>${num(out.total)}</b> ج.م\n${out.confirmed ? '📉 تم خصم الكمية من المخزون.' : '📝 مسودة — لم يُخصم المخزون بعد (أكّدها من النظام).'}\n<i>سجّل التحصيل من النظام عند استلام المبلغ.</i>`);
    } catch (e) {
      st.executing = false;
      await tg.sendMessage(chat.id, `⛔ <b>تعذر إنشاء الفاتورة</b>\n${esc(e.message)}\n<i>الفاتورة لسه محفوظة هنا — عدّل واضغط تاني، أو /cancel.</i>`, { reply_markup: kb([[{ text: '🔁 حاول تاني', callback_data: 'inv:t:' + st.payment }], CANCEL_ROW]) });
    }
  }
}

// ── التنفيذ عبر API النظام بجلسة حقيقية لحساب النظام المُعيَّن ──
async function actingUser() {
  const name = cfg.actAsUsername();
  if (name) { const u = await get('SELECT * FROM users WHERE username = ? AND is_active = 1', [name]); if (u) return u; throw new Error(`حساب النظام "${name}" (TELEGRAM_ACT_AS_USERNAME) غير موجود أو غير نشط`); }
  const u = await get(`SELECT * FROM users WHERE is_active = 1 AND role IN ('owner','admin') ORDER BY CASE role WHEN 'owner' THEN 0 ELSE 1 END, id LIMIT 1`);
  if (!u) throw new Error('لا يوجد حساب نظام نشط لتسجيل الفاتورة باسمه');
  return u;
}
async function api(token, method, path, body) {
  const res = await fetch(`http://127.0.0.1:${process.env.PORT || 5000}/api${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
async function createViaApi(st, confirm, from) {
  const user = await actingUser();
  const sid = await createSession(user, { headers: { 'user-agent': 'telegram-bot' } });
  const token = generateToken(user, sid);
  try {
    const body = {
      customer_id: st.customer.id, location_id: st.location.id, payment_type: st.payment,
      notes: `أُنشئت من بوت تيليجرام (${from.first_name || ''}${from.username ? ' @' + from.username : ''})`,
      items: st.cart.map((c) => ({ product_id: c.product_id, quantity: c.qty, unit_price: c.unit_price, discount_pct: c.discount_pct || 0, location_id: st.location.id })),
    };
    const created = await api(token, 'POST', '/invoices', body);
    let inv = created.invoice;
    if (confirm) { const r = await api(token, 'POST', `/invoices/${inv.id}/confirm`); inv = r.invoice || inv; }
    return { number: inv.invoice_number, total: inv.total, confirmed: !!confirm };
  } finally { await revokeSession(sid, 'telegram_invoice').catch(() => {}); }
}

module.exports = { begin, onText, onCallback, hasActive, cancel };
