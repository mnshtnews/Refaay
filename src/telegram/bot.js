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
const { parseIntent, stripAddress } = require('./intents');
const engine = require('./stockAlertEngine');
const { get, run } = require('../db/database');

const ROLE_RANK = { member: 1, admin: 2 };
let running = false, offset = 0, botUsername = '';
const ANON_ADMIN_ID = 1087968824; // GroupAnonymousBot
const ADMIN_ONLY_DATA = /^(sp:|pq$|td$|inv:|m:alerts$|al:|sr:\w+:x$)/;

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
  if (cmd === 'myid' || cmd === 'whoami') {
    const r = roleFor(chat, from);
    const anon = from.id === ANON_ADMIN_ID || !!msg.sender_chat;
    await tg.sendMessage(chat.id, anon
      ? '👤 أنت بتكتب كـ<b>أدمن مجهول</b> (باسم الجروب)، فتيليجرام مابيبعتش رقمك. ادخل إعدادات صلاحياتك كأدمن في الجروب وأوقف «البقاء مجهول» (Remain Anonymous) عشان البوت يتعرف عليك.'
      : `🆔 معرّفك: <code>${from.id}</code>\n🔐 دورك عند البوت: <b>${r === 'admin' ? 'أدمن ✅' : r === 'member' ? 'عضو' : 'غير مصرّح'}</b>${r === 'admin' ? '' : '\n<i>لو انت الأدمن: ضيف الرقم ده في TELEGRAM_ADMIN_IDS على السيرفر وأعد التشغيل.</i>'}`);
    return;
  }
  if (from.id === ANON_ADMIN_ID || msg.sender_chat) { // رسالة باسم الجروب/قناة: هوية غير معروفة → مفيش صلاحيات
    if (isAddressed(msg, text)) await tg.sendMessage(chat.id, '👤 مش قادر أتعرف عليك لأنك بتكتب كـ<b>أدمن مجهول</b>. أوقف «البقاء مجهول» من صلاحياتك في الجروب وجرّب تاني.', { reply_to_message_id: msg.message_id });
    return;
  }

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
  // في الجروب: نص التدفقات (فاتورة/استعلام) بيتقبل فقط لو رد على رسالة البوت أو منشن له — عشان كلام الأدمن العادي مع زمايله ما يتفسّرش غلط
  if (can(role, 'admin') && isAddressed(msg, text)) {
    if (await invoiceFlow.onText(chat, from, stripAddress(text, botUsername))) return;
    const p = pendingText.get(key);
    if (p && Date.now() - p.at < 10 * 60 * 1000) { pendingText.delete(key); await showProducts(chat.id, text); return; }
  }
  // كلام حر موجّه للبوت (في الجروب: لازم منشن @البوت أو رد على رسالته أو يبدأ بـ«بوت»؛ في الخاص: دايمًا)
  if (isAddressed(msg, text)) { await handleNaturalLanguage(chat, from, role, msg, stripAddress(text, botUsername)); return; }
}

function isAddressed(msg, text) {
  if (msg.chat.type === 'private') return true;
  const low = String(text || '').toLowerCase();
  if (botUsername && low.includes('@' + botUsername.toLowerCase())) return true;
  const rt = msg.reply_to_message;
  if (rt && rt.from && rt.from.is_bot && botUsername && String(rt.from.username || '').toLowerCase() === botUsername.toLowerCase()) return true;
  return /^\s*(يا\s*)?بوت(?=[\s,،:]|$)/i.test(text || '');
}
async function handleNaturalLanguage(chat, from, role, msg, text) {
  const reply = { reply_to_message_id: msg.message_id };
  const it = parseIntent(text);
  const deny = () => tg.sendMessage(chat.id, '🔒 الخدمة دي للأدمن فقط. اللي متاح ليك: تقارير المخزون (نفدت/قاربت) وكشف بواقي العملاء.', reply);
  const act = (data) => (ADMIN_ONLY_DATA.test(data) && !can(role, 'admin')) ? deny() : onCallback({ id: 'nl:' + msg.message_id, data, from, message: { chat } });
  switch (it.type) {
    case 'stock': return act(`sr:${it.kind}:p`);
    case 'receivables': return act(it.all ? 'rc:all' : 'rc:bal');
    case 'suppliers': return act(it.all ? 'sp:all' : 'sp:bal');
    case 'today': return act('td');
    case 'alerts': return act('m:alerts');
    case 'invoice': return act('inv:new');
    case 'product': if (!can(role, 'admin')) return deny(); return showProducts(chat.id, it.query);
    case 'menu': return sendMain(chat.id, role);
    default: await tg.sendMessage(chat.id, 'مفهمتش قصدك 🤔 اختار من القائمة 👇 أو قول مثلًا: «المنتجات اللي نفدت» / «بواقي العملاء»' + (can(role, 'admin') ? ' / «سعر EA-6311» (بالكود SKU) / «فاتورة جديدة»' : ''), { ...reply, reply_markup: mainMenu(role) });
  }
}
const receivablesCaption = (r) => `👥 <b>${r.dueCount} عميل عليهم رصيد</b> بإجمالي <b>${reports.num(r.totalDue)}</b> ج.م\n🕒 ${r.now.stamp}`;

