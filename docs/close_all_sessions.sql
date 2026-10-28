-- ═══════════════════════════════════════════════════════════════════════
--  إدارة الجلسات من Supabase → SQL Editor
--  الجدول: public.user_sessions  (جلسة = صف؛ مقفولة لما revoked_at يكون مش NULL)
--  السيرفر بيتحقق من الجدول عند كل طلب (مع كاش 5 ثواني) ← القفل بيسري خلال ثواني،
--  والمستخدم بيتحول لشاشة تسجيل الدخول عند أول طلب/تحديث.
-- ═══════════════════════════════════════════════════════════════════════

-- (1) اقفل كل الجلسات المفتوحة لكل المستخدمين الآن  ← الأهم
UPDATE public.user_sessions
   SET revoked_at = NOW(), revoke_reason = 'admin_sql'
 WHERE revoked_at IS NULL;

-- (2) دالة جاهزة (شغّليها مرة واحدة) بعدها تقفلي الكل بسطر واحد:  SELECT public.close_all_sessions();
CREATE OR REPLACE FUNCTION public.close_all_sessions(p_reason TEXT DEFAULT 'admin_sql')
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE n INTEGER;
BEGIN
  UPDATE public.user_sessions SET revoked_at = NOW(), revoke_reason = p_reason WHERE revoked_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
-- SELECT public.close_all_sessions();

-- (3) اقفل جلسات مستخدم واحد بالـ username
UPDATE public.user_sessions s
   SET revoked_at = NOW(), revoke_reason = 'admin_sql'
  FROM public.users u
 WHERE s.user_id = u.id AND u.username = 'اكتب_اسم_المستخدم_هنا' AND s.revoked_at IS NULL;

-- (4) اقفل كل الجلسات ما عدا جلسات المالك (مثلًا)
UPDATE public.user_sessions s
   SET revoked_at = NOW(), revoke_reason = 'admin_sql'
  FROM public.users u
 WHERE s.user_id = u.id AND u.role <> 'owner' AND s.revoked_at IS NULL;

-- (5) شوف الجلسات النشطة دلوقتي (مين مفتوح، من إمتى، آخر نشاط، من أنهي جهاز)
SELECT u.username, u.role, s.created_at, s.last_activity_at,
       ROUND(EXTRACT(EPOCH FROM (NOW() - s.last_activity_at)) / 60) AS idle_minutes,
       s.ip, LEFT(s.user_agent, 60) AS device
  FROM public.user_sessions s JOIN public.users u ON u.id = s.user_id
 WHERE s.revoked_at IS NULL AND s.expires_at > NOW()
 ORDER BY s.last_activity_at DESC;

-- (6) سجل آخر الجلسات المقفولة وسبب القفل (logout / idle / expired / admin_sql / admin_update / deactivated)
SELECT u.username, s.revoke_reason, s.revoked_at, s.created_at
  FROM public.user_sessions s JOIN public.users u ON u.id = s.user_id
 WHERE s.revoked_at IS NOT NULL
 ORDER BY s.revoked_at DESC LIMIT 50;

-- (7) بديل أعنف: مسح الجلسات نهائيًا (النتيجة نفسها: كل الأجهزة تتطلب تسجيل دخول)
-- DELETE FROM public.user_sessions;
