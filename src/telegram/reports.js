// telegram/reports.js — بيانات + بناء تقارير البوت (PDF / Excel / نصوص). كلها قراءة فقط.
const { all, get } = require('../db/database');
const { getAllLowStockProducts } = require('../utils/stockAlerts');
const { getCustomerBalancesBatch } = require('../utils/customerLedger');
const buildReportPdf = (o) => require('./pdf').buildReportPdf(o); // تحميل كسول: canvas ما يتحمّلش إلا عند أول تقرير

const BRAND = 'الرفاعي للنجف والإضاءة';
const num = (n, d = 2) => (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const qtyFmt = (n) => { const v = Number(n) || 0; return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.?0+$/, ''); };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function cairoNow() {
  const d = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d)
    .reduce((a, p) => { a[p.type] = p.value; return a; }, {});
  return { date: `${parts.year}-${parts.month}-${parts.day}`, stamp: `${parts.year}-${parts.month}-${parts.day} ${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}` };
}

// ───────── المخزون: نفد / قارب ينفد ─────────
async function getStockRows() {
  const items = await getAllLowStockProducts();
  const rows = items.map((it) => {
    const total = Number(it.total_quantity) || 0;
    const out = total <= 0;
    const withStock = (it.stock_by_location || []).filter((l) => Number(l.quantity) > 0).map((l) => `${l.location_name}: ${qtyFmt(l.quantity)}`);
    let threshold = Number(it.min_stock_threshold) || 0;
    if (it.low_stock_mode === 'per_location' && it.low_locations.length) threshold = Math.min(...it.low_locations.map((l) => Number(l.threshold)));
    return {
      product_id: it.product_id, sku: it.sku || '', name: it.name || '', total, threshold, status: out ? 'out' : 'low',
      locations: withStock.length ? withStock.join(' · ') : 'لا يوجد مخزون في أي مخزن',
      low_locations: (it.low_locations || []).map((l) => l.location_name).join('، '),
    };
  });
  rows.sort((a, b) => (a.status === b.status ? (a.total - b.total) || a.name.localeCompare(b.name, 'ar') : (a.status === 'out' ? -1 : 1)));
  return rows;
}
const STOCK_TITLES = { out: 'تقرير المنتجات التي نفدت', low: 'تقرير المنتجات التي قاربت على النفاد', both: 'تقرير المنتجات التي نفدت وقاربت على النفاد' };

async function buildStockPdf(kind) {
  const all_ = await getStockRows();
  const rows = all_.filter((r) => kind === 'both' || r.status === kind);
  const outN = rows.filter((r) => r.status === 'out').length, lowN = rows.length - outN;
  const now = cairoNow();
  const mk = (r, i) => ({ cells: {
    n: String(i + 1), sku: { text: r.sku || '—', bold: true, ltr: true }, name: r.name,
    qty: { text: qtyFmt(r.total), bold: true, color: r.status === 'out' ? '#A83030' : '#B26A00' }, thr: qtyFmt(r.threshold),
    st: r.status === 'out' ? { text: 'نفد', badge: '#A83030' } : { text: 'قارب', badge: '#B26A00' }, loc: r.locations } });
  const pdfRows = [];
  let n = 0;
  if (kind === 'both' || kind === 'out') { const g = rows.filter((r) => r.status === 'out'); if (kind === 'both' && g.length) pdfRows.push({ section: `نفدت بالكامل (${g.length})`, color: '#A83030' }); g.forEach((r) => pdfRows.push(mk(r, n++))); }
  if (kind === 'both' || kind === 'low') { const g = rows.filter((r) => r.status === 'low'); if (kind === 'both' && g.length) pdfRows.push({ section: `قاربت على النفاد (${g.length})`, color: '#B26A00' }); g.forEach((r) => pdfRows.push(mk(r, n++))); }
  if (!pdfRows.length) return { empty: true, count: 0, outN, lowN, now };
  const summary = [{ label: 'إجمالي المنتجات', value: rows.length }];
  if (kind !== 'low') summary.push({ label: 'نفدت', value: outN, color: '#A83030' });
  if (kind !== 'out') summary.push({ label: 'قاربت على النفاد', value: lowN, color: '#B26A00' });
  const pdf = await buildReportPdf({
    title: STOCK_TITLES[kind], subtitle: 'كل المخازن — حسب حد التنبيه المسجّل لكل منتج', brand: BRAND, generatedAt: now.stamp, summary, footer: `${BRAND} — تقرير مخزون آلي`,
    columns: [
      { key: 'n', label: '#', w: 4, align: 'center' }, { key: 'sku', label: 'الكود (SKU)', w: 19, align: 'center' }, { key: 'name', label: 'المنتج', w: 30 },
      { key: 'qty', label: 'المتبقي', w: 8, align: 'center' }, { key: 'thr', label: 'حد التنبيه', w: 8, align: 'center' }, { key: 'st', label: 'الحالة', w: 8, align: 'center' }, { key: 'loc', label: 'الموجود في المخازن', w: 23 },
    ], rows: pdfRows,
  });
  return { pdf, filename: `stock-${kind}-${now.date}.pdf`, count: rows.length, outN, lowN, now };
}