async function askProduct(chat, from, inline) {
  if (inline && inline.trim()) return showProducts(chat.id, inline.trim());
  pendingText.set(`${chat.id}:${from.id}`, { type: 'pq', at: Date.now() });
  await tg.sendMessage(chat.id, '🔎 اكتب <b>كود المنتج (SKU)</b> — أو جزء منه:\n<i>البحث بالكود فقط (مش بالاسم ولا الباركود)</i>', { reply_markup: { force_reply: true, selective: true, input_field_placeholder: 'كود المنتج SKU' } });
}
const LOOKUP_LIMIT = 10;
async function showProducts(chatId, q) {
  if (reports.normSku(q).length < reports.SKU_MIN_LEN) { await tg.sendMessage(chatId, `اكتب ${reports.SKU_MIN_LEN} حروف/أرقام على الأقل من كود المنتج (SKU).`); return; }
  const rows = await reports.searchProducts(q, LOOKUP_LIMIT + 1);
  if (!rows.length) { await tg.sendMessage(chatId, `مفيش منتج كوده (SKU) يحتوي على «${reports.esc(String(q).trim())}».\n<i>البحث بالكود فقط — اتأكد من الكود وجرّب تاني.</i>`); return; }
  const more = rows.length > LOOKUP_LIMIT; const shown = rows.slice(0, LOOKUP_LIMIT);
  const cards = []; for (const r of shown) cards.push(await reports.productCard(r.id));
  const head = `🔎 <b>${shown.length}${more ? '+' : ''} منتج</b> كوده يحتوي على «<code>${reports.esc(String(q).trim())}</code>»`;
  // نقسّم على رسائل (حد تيليجرام 4096 حرف) من غير ما نقطع وسم HTML في النص
  const chunks = []; let cur = head;
  for (const c of cards) { const add = `\n\n──────────────\n\n${c}`; if ((cur + add).length > 3600) { chunks.push(cur); cur = c; } else cur += add; }
  chunks.push(cur);
  if (more) chunks[chunks.length - 1] += `\n\n<i>⚠️ فيه نتائج أكتر من ${LOOKUP_LIMIT} — اكتب جزء أطول من الكود عشان تضيّق البحث.</i>`;
  for (const c of chunks) await tg.sendMessage(chatId, c);
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
  let backoff = 2000, netFails = 0;
  while (running) {
    try {
      const updates = await tg.getUpdates(offset, 25);
      if (netFails) { console.log(`[Bot] ✓ الاتصال بتيليجرام رجع بعد ${netFails} محاولة فاشلة`); netFails = 0; }
      backoff = 2000;
      for (const u of updates) { offset = u.update_id + 1; handle(u); }
    } catch (e) {
      if (e.code === 409) { console.warn('[Bot] نسخة تانية من السيرفر بتعمل polling لنفس البوت — الانتظار 30 ثانية'); backoff = 30000; }
      else if (e.name === 'TypeError' && /fetch failed/i.test(e.message)) {
        // فشل شبكة (مش رد من تيليجرام): نطبع السبب الحقيقي (ETIMEDOUT / ENOTFOUND / ECONNRESET…) أول مرة وكل 10 محاولات بدل السبام
        netFails++;
        if (netFails === 1 || netFails % 10 === 0) {
          const c = e.cause || {};
          console.warn(`[Bot] تعذر الوصول لـ api.telegram.org (محاولة ${netFails}) — السبب: ${c.code || c.name || 'unknown'}${c.message ? ' / ' + c.message : ''}. تأكد إن السيرفر يقدر يوصل لتيليجرام (قد يكون محجوبًا/يحتاج VPN أو بروكسي، أو مشكلة DNS/IPv6: جرّب NODE_OPTIONS=--dns-result-order=ipv4first).`);
        }
      } else console.warn('[Bot] polling error:', e.message);
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

module.exports = { start, stop, handle, roleFor, mainMenu, isAddressed, _setUsername: (u) => { botUsername = u; } };
