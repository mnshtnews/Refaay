// telegram/bot.js — بوت الإدارة التفاعلي (Long Polling)
//
// الصلاحيات (مهم):
//   • الجروب الوحيد المسموح: TELEGRAM_CHAT_ID. أي جروب/محادثة تانية = البوت يتجاهلها تمامًا.
//   • الأدمن = معرّفات تيليجرام المحددة في TELEGRAM_ADMIN_IDS فقط (مش كل أدمن في الجروب).
//   • أي عضو تاني في الجروب (member): يشوف فقط تقارير المخزون (نفد/قارب) + كشف بواقي العملاء.
//   • كل ضغطة زرار بتتحقق من الصلاحية من جديد على السيرفر (مش مجرد إخفاء الزرار)، فمفيش تحايل بزرار قديم/مُعاد توجيهه.
const tg = require('./tg');
const cfg = require('./config');
const reports = require('./reports');
const invoiceFlow = require('./invoiceFlow');
const engine = require('./stockAlertEngine');
const { get, run } = require('../db/database');

const ROLE_RANK = { member: 1, admin: 2 };
let running = false, offset = 0, botUsername = '';

function roleFor(chat, from) {
  if (!chat || !from || from.is_bot) return null;
  const isAdmin = cfg.adminIds().has(from.id);
  if (chat.type === 'private') return isAdmin ? 'admin' : null;       // الخاص: للأدمن فقط
  if (chat.id === cfg.groupChatId()) return isAdmin ? 'admin' : 'member'; // الجروب المعتمد فقط
  return null;
}
const can = (role, need) => !!role && ROLE_RANK[role] >= ROLE_RANK[need];

// ───────── القوائم ─────────
const btn = (text, data) => ({ text, callback_data: data });
function mainMenu(role) {
  const rows = [
    [btn('🚨 نفدت', 'sr:out:p'), btn('⚠️ قاربت تنفد', 'sr:low:p')],
    [btn('📄 تقرير الاتنين معًا', 'sr:both:p')],
    [btn('👥 بواقي العملاء (عليهم رصيد)', 'rc:bal'), btn('👥 كل العملاء', 'rc:all')],
  ];
  if (role === 'admin') {
    rows.push([btn('🏭 مستحقات الموردين', 'sp:bal'), btn('🏭 كل الموردين', 'sp:all')]);
    rows.push([btn('🔎 استعلام عن منتج', 'pq'), btn('📊 ملخص النهاردة', 'td')]);
    rows.push([btn('🧾 فاتورة جديدة', 'inv:new')]);
    rows.push([btn('📊 Excel: نفدت', 'sr:out:x'), btn('📊 Excel: قاربت', 'sr:low:x'), btn('📊 Excel: الاتنين', 'sr:both:x')]);
    rows.push([btn('🔔 إعدادات التنبيهات', 'm:alerts')]);
  }
  return { inline_keyboard: rows };
}
const mainText = (role) => `👋 <b>بوت الرفاعي</b> — ${role === 'admin' ? 'وضع الأدمن 🔐' : 'عضو'}\nاختار اللي محتاجه 👇`;

async function sendMain(chatId, role) { return tg.sendMessage(chatId, mainText(role), { reply_markup: mainMenu(role) }); }

