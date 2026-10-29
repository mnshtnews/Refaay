// telegram/pdf.js — تقارير PDF عربية احترافية بتتولّد على السيرفر نفسه (من غير متصفح)
//
// ليه canvas؟  pdfkit مفيهوش Arabic shaping/RTL (الحروف بتطلع مفصولة ومعكوسة)، بينما @napi-rs/canvas
// (Skia + HarfBuzz) بيرسم العربي صح. بنرسم كل صفحة على canvas ونحطها في PDF A4 عن طريق مُجمّع PDF
// صغير هنا (بدون أي مكتبة إضافية). الخط (DejaVu Sans) متضمّن في src/assets/fonts فبيطلع نفس الشكل على أي سيرفر.
const fs = require('fs');
const path = require('path');
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');

const FONT = 'ReportFont';
let fontsReady = false;
function ensureFonts() {
  if (fontsReady) return;
  const dir = path.join(__dirname, '..', 'assets', 'fonts');
  for (const f of ['DejaVuSans.ttf', 'DejaVuSans-Bold.ttf']) {
    const p = path.join(dir, f);
    if (fs.existsSync(p)) GlobalFonts.registerFromPath(p, FONT);
  }
  fontsReady = true;
}

const C = { navy: '#1B2A3D', gold: '#B8860B', ink: '#1A1A1A', gray: '#6B6B6B', line: '#E3DED3', zebra: '#F7F4EC', head: '#1B2A3D', white: '#FFFFFF', red: '#A83030', amber: '#B26A00', green: '#2E7D52' };
const hasArabic = (s) => /[\u0600-\u06FF]/.test(s);
const stripEmoji = (s) => String(s == null ? '' : s).replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '').replace(/\s{2,}/g, ' ').trim();

function wrapText(ctx, text, maxW, maxLines) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(test).width <= maxW) { cur = test; continue; }
    if (cur) lines.push(cur);
    if (ctx.measureText(w).width > maxW) { // كلمة أطول من العمود: قص
      let cut = w; while (cut.length > 1 && ctx.measureText(cut + '…').width > maxW) cut = cut.slice(0, -1);
      lines.push(cut + '…'); cur = '';
    } else cur = w;
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1];
    while (last.length > 1 && ctx.measureText(last + '…').width > maxW) last = last.slice(0, -1);
    kept[maxLines - 1] = last + '…';
    return kept;
  }
  return lines.length ? lines : [''];
}

/**
 * @param {object} o
 *  title, subtitle, orientation ('landscape'|'portrait'), brand
 *  summary: [{label, value, color}]
 *  columns: [{key, label, w (نسبة)، align:'right'|'center'|'left', maxLines}]  (الترتيب = من اليمين لليسار)
 *  rows: [{ cells:{key: string | {text,color,bold,badge}} } | { section:'عنوان', color }]
 *  footer: نص أسفل الصفحة
 */
