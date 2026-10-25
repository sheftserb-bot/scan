// Экспорт текста: склейка строк в абзацы и сборка .docx (через JSZip).
(function (root) {
  'use strict';

  const HYPHENS = '-‐‑‒–—­';

  // Строки OCR -> абзацы: убирает переносы слов и разрывы строк внутри абзаца.
  function reflow(text) {
    const paras = String(text || '').replace(/\r/g, '').split(/\n[ \t]*\n+/);
    const out = [];
    for (const p of paras) {
      const lines = p.split('\n').map(s => s.trim()).filter(Boolean);
      if (!lines.length) continue;
      let acc = lines[0];
      for (let i = 1; i < lines.length; i++) {
        const next = lines[i];
        const last = acc.slice(-1);
        const prevChar = acc.slice(-2, -1);
        // перенос слова: «слово-» + «окончание» (строчная буква, перед дефисом буква)
        if (HYPHENS.includes(last) && /\p{L}/u.test(prevChar) && /^\p{Ll}/u.test(next)) acc = acc.slice(0, -1) + next;
        else acc += ' ' + next;
      }
      out.push(acc.replace(/[ \t]{2,}/g, ' ').trim());
    }
    return out.join('\n\n');
  }

  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  }

  // type: 'blob' в браузере, 'nodebuffer' в Node
  function buildDocx(JSZip, text, type) {
    const paras = String(text || '').split(/\n[ \t]*\n+/).map(s => s.trim()).filter(Boolean);
    const rpr = '<w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:sz w:val="24"/><w:lang w:val="ru-RU"/></w:rPr>';
    const body = paras.map(p =>
      '<w:p><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/><w:jc w:val="both"/></w:pPr>' +
      '<w:r>' + rpr + '<w:t xml:space="preserve">' + esc(p.replace(/\n/g, ' ')) + '</w:t></w:r></w:p>'
    ).join('');

    const documentXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
      (body || '<w:p/>') +
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>' +
      '</w:body></w:document>';

    const contentTypes =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>';

    const rels =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>';

    const zip = new JSZip();
    zip.file('[Content_Types].xml', contentTypes);
    zip.file('_rels/.rels', rels);
    zip.file('word/document.xml', documentXml);
    return zip.generateAsync({
      type: type || 'blob',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      compression: 'DEFLATE'
    });
  }

  const api = { reflow, buildDocx };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ScanExport = api;
})(typeof window !== 'undefined' ? window : globalThis);
