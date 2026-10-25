// Ядро обработки: поиск листа, выравнивание перспективы, фильтры.
// Работает поверх OpenCV.js; не зависит от DOM (тестируется в Node).
(function (root) {
  'use strict';

  function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }

  // порядок: левый-верх, правый-верх, правый-низ, левый-низ
  function orderCorners(pts) {
    const sum = pts.map(p => p[0] + p[1]);
    const dif = pts.map(p => p[0] - p[1]);
    const tl = pts[sum.indexOf(Math.min(...sum))];
    const br = pts[sum.indexOf(Math.max(...sum))];
    const tr = pts[dif.indexOf(Math.max(...dif))];
    const bl = pts[dif.indexOf(Math.min(...dif))];
    return [tl, tr, br, bl];
  }

  function fullFrame(w, h, inset) {
    const m = inset || 0;
    return [[m, m], [w - m, m], [w - m, h - m], [m, h - m]];
  }

  function findQuad(cv, bin, imgArea) {
    const contours = new cv.MatVector();
    const hier = new cv.Mat();
    let best = null, bestArea = 0;
    try {
      cv.findContours(bin, contours, hier, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
      for (let i = 0; i < contours.size(); i++) {
        const cnt = contours.get(i);
        const area = cv.contourArea(cnt);
        if (area < imgArea * 0.12 || area > imgArea * 0.985 || area <= bestArea) { cnt.delete(); continue; }
        const hull = new cv.Mat();
        cv.convexHull(cnt, hull, false, true);
        const peri = cv.arcLength(hull, true);
        let quad = null;
        for (const eps of [0.02, 0.03, 0.045, 0.06]) {
          const approx = new cv.Mat();
          cv.approxPolyDP(hull, approx, eps * peri, true);
          if (approx.rows === 4) {
            quad = [];
            for (let k = 0; k < 4; k++) quad.push([approx.data32S[k * 2], approx.data32S[k * 2 + 1]]);
            approx.delete();
            break;
          }
          approx.delete();
        }
        hull.delete(); cnt.delete();
        if (quad) { best = quad; bestArea = area; }
      }
    } finally {
      contours.delete(); hier.delete();
    }
    return best;
  }

  // img: {width,height,data(RGBA)} -> {found, corners}
  function detectCorners(cv, img) {
    const w = img.width, h = img.height, imgArea = w * h;
    const src = cv.matFromImageData(img);
    const gray = new cv.Mat(), blur = new cv.Mat(), bin = new cv.Mat();
    const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5));
    let quad = null;
    try {
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
      cv.GaussianBlur(gray, blur, new cv.Size(7, 7), 0);

      const attempts = [
        () => { cv.Canny(blur, bin, 40, 130); cv.dilate(bin, bin, kernel, new cv.Point(-1, -1), 2); cv.morphologyEx(bin, bin, cv.MORPH_CLOSE, kernel); },
        () => { cv.threshold(blur, bin, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU); cv.morphologyEx(bin, bin, cv.MORPH_CLOSE, kernel); },
        () => { cv.threshold(blur, bin, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU); cv.morphologyEx(bin, bin, cv.MORPH_CLOSE, kernel); }
      ];
      for (const run of attempts) {
        run();
        quad = findQuad(cv, bin, imgArea);
        if (quad) break;
      }
    } finally {
      src.delete(); gray.delete(); blur.delete(); bin.delete(); kernel.delete();
    }
    if (!quad) return { found: false, corners: fullFrame(w, h, Math.round(Math.min(w, h) * 0.04)) };
    return { found: true, corners: orderCorners(quad) };
  }

  // Убирает тени и выравнивает фон бумаги: возвращает RGB Mat
  function whiten(cv, rgba) {
    const rgb = new cv.Mat();
    cv.cvtColor(rgba, rgb, cv.COLOR_RGBA2RGB);
    const f = Math.max(1, Math.max(rgb.cols, rgb.rows) / 500);
    const small = new cv.Mat();
    cv.resize(rgb, small, new cv.Size(Math.round(rgb.cols / f), Math.round(rgb.rows / f)), 0, 0, cv.INTER_AREA);
    const k = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(11, 11));
    cv.dilate(small, small, k);
    cv.medianBlur(small, small, 21);
    cv.GaussianBlur(small, small, new cv.Size(15, 15), 0);
    const bg = new cv.Mat();
    cv.resize(small, bg, new cv.Size(rgb.cols, rgb.rows), 0, 0, cv.INTER_LINEAR);
    const flat = new cv.Mat();
    cv.divide(rgb, bg, flat, 255, -1);
    // чёрная точка 25 -> 0, белая 235 -> 255
    const alpha = 255 / (235 - 25);
    const out = new cv.Mat();
    flat.convertTo(out, -1, alpha, -25 * alpha);
    k.delete(); small.delete(); bg.delete(); flat.delete(); rgb.delete();
    return out;
  }

  function matToImage(cv, mat, kind) {
    const rgba = new cv.Mat();
    if (kind === 'gray') cv.cvtColor(mat, rgba, cv.COLOR_GRAY2RGBA);
    else if (kind === 'rgb') cv.cvtColor(mat, rgba, cv.COLOR_RGB2RGBA);
    else mat.copyTo(rgba);
    const res = { width: rgba.cols, height: rgba.rows, data: new Uint8ClampedArray(rgba.data) };
    rgba.delete();
    return res;
  }

  function applyFilter(cv, rgba, filter) {
    if (filter === 'original') return matToImage(cv, rgba, 'rgba');
    const flat = whiten(cv, rgba);
    try {
      if (filter === 'auto') return matToImage(cv, flat, 'rgb');
      if (filter === 'color') {
        const hsv = new cv.Mat(), ch = new cv.MatVector(), merged = new cv.Mat(), back = new cv.Mat();
        cv.cvtColor(flat, hsv, cv.COLOR_RGB2HSV);
        cv.split(hsv, ch);
        const s = ch.get(1);
        s.convertTo(s, -1, 1.35, 0);
        cv.merge(ch, merged);
        cv.cvtColor(merged, back, cv.COLOR_HSV2RGB);
        const r = matToImage(cv, back, 'rgb');
        s.delete(); hsv.delete(); ch.delete(); merged.delete(); back.delete();
        return r;
      }
      const gray = new cv.Mat();
      cv.cvtColor(flat, gray, cv.COLOR_RGB2GRAY);
      try {
        if (filter === 'gray') return matToImage(cv, gray, 'gray');
        // bw
        const bw = new cv.Mat();
        cv.threshold(gray, bw, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
        const r = matToImage(cv, bw, 'gray');
        bw.delete();
        return r;
      } finally { gray.delete(); }
    } finally { flat.delete(); }
  }

  // img: исходное изображение, corners: 4 точки в его координатах
  function warp(cv, img, corners, filter, maxSide) {
    const [tl, tr, br, bl] = corners;
    let W = Math.round(Math.max(dist(tl, tr), dist(bl, br)));
    let H = Math.round(Math.max(dist(tl, bl), dist(tr, br)));
    W = Math.max(W, 50); H = Math.max(H, 50);
    const lim = maxSide || 3000;
    const k = Math.min(1, lim / Math.max(W, H));
    W = Math.round(W * k); H = Math.round(H * k);

    const src = cv.matFromImageData(img);
    const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [tl[0], tl[1], tr[0], tr[1], br[0], br[1], bl[0], bl[1]]);
    const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, W, 0, W, H, 0, H]);
    const M = cv.getPerspectiveTransform(srcTri, dstTri);
    const dst = new cv.Mat();
    try {
      cv.warpPerspective(src, dst, M, new cv.Size(W, H), cv.INTER_CUBIC, cv.BORDER_REPLICATE, new cv.Scalar());
      // срезаем тонкую кромку на стыке с фоном
      const m = Math.round(Math.min(W, H) * 0.006);
      const roi = dst.roi(new cv.Rect(m, m, W - 2 * m, H - 2 * m));
      try { return applyFilter(cv, roi, filter); } finally { roi.delete(); }
    } finally {
      src.delete(); srcTri.delete(); dstTri.delete(); M.delete(); dst.delete();
    }
  }

  const api = { detectCorners, warp, applyFilter, orderCorners, fullFrame };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ScanCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
