/* ═══════════════════════════════════════════════════════════════════════
   session-guard.js — حارس الجلسة في الواجهة (لكل المستخدمين)
   ───────────────────────────────────────────────────────────────────────
   السيرفر هو المرجع (user_sessions + SESSION_IDLE_MINUTES). الملف ده بيعمل:
   1) يتتبع النشاط الفعلي (لمس/ماوس/كيبورد/سكرول) ويخزّن آخر نشاط في localStorage
      (مشترك بين التابات).
   2) لو ساعة (أو القيمة اللي السيرفر حدّدها) من غير أي نشاط → forceLogout فورًا.
   3) heartbeat للسيرفر طالما المستخدم نشط، عشان قراءة/كتابة بدون طلبات API ما تتحسبش خمول.
   4) عند فتح التطبيق بعد غياب: يتأكد من السيرفر (/auth/me) قبل ما يعرض أي بيانات.
   5) تسجيل الخروج في تاب = كل التابات.  6) رسالة واضحة في شاشة الدخول.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.__sessionGuard) return; window.__sessionGuard = true;

  const K_TOKEN = 'arToken', K_LAST = 'arLastActive', K_IDLE = 'arIdleMin';
  const HEARTBEAT_EVERY = 4 * 60 * 1000;   // مرة كل 4 دقايق كحد أقصى (وبس لو فيه نشاط)
  const WRITE_EVERY = 10 * 1000;           // مانكتبش localStorage مع كل حركة ماوس
  const get = k => { try { return localStorage.getItem(k); } catch (_) { return null; } };
  const hasToken = () => !!get(K_TOKEN);
  const idleMs = () => (Number(get(K_IDLE)) || 60) * 60 * 1000;

  let lastWrite = 0, lastHeartbeat = 0, activeSinceBeat = false;
  function markActive() {
    if (!hasToken()) return;
    const now = Date.now(); activeSinceBeat = true;
    if (now - lastWrite < WRITE_EVERY) return;
    lastWrite = now; try { localStorage.setItem(K_LAST, String(now)); } catch (_) {}
  }
  ['pointerdown', 'pointermove', 'keydown', 'touchstart', 'wheel', 'click'].forEach(ev =>
    window.addEventListener(ev, markActive, { passive: true, capture: true }));
  window.addEventListener('scroll', markActive, { passive: true, capture: true });
  if (hasToken() && !get(K_LAST)) { try { localStorage.setItem(K_LAST, String(Date.now())); } catch (_) {} }

  function checkIdle() {
    if (!hasToken()) return;
    const last = Number(get(K_LAST)) || 0;
    if (last && Date.now() - last > idleMs()) window.forceLogout && window.forceLogout('idle');
  }
  setInterval(checkIdle, 15 * 1000);
  // الجهاز صحي من sleep / التاب رجع: افحص فورًا قبل ما أي حاجة تتعرض
  ['visibilitychange', 'focus', 'pageshow', 'online'].forEach(ev => window.addEventListener(ev, () => { if (!document.hidden) checkIdle(); }));

  async function heartbeat() {
    const token = get(K_TOKEN); if (!token || document.hidden) return;
    if (!activeSinceBeat || Date.now() - lastHeartbeat < HEARTBEAT_EVERY) return;
    activeSinceBeat = false; lastHeartbeat = Date.now();
    try {
      const r = await fetch('/api/auth/heartbeat', { method: 'POST', headers: { Authorization: 'Bearer ' + token } });
      if (r.ok) { const d = await r.json().catch(() => ({})); if (d.idle_minutes) localStorage.setItem(K_IDLE, String(d.idle_minutes)); }
    } catch (_) { /* أوفلاين: مش مشكلة */ }
  }
  setInterval(heartbeat, 30 * 1000);

  // تأكيد الجلسة من السيرفر عند فتح التطبيق (وبالذات بعد غياب) — الـ 401 هيتعامل معاه الحارس المبكر
  async function verifyOnOpen() {
    const token = get(K_TOKEN); if (!token) return;
    try {
      const r = await fetch('/api/auth/me', { headers: { Authorization: 'Bearer ' + token } });
      if (r.ok) { const d = await r.json().catch(() => ({})); if (d.idle_minutes) localStorage.setItem(K_IDLE, String(d.idle_minutes)); }
    } catch (_) { /* أوفلاين: نعرض التطبيق (مفيش بيانات حساسة هتتحمل بدون سيرفر) */ }
    document.documentElement.classList.remove('auth-check');
  }
  verifyOnOpen();

  // تسجيل خروج/انتهاء جلسة في تاب تاني → كل التابات
  window.addEventListener('storage', e => { if (e.key === K_TOKEN && !e.newValue) location.reload(); });

  // رسالة شاشة الدخول
  const MSG = {
    idle: 'انتهت الجلسة لعدم النشاط لمدة ساعة. برجاء تسجيل الدخول من جديد حفاظًا على أمان حسابك.',
    revoked: 'تم إنهاء هذه الجلسة. برجاء تسجيل الدخول من جديد.',
    expired: 'انتهت صلاحية الجلسة. برجاء تسجيل الدخول من جديد.',
    inactive: 'الحساب غير متاح. برجاء التواصل مع المسؤول.',
    missing: 'انتهت الجلسة. برجاء تسجيل الدخول من جديد.',
  };
  function showReason() {
    let reason = null; try { reason = sessionStorage.getItem('arLogoutReason'); sessionStorage.removeItem('arLogoutReason'); } catch (_) {}
    if (!reason || hasToken()) return;
    const box = document.getElementById('loginError'); if (!box) return;
    const msg = document.getElementById('loginErrorMsg') || box;
    msg.textContent = MSG[reason] || MSG.expired; box.style.display = 'flex';
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showReason); else showReason();
})();
