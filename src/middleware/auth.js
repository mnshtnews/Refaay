// middleware/auth.js
const jwt = require('jsonwebtoken');
const { validateSession, MAX_HOURS } = require('../utils/sessions');

// أمان: ممنوع أي fallback ثابت للمفتاح السري في الكود. لو الـ env var
// مش موجود، السيرفر يرفض يشتغل بدل ما يستخدم مفتاح معروف للعامة
// (لو حصل كده أي حد يقدر يزوّر tokens بأي صلاحية، حتى admin).
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error(
    'JWT_SECRET غير معرّف أو قصير جداً (لازم 32 حرف على الأقل). ' +
    'عرّفه في متغيرات البيئة قبل تشغيل السيرفر. السيرفر لن يعمل بمفتاح افتراضي لأسباب أمنية.'
  );
}

const SESSION_MESSAGES = {
  idle: 'انتهت الجلسة لعدم النشاط لمدة ساعة. برجاء تسجيل الدخول من جديد.',
  revoked: 'تم إنهاء هذه الجلسة. برجاء تسجيل الدخول من جديد.',
  expired: 'انتهت صلاحية الجلسة. برجاء تسجيل الدخول من جديد.',
  inactive: 'الحساب غير متاح. برجاء التواصل مع المسؤول.',
  missing: 'الجلسة منتهية، يرجى تسجيل الدخول مرة أخرى',
};
function sessionExpired(res, reason) {
  // code=SESSION_EXPIRED هو اللي بيخلّي الواجهة تقفل وتفتح شاشة الدخول (أي 401 تاني ما بيعملش logout)
  return res.status(401).json({ error: SESSION_MESSAGES[reason] || SESSION_MESSAGES.missing, code: 'SESSION_EXPIRED', reason });
}

async function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'يجب تسجيل الدخول للوصول لهذه الصفحة', code: 'SESSION_EXPIRED', reason: 'missing' });
  }

  const token = authHeader.split(' ')[1];
  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return sessionExpired(res, 'expired');
  }
  if (decoded.purpose) return res.status(401).json({ error: 'يجب إكمال التحقق بخطوتين أولاً', code: 'MFA_REQUIRED' });

  try {
    // توكنات قديمة بدون sid (قبل نظام الجلسات) تتعامل كمنتهية → إعادة تسجيل دخول مرة واحدة
    // طلبات الخلفية (X-Background: 1) بتتحقق عادي لكنها ما بتجدّدش مهلة الخمول
    const background = req.headers['x-background'] === '1';
    const result = await validateSession(decoded.sid, decoded.id, { touch: !background });
    if (!result.ok) return sessionExpired(res, result.reason);
  } catch (err) {
    // عطل مؤقت في الداتابيز ≠ جلسة منتهية: 503 (الواجهة ما تعملش logout على 503)
    console.error('session validation failed:', err.message);
    return res.status(503).json({ error: 'تعذر التحقق من الجلسة مؤقتًا، حاول مرة أخرى' });
  }
  req.user = decoded;
  req.sid = decoded.sid;
  next();
}

// السماح فقط لأدوار محددة بالوصول للـ endpoint
function authorize(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'يجب تسجيل الدخول' });
    }
    if (req.user.role !== 'owner' && !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'ليس لديك صلاحية للقيام بهذا الإجراء' });
    }
    next();
  };
}

function generateToken(user, sid) {
  if (!sid) throw new Error('generateToken يتطلب sid لجلسة مسجّلة (createSession)');
  return jwt.sign(
    {
      sid,
      id: user.id,
      username: user.username,
      full_name: user.full_name,
      role: user.role,
      can_view_cost_price: !!user.can_view_cost_price,
      avatar_url: user.avatar_url || null,
    },
    JWT_SECRET,
    { expiresIn: `${MAX_HOURS}h` }
  );
}

module.exports = { authenticate, authorize, generateToken, JWT_SECRET };
