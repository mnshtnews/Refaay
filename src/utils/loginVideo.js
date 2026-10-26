// utils/loginVideo.js — فيديو الترحيب الخاص بحساب المالكة "شروق" فقط
// يُعرض مرة واحدة بعد كل تسجيل دخول كامل (باسورد + OTP) ولا يظهر لأي حساب آخر.
const jwt = require('jsonwebtoken');
const { get } = require('../db/database');
const { JWT_SECRET } = require('../middleware/auth');

const VIDEO_BUCKET = 'owner-login-video';
const MAX_VIDEO_MB = Math.max(1, Number(process.env.LOGIN_VIDEO_MAX_MB) || 50); // سقف Supabase المجاني 50MB للملف
const MAX_VIDEO_SIZE = MAX_VIDEO_MB * 1024 * 1024;
const VIDEO_TYPES = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm' };

function isShroukUser(user) {
  return !!user && user.role === 'owner' && String(user.username || '').trim().toLowerCase() === 'shrouk';
}
async function getVideoRow(userId) {
  return get('SELECT user_id,video_path,video_mime,video_size,title,created_at FROM owner_login_video WHERE user_id=?', [userId]);
}
// رابط بث بتوكن قصير العمر: عنصر <video> مش بيقدر يبعت Authorization header، فالتوكن في الـ query.
function signStreamToken(userId) {
  return jwt.sign({ id: userId, purpose: 'login_video' }, JWT_SECRET, { expiresIn: '30m' });
}
function streamUrl(userId) {
  return `/api/owner-workspace/login-video/stream?t=${encodeURIComponent(signStreamToken(userId))}`;
}
function verifyStreamToken(token) {
  try {
    const p = jwt.verify(String(token || ''), JWT_SECRET);
    return p && p.purpose === 'login_video' ? Number(p.id) : null;
  } catch (_) { return null; }
}
// magic bytes: يمنع رفع ملف غريب باسم .mp4
function sniffVideo(buffer) {
  if (!buffer || buffer.length < 12) return false;
  if (buffer.slice(4, 8).toString('latin1') === 'ftyp') return true;               // mp4 / mov / m4v
  return buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3; // webm / mkv (EBML)
}
// الحمولة اللي بترجع مع استجابة OTP الناجحة (أو null). أي خطأ هنا لازم ما يعطّلش تسجيل الدخول.
async function getLoginVideoPayload(user) {
  try {
    if (!isShroukUser(user)) return null;
    const row = await getVideoRow(user.id);
    if (!row) return null;
    return { url: streamUrl(user.id), mime: row.video_mime, size: row.video_size, title: row.title || '' };
  } catch (e) { console.warn('login video lookup failed:', e.message); return null; }
}
module.exports = { VIDEO_BUCKET, MAX_VIDEO_MB, MAX_VIDEO_SIZE, VIDEO_TYPES, isShroukUser, getVideoRow, streamUrl, verifyStreamToken, sniffVideo, getLoginVideoPayload };
