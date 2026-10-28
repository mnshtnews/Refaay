# تحسينات الموبايل/iOS — حساب شروق أولاً (role=owner, username=shrouk)
ملفات جديدة: public/shrouk-mobile.css, public/shrouk-mobile.js, src/utils/featureFlags.js
معدّلة: public/index.html, public/sw.js (v10), src/utils/customerLedger.js, src/routes/customers.js
التعميم: FAST_LISTS=all (سيرفر) + شرط isShroukUser في shrouk-mobile.js والسكريبت المبكر في index.html.
الرجوع: شيل وسوم shrouk-mobile.* والسكريبت المبكر من index.html.

## فيديو الترحيب (شروق فقط)
جديد: src/utils/loginVideo.js, public/login-video.js ، جدول owner_login_video (يتنشأ تلقائيًا)
معدّل: ownerWorkspace.js (GET/POST/DELETE /login-video + /stream)، auth.js (login_video في استجابة OTP)، index.html، owner-space.js، sw.js (v11)
اختياري: LOGIN_VIDEO_MAX_MB (الافتراضي 50). التخزين: Supabase bucket خاص "owner-login-video" (بيتعمل تلقائيًا).

## نظام الجلسات (كل المستخدمين) — إنهاء بعد ساعة خمول + إغلاق فوري من SQL
جديد: src/utils/sessions.js, public/session-guard.js, docs/close_all_sessions.sql, جدول user_sessions (migrateSessionsSchema)
معدّل: middleware/auth.js (authenticate async + sid), routes/auth.js (إنشاء جلسة، /heartbeat، /logout)، routes/users.js (تغيير كلمة مرور/دور/تعطيل = قفل جلساته)، server.js، index.html (حارس مبكر)، sw.js (v14)
متغيرات: SESSION_IDLE_MINUTES (60) / SESSION_MAX_HOURS (12)
أول نشر: كل التوكنات القديمة (بدون sid) بتتقفل = كل المستخدمين يسجلوا دخول مرة واحدة.
