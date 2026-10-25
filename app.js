'use strict';
/* Сканер: интерфейс. Обработка — в core.js (OpenCV.js). */
(function () {
  const $ = id => document.getElementById(id);
  const state = {
    pages: [],          // {id, src:Canvas, corners:[[x,y]x4], filter, rot, result:Canvas, thumb:string}
    current: null,      // страница в редакторе/просмотре
    cropIsNew: false,
    opt: { page: 'auto', quality: 0.8 }
  };
  let cv = null, cvReady = false, nextId = 1;
  const MAX_SRC = 3000;

  /* ---------- утилиты ---------- */
  function show(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id));
  }
  let toastTimer;
  function toast(msg, ms = 2200) {
    const t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), ms);
  }
  function busy(on, text) { $('busy').hidden = !on; if (text) $('busyText').textContent = text; }
  const tick = () => new Promise(r => setTimeout(r, 30));

  /* ---------- загрузка OpenCV ---------- */
  function loadEngine() {
    const chip = $('engineState');
    const s = document.createElement('script');
    s.src = 'lib/opencv.js';
    s.async = true;
    s.onerror = () => { chip.textContent = 'ошибка загрузки'; chip.className = 'chip err'; };
    s.onload = () => {
      const started = Date.now();
      const poll = setInterval(() => {
        const c = window.cv;
        if (c && c.Mat) { clearInterval(poll); cv = c; cvReady = true; chip.textContent = 'готов'; chip.className = 'chip ok'; return; }
        if (c && typeof c.then === 'function' && !poll._hooked) {
          poll._hooked = true;
          c.then(m => { cv = m; });
        }
        if (cv && cv.Mat) { clearInterval(poll); cvReady = true; chip.textContent = 'готов'; chip.className = 'chip ok'; }
        if (Date.now() - started > 90000) { clearInterval(poll); chip.textContent = 'таймаут'; chip.className = 'chip err'; }
      }, 120);
    };
    document.head.appendChild(s);
  }
  async function needEngine() {
    if (cvReady) return true;
    busy(true, 'Загружаю движок…');
    const t0 = Date.now();
    while (!cvReady && Date.now() - t0 < 60000) await new Promise(r => setTimeout(r, 150));
    busy(false);
    if (!cvReady) toast('Движок не загрузился. Проверьте соединение.');
    return cvReady;
  }

  /* ---------- загрузка фото ---------- */
  async function fileToCanvas(file) {
    let bmp;
    try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
    catch (e) {
      bmp = await new Promise((res, rej) => {
        const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = URL.createObjectURL(file);
      });
    }
    const w = bmp.width || bmp.naturalWidth, h = bmp.height || bmp.naturalHeight;
    const k = Math.min(1, MAX_SRC / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.round(w * k); c.height = Math.round(h * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    if (bmp.close) bmp.close();
    return c;
  }
  function getImageData(canvas, maxSide) {
    const k = Math.min(1, maxSide / Math.max(canvas.width, canvas.height));
    const w = Math.round(canvas.width * k), h = Math.round(canvas.height * k);
    const tmp = document.createElement('canvas'); tmp.width = w; tmp.height = h;
    const ctx = tmp.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(canvas, 0, 0, w, h);
    return { img: ctx.getImageData(0, 0, w, h), k };
  }
  function autoDetect(page) {
    const { img, k } = getImageData(page.src, 700);
    const r = window.ScanCore.detectCorners(cv, img);
    page.corners = r.corners.map(p => [p[0] / k, p[1] / k]);
    return r.found;
  }

  async function addFiles(files) {
    if (!files || !files.length) return;
    if (!(await needEngine())) return;
    const list = Array.from(files);
    for (let i = 0; i < list.length; i++) {
      busy(true, `Обработка ${i + 1} из ${list.length}…`); await tick();
      try {
        const page = { id: nextId++, src: await fileToCanvas(list[i]), corners: null, filter: 'auto', rot: 0, result: null, thumb: '' };
        const found = autoDetect(page);
        if (list.length === 1) {
          busy(false);
          state.current = page; state.cropIsNew = true;
          openCrop(); if (!found) toast('Границы не найдены — подвиньте углы вручную');
          return;
        }
        render(page); state.pages.push(page);
      } catch (e) { console.error(e); toast('Не удалось обработать фото'); }
    }
    busy(false); refreshHome();
  }

  /* ---------- рендер страницы ---------- */
  function render(page) {
    const { img, k } = getImageData(page.src, MAX_SRC);
    const corners = page.corners.map(p => [p[0] * k, p[1] * k]);
    const out = window.ScanCore.warp(cv, img, corners, page.filter, 3000);
    let c = document.createElement('canvas'); c.width = out.width; c.height = out.height;
    c.getContext('2d').putImageData(new ImageData(out.data, out.width, out.height), 0, 0);
    if (page.rot) c = rotateCanvas(c, page.rot);
    page.result = c;
    page.thumb = thumbOf(c, 420);
  }
  function rotateCanvas(c, deg) {
    deg = ((deg % 360) + 360) % 360;
    if (!deg) return c;
    const o = document.createElement('canvas');
    const sw = deg === 90 || deg === 270;
    o.width = sw ? c.height : c.width; o.height = sw ? c.width : c.height;
    const x = o.getContext('2d');
    x.translate(o.width / 2, o.height / 2); x.rotate(deg * Math.PI / 180);
    x.drawImage(c, -c.width / 2, -c.height / 2);
    return o;
  }
  function thumbOf(c, max) {
    const k = Math.min(1, max / Math.max(c.width, c.height));
    const t = document.createElement('canvas'); t.width = Math.round(c.width * k); t.height = Math.round(c.height * k);
    t.getContext('2d').drawImage(c, 0, 0, t.width, t.height);
    return t.toDataURL('image/jpeg', 0.75);
  }

  /* ---------- главный экран ---------- */
  function refreshHome() {
    const g = $('pageGrid'); g.innerHTML = '';
    state.pages.forEach((p, i) => {
      const d = document.createElement('div'); d.className = 'card';
      d.innerHTML = `<img alt=""><span class="n">${i + 1}</span>`;
      d.firstChild.src = p.thumb;
      d.onclick = () => { state.current = p; openView(); };
      g.appendChild(d);
    });
    $('pagesEmpty').style.display = state.pages.length ? 'none' : '';
    $('btnPdf').disabled = !state.pages.length;
    show('home');
  }

  /* ---------- экран границ ---------- */
  const crop = { scale: 1, drag: -1, ox: 0, oy: 0 };
  function openCrop() {
    show('crop');
    requestAnimationFrame(() => { layoutCrop(); drawCrop(); });
  }
  function layoutCrop() {
    const st = $('cropStage'), cvs = $('cropCanvas'), p = state.current;
    const maxW = st.clientWidth - 24, maxH = st.clientHeight - 24;
    crop.scale = Math.min(maxW / p.src.width, maxH / p.src.height);
    cvs.width = Math.round(p.src.width * crop.scale);
    cvs.height = Math.round(p.src.height * crop.scale);
    cvs.style.width = cvs.width + 'px'; cvs.style.height = cvs.height + 'px';
  }
  function drawCrop() {
    const cvs = $('cropCanvas'), x = cvs.getContext('2d'), p = state.current, s = crop.scale;
    x.clearRect(0, 0, cvs.width, cvs.height);
    x.drawImage(p.src, 0, 0, cvs.width, cvs.height);
    const pts = p.corners.map(c => [c[0] * s, c[1] * s]);
    // затемнение вне области
    x.save(); x.fillStyle = 'rgba(0,0,0,.45)';
    x.beginPath(); x.rect(0, 0, cvs.width, cvs.height);
    x.moveTo(pts[0][0], pts[0][1]); pts.slice(1).forEach(q => x.lineTo(q[0], q[1])); x.closePath();
    x.fill('evenodd'); x.restore();
    x.lineWidth = 2.5; x.strokeStyle = '#3b9cff';
    x.beginPath(); x.moveTo(pts[0][0], pts[0][1]); pts.slice(1).forEach(q => x.lineTo(q[0], q[1])); x.closePath(); x.stroke();
    pts.forEach((q, i) => {
      x.beginPath(); x.arc(q[0], q[1], i === crop.drag ? 15 : 12, 0, 7);
      x.fillStyle = 'rgba(59,156,255,.35)'; x.fill(); x.lineWidth = 3; x.strokeStyle = '#fff'; x.stroke();
    });
  }
  function cropPoint(e) {
    const r = $('cropCanvas').getBoundingClientRect();
    return [(e.clientX - r.left) / crop.scale, (e.clientY - r.top) / crop.scale];
  }
  function drawLoupe(pt) {
    const L = $('loupe'), x = L.getContext('2d'), p = state.current, half = 40;
    L.hidden = false;
    x.clearRect(0, 0, L.width, L.height);
    x.drawImage(p.src, pt[0] - half, pt[1] - half, half * 2, half * 2, 0, 0, L.width, L.height);
    x.strokeStyle = '#ff3b3b'; x.lineWidth = 1.5;
    x.beginPath(); x.moveTo(55, 40); x.lineTo(55, 70); x.moveTo(40, 55); x.lineTo(70, 55); x.stroke();
  }
  function bindCrop() {
    const c = $('cropCanvas');
    c.addEventListener('pointerdown', e => {
      const p = state.current, pt = cropPoint(e);
      let best = -1, bd = 1e9;
      p.corners.forEach((q, i) => { const d = Math.hypot(q[0] - pt[0], q[1] - pt[1]) * crop.scale; if (d < bd) { bd = d; best = i; } });
      if (bd < 44) {
        crop.drag = best; c.setPointerCapture(e.pointerId);
        // смещение, чтобы палец не закрывал точку
        crop.ox = p.corners[best][0] - pt[0]; crop.oy = p.corners[best][1] - pt[1];
        drawLoupe(p.corners[best]); drawCrop();
      }
    });
    c.addEventListener('pointermove', e => {
      if (crop.drag < 0) return;
      const p = state.current, pt = cropPoint(e);
      p.corners[crop.drag] = [
        Math.min(p.src.width, Math.max(0, pt[0] + crop.ox)),
        Math.min(p.src.height, Math.max(0, pt[1] + crop.oy))
      ];
      drawLoupe(p.corners[crop.drag]); drawCrop();
    });
    const end = () => { crop.drag = -1; $('loupe').hidden = true; drawCrop(); };
    c.addEventListener('pointerup', end); c.addEventListener('pointercancel', end);

    $('cropAuto').onclick = async () => {
      busy(true, 'Ищу границы…'); await tick();
      const ok = autoDetect(state.current); busy(false); drawCrop();
      toast(ok ? 'Границы найдены' : 'Не нашёл — отметьте вручную');
    };
    $('cropFull').onclick = () => {
      const p = state.current; p.corners = window.ScanCore.fullFrame(p.src.width, p.src.height, 0); drawCrop();
    };
    $('cropRotL').onclick = () => rotateSource(-1);
    $('cropRotR').onclick = () => rotateSource(1);
    $('cropCancel').onclick = () => { state.current = null; refreshHome(); };
    $('cropDone').onclick = async () => {
      const p = state.current;
      busy(true, 'Выравниваю…'); await tick();
      try { render(p); } catch (e) { console.error(e); busy(false); toast('Ошибка обработки'); return; }
      if (!state.pages.includes(p)) state.pages.push(p);
      busy(false); openView();
    };
    window.addEventListener('resize', () => {
      if ($('crop').classList.contains('active')) { layoutCrop(); drawCrop(); }
    });
  }
  function rotateSource(dir) {
    const p = state.current, s = p.src, W = s.width, H = s.height;
    const o = document.createElement('canvas'); o.width = H; o.height = W;
    const x = o.getContext('2d');
    x.translate(H / 2, W / 2); x.rotate(dir * Math.PI / 2); x.drawImage(s, -W / 2, -H / 2);
    p.corners = p.corners.map(([px, py]) => dir > 0 ? [H - py, px] : [py, W - px]);
    p.src = o; layoutCrop(); drawCrop();
  }

  /* ---------- просмотр ---------- */
  function openView() {
    const p = state.current, i = state.pages.indexOf(p) + 1;
    $('viewTitle').textContent = `Страница ${i} из ${state.pages.length}`;
    document.querySelectorAll('#filters button').forEach(b => b.classList.toggle('on', b.dataset.f === p.filter));
    show('view'); requestAnimationFrame(drawView);
  }
  function drawView() {
    const p = state.current; if (!p || !p.result) return;
    const c = $('viewCanvas'), st = c.parentElement;
    const k = Math.min((st.clientWidth - 16) / p.result.width, (st.clientHeight - 16) / p.result.height, 1.5);
    c.width = Math.round(p.result.width * k); c.height = Math.round(p.result.height * k);
    c.getContext('2d').drawImage(p.result, 0, 0, c.width, c.height);
  }
  function bindView() {
    $('filters').addEventListener('click', async e => {
      const b = e.target.closest('button'); if (!b) return;
      const p = state.current; p.filter = b.dataset.f;
      document.querySelectorAll('#filters button').forEach(x => x.classList.toggle('on', x === b));
      busy(true, 'Применяю…'); await tick(); render(p); busy(false); drawView();
    });
    const rot = async d => { const p = state.current; p.rot = (p.rot + d + 360) % 360; busy(true); await tick(); render(p); busy(false); drawView(); };
    $('viewRotL').onclick = () => rot(-90); $('viewRotR').onclick = () => rot(90);
    $('viewBack').onclick = () => refreshHome();
    $('viewRecrop').onclick = () => { state.cropIsNew = false; p0().rot = 0; openCrop(); };
    $('viewDelete').onclick = () => {
      if (!confirm('Удалить эту страницу?')) return;
      state.pages = state.pages.filter(x => x !== state.current); state.current = null; refreshHome();
    };
    $('viewOcr').onclick = () => { $('ocrText').value = ''; show('ocr'); };
    window.addEventListener('resize', () => { if ($('view').classList.contains('active')) drawView(); });
  }
  const p0 = () => state.current;

  /* ---------- OCR (Tesseract.js, подгружается при первом использовании) ---------- */
  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s);
    });
  }
  function bindOcr() {
    $('ocrBack').onclick = () => show('view');
    $('ocrCopy').onclick = async () => {
      const t = $('ocrText').value; if (!t) return;
      try { await navigator.clipboard.writeText(t); toast('Скопировано'); }
      catch (e) { $('ocrText').select(); document.execCommand('copy'); toast('Скопировано'); }
    };
    $('ocrRun').onclick = async () => {
      const p = state.current; if (!p || !p.result) return;
      const btn = $('ocrRun'); btn.disabled = true;
      $('ocrText').value = ''; $('ocrText').placeholder = 'Идёт распознавание…'; $('ocrBar').style.width = '3%';
      try {
        if (!window.Tesseract) await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js');
        const worker = await window.Tesseract.createWorker($('ocrLang').value, 1, {
          logger: m => { if (m.status === 'recognizing text') $('ocrBar').style.width = Math.max(5, Math.round(m.progress * 100)) + '%'; }
        });
        // для OCR берём чёткую версию; ограничиваем размер
        const src = p.result, k = Math.min(1, 2400 / Math.max(src.width, src.height));
        const tc = document.createElement('canvas'); tc.width = Math.round(src.width * k); tc.height = Math.round(src.height * k);
        tc.getContext('2d').drawImage(src, 0, 0, tc.width, tc.height);
        const { data } = await worker.recognize(tc);
        $('ocrText').value = data.text.trim() || '(текст не найден)';
        await worker.terminate();
      } catch (e) {
        console.error(e); $('ocrText').placeholder = 'Не удалось распознать. Для первого запуска нужен интернет (загрузка языковых данных).';
        toast('Ошибка распознавания');
      }
      $('ocrBar').style.width = '0'; btn.disabled = false;
    };
  }

  /* ---------- PDF ---------- */
  async function makePdf() {
    if (!state.pages.length) return;
    busy(true, 'Собираю PDF…'); await tick();
    try {
      const { jsPDF } = window.jspdf;
      let doc = null;
      const q = state.opt.quality;
      for (let i = 0; i < state.pages.length; i++) {
        const c = state.pages[i].result;
        const k = Math.min(1, 2400 / Math.max(c.width, c.height));
        const t = document.createElement('canvas'); t.width = Math.round(c.width * k); t.height = Math.round(c.height * k);
        const tx = t.getContext('2d'); tx.fillStyle = '#fff'; tx.fillRect(0, 0, t.width, t.height); tx.drawImage(c, 0, 0, t.width, t.height);
        const jpg = t.toDataURL('image/jpeg', q);
        let pw, ph, x = 0, y = 0, w, h;
        const ar = t.width / t.height;
        if (state.opt.page === 'auto') { pw = 210; ph = 210 / ar; w = pw; h = ph; }
        else {
          const A = state.opt.page === 'a4' ? [210, 297] : [215.9, 279.4];
          const land = ar > 1; pw = land ? A[1] : A[0]; ph = land ? A[0] : A[1];
          const s = Math.min(pw / t.width, ph / t.height); w = t.width * s; h = t.height * s; x = (pw - w) / 2; y = (ph - h) / 2;
        }
        const orient = pw > ph ? 'l' : 'p';
        if (!doc) doc = new jsPDF({ unit: 'mm', format: [pw, ph], orientation: orient, compress: true });
        else doc.addPage([pw, ph], orient);
        doc.addImage(jpg, 'JPEG', x, y, w, h, undefined, 'FAST');
        await tick();
      }
      const d = new Date(), pad = n => String(n).padStart(2, '0');
      const name = `scan_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}.pdf`;
      const blob = doc.output('blob');
      const file = new File([blob], name, { type: 'application/pdf' });
      busy(false);
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: name }); return; }
        catch (e) { if (e && e.name === 'AbortError') return; }
      }
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      toast('PDF сохранён');
    } catch (e) { console.error(e); busy(false); toast('Не удалось создать PDF'); }
  }

  /* ---------- меню и старт ---------- */
  function bindHome() {
    $('btnCamera').onclick = () => { $('fileCamera').value = ''; $('fileCamera').click(); };
    $('btnGallery').onclick = () => { $('fileGallery').value = ''; $('fileGallery').click(); };
    $('fileCamera').onchange = e => addFiles(e.target.files);
    $('fileGallery').onchange = e => addFiles(e.target.files);
    $('btnPdf').onclick = makePdf;
    $('btnMenu').onclick = () => ($('sheet').hidden = false);
    $('btnCloseMenu').onclick = () => ($('sheet').hidden = true);
    $('sheet').addEventListener('click', e => { if (e.target.id === 'sheet') $('sheet').hidden = true; });
    $('optPage').onchange = e => (state.opt.page = e.target.value);
    $('optQuality').onchange = e => (state.opt.quality = parseFloat(e.target.value));
    $('btnClear').onclick = () => {
      if (!state.pages.length || !confirm('Удалить все страницы?')) return;
      state.pages = []; $('sheet').hidden = true; refreshHome();
    };
  }

  document.addEventListener('DOMContentLoaded', () => {
    // core.js подключаем динамически, чтобы порядок загрузки был предсказуем
    const core = document.createElement('script');
    core.src = 'core.js';
    core.onload = () => { loadEngine(); };
    document.head.appendChild(core);
    bindHome(); bindCrop(); bindView(); bindOcr(); refreshHome();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  });
})();
