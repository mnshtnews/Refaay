/* ═══════════════════════════════════════════════════════════════════════
   login-video.js — فيديو الترحيب لحساب المالكة "شروق" فقط
   ───────────────────────────────────────────────────────────────────────
   1) المشغّل: بيتعرض فور نجاح (باسورد + OTP) مرة واحدة، والتحكم بالسيرفر:
      استجابة /auth/owner-2fa/verify بترجع login_video فقط لشروق ولو عندها فيديو.
      العلم محفوظ في الذاكرة بس ← ريفريش للصفحة ما بيعيدش الفيديو، وتسجيل خروج
      ثم دخول بيعرضه من جديد.
   2) كارت الإدارة داخل "صفحتي": رفع / معاينة / استبدال / حذف.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.ShroukLoginVideo) return;

  const PRIME_SRC = 'data:video/mp4;base64,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ZGN0PTEgY3FtPTAgZGVhZHpvbmU9MjEsMTEgZmFzdF9wc2tpcD0xIGNocm9tYV9xcF9vZmZzZXQ9LTIgdGhyZWFkcz0xIGxvb2thaGVhZF90aHJlYWRzPTEgc2xpY2VkX3RocmVhZHM9MCBucj0wIGRlY2ltYXRlPTEgaW50ZXJsYWNlZD0wIGJsdXJheV9jb21wYXQ9MCBjb25zdHJhaW5lZF9pbnRyYT0wIGJmcmFtZXM9OCBiX3B5cmFtaWQ9MiBiX2FkYXB0PTIgYl9iaWFzPTAgZGlyZWN0PTMgd2VpZ2h0Yj0xIG9wZW5fZ29wPTAgd2VpZ2h0cD0yIGtleWludD0yNTAga2V5aW50X21pbj0xMCBzY2VuZWN1dD00MCBpbnRyYV9yZWZyZXNoPTAgcmNfbG9va2FoZWFkPTYwIHJjPWNyZiBtYnRyZWU9MSBjcmY9NDAuMCBxY29tcD0wLjYwIHFwbWluPTAgcXBtYXg9NjkgcXBzdGVwPTQgaXBfcmF0aW89MS40MCBhcT0xOjEuMDAAgAAAAA1liIEAB//+yk+BS51n3gIATGF2YzYwLjMxLjEwMgACMEAOAAAACUGaCE2Ib/+rgAAAAAgBnhAnIb/lgQEYIAcBGCAH';
  let primed = null;       // عنصر <video> اتفعّل بلمسة المستخدم (بيحل حظر الصوت التلقائي)
  let overlay = null;      // المشغّل الحالي
  let playedThisLogin = false;

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const mb = n => (Number(n || 0) / 1024 / 1024).toFixed(1);
  const notify = (msg, type) => { try { window.toast ? toast(msg, type) : console.log(msg); } catch (_) {} };

  /* ───────────── CSS ───────────── */
  const css = `
  #sxLoginVideo{position:fixed;inset:0;z-index:100005;background:#000;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .45s ease;overscroll-behavior:contain;touch-action:manipulation;-webkit-tap-highlight-color:transparent}
  #sxLoginVideo.in{opacity:1}
  #sxLoginVideo.out{opacity:0;transition:opacity .6s ease}
  #sxLoginVideo video{width:100%;height:100%;object-fit:contain;background:#000;outline:0}
  #sxLoginVideo .lv-pause{position:absolute;inset-inline-end:18px;bottom:calc(env(safe-area-inset-bottom,0px) + 22px);width:52px;height:52px;border:1px solid rgba(255,255,255,.28);border-radius:50%;background:rgba(20,14,8,.55);color:#fff;font-size:20px;line-height:1;display:grid;place-items:center;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);cursor:pointer;transition:transform .14s ease,background .2s ease}
  #sxLoginVideo .lv-pause:active{transform:scale(.92)}
  #sxLoginVideo .lv-pause:hover{background:rgba(40,28,14,.75)}
  #sxLoginVideo .lv-sound{position:absolute;left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + 34px);transform:translateX(-50%);min-height:48px;padding:0 22px;border:0;border-radius:24px;background:linear-gradient(135deg,#ffd55f,#f4a02d);color:#2b1700;font:800 15px Tajawal,system-ui,sans-serif;box-shadow:0 10px 28px -8px rgba(255,190,70,.7);cursor:pointer;display:none;animation:lvPulse 1.6s ease-in-out infinite}
  #sxLoginVideo .lv-sound.show{display:block}
  @keyframes lvPulse{50%{box-shadow:0 10px 40px -4px rgba(255,190,70,.95)}}
  #sxLoginVideo .lv-bar{position:absolute;left:0;right:0;bottom:0;height:3px;background:rgba(255,255,255,.12)}
  #sxLoginVideo .lv-bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,#f4a02d,#ffd55f);box-shadow:0 0 10px rgba(255,190,70,.8);transition:width .25s linear}
  #sxLoginVideo .lv-load{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;transition:opacity .4s ease}
  #sxLoginVideo .lv-load.hide{opacity:0}
  #sxLoginVideo .lv-sun{width:64px;height:64px;border-radius:50%;background:radial-gradient(circle at 50% 38%,#fff6c9,#ffd55f 45%,#f4a02d 80%,#e0701f);box-shadow:0 0 36px 12px rgba(255,190,70,.5);animation:lvSun 1.6s ease-in-out infinite}
  @keyframes lvSun{0%,100%{transform:scale(.82);opacity:.7}50%{transform:scale(1.08);opacity:1}}
  html.lv-lock,html.lv-lock body{overflow:hidden!important}

  /* كارت الإدارة داخل صفحتي */
  .owner-video-card{margin:0 0 16px;overflow:hidden}
  .lvc-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:12px}
  .lvc-title{display:flex;align-items:center;gap:10px;font-weight:800;font-size:1.02rem}
  .lvc-caption{margin:4px 0 0;font-size:.82rem;color:#8b7b69;line-height:1.7}
  .lvc-badge{flex:none;padding:5px 11px;border-radius:14px;background:#f1e7d7;color:#8a5e2a;font-size:.74rem;font-weight:700}
  .lvc-badge.on{background:#dff3e4;color:#2f7a45}
  .lvc-drop{display:flex;flex-direction:column;align-items:center;gap:6px;padding:26px 16px;border:2px dashed #dccbb0;border-radius:18px;background:linear-gradient(120deg,#fffaf2,#fffdf9);color:#76644e;text-align:center;cursor:pointer;transition:border-color .2s,background .2s,transform .15s}
  .lvc-drop:hover,.lvc-drop.drag{border-color:#ad8644;background:#fff6e6}
  .lvc-drop:active{transform:scale(.99)}
  .lvc-drop b{font-size:1rem;color:#5c4a33}.lvc-drop small{color:#9a8a76}
  .lvc-drop .lvc-ico{font-size:30px;line-height:1}
  .lvc-drop input{display:none}
  .lvc-current{display:grid;grid-template-columns:minmax(0,260px) 1fr;gap:16px;align-items:center}
  .lvc-preview{position:relative;border-radius:16px;overflow:hidden;background:#000;aspect-ratio:16/9;box-shadow:0 8px 22px -10px rgba(60,40,10,.5)}
  .lvc-preview video{width:100%;height:100%;object-fit:contain;display:block}
  .lvc-meta{display:flex;flex-direction:column;gap:6px;min-width:0}
  .lvc-name{font-weight:800;color:#3d3022;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .lvc-sub{font-size:.8rem;color:#8b7b69}
  .lvc-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
  .lvc-btn{min-height:44px;padding:0 16px;border:1px solid #e3d5bd;border-radius:14px;background:#fffaf2;color:#5c4a33;font:700 .86rem Tajawal,system-ui,sans-serif;cursor:pointer;transition:transform .14s,background .2s}
  .lvc-btn:hover{background:#f8eddb}.lvc-btn:active{transform:scale(.96)}
  .lvc-btn.primary{border:0;background:linear-gradient(135deg,#ffd55f,#f4a02d);color:#2b1700}
  .lvc-btn.danger{color:#b4424f;border-color:#efc9ce;background:#fff6f7}
  .lvc-btn:disabled{opacity:.55;pointer-events:none}
  .lvc-progress{margin-top:12px;display:none;gap:10px;align-items:center}
  .lvc-progress.on{display:flex}
  .lvc-track{flex:1;height:8px;border-radius:6px;background:#efe4d1;overflow:hidden}
  .lvc-track i{display:block;height:100%;width:0;border-radius:6px;background:linear-gradient(90deg,#f4a02d,#ffd55f);transition:width .2s ease}
  .lvc-pct{min-width:44px;text-align:center;font:700 .8rem system-ui,sans-serif;color:#8a5e2a;font-variant-numeric:tabular-nums}
  .lvc-note{margin-top:10px;font-size:.78rem;color:#9a8a76;line-height:1.7}
  .lvc-warn{margin-top:10px;padding:9px 12px;border-radius:12px;background:#fff3dc;color:#8a5e2a;font-size:.8rem;line-height:1.7}
  @media(max-width:620px){.lvc-current{grid-template-columns:1fr}.lvc-actions .lvc-btn{flex:1 1 calc(50% - 8px)}}
  @media(prefers-reduced-motion:reduce){#sxLoginVideo,#sxLoginVideo .lv-sun,#sxLoginVideo .lv-sound{animation:none;transition:none}}
  `;
  function injectCss() {
    if (document.getElementById('lvStyle')) return;
    const s = document.createElement('style'); s.id = 'lvStyle'; s.textContent = css; document.head.appendChild(s);
  }

  /* ───────────── المشغّل ───────────── */
  // يُنادى لحظة ضغط "تحقق وتابع" (داخل لمسة المستخدم) لفتح تصريح الصوت على نفس عنصر الفيديو
  function prime() {
    try {
      if (primed) return;
      const v = document.createElement('video');
      v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', ''); v.preload = 'auto';
      v.muted = false; v.src = PRIME_SRC;
      const p = v.play(); if (p && p.catch) p.catch(() => {});
      primed = v;
    } catch (_) {}
  }

  function closeOverlay(immediate) {
    const el = overlay; if (!el) return;
    overlay = null;
    const done = () => {
      try { const v = el.querySelector('video'); if (v) { v.pause(); v.removeAttribute('src'); v.load(); } } catch (_) {}
      el.remove(); document.documentElement.classList.remove('lv-lock');
      document.removeEventListener('keydown', el.__key);
    };
    if (immediate) return done();
    el.classList.add('out'); setTimeout(done, 650);
  }

  function showPlayer(info, opts) {
    opts = opts || {};
    if (!info || !info.url || overlay) return false;
    injectCss();
    const el = document.createElement('div'); el.id = 'sxLoginVideo'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'فيديو الترحيب');
    el.innerHTML = '<div class="lv-load"><div class="lv-sun"></div></div>' + '<button type="button" class="lv-pause" aria-label="إيقاف مؤقت">⏸</button><button type="button" class="lv-sound">🔊 اضغطي لتشغيل الصوت</button><div class="lv-bar"><i></i></div>';
    // نستخدم العنصر المجهّز لو موجود (نفس العنصر اللي اتفعّل بلمسة المستخدم)
    const v = (!opts.preview && primed) ? primed : document.createElement('video');
    if (v === primed) primed = null;
    v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', ''); v.setAttribute('disablepictureinpicture', '');
    v.setAttribute('controlsList', 'nodownload noremoteplayback'); v.controls = false; v.preload = 'auto'; v.loop = false;
    v.addEventListener('contextmenu', e => e.preventDefault());
    el.insertBefore(v, el.firstChild);
    document.body.appendChild(el); overlay = el;
    document.documentElement.classList.add('lv-lock');
    requestAnimationFrame(() => el.classList.add('in'));

    const sound = el.querySelector('.lv-sound'), pauseBtn = el.querySelector('.lv-pause'), load = el.querySelector('.lv-load'), bar = el.querySelector('.lv-bar i');
    let started = false, finished = false;
    const finish = (instant) => { if (finished) return; finished = true; clearTimeout(watchdog); closeOverlay(instant); };
    // الفيديو إلزامي: مفيش زر تخطي/إغلاق ولا Escape في أي مكان. بيتقفل بس لما يخلص (أو يفشل).
    el.__key = e => { if (e.key === 'Escape' || e.key === ' ') e.preventDefault(); };
    document.addEventListener('keydown', el.__key);

    v.addEventListener('playing', () => { started = true; load.classList.add('hide'); });
    v.addEventListener('timeupdate', () => { if (v.duration > 0) bar.style.width = (v.currentTime / v.duration * 100) + '%'; });
    v.addEventListener('ended', () => finish());
    // الوحيد المسموح: إيقاف مؤقت / استئناف (زرار واحد). مفيش تخطي ولا تقديم.
    let userPaused = false;
    const syncPause = () => { pauseBtn.textContent = v.paused ? '▶' : '⏸'; pauseBtn.setAttribute('aria-label', v.paused ? 'استئناف' : 'إيقاف مؤقت'); };
    pauseBtn.addEventListener('click', () => {
      if (v.paused) { userPaused = false; if (v.muted && sound.classList.contains('show')) { /* لسه صامت */ } const p = v.play(); if (p && p.catch) p.catch(() => {}); }
      else { userPaused = true; v.pause(); }
    });
    v.addEventListener('play', syncPause); v.addEventListener('pause', syncPause);
    // لو المتصفح وقّفه (تبديل تبويب) نكمّل تلقائياً، إلا لو المستخدمة هي اللي وقّفته
    document.addEventListener('visibilitychange', () => { if (!document.hidden && !finished && v.paused && !userPaused) { const p = v.play(); if (p && p.catch) p.catch(() => {}); } });
    v.addEventListener('error', () => { if (!opts.preview) console.warn('login video failed to play'); finish(true); });
    sound.addEventListener('click', () => { v.muted = false; v.volume = 1; sound.classList.remove('show'); const p = v.play(); if (p && p.catch) p.catch(() => {}); });
    // لمسة على الشاشة = تشغيل الصوت لو كان صامت
    el.addEventListener('click', e => { if (e.target.closest('button')) return; if (v.muted) sound.click(); });
    // حماية: لو الفيديو ما بدأش خلال 12 ثانية ما نعطّلش المستخدم
    const watchdog = setTimeout(() => { if (!started) finish(true); }, 12000);

    v.src = info.url;
    v.muted = false;
    const tryPlay = () => {
      const p = v.play();
      if (p && p.catch) p.catch(() => {
        // المتصفح رفض الصوت التلقائي → نشغّل صامت فوراً ونعرض زر تشغيل الصوت (بدل ما يقف الفيديو)
        v.muted = true;
        const q = v.play(); if (q && q.catch) q.catch(() => finish(true));
        sound.classList.add('show');
      });
    };
    tryPlay();
    return true;
  }

  // يُنادى من شاشة الدخول بعد نجاح الـ OTP: data = استجابة /auth/owner-2fa/verify
  function play(data) {
    const info = data && data.login_video;
    if (!info || playedThisLogin) { primed = null; return false; }
    playedThisLogin = true; // مرة واحدة لكل تسجيل دخول (في الذاكرة فقط، مش localStorage)
    return showPlayer(info, { preview: false });
  }

  /* ───────────── كارت الإدارة في "صفحتي" ───────────── */
  async function mountCard(host) {
    if (!host || host.__lv) return; host.__lv = true;
    let u = null; try { u = state.user; } catch (_) {}
    if (!u || u.role !== 'owner' || String(u.username || '').toLowerCase() !== 'shrouk') { host.remove(); return; }
    injectCss();
    host.innerHTML = '<section class="owner-feature-card owner-video-card"><div class="lvc-head"><div><div class="lvc-title"><span class="owner-card-icon" aria-hidden="true">🎬</span> فيديو الترحيب</div><p class="lvc-caption">فيديو يشتغل تلقائيًا أول ما تسجّلي الدخول (بعد رمز التحقق) ولازم يكتمل قبل ما يفتح النظام، مرة واحدة فقط في كل تسجيل دخول. خاص بحسابك ولا يظهر لأي حساب آخر.</p></div><span class="lvc-badge" id="lvcBadge">لا يوجد فيديو</span></div><div id="lvcBody"><div class="owner-small">جارٍ التحميل…</div></div><div class="lvc-progress" id="lvcProgress"><div class="lvc-track"><i id="lvcFill"></i></div><span class="lvc-pct" id="lvcPct">0%</span><button type="button" class="lvc-btn" id="lvcCancel">إلغاء</button></div><div id="lvcWarn"></div></section>';
    const $ = s => host.querySelector(s);
    let current = null, maxMb = 50, xhr = null;

    async function refresh() {
      try {
        const r = await API.get('/owner-workspace/login-video');
        current = r.video; maxMb = r.max_mb || maxMb;
      } catch (e) { $('#lvcBody').innerHTML = '<div class="owner-small">' + esc(e.message || 'تعذر تحميل الفيديو') + '</div>'; return; }
      render();
    }
    function render() {
      $('#lvcBadge').textContent = current ? 'مفعّل' : 'لا يوجد فيديو';
      $('#lvcBadge').classList.toggle('on', !!current);
      const picker = '<label class="lvc-drop" id="lvcDrop"><span class="lvc-ico">🎞️</span><b>' + (current ? 'استبدال الفيديو' : 'اختاري فيديو من جهازك') + '</b><small>MP4 (H.264) أفضل توافق · MOV أو WEBM · حتى ' + maxMb + ' ميجابايت</small><input type="file" id="lvcFile" accept="video/mp4,video/quicktime,video/webm,.mp4,.m4v,.mov,.webm"></label>';
      if (!current) { $('#lvcBody').innerHTML = picker; }
      else {
        const dt = current.created_at ? new Date(String(current.created_at).replace(' ', 'T') + (/[zZ+]/.test(current.created_at) ? '' : 'Z')) : null;
        $('#lvcBody').innerHTML = '<div class="lvc-current"><div class="lvc-preview"><video id="lvcPrev" playsinline muted controls preload="metadata" controlsList="nodownload" src="' + esc(current.url) + '#t=0.5"></video></div><div class="lvc-meta"><div class="lvc-name">' + esc(current.title || 'فيديو الترحيب') + '</div><div class="lvc-sub">' + mb(current.size) + ' ميجابايت' + (dt && !isNaN(dt) ? ' · رُفع ' + dt.toLocaleDateString('ar-EG-u-nu-latn', { day: 'numeric', month: 'long' }) : '') + '</div><div class="lvc-actions"><button type="button" class="lvc-btn danger" id="lvcDel">حذف</button></div></div></div><div style="margin-top:14px">' + picker + '</div>';
        $('#lvcDel').addEventListener('click', remove);
      }
      const input = $('#lvcFile'), drop = $('#lvcDrop');
      input.addEventListener('change', () => { const f = input.files && input.files[0]; if (f) pick(f); input.value = ''; });
      ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('drag'); }));
      ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('drag'); }));
      drop.addEventListener('drop', e => { const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f) pick(f); });
    }

    function warn(msg) { $('#lvcWarn').innerHTML = msg ? '<div class="lvc-warn">' + esc(msg) + '</div>' : ''; }

    // فحص مبدئي: النوع، الحجم، وهل المتصفح يقدر يشغّله (HEVC مثلاً)
    function probe(file) {
      return new Promise(resolve => {
        const url = URL.createObjectURL(file), v = document.createElement('video');
        const done = (r) => { URL.revokeObjectURL(url); resolve(r); };
        const t = setTimeout(() => done({ ok: true, unknown: true }), 4000);
        v.preload = 'metadata'; v.muted = true;
        v.onloadedmetadata = () => { clearTimeout(t); done({ ok: true, duration: v.duration, w: v.videoWidth, h: v.videoHeight }); };
        v.onerror = () => { clearTimeout(t); done({ ok: false }); };
        v.src = url;
      });
    }
    async function pick(file) {
      warn('');
      if (!/\.(mp4|m4v|mov|webm)$/i.test(file.name)) { notify('الصيغة غير مدعومة. اختاري MP4 أو MOV أو WEBM', 'warning'); return; }
      if (file.size > maxMb * 1024 * 1024) { notify('حجم الفيديو ' + mb(file.size) + ' ميجابايت، والحد الأقصى ' + maxMb + ' ميجابايت. قلّلي الجودة أو اقصّي الفيديو.', 'warning'); return; }
      const info = await probe(file);
      if (!info.ok) {
        warn('المتصفح لم يستطع قراءة هذا الفيديو (غالبًا ترميز HEVC/H.265 من الآيفون). يفضّل تحويله إلى MP4 بترميز H.264 حتى يعمل على كل الأجهزة. سنرفعه على أي حال.');
      } else if (info.duration > 120) {
        warn('مدة الفيديو ' + Math.round(info.duration) + ' ثانية — فيديو الترحيب إلزامي ولا يمكن تخطيه عند الدخول، فالأفضل أن يكون قصيرًا (10–30 ثانية).');
      }
      upload(file);
    }

    function upload(file) {
      const form = new FormData(); form.append('video', file, file.name); form.append('title', file.name.replace(/\.[^.]+$/, ''));
      const bar = $('#lvcProgress'), fill = $('#lvcFill'), pct = $('#lvcPct'), drop = $('#lvcDrop');
      bar.classList.add('on'); fill.style.width = '0'; pct.textContent = '0%'; if (drop) drop.style.pointerEvents = 'none';
      xhr = new XMLHttpRequest();
      xhr.open('POST', (API.base || '/api') + '/owner-workspace/login-video');
      xhr.setRequestHeader('Authorization', 'Bearer ' + state.token);
      xhr.upload.onprogress = e => { if (e.lengthComputable) { const p = Math.round(e.loaded / e.total * 100); fill.style.width = p + '%'; pct.textContent = p >= 100 ? 'جارٍ الحفظ…' : p + '%'; } };
      const end = () => { bar.classList.remove('on'); if (drop) drop.style.pointerEvents = ''; xhr = null; };
      xhr.onload = () => {
        let data = {}; try { data = JSON.parse(xhr.responseText); } catch (_) {}
        end();
        if (xhr_ok(data)) { current = data.video; render(); notify('تم حفظ فيديو الترحيب ✨ هيشتغل في تسجيل الدخول الجاي'); }
        else notify(data.error || 'تعذر رفع الفيديو', 'danger');
      };
      const xhr_ok = d => !!d.video;
      xhr.onerror = () => { end(); notify('انقطع الاتصال أثناء الرفع. جرّبي مرة أخرى', 'danger'); };
      xhr.onabort = () => { end(); notify('تم إلغاء الرفع', 'warning'); };
      xhr.send(form);
    }
    $('#lvcCancel').addEventListener('click', () => { if (xhr) xhr.abort(); });

    async function remove() {
      if (!confirm('حذف فيديو الترحيب؟ لن يظهر عند تسجيل الدخول بعد ذلك.')) return;
      try { await API.req('DELETE', '/owner-workspace/login-video'); current = null; render(); notify('تم حذف الفيديو'); }
      catch (e) { notify(e.message || 'تعذر الحذف', 'danger'); }
    }
    refresh();
  }

  window.ShroukLoginVideo = { prime, play, mountCard };
})();