// ───────── التقارير ─────────
const busy = new Set();
async function sendReport(chatId, key, builder, captionFn) {
  if (busy.has(key)) return;           // منع ضغط متكرر على نفس التقرير في نفس اللحظة
  busy.add(key);
  try {
    await tg.sendChatAction(chatId, 'upload_document');
    const r = await builder();
    if (r.empty) { await tg.sendMessage(chatId, '✅ مفيش بيانات ينطبق عليها التقرير ده دلوقتي.'); return; }
    const data = r.pdf || r.buffer;
    if (data.length > 48 * 1024 * 1024) { await tg.sendMessage(chatId, '⚠️ التقرير أكبر من حد تيليجرام (50MB). اطلب نسخة Excel (للأدمن) أو قلّل النطاق.'); return; }
    await tg.sendDocument(chatId, data, r.filename, captionFn(r));
  } catch (e) {
    console.error('[Bot] report failed:', e.message);
    await tg.sendMessage(chatId, '⛔ حصلت مشكلة أثناء تجهيز التقرير. حاول بعد لحظات.').catch(() => {});
  } finally { setTimeout(() => busy.delete(key), 4000); }
}
const stockCaption = (r) => `📄 <b>${r.outN ? `نفد: ${r.outN}` : ''}${r.outN && r.lowN ? ' · ' : ''}${r.lowN ? `قارب: ${r.lowN}` : ''}</b>\n🕒 ${r.now.stamp}`;

// ───────── الأوامر والنصوص ─────────
const pendingText = new Map(); // `${chat}:${user}` -> {type:'pq', at}
async function onMessage(msg) {
  const chat = msg.chat, from = msg.from, text = (msg.text || '').trim();
  if (!text || !from) return;
  const cmdMatch = /^\/([a-zA-Z_]+)(?:@(\w+))?(?:\s+(.*))?$/.exec(text);
  const cmd = cmdMatch ? cmdMatch[1].toLowerCase() : null;
  if (cmdMatch && cmdMatch[2] && botUsername && cmdMatch[2].toLowerCase() !== botUsername.toLowerCase()) return; // أمر موجّه لبوت تاني

  // /myid متاح لأي حد (عشان صاحب النظام يعرف رقمه ويحطه في TELEGRAM_ADMIN_IDS)
  if (cmd === 'myid') { await tg.sendMessage(chat.id, `🆔 معرّفك: <code>${from.id}</code>`); return; }

  const role = roleFor(chat, from);
  if (!role) { if (chat.type === 'private' && cmd) await tg.sendMessage(chat.id, '🔒 البوت للاستخدام داخل مجموعة الشركة، أو في الخاص للأدمن المعتمدين فقط.'); return; }

  const key = `${chat.id}:${from.id}`;
  if (cmd === 'cancel') { invoiceFlow.cancel(chat.id, from.id); pendingText.delete(key); await tg.sendMessage(chat.id, 'تم الإلغاء ✅'); return; }
  if (cmd === 'start' || cmd === 'menu' || cmd === 'help') { await sendMain(chat.id, role); return; }
  if (cmd === 'out' || cmd === 'low' || cmd === 'stock') { const k = cmd === 'stock' ? 'both' : cmd; await sendReport(chat.id, `sr:${k}:${chat.id}`, () => reports.buildStockPdf(k), stockCaption); return; }
  if (cmd === 'receivables') { await sendReport(chat.id, `rc:${chat.id}`, () => reports.buildReceivablesPdf('bal'), (r) => receivablesCaption(r)); return; }
  if (cmd && can(role, 'admin')) {
    if (cmd === 'invoice') { await invoiceFlow.begin(chat, from); return; }
    if (cmd === 'today') { await tg.sendMessage(chat.id, await reports.todaySummary()); return; }
    if (cmd === 'product') { await askProduct(chat, from, cmdMatch[3]); return; }
  }
  if (cmd) return; // أمر غير معروف: تجاهل

  // نص عادي: لو الأدمن في وسط تدفّق (فاتورة / استعلام منتج)
  if (can(role, 'admin')) {
    if (await invoiceFlow.onText(chat, from, text)) return;
    const p = pendingText.get(key);
    if (p && Date.now() - p.at < 10 * 60 * 1000) { pendingText.delete(key); await showProducts(chat.id, text); return; }
  }
  if (chat.type === 'private') await sendMain(chat.id, role);
}
const receivablesCaption = (r) => `👥 <b>${r.dueCount} عميل عليهم رصيد</b> بإجمالي <b>${reports.num(r.totalDue)}</b> ج.م\n🕒 ${r.now.stamp}`;

