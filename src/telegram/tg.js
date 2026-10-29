// telegram/tg.js — غلاف رفيع على Telegram Bot API (إعادة محاولة واحدة عند 429)
const cfg = require('./config');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class TelegramError extends Error {
  constructor(data) { super(data.description || 'telegram error'); this.code = data.error_code; this.params = data.parameters || {}; }
}
async function call(method, payload = {}, retried = false) {
  const url = `https://api.telegram.org/bot${cfg.token()}/${method}`;
  const isForm = typeof FormData !== 'undefined' && payload instanceof FormData;
  const res = await fetch(url, isForm ? { method: 'POST', body: payload } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }));
  if (!data.ok) {
    if (data.error_code === 429 && !retried) { await sleep(((data.parameters && data.parameters.retry_after) || 3) * 1000 + 500); return call(method, payload, true); }
    throw new TelegramError(data);
  }
  return data.result;
}
const sendMessage = (chat_id, text, extra = {}) => call('sendMessage', { chat_id, text: String(text).slice(0, 4096), parse_mode: 'HTML', disable_web_page_preview: true, ...extra });
const editMessageText = (chat_id, message_id, text, extra = {}) =>
  call('editMessageText', { chat_id, message_id, text: String(text).slice(0, 4096), parse_mode: 'HTML', disable_web_page_preview: true, ...extra })
    .catch((e) => { if (!/not modified/i.test(e.message)) throw e; });
const answerCallbackQuery = (id, text, show_alert = false) => call('answerCallbackQuery', { callback_query_id: id, text: text ? String(text).slice(0, 200) : undefined, show_alert }).catch(() => {});
const sendChatAction = (chat_id, action = 'upload_document') => call('sendChatAction', { chat_id, action }).catch(() => {});
async function sendDocument(chat_id, buffer, filename, caption, extra = {}) {
  const form = new FormData();
  form.append('chat_id', String(chat_id));
  if (caption) { form.append('caption', String(caption).slice(0, 1024)); form.append('parse_mode', 'HTML'); }
  if (extra.reply_markup) form.append('reply_markup', JSON.stringify(extra.reply_markup));
  form.append('document', new Blob([buffer]), filename);
  return call('sendDocument', form);
}
const getUpdates = (offset, timeout = 25) => call('getUpdates', { offset, timeout, allowed_updates: ['message', 'callback_query'] });
const deleteWebhook = () => call('deleteWebhook', { drop_pending_updates: false });
const getMe = () => call('getMe');
const setMyCommands = (commands) => call('setMyCommands', { commands }).catch(() => {});

module.exports = { call, sendMessage, editMessageText, answerCallbackQuery, sendChatAction, sendDocument, getUpdates, deleteWebhook, getMe, setMyCommands, TelegramError };