async function buildStockXlsx(kind) {
  const XLSX = require('xlsx');
  const rows = (await getStockRows()).filter((r) => kind === 'both' || r.status === kind);
  const now = cairoNow();
  if (!rows.length) return { empty: true };
  const data = rows.map((r) => ({ 'الكود (SKU)': r.sku, 'المنتج': r.name, 'الحالة': r.status === 'out' ? 'نفد' : 'قارب على النفاد', 'المتبقي': r.total, 'حد التنبيه': r.threshold, 'الموجود في المخازن': r.locations }));
  const ws = XLSX.utils.json_to_sheet(data); ws['!cols'] = [{ wch: 24 }, { wch: 40 }, { wch: 16 }, { wch: 10 }, { wch: 10 }, { wch: 46 }];
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'المخزون'); if (!wb.Workbook) wb.Workbook = { Views: [{ RTL: true }] };
  return { buffer: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), filename: `stock-${kind}-${now.date}.xlsx`, count: rows.length };
}

// ───────── بواقي العملاء ─────────
async function buildReceivablesPdf(mode /* 'bal' | 'all' */) {
  const customers = await all('SELECT id, code, name, phone, opening_balance FROM customers WHERE is_active = 1 ORDER BY name');
  const balances = await getCustomerBalancesBatch(customers);
  let rows = customers.map((c) => ({ ...c, balance: balances.get(Number(c.id)).balance }));
  const totalDue = rows.filter((r) => r.balance > 0.005).reduce((s, r) => s + r.balance, 0);
  const dueCount = rows.filter((r) => r.balance > 0.005).length;
  if (mode === 'bal') rows = rows.filter((r) => r.balance > 0.005);
  rows.sort((a, b) => b.balance - a.balance);
  const now = cairoNow();
  if (!rows.length) return { empty: true, now };
  const pdf = await buildReportPdf({
    title: mode === 'bal' ? 'كشف بواقي العملاء (عليهم رصيد)' : 'كشف أرصدة كل العملاء', subtitle: 'الرصيد = المستحق على العميل للشركة (الموجب)، والسالب = رصيد دائن للعميل',
    brand: BRAND, generatedAt: now.stamp, orientation: 'portrait', footer: `${BRAND} — كشف آلي`,
    summary: [{ label: 'عدد العملاء المدينين', value: dueCount }, { label: 'إجمالي المستحق (ج.م)', value: num(totalDue), color: '#A83030' }],
    columns: [{ key: 'n', label: '#', w: 5, align: 'center' }, { key: 'code', label: 'الكود', w: 13, align: 'center' }, { key: 'name', label: 'العميل', w: 34 }, { key: 'phone', label: 'الهاتف', w: 20, align: 'center' }, { key: 'bal', label: 'الرصيد (ج.م)', w: 20, align: 'center' }],
    rows: rows.map((r, i) => ({ cells: { n: String(i + 1), code: { text: r.code || '', ltr: true }, name: r.name, phone: { text: r.phone || '—', ltr: true }, bal: { text: num(Math.abs(r.balance)) + (r.balance < -0.005 ? ' (دائن)' : ''), bold: true, color: r.balance > 0.005 ? '#A83030' : (r.balance < -0.005 ? '#2E7D52' : '#6B6B6B') } } })),
  });
  return { pdf, filename: `customers-balances-${now.date}.pdf`, count: rows.length, totalDue, dueCount, now };
}