async function askProduct(chat, from, inline) {
  if (inline && inline.trim()) return showProducts(chat.id, inline.trim());
  pendingText.set(`${chat.id}:${from.id}`, { type: 'pq', at: Date.now() });
  await tg.sendMessage(chat.id, '🔎 اكتب <b>اسم المنتج</b> أو كوده (SKU) أو الباركود:', { reply_markup: { force_reply: true, selective: true, input_field_placeholder: 'اسم/كود المنتج' } });
}
async function showProducts(chatId, q) {
  const rows = await reports.searchProducts(q, 5);
  if (!rows.length) { await tg.sendMessage(chatId, 'مفيش منتج بالاسم/الكود ده 🤔'); return; }
  const cards = []; for (const r of rows) cards.push(await reports.productCard(r.id));
  await tg.sendMessage(chatId, cards.join('\n\n──────────────\n\n'));
}

// ───────── الضغطات على الأزرار ─────────
async function onCallback(cb) {
  const chat = cb.message && cb.message.chat, from = cb.from, data = cb.data || '';
  const role = roleFor(chat, from);
  if (!role) { await tg.answerCallbackQuery(cb.id, 'غير مصرّح لك باستخدام هذا البوت', true); return; }
  const deny = () => tg.answerCallbackQuery(cb.id, '🔒 الخدمة دي للأدمن فقط', true);

  let m;
  if (data === 'm:main') { await tg.answerCallbackQuery(cb.id); await sendMain(chat.id, role); return; }
  if ((m = /^sr:(out|low|both):(p|x)$/.exec(data))) {
    const [, kind, fmt] = m; if (fmt === 'x' && !can(role, 'admin')) return deny();
    await tg.answerCallbackQuery(cb.id, 'جاري تجهيز التقرير…');
    if (fmt === 'p') await sendReport(chat.id, `sr:${kind}:${chat.id}`, () => reports.buildStockPdf(kind), stockCaption);
    else await sendReport(chat.id, `srx:${kind}:${chat.id}`, () => reports.buildStockXlsx(kind), () => '📊 ملف Excel — يمكن البحث والنسخ منه');
    return;
  }
  if ((m = /^rc:(bal|all)$/.exec(data))) { await tg.answerCallbackQuery(cb.id, 'جاري تجهيز الكشف…'); await sendReport(chat.id, `rc:${m[1]}:${chat.id}`, () => reports.buildReceivablesPdf(m[1]), receivablesCaption); return; }
  // ───── من هنا للأدمن فقط ─────
  if ((m = /^sp:(bal|all)$/.exec(data))) { if (!can(role, 'admin')) return deny(); await tg.answerCallbackQuery(cb.id, 'جاري تجهيز الكشف…'); await sendReport(chat.id, `sp:${m[1]}:${chat.id}`, () => reports.buildPayablesPdf(m[1]), (r) => `🏭 <b>${r.count} مورد</b> — إجمالي المستحق <b>${reports.num(r.totalDue)}</b> ج.م\n🕒 ${r.now.stamp}`); return; }
  if (data === 'pq') { if (!can(role, 'admin')) return deny(); await tg.answerCallbackQuery(cb.id); await askProduct(chat, from); return; }
  if (data === 'td') { if (!can(role, 'admin')) return deny(); await tg.answerCallbackQuery(cb.id); await tg.sendMessage(chat.id, await reports.todaySummary()); return; }
  if (data.startsWith('inv:')) { if (!can(role, 'admin')) return deny(); await tg.answerCallbackQuery(cb.id).catch(() => {}); await invoiceFlow.onCallback(chat, from, data, cb); return; }
  if (data === 'm:alerts') {
    if (!can(role, 'admin')) return deny(); await tg.answerCallbackQuery(cb.id);
    const s = await get('SELECT notify_low_stock FROM settings WHERE id = 1'); const on = !s || !!s.notify_low_stock;
    await tg.sendMessage(chat.id, `🔔 <b>تنبيهات المخزون</b>\nالحالة: <b>${on ? 'مفعّلة ✅' : 'متوقفة ⏸'}</b>\nبتتبعت <u>عند التغيّر فقط</u> (منتج كان سليم وقرب/نفد)، ومجمّعة في رسالة واحدة، من غير تكرار.`, { reply_markup: { inline_keyboard: [[btn(on ? '⏸ إيقاف التنبيهات' : '▶️ تشغيل التنبيهات', 'al:toggle')], [btn('🔄 افحص دلوقتي', 'al:sweep')], [btn('⬅️ القائمة', 'm:main')]] } });
    return;
  }
  if (data === 'al:toggle') { if (!can(role, 'admin')) return deny(); const s = await get('SELECT notify_low_stock FROM settings WHERE id = 1'); const next = (!s || s.notify_low_stock) ? 0 : 1; await run('UPDATE settings SET notify_low_stock = ? WHERE id = 1', [next]); await tg.answerCallbackQuery(cb.id, next ? 'تم تشغيل التنبيهات' : 'تم إيقاف التنبيهات', true); return; }
  if (data === 'al:sweep') { if (!can(role, 'admin')) return deny(); await tg.answerCallbackQuery(cb.id, 'جاري الفحص…'); const r = await engine.sweep(); await tg.sendMessage(chat.id, `🔄 تم الفحص — تنبيهات جديدة: <b>${r.notified || 0}</b>${r.baseline ? ` (تسجيل أول: ${r.baseline} منتج ناقص حاليًا)` : ''}`); return; }
  await tg.answerCallbackQuery(cb.id);
}

