// utils/sessions.js — جلسات المستخدمين على السيرفر (إنهاء بعد الخمول + إغلاق فوري من SQL)
//
// الفكرة: الـ JWT لوحده مش كفاية (stateless: مفيش طريقة نقفله قبل انتهائه). فكل تسجيل دخول
// بينشئ صف في جدول user_sessions، والـ JWT بيحمل sid بتاعه. كل طلب API بيتحقق إن:
//   1) الجلسة موجودة ومش مقفولة (revoked_at IS NULL)
//   2) آخر نشاط خلال SESSION_IDLE_MINUTES (الافتراضي 60 دقيقة)  ← "ساعة خمول = الجلسة تتقفل"
//   3) ما تعدّتش العمر الأقصى SESSION_MAX_HOURS (الافتراضي 12 ساعة، زي مدة الـ JWT)
//   4) حساب المستخدم لسه نشط
// الفحص بيتم على السيرفر (مش على الجهاز) فمفيش تلاعب ممكن من المتصفح.
const crypto = require('crypto');
const { get, run } = require('../db/database');

const clamp = (n, min, max, dflt) => (Number.isFinite(n) && n >= min ? Math.min(n, max) : dflt);
const IDLE_MINUTES = Math.round(clamp(Number(process.env.SESSION_IDLE_MINUTES), 1, 24 * 60, 60));
const MAX_HOURS = Math.round(clamp(Number(process.env.SESSION_MAX_HOURS), 1, 24 * 30, 12));
const TOUCH_AFTER_SECONDS = 30;   // مانكتبش في الداتابيز لكل طلب: تحديث النشاط كل 30 ثانية بحد أقصى
const CACHE_MS = 5000;            // نتيجة التحقق تتخزن 5 ثواني (الصفحة بتبعت ~10 طلبات متوازية)
const cache = new Map();          // sid -> { until, userId }

function clientIp(req) {
  const xf = String((req && req.headers && req.headers['x-forwarded-for']) || '').split(',')[0].trim();
  return (xf || (req && req.ip) || '').slice(0, 64);
}

async function createSession(user, req) {
  const id = crypto.randomUUID();
  await run(
    `INSERT INTO user_sessions (id, user_id, expires_at, ip, user_agent)
     VALUES (?, ?, NOW() + make_interval(hours => CAST(? AS INTEGER)), ?, ?)`,
    [id, user.id, MAX_HOURS, clientIp(req), String((req && req.headers && req.headers['user-agent']) || '').slice(0, 300)]
  );
  return id;
}

// يرجّع { ok:true } أو { ok:false, reason: 'missing'|'revoked'|'idle'|'expired'|'inactive' }
async function validateSession(sid, userId, { touch = true } = {}) {
  if (!sid) return { ok: false, reason: 'missing' };
  const now = Date.now();
  const hit = cache.get(sid);
  if (hit && hit.until > now && hit.userId === userId) return { ok: true };

  const row = await get(
    `SELECT s.user_id,
            (s.revoked_at IS NOT NULL) AS revoked,
            EXTRACT(EPOCH FROM (NOW() - s.last_activity_at)) AS idle_s,
            EXTRACT(EPOCH FROM (s.expires_at - NOW())) AS ttl_s,
            u.is_active
       FROM user_sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = ?`, [sid]);
  const fail = (reason) => { cache.delete(sid); return { ok: false, reason }; };
  if (!row || Number(row.user_id) !== Number(userId)) return fail('missing');
  if (row.revoked) return fail('revoked');
  if (!row.is_active) { await revokeSession(sid, 'user_inactive'); return fail('inactive'); }
  if (Number(row.ttl_s) <= 0) { await revokeSession(sid, 'expired'); return fail('expired'); }
  if (Number(row.idle_s) > IDLE_MINUTES * 60) { await revokeSession(sid, 'idle'); return fail('idle'); }

  if (touch && Number(row.idle_s) > TOUCH_AFTER_SECONDS) {
    await run('UPDATE user_sessions SET last_activity_at = NOW() WHERE id = ? AND revoked_at IS NULL', [sid]);
  }
  cache.set(sid, { until: now + CACHE_MS, userId });
  return { ok: true };
}

async function revokeSession(sid, reason = 'logout') {
  cache.delete(sid);
  await run('UPDATE user_sessions SET revoked_at = NOW(), revoke_reason = ? WHERE id = ? AND revoked_at IS NULL', [reason, sid]);
}
async function revokeUserSessions(userId, reason = 'admin', exceptSid = null) {
  cache.clear();
  if (exceptSid) await run('UPDATE user_sessions SET revoked_at = NOW(), revoke_reason = ? WHERE user_id = ? AND id <> ? AND revoked_at IS NULL', [reason, userId, exceptSid]);
  else await run('UPDATE user_sessions SET revoked_at = NOW(), revoke_reason = ? WHERE user_id = ? AND revoked_at IS NULL', [reason, userId]);
}

// صيانة دورية: نقفل الخاملة (عشان تظهر صح في SQL) ونمسح القديمة (> 30 يوم) عشان الجدول ما يكبرش
async function maintain() {
  try {
    await run(`UPDATE user_sessions SET revoked_at = NOW(), revoke_reason = 'idle'
                WHERE revoked_at IS NULL AND last_activity_at < NOW() - make_interval(mins => CAST(? AS INTEGER))`, [IDLE_MINUTES]);
    await run(`UPDATE user_sessions SET revoked_at = NOW(), revoke_reason = 'expired'
                WHERE revoked_at IS NULL AND expires_at < NOW()`);
    await run(`DELETE FROM user_sessions WHERE COALESCE(revoked_at, expires_at) < NOW() - INTERVAL '30 days'`);
  } catch (e) { console.warn('session maintenance failed:', e.message); }
}
function startMaintenance() {
  maintain();
  setInterval(maintain, 30 * 60 * 1000).unref();
}

module.exports = { IDLE_MINUTES, MAX_HOURS, createSession, validateSession, revokeSession, revokeUserSessions, startMaintenance, _cache: cache };