// ───────── مستحقات الموردين ─────────
async function buildPayablesPdf(mode) {
  let rows = await all(`
    SELECT s.id, s.code, s.name, s.phone,
      COALESCE(s.opening_balance,0) + COALESCE(po.t,0) - COALESCE(pay.t,0) - COALESCE(ret.t,0) + COALESCE(ret.r,0) AS balance
    FROM suppliers s
    LEFT JOIN (SELECT supplier_id, SUM(total) t FROM purchase_orders WHERE status NOT IN ('draft','cancelled') GROUP BY supplier_id) po ON po.supplier_id=s.id
    LEFT JOIN (SELECT supplier_id, SUM(amount) t FROM supplier_payments GROUP BY supplier_id) pay ON pay.supplier_id=s.id
    LEFT JOIN (SELECT supplier_id, SUM(total_amount) t, SUM(total_amount) FILTER (WHERE settlement_type='refund' AND compensation_status='refunded') r FROM supplier_returns WHERE status='approved' GROUP BY supplier_id) ret ON ret.supplier_id=s.id
    WHERE s.is_active = 1 ORDER BY s.name`);
  rows = rows.map((r) => ({ ...r, balance: Math.round((Number(r.balance) || 0) * 100) / 100 }));
  const dueRows = rows.filter((r) => r.balance > 0.005);
  const totalDue = dueRows.reduce((s, r) => s + r.balance, 0);
  if (mode === 'bal') rows = dueRows;
  rows.sort((a, b) => b.balance - a.balance);
  const now = cairoNow();
  if (!rows.length) return { empty: true, now };
  const pdf = await buildReportPdf({
    title: mode === 'bal' ? 'كشف مستحقات الموردين (لهم رصيد عندنا)' : 'كشف أرصدة كل الموردين', subtitle: 'الموجب = مستحق للمورد على الشركة', brand: BRAND, generatedAt: now.stamp, orientation: 'portrait', footer: `${BRAND} — كشف آلي`,
    summary: [{ label: 'عدد الموردين الدائنين', value: dueRows.length }, { label: 'إجمالي المستحق للموردين (ج.م)', value: num(totalDue), color: '#A83030' }],
    columns: [{ key: 'n', label: '#', w: 5, align: 'center' }, { key: 'code', label: 'الكود', w: 13, align: 'center' }, { key: 'name', label: 'المورد', w: 34 }, { key: 'phone', label: 'الهاتف', w: 20, align: 'center' }, { key: 'bal', label: 'المستحق (ج.م)', w: 20, align: 'center' }],
    rows: rows.map((r, i) => ({ cells: { n: String(i + 1), code: { text: r.code || '', ltr: true }, name: r.name, phone: { text: r.phone || '—', ltr: true }, bal: { text: num(Math.abs(r.balance)) + (r.balance < -0.005 ? ' (مدفوع زيادة)' : ''), bold: true, color: r.balance > 0.005 ? '#A83030' : '#6B6B6B' } } })),
  });
  return { pdf, filename: `suppliers-payables-${now.date}.pdf`, count: rows.length, totalDue, now };
}