// ───────── الحلقة الرئيسية ─────────
async function handle(update) {
  try {
    if (update.callback_query) await onCallback(update.callback_query);
    else if (update.message) await onMessage(update.message);
  } catch (e) { console.error('[Bot] handler error:', e.message); }
}
async function loop() {
  let backoff = 2000;
  while (running) {
    try {
      const updates = await tg.getUpdates(offset, 25);
      backoff = 2000;
      for (const u of updates) { offset = u.update_id + 1; handle(u); }
    } catch (e) {
      if (e.code === 409) { console.warn('[Bot] نسخة تانية من السيرفر بتعمل polling لنفس البوت — الانتظار 30 ثانية'); backoff = 30000; }
      else console.warn('[Bot] polling error:', e.message);
      await new Promise((r) => setTimeout(r, backoff)); backoff = Math.min(backoff * 2, 60000);
    }
  }
}
async function start() {
  if (!cfg.enabled()) { console.log('ℹ️ بوت تيليجرام التفاعلي متوقف (TELEGRAM_BOT_TOKEN غير موجود أو TELEGRAM_BOT_ENABLED=0)'); engine.start(); return; }
  engine.start();
  if (running) return; running = true;
  try {
    const me = await tg.getMe(); botUsername = me.username || '';
    await tg.deleteWebhook();
    await tg.setMyCommands([{ command: 'menu', description: 'القائمة الرئيسية' }, { command: 'out', description: 'المنتجات اللي نفدت (PDF)' }, { command: 'low', description: 'المنتجات اللي قربت تنفد (PDF)' }, { command: 'receivables', description: 'كشف بواقي العملاء (PDF)' }, { command: 'myid', description: 'معرفة رقم حسابك' }]);
    const admins = cfg.adminIds().size;
    console.log(`✓ بوت تيليجرام التفاعلي شغّال (@${botUsername}) — أدمن معتمد: ${admins}${admins ? '' : ' ⚠️ لم يُحدَّد TELEGRAM_ADMIN_IDS: لا يوجد أدمن، الكل أعضاء عاديين'}`);
  } catch (e) { console.warn('[Bot] تعذر بدء البوت:', e.message); running = false; return; }
  loop();
}
function stop() { running = false; }

module.exports = { start, stop, handle, roleFor, mainMenu, _setUsername: (u) => { botUsername = u; } };
