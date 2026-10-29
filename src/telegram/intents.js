// telegram/intents.js — فهم الكلام العربي الحر (بدون AI خارجي): كلمات مفتاحية + تطبيع عربي
// بيرجّع "نية" تتحوّل لنفس أزرار القوائم، فالصلاحيات بتتطبّق بنفس القواعد بالظبط.
const norm = (s) => String(s || '').toLowerCase()
  .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
  .replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[\u064B-\u0652\u0640]/g, '')
  .replace(/[؟?!.,،:؛]/g, ' ').replace(/\s+/g, ' ').trim();

const has = (t, re) => re.test(t);
function parseIntent(raw) {
  const t = norm(raw);
  if (!t) return { type: 'menu' };
  // (?<![تي]) عشان «هتخلص/هينفد» (مستقبل = قرب ينفد) ما تتحسبش «نفد»
  const wantsOut = has(t, /((?<![تي])نفد|(?<![تي])نفذ|(?<![تي])خلص|خالص|صفر|منتهي|انتهي)/);
  const wantsLow = has(t, /(قرب|قارب|قاربت|هينفد|هتنفد|هيخلص|هتخلص|تخلص|وشك|ناقص|نواقص|نقص|محتاج.*(تجديد|طلب))/);
  const stockish = has(t, /(منتج|اصناف|صنف|مخزون|بضاع|نفد|نفذ|خلص|قرب|قارب|نواقص|ناقص|تقرير)/);

  if (has(t, /(فاتوره|فاتورة)/) && has(t, /(جديد|اعمل|انشئ|سجل|اعملي|عايز|ابدا|عمل)/)) return { type: 'invoice' };
  if (has(t, /(مورد|موردين|موردي)/)) return { type: 'suppliers', all: has(t, /(كل|جميع)/) && !has(t, /(مستحق|عليه|رصيد|باقي|بواقي)/) };
  if (has(t, /(عميل|عملاء|زبون|زبائن|مديونيه|مديونيات|بواقي|باقي|متاخرات|ارصده)/) && !has(t, /(كشف حساب)/)) return { type: 'receivables', all: has(t, /(كل|جميع)/) && !has(t, /(عليهم|عليه|رصيد|مديون|بواقي)/) };
  if (has(t, /(ملخص|تقرير اليوم|النهارده|انهارده|حركه اليوم|مبيعات اليوم)/)) return { type: 'today' };
  const prodQ = /(?:منتج|صنف|كود|باركود|سعر|رصيد|مخزون|كام|كم|فيه)\s+(?:ال)?(.{2,})$/.exec(t);
  if (prodQ && !(wantsOut || wantsLow) && !has(t, /^(المنتجات|منتجات)(?=\s|$)/)) {
    const q = prodQ[1].replace(/^((كام|كم|من|عن|عندنا|عندي|فاضل|بتاع|بتاعه|ال)\s+)+/, '').trim();
    if (q && !/^(الي|اللي)(?=\s|$)/.test(q)) return { type: 'product', query: q };
  }
  if (has(t, /(اعدادات|اشعارات|تنبيهات)/)) return { type: 'alerts' };
  if (stockish && (wantsOut || wantsLow)) {
    if (wantsOut && wantsLow) return { type: 'stock', kind: 'both' };
    if (has(t, /(اتنين|الاثنين|كلهم|كله|الكل|نواقص|ناقص)/)) return { type: 'stock', kind: 'both' };
    return { type: 'stock', kind: wantsOut ? 'out' : 'low' };
  }
  if (has(t, /(نواقص|ناقص|تقرير المخزون|تقرير المنتجات)/)) return { type: 'stock', kind: 'both' };
  if (has(t, /(قايمه|menu|ابدا|ابدأ|مساعده|help|اوامر|اختيارات|ايه اللي تقدر|تقدر تعمل)/)) return { type: 'menu' };
  return { type: 'unknown' };
}
// يشيل اسم البوت/«يا بوت» من أول الكلام
function stripAddress(text, botUsername) {
  let t = String(text || '');
  if (botUsername) t = t.replace(new RegExp('@' + botUsername.replace(/[^\w]/g, '') + '\\b', 'ig'), ' ');
  t = t.replace(/^\s*(يا\s*)?بوت(?=[\s,،:]|$)[\s,،:]*/i, ' ');
  return t.replace(/\s+/g, ' ').trim();
}
module.exports = { parseIntent, stripAddress, norm };