// ───────── استعلام عن منتج (نص) ─────────
const AR_FROM = 'أإآةى', AR_TO = 'اااهي';
function normAr(s) { return String(s || '').toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[ً-ْـ]/g, '').replace(/\s+/g, ' ').trim(); }
// يبني شرط "كل كلمة موجودة" مع تجاهل الهمزات/التاء المربوطة
function likeAll(columns, query) {
  const tokens = normAr(query).split(' ').filter(Boolean).slice(0, 6);
  const params = []; const conds = tokens.map((t) => {
    const parts = columns.map((c) => { params.push(`%${t}%`); return `translate(LOWER(COALESCE(${c},'')), '${AR_FROM}', '${AR_TO}') LIKE ?`; });
    return `(${parts.join(' OR ')})`;
  });
  return { where: conds.length ? conds.join(' AND ') : '1=0', params };
}
async function searchProducts(query, limit = 8, locationId = null) {
  const { where, params } = likeAll(['p.name', 'p.sku', 'p.barcode'], query);
  return all(`
    SELECT p.id, p.name, p.sku, p.sale_price, p.min_stock_threshold, p.allow_fractional_qty,
           COALESCE((SELECT SUM(i.quantity) FROM inventory i WHERE i.product_id = p.id), 0) AS total_qty,
           ${locationId ? `COALESCE((SELECT i.quantity FROM inventory i WHERE i.product_id = p.id AND i.location_id = ${Number(locationId)}), 0)` : '0'} AS loc_qty
    FROM products p WHERE p.is_active = 1 AND ${where}
    ORDER BY (CASE WHEN LOWER(p.sku) = LOWER(?) THEN 0 ELSE 1 END), p.name LIMIT ${Number(limit)}`, [...params, String(query || '').trim()]);
}
async function productCard(id) {
  const p = await get('SELECT id, name, sku, barcode, sale_price, min_stock_threshold FROM products WHERE id = ?', [id]);
  if (!p) return null;
  const locs = await all(`SELECT l.name, COALESCE(i.quantity,0) AS q FROM locations l LEFT JOIN inventory i ON i.location_id=l.id AND i.product_id=? WHERE l.is_active=1 ORDER BY l.id`, [id]);
  const total = locs.reduce((s, l) => s + Number(l.q), 0);
  const status = total <= 0 ? '🚨 نفد' : total <= (Number(p.min_stock_threshold) || 0) ? '⚠️ قارب على النفاد' : '✅ متوفر';
  return `📦 <b>${esc(p.name)}</b>\n🏷 <code>${esc(p.sku || '—')}</code>${p.barcode ? `  ·  ▮ <code>${esc(p.barcode)}</code>` : ''}\n💰 السعر: <b>${num(p.sale_price)}</b> ج.م\n${status} — الإجمالي: <b>${qtyFmt(total)}</b> (حد التنبيه ${qtyFmt(p.min_stock_threshold)})\n` +
    locs.map((l) => `   • ${esc(l.name)}: <b>${qtyFmt(l.q)}</b>`).join('\n');
}

// ───────── ملخص اليوم ─────────
async function todaySummary() {
  const { date, stamp } = cairoNow();
  const sales = await get(`SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS t FROM invoices WHERE invoice_date = ? AND status IN ('confirmed','partial','paid')`, [date]);
  const coll = await get(`SELECT COUNT(*) AS n, COALESCE(SUM(amount),0) AS t FROM customer_payments WHERE payment_date = ?`, [date]);
  const supp = await get(`SELECT COALESCE(SUM(amount),0) AS t FROM supplier_payments WHERE payment_date = ?`, [date]).catch(() => ({ t: 0 }));
  const stock = await getStockRows();
  const out = stock.filter((r) => r.status === 'out').length;
  return `📊 <b>ملخص اليوم</b> — ${stamp}\n──────────────\n🧾 فواتير مؤكدة: <b>${sales.n}</b> بإجمالي <b>${num(sales.t)}</b> ج.م\n💵 تحصيلات: <b>${coll.n}</b> دفعة بإجمالي <b>${num(coll.t)}</b> ج.م\n🏭 مدفوعات للموردين: <b>${num(supp.t)}</b> ج.م\n──────────────\n🚨 نفد: <b>${out}</b> منتج   ⚠️ قارب: <b>${stock.length - out}</b> منتج`;
}

module.exports = { BRAND, num, qtyFmt, esc, cairoNow, normAr, likeAll, getStockRows, buildStockPdf, buildStockXlsx, buildReceivablesPdf, buildPayablesPdf, searchProducts, productCard, todaySummary };
