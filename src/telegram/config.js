// telegram/config.js — إعدادات البوت (كلها من متغيرات البيئة، وبتتقرأ وقت الاستخدام)
const parseIds = (s) => new Set(String(s || '').split(/[,\s;]+/).map((x) => x.trim()).filter((x) => /^-?\d+$/.test(x)).map(Number));
module.exports = {
  token: () => process.env.TELEGRAM_BOT_TOKEN || '',
  // الجروب الوحيد المسموح له يستخدم البوت (نفس TELEGRAM_CHAT_ID المستخدم في الإشعارات)
  groupChatId: () => Number(process.env.TELEGRAM_CHAT_ID) || 0,
  // الأدمن = معرّفات تيليجرام (أرقام) اللي انت بتحددها فقط. أي حد تاني = عضو عادي في الجروب.
  adminIds: () => parseIds(process.env.TELEGRAM_ADMIN_IDS),
  // حساب النظام اللي بتتسجل باسمه الفواتير اللي بتتعمل من البوت (username). لو فاضي: أول مالك/أدمن نشط.
  actAsUsername: () => String(process.env.TELEGRAM_ACT_AS_USERNAME || '').trim(),
  enabled: () => process.env.TELEGRAM_BOT_ENABLED !== '0' && !!process.env.TELEGRAM_BOT_TOKEN,
  alertIntervalSec: () => Math.max(60, Number(process.env.STOCK_ALERT_INTERVAL_SEC) || 180),
  parseIds,
};