async function buildReportPdf(o) {
  ensureFonts();
  const S = 1.75; // px لكل point (≈126dpi): وضوح كافي للقراءة وحجم ملف صغير حتى مع آلاف الصفوف
  const land = o.orientation !== 'portrait';
  const PW = (land ? 841.89 : 595.28) * S, PH = (land ? 595.28 : 841.89) * S;
  const M = 24 * S;
  const colsDef = o.columns;
  const innerW = PW - M * 2;
  const totalFrac = colsDef.reduce((s, c) => s + c.w, 0);
  const cols = []; // x من اليمين
  let xr = PW - M;
  for (const c of colsDef) { const w = innerW * c.w / totalFrac; cols.push({ ...c, px: w, x1: xr, x0: xr - w }); xr -= w; }

  const probe = createCanvas(10, 10).getContext('2d');
  const fontPx = 10.5 * S, rowPad = 4 * S, lineH = fontPx * 1.32;
  probe.font = `${fontPx}px ${FONT}`;

  // ── 1) تخطيط: نحسب ارتفاع كل صف ونوزّع على صفحات ──
  const headerFirstH = (o.summary && o.summary.length ? 118 : 84) * S, headerNextH = 46 * S, tableHeadH = 28 * S, footerH = 26 * S;
  const items = o.rows.map((r) => {
    if (r.section) return { section: r.section, color: r.color || C.navy, h: 24 * S };
    let maxL = 1; const lines = {};
    for (const c of cols) {
      const cell = r.cells[c.key]; const text = stripEmoji(cell == null ? '' : (typeof cell === 'object' ? cell.text : cell));
      const maxLines = c.maxLines || 2;
      probe.font = `${(typeof cell === 'object' && cell.bold) ? 'bold ' : ''}${fontPx}px ${FONT}`;
      lines[c.key] = wrapText(probe, text, c.px - 14 * S, maxLines);
      maxL = Math.max(maxL, lines[c.key].length);
    }
    return { cells: r.cells, lines, h: Math.max(21 * S, maxL * lineH + rowPad * 2) };
  });
  const pages = []; let cur = [], used = 0, avail = PH - M - headerFirstH - tableHeadH - footerH;
  for (const it of items) {
    if (used + it.h > avail && cur.length) { pages.push(cur); cur = []; used = 0; avail = PH - M - headerNextH - tableHeadH - footerH; }
    cur.push(it); used += it.h;
  }
  pages.push(cur);

  // ── 2) رسم الصفحات ──
  const jpegs = [];
  pages.forEach((pageItems, pi) => {
    const cv = createCanvas(Math.round(PW), Math.round(PH)); const ctx = cv.getContext('2d');
    ctx.fillStyle = C.white; ctx.fillRect(0, 0, PW, PH);
    ctx.direction = 'rtl'; ctx.textBaseline = 'middle';
    const text = (t, x, y, { size = 11, bold = false, color = C.ink, align = 'right', dir } = {}) => {
      t = stripEmoji(t);
      ctx.font = `${bold ? 'bold ' : ''}${size * S}px ${FONT}`; ctx.fillStyle = color; ctx.textAlign = align;
      ctx.direction = dir || (hasArabic(String(t)) ? 'rtl' : 'ltr'); ctx.fillText(String(t), x, y); ctx.direction = 'rtl';
    };
    // شريط علوي ذهبي
    ctx.fillStyle = C.gold; ctx.fillRect(0, 0, PW, 6 * S);
    let y = 6 * S + M * 0.55;
    if (pi === 0) {
      text(o.brand || 'الرفاعي للنجف والإضاءة', PW - M, y + 12 * S, { size: 11, color: C.gray });
      text(o.title, PW - M, y + 36 * S, { size: 22, bold: true, color: C.navy });
      text(o.subtitle || '', PW - M, y + 58 * S, { size: 10.5, color: C.gray });
      text(o.generatedAt || '', M, y + 12 * S, { size: 10, color: C.gray, align: 'left', dir: 'ltr' });
      y += 70 * S;
      if (o.summary && o.summary.length) { // بطاقات ملخص
        const n = o.summary.length, gap = 10 * S, bw = Math.min(150 * S, (innerW - gap * (n - 1)) / n);
        let bx = PW - M;
        for (const s of o.summary) {
          ctx.fillStyle = C.zebra; roundRect(ctx, bx - bw, y - 6 * S, bw, 42 * S, 8 * S); ctx.fill();
          ctx.fillStyle = s.color || C.navy; ctx.fillRect(bx - 4 * S, y - 6 * S, 4 * S, 42 * S);
          text(s.label, bx - 12 * S, y + 6 * S, { size: 9.5, color: C.gray });
          text(String(s.value), bx - 12 * S, y + 24 * S, { size: 15, bold: true, color: s.color || C.navy });
          bx -= bw + gap;
        }
        y += 52 * S;
      }
    } else {
      text(o.title, PW - M, y + 14 * S, { size: 13, bold: true, color: C.navy });
      text(o.generatedAt || '', M, y + 14 * S, { size: 9.5, color: C.gray, align: 'left', dir: 'ltr' });
      y += 32 * S;
    }
    // رأس الجدول
    ctx.fillStyle = C.head; ctx.fillRect(M, y, innerW, tableHeadH);
    for (const c of cols) text(c.label, alignX(c, c.align || 'right'), y + tableHeadH / 2, { size: 10.5, bold: true, color: C.white, align: c.align || 'right', dir: 'rtl' });
    y += tableHeadH;
    // الصفوف
    let zebra = false;
    for (const it of pageItems) {
      if (it.section) {
        ctx.fillStyle = it.color; ctx.globalAlpha = 0.12; ctx.fillRect(M, y, innerW, it.h); ctx.globalAlpha = 1;
        ctx.fillStyle = it.color; ctx.fillRect(PW - M - 4 * S, y, 4 * S, it.h);
        text(it.section, PW - M - 14 * S, y + it.h / 2, { size: 12, bold: true, color: it.color });
        y += it.h; zebra = false; continue;
      }
      if (zebra) { ctx.fillStyle = C.zebra; ctx.fillRect(M, y, innerW, it.h); }
      zebra = !zebra;
      ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(M, y + it.h); ctx.lineTo(M + innerW, y + it.h); ctx.stroke();
      for (const c of cols) {
        const cell = it.cells[c.key]; const obj = (cell && typeof cell === 'object') ? cell : { text: cell == null ? '' : cell };
        const ls = it.lines[c.key]; const align = c.align || 'right';
        const startY = y + it.h / 2 - ((ls.length - 1) * lineH) / 2;
        if (obj.badge && obj.text) { // حبّة ملوّنة (نفد / قارب)
          ctx.font = `bold ${fontPx}px ${FONT}`; const tw = ctx.measureText(obj.text).width + 14 * S; const bx = alignBox(c, align, tw);
          ctx.fillStyle = obj.badge; roundRect(ctx, bx, y + it.h / 2 - 8.5 * S, tw, 17 * S, 8.5 * S); ctx.fill();
          text(obj.text, bx + tw / 2, y + it.h / 2, { size: 10.5, bold: true, color: C.white, align: 'center' });
        } else ls.forEach((ln, i) => text(ln, alignX(c, align), startY + i * lineH, { size: 10.5, bold: !!obj.bold, color: obj.color || C.ink, align, dir: obj.ltr || !hasArabic(ln) ? 'ltr' : 'rtl' }));
      }
      y += it.h;
    }
    // تذييل
    ctx.fillStyle = C.line; ctx.fillRect(M, PH - M - footerH + 4 * S, innerW, 1);
    text(o.footer || '', PW - M, PH - M - footerH / 2 + 8 * S, { size: 9, color: C.gray });
    text(`${pi + 1} / ${pages.length}`, M, PH - M - footerH / 2 + 8 * S, { size: 9.5, color: C.gray, align: 'left', dir: 'ltr' });
    jpegs.push(cv.toBuffer('image/jpeg', 80));
  });

  return assemblePdf(jpegs, Math.round(PW), Math.round(PH), PW / S, PH / S, o.title);

  function alignX(c, align) { const pad = 7 * S; return align === 'center' ? (c.x0 + c.x1) / 2 : align === 'left' ? c.x0 + pad : c.x1 - pad; }
  function alignBox(c, align, w) { return align === 'center' ? (c.x0 + c.x1) / 2 - w / 2 : align === 'left' ? c.x0 + 7 * S : c.x1 - 7 * S - w; }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// ── مُجمّع PDF: كل صفحة = صورة JPEG بحجم A4 (بدون أي مكتبة) ──
function assemblePdf(jpegs, pxW, pxH, ptW, ptH, title) {
  const parts = []; const offsets = []; let pos = 0;
  const push = (b) => { const buf = Buffer.isBuffer(b) ? b : Buffer.from(b, 'latin1'); parts.push(buf); pos += buf.length; };
  const obj = (n, body) => { offsets[n] = pos; push(`${n} 0 obj\n`); push(body); push('\nendobj\n'); };
  const hex16 = (s) => 'FEFF' + Array.from(String(s || '')).map((ch) => ch.codePointAt(0).toString(16).padStart(4, '0')).join('').toUpperCase();
  const N = jpegs.length;
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Count ${N} /Kids [${jpegs.map((_, i) => `${3 + i * 3} 0 R`).join(' ')}] >>`);
  jpegs.forEach((jpg, i) => {
    const page = 3 + i * 3, content = page + 1, img = page + 2;
    obj(page, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${ptW.toFixed(2)} ${ptH.toFixed(2)}] /Resources << /XObject << /Im0 ${img} 0 R >> >> /Contents ${content} 0 R >>`);
    const cs = `q ${ptW.toFixed(2)} 0 0 ${ptH.toFixed(2)} 0 0 cm /Im0 Do Q`;
    obj(content, `<< /Length ${cs.length} >>\nstream\n${cs}\nendstream`);
    offsets[img] = pos; push(`${img} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${pxW} /Height ${pxH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`); push(jpg); push('\nendstream\nendobj\n');
  });
  const infoN = 3 + N * 3;
  obj(infoN, `<< /Title <${hex16(title)}> /Producer (Rifai ERP) >>`);
  const xref = pos; const total = infoN + 1;
  push(`xref\n0 ${total}\n0000000000 65535 f \n`);
  for (let i = 1; i < total; i++) push(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${total} /Root 1 0 R /Info ${infoN} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return Buffer.concat(parts);
}

module.exports = { buildReportPdf, assemblePdf };
