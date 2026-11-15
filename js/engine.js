/* TrustFile engine v2 — every tool runs 100% in the browser.
   Plain JavaScript, no build step, no API key, no server.
   Libraries are loaded lazily, only when a tool needs them, with a
   fallback CDN if the first one fails. Files never leave the device.
   Each tool: async (files, opts, progress) -> { files: [{name, blob}], note } */
(function (global) {
  'use strict';

  var IMAGE_TYPES = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'];
  var MAX_BYTES = 50 * 1024 * 1024;

  /* ---------------- library loader (primary + fallback CDN) ---------------- */
  var LIBS = {
    pdfjs: {
      urls: [
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js'
      ],
      check: function () { return !!global.pdfjsLib; },
      setup: function (url) {
        if (global.pdfjsLib) {
          global.pdfjsLib.GlobalWorkerOptions.workerSrc = url.replace('pdf.min.js', 'pdf.worker.min.js');
        }
      }
    },
    pdflib: {
      urls: [
        'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js',
        'https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js'
      ],
      check: function () { return !!global.PDFLib; }
    },
    mammoth: {
      urls: [
        'https://cdn.jsdelivr.net/npm/mammoth@1.6.0/mammoth.browser.min.js',
        'https://unpkg.com/mammoth@1.6.0/mammoth.browser.min.js'
      ],
      check: function () { return !!global.mammoth; }
    },
    xlsx: {
      urls: [
        'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
        'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
      ],
      check: function () { return !!global.XLSX; }
    },
    jszip: {
      urls: [
        'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
        'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js'
      ],
      check: function () { return !!global.JSZip; }
    },
    jspdf: {
      urls: [
        'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
        'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js'
      ],
      check: function () { return !!(global.jspdf && global.jspdf.jsPDF); }
    },
    html2canvas: {
      urls: [
        'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
        'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js'
      ],
      check: function () { return !!global.html2canvas; }
    },
    tesseract: {
      urls: [
        'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
        'https://unpkg.com/tesseract.js@5.1.1/dist/tesseract.min.js'
      ],
      check: function () { return !!(global.Tesseract && global.Tesseract.createWorker); }
    }
  };
  var loadedLibs = {};

  function loadOneScript(url) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var timer = setTimeout(function () {
        if (!done) { done = true; reject(new Error('Timed out loading ' + url)); }
      }, 25000);
      var s = document.createElement('script');
      s.src = url; s.async = true;
      s.onload = function () { if (!done) { done = true; clearTimeout(timer); resolve(); } };
      s.onerror = function () { if (!done) { done = true; clearTimeout(timer); reject(new Error('Failed to load ' + url)); } };
      document.head.appendChild(s);
    });
  }
  function loadLib(key) {
    if (loadedLibs[key]) return loadedLibs[key];
    loadedLibs[key] = (async function () {
      var lib = LIBS[key];
      if (!lib) throw new Error('Unknown library: ' + key);
      if (lib.check()) return;
      var lastErr = null;
      for (var i = 0; i < lib.urls.length; i++) {
        try {
          await loadOneScript(lib.urls[i]);
          if (lib.check()) { if (lib.setup) lib.setup(lib.urls[i]); return; }
        } catch (e) { lastErr = e; }
      }
      throw new Error('Could not load the ' + key + ' library. Please check your internet connection and try again.' + (lastErr ? '' : ''));
    })();
    return loadedLibs[key];
  }
  async function loadLibs(names) {
    for (var i = 0; i < names.length; i++) await loadLib(names[i]);
  }
  function needLib(key) {
    var lib = LIBS[key];
    if (!lib.check()) throw new Error('The ' + key + ' library did not load. Please refresh the page and try again.');
  }

  /* ---------------- small helpers ---------------- */
  function extOf(name) {
    var p = String(name || '').split('.');
    return p.length > 1 ? p.pop().toLowerCase() : '';
  }
  function baseOf(name) {
    return String(name || 'file').replace(/\.[^.]+$/, '') || 'file';
  }
  function escapeXml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function escapeHtml(s) { return escapeXml(s); }
  function assertSize(file) {
    if (file.size > MAX_BYTES) throw new Error('"' + file.name + '" is larger than 50 MB. Please use a smaller file.');
  }
  function readArrayBuffer(file) { return file.arrayBuffer(); }
  function readText(file) { return file.text(); }
  function readDataURL(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(new Error('Could not read the file.')); };
      r.readAsDataURL(file);
    });
  }
  function loadImage(dataUrl) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('The image could not be loaded. The format may not be supported.')); };
      img.src = dataUrl;
    });
  }
  function canvasToBlob(canvas, mime, quality) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (b) {
        if (b) resolve(b); else reject(new Error('The image could not be created.'));
      }, mime, quality);
    });
  }
  function uint8ToBlob(u8, type) {
    return new Blob([u8.buffer.slice ? u8 : u8.slice()], { type: type });
  }
  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 8000);
  }

  /* Parse "1-3, 5, 8-" into sorted unique 1-based page numbers. */
  function parsePageRanges(spec, total) {
    spec = String(spec || '').trim().toLowerCase();
    if (!spec || spec === 'all') {
      var all = [];
      for (var i = 1; i <= total; i++) all.push(i);
      return all;
    }
    var pages = {};
    var parts = spec.split(',');
    for (var p = 0; p < parts.length; p++) {
      var part = parts[p].trim();
      if (!part) continue;
      var m = part.match(/^(\d+)\s*-\s*(\d*)$/);
      if (m) {
        var start = parseInt(m[1], 10);
        var end = m[2] ? parseInt(m[2], 10) : total;
        if (start < 1 || end < 1 || start > total || end > total || start > end) {
          throw new Error('Page range "' + part + '" is invalid. This PDF has ' + total + ' pages.');
        }
        for (var n = start; n <= end; n++) pages[n] = true;
      } else if (/^\d+$/.test(part)) {
        var num = parseInt(part, 10);
        if (num < 1 || num > total) throw new Error('Page ' + num + ' does not exist. This PDF has ' + total + ' pages.');
        pages[num] = true;
      } else {
        throw new Error('Could not understand "' + part + '". Use page numbers and ranges like 1-3, 5, 8.');
      }
    }
    var out = Object.keys(pages).map(Number).sort(function (a, b) { return a - b; });
    if (!out.length) throw new Error('Please enter at least one page, for example 1-3, 5.');
    return out;
  }

  /* Proper CSV parser: quotes, escaped quotes, commas, CRLF. */
  function parseCsv(text) {
    var rows = [], row = [], field = '', inQuotes = false;
    text = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
        } else { field += ch; }
      } else if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else { field += ch; }
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (c) { return String(c).trim() !== ''; }); });
  }

  /* Group pdf.js text items into lines (by y coordinate), top to bottom. */
  function groupTextItems(items) {
    var sorted = items.slice().sort(function (a, b) {
      var dy = b.transform[5] - a.transform[5];
      if (Math.abs(dy) > 2) return dy;
      return a.transform[4] - b.transform[4];
    });
    var lines = [], current = [], currentY = null;
    sorted.forEach(function (it) {
      var y = it.transform[5];
      if (currentY === null || Math.abs(y - currentY) <= 2) {
        current.push(it); currentY = y;
      } else {
        lines.push(current); current = [it]; currentY = y;
      }
    });
    if (current.length) lines.push(current);
    return lines.map(function (line) {
      return line.map(function (it) { return it.str; }).join(' ').replace(/\s+/g, ' ').trim();
    }).filter(function (l) { return l !== ''; });
  }

  /* ---------------- DOCX builder (JSZip + minimal OOXML, no docx lib) ---------------- */
  function buildDocxXml(paragraphs) {
    var body = paragraphs.map(function (line) {
      if (!String(line).trim()) return '<w:p/>';
      return '<w:p><w:r><w:t xml:space="preserve">' + escapeXml(line) + '</w:t></w:r></w:p>';
    }).join('');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:body>' + body +
      '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>' +
      '</w:body></w:document>';
  }
  var DOCX_CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    '</Types>';
  var DOCX_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
    '</Relationships>';
  var DOCX_WORD_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
  var DOCX_STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault>' +
    '<w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
    '</w:styles>';
  var DOCX_CORE = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties">' +
    '<dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">Converted by TrustFile</dc:title>' +
    '<dc:creator xmlns:dc="http://purl.org/dc/elements/1.1/">TrustFile</dc:creator>' +
    '</cp:coreProperties>';
  async function buildDocxBlob(paragraphs) {
    needLib('jszip');
    var zip = new global.JSZip();
    zip.file('[Content_Types].xml', DOCX_CONTENT_TYPES);
    zip.file('_rels/.rels', DOCX_RELS);
    zip.file('word/document.xml', buildDocxXml(paragraphs));
    zip.file('word/_rels/document.rels', DOCX_WORD_RELS);
    zip.file('word/styles.xml', DOCX_STYLES);
    zip.file('docProps/core.xml', DOCX_CORE);
    return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  }

  /* ---------------- PDF loading helpers ---------------- */
  async function loadPdfJs(file) {
    needLib('pdfjs');
    var buf = await readArrayBuffer(file);
    return global.pdfjsLib.getDocument({ data: buf }).promise;
  }
  async function loadPdfLibDoc(file) {
    needLib('pdflib');
    var buf = await readArrayBuffer(file);
    try {
      return await global.PDFLib.PDFDocument.load(buf, { ignoreEncryption: true });
    } catch (e) {
      throw new Error('This PDF could not be opened. It may be damaged or protected with a password that this tool cannot remove.');
    }
  }
  /* Read the text of every page. Pages with no selectable text (scanned /
     image-only pages) are read automatically with OCR (Tesseract.js),
     so scanned PDFs work too. onPage(pageNum, total, label) reports progress. */
  async function pdfPagesText(file, onPage) {
    var pdf = await loadPdfJs(file);
    var pages = [];
    var ocrWorker = null;
    var ocrTried = false;
    async function ocrPage(page, pageNum, total) {
      if (!ocrTried) {
        ocrTried = true;
        if (onPage) onPage(pageNum, total, 'Loading text recognition (one-time download)...');
        await loadLib('tesseract');
        needLib('tesseract');
        var oem = (global.Tesseract.OEM && global.Tesseract.OEM.LSTM_ONLY) || 1;
        ocrWorker = await global.Tesseract.createWorker('eng', oem, {
          logger: function (m) {
            if (onPage && m.status) {
              onPage(pageNum, total, 'Text recognition: ' + m.status + (m.progress ? ' ' + Math.round(m.progress * 100) + '%' : ''));
            }
          }
        });
      }
      if (onPage) onPage(pageNum, total, 'Reading page ' + pageNum + ' as an image (OCR)...');
      var viewport = page.getViewport({ scale: 2 });
      var canvas = document.createElement('canvas');
      canvas.width = viewport.width; canvas.height = viewport.height;
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: viewport }).promise;
      var ret = await ocrWorker.recognize(canvas);
      var text = (ret && ret.data && ret.data.text) || '';
      return text.split(/\n/).map(function (l) { return l.trim(); }).filter(function (l) { return l !== ''; });
    }
    try {
      for (var p = 1; p <= pdf.numPages; p++) {
        var page = await pdf.getPage(p);
        var content = await page.getTextContent();
        var lines = groupTextItems(content.items);
        if (!lines.length) {
          try {
            lines = await ocrPage(page, p, pdf.numPages);
          } catch (ocrErr) {
            /* OCR unavailable (e.g. no network for the language data) —
               keep the page empty; the tool reports clearly if ALL pages
               end up empty. */
            lines = [];
          }
        }
        pages.push(lines);
        if (onPage) onPage(p, pdf.numPages);
      }
    } finally {
      if (ocrWorker) { try { await ocrWorker.terminate(); } catch (e) { /* ignore */ } }
    }
    return { numPages: pdf.numPages, pages: pages };
  }

  /* Render an HTML string to a paginated A4 PDF (html2canvas + jsPDF). */
  async function htmlStringToPdf(html, opts) {
    needLib('html2canvas'); needLib('jspdf');
    opts = opts || {};
    var container = document.createElement('div');
    container.style.cssText = 'position:absolute;left:-10000px;top:0;width:760px;background:#ffffff;color:#111111;' +
      'font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;font-size:14px;line-height:1.6;padding:24px;';
    container.innerHTML = html;
    document.body.appendChild(container);
    try {
      var canvas = await global.html2canvas(container, { scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false });
      var doc = new global.jspdf.jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });
      var pageW = doc.internal.pageSize.getWidth();
      var pageH = doc.internal.pageSize.getHeight();
      var margin = opts.marginPt || 36;
      var usableW = pageW - margin * 2;
      var usableH = pageH - margin * 2;
      var pxPerPt = canvas.width / usableW;
      var sliceHpx = Math.floor(usableH * pxPerPt);
      var rendered = 0, pageIndex = 0;
      while (rendered < canvas.height) {
        var h = Math.min(sliceHpx, canvas.height - rendered);
        var slice = document.createElement('canvas');
        slice.width = canvas.width; slice.height = h;
        slice.getContext('2d').drawImage(canvas, 0, rendered, canvas.width, h, 0, 0, canvas.width, h);
        if (pageIndex > 0) doc.addPage();
        doc.addImage(slice.toDataURL('image/jpeg', 0.95), 'JPEG', margin, margin, usableW, h / pxPerPt);
        rendered += h; pageIndex++;
      }
      return doc.output('blob');
    } finally {
      container.remove();
    }
  }

  function tableHtml(rows, opts) {
    opts = opts || {};
    var maxRows = opts.maxRows || 500;
    var shown = rows.slice(0, maxRows);
    var css = '<style>table{border-collapse:collapse;width:100%;font-size:13px}' +
      'th,td{border:1px solid #cbd5e1;padding:7px 9px;text-align:left;vertical-align:top;word-break:break-word}' +
      'th{background:#f1f5f9;font-weight:700}tr:nth-child(even) td{background:#f8fafc}</style>';
    var html = css + '<table><thead><tr>' +
      shown[0].map(function (c) { return '<th>' + escapeHtml(c) + '</th>'; }).join('') + '</tr></thead><tbody>';
    for (var i = 1; i < shown.length; i++) {
      html += '<tr>' + shown[i].map(function (c) { return '<td>' + escapeHtml(c) + '</td>'; }).join('') + '</tr>';
    }
    html += '</tbody></table>';
    if (rows.length > maxRows) {
      html += '<p style="color:#6b7280;font-size:12px">Showing the first ' + maxRows + ' of ' + rows.length + ' rows.</p>';
    }
    return html;
  }

  /* ================= PDF tools (pdf-lib) ================= */
  async function toolMergePdf(files, opts, prog) {
    needLib('pdflib');
    if (files.length < 2) throw new Error('Please add at least 2 PDF files to merge.');
    var out = await global.PDFLib.PDFDocument.create();
    for (var i = 0; i < files.length; i++) {
      assertSize(files[i]);
      var src = await loadPdfLibDoc(files[i]);
      var pages = await out.copyPages(src, src.getPageIndices());
      pages.forEach(function (p) { out.addPage(p); });
      prog((i + 1) / files.length, 'Merging file ' + (i + 1) + ' of ' + files.length + '...');
    }
    var bytes = await out.save();
    return { files: [{ name: 'merged.pdf', blob: uint8ToBlob(bytes, 'application/pdf') }] };
  }

  async function toolSplitPdf(files, opts, prog) {
    needLib('pdflib');
    var file = files[0]; assertSize(file);
    var src = await loadPdfLibDoc(file);
    var total = src.getPageCount();
    var mode = opts.splitMode || 'ranges';
    var groups = [];
    if (mode === 'each') {
      for (var p = 1; p <= total; p++) groups.push({ label: 'page-' + p, pages: [p] });
    } else {
      var selected = parsePageRanges(opts.pageRanges, total);
      groups.push({ label: 'pages-' + selected[0] + '-' + selected[selected.length - 1], pages: selected });
    }
    var outFiles = [];
    for (var g = 0; g < groups.length; g++) {
      var doc = await global.PDFLib.PDFDocument.create();
      var copied = await doc.copyPages(src, groups[g].pages.map(function (n) { return n - 1; }));
      copied.forEach(function (pg) { doc.addPage(pg); });
      var bytes = await doc.save();
      outFiles.push({ name: baseOf(file.name) + '-' + groups[g].label + '.pdf', blob: uint8ToBlob(bytes, 'application/pdf') });
      prog((g + 1) / groups.length, 'Creating part ' + (g + 1) + ' of ' + groups.length + '...');
    }
    return { files: outFiles };
  }

  async function toolRotatePdf(files, opts, prog) {
    needLib('pdflib');
    var file = files[0]; assertSize(file);
    var angle = parseInt(opts.angle || '90', 10) || 90;
    var doc = await loadPdfLibDoc(file);
    var pages = doc.getPages();
    pages.forEach(function (page) {
      var current = page.getRotation().angle;
      page.setRotation(global.PDFLib.degrees((current + angle) % 360));
    });
    prog(0.9, 'Saving...');
    var bytes = await doc.save();
    return { files: [{ name: baseOf(file.name) + '-rotated.pdf', blob: uint8ToBlob(bytes, 'application/pdf') }] };
  }

  async function toolDeletePages(files, opts, prog) {
    needLib('pdflib');
    var file = files[0]; assertSize(file);
    var doc = await loadPdfLibDoc(file);
    var total = doc.getPageCount();
    var toDelete = parsePageRanges(opts.pageRanges, total);
    if (toDelete.length >= total) throw new Error('You cannot delete every page. At least one page must remain.');
    toDelete.sort(function (a, b) { return b - a; }).forEach(function (n) { doc.removePage(n - 1); });
    prog(0.9, 'Saving...');
    var bytes = await doc.save();
    return { files: [{ name: baseOf(file.name) + '-edited.pdf', blob: uint8ToBlob(bytes, 'application/pdf') }] };
  }

  async function toolPageNumbers(files, opts, prog) {
    needLib('pdflib');
    var file = files[0]; assertSize(file);
    var doc = await loadPdfLibDoc(file);
    var font = await doc.embedFont(global.PDFLib.StandardFonts.Helvetica);
    var size = parseInt(opts.fontSize || '11', 10) || 11;
    var start = parseInt(opts.startAt || '1', 10) || 1;
    var format = opts.format || 'Page {n} of {total}';
    var position = opts.position || 'bottom-center';
    var pages = doc.getPages();
    pages.forEach(function (page, idx) {
      var label = format.replace('{n}', String(start + idx)).replace('{total}', String(pages.length));
      var w = font.widthOfTextAtSize(label, size);
      var dims = page.getSize();
      var x = 36, y = 30;
      if (position.indexOf('center') !== -1) x = (dims.width - w) / 2;
      if (position.indexOf('right') !== -1) x = dims.width - w - 36;
      if (position.indexOf('left') !== -1) x = 36;
      if (position.indexOf('top') === 0) y = dims.height - 30 - size;
      page.drawText(label, { x: x, y: y, size: size, font: font, color: global.PDFLib.rgb(0.35, 0.35, 0.35) });
      prog((idx + 1) / pages.length, 'Numbering page ' + (idx + 1) + ' of ' + pages.length + '...');
    });
    var bytes = await doc.save();
    return { files: [{ name: baseOf(file.name) + '-numbered.pdf', blob: uint8ToBlob(bytes, 'application/pdf') }] };
  }

  async function toolWatermark(files, opts, prog) {
    needLib('pdflib');
    var file = files[0]; assertSize(file);
    var text = String(opts.watermarkText || '').trim();
    if (!text) throw new Error('Please enter the watermark text.');
    var doc = await loadPdfLibDoc(file);
    var font = await doc.embedFont(global.PDFLib.StandardFonts.HelveticaBold);
    var size = parseInt(opts.fontSize || '48', 10) || 48;
    var opacity = Math.min(0.9, Math.max(0.05, parseFloat(opts.opacity || '0.25') || 0.25));
    var angle = parseInt(opts.angle || '-45', 10) || 0;
    var colors = {
      gray: global.PDFLib.rgb(0.6, 0.6, 0.6),
      red: global.PDFLib.rgb(0.9, 0.2, 0.2),
      blue: global.PDFLib.rgb(0.2, 0.4, 0.9),
      green: global.PDFLib.rgb(0.15, 0.6, 0.3)
    };
    var color = colors[opts.color] || colors.gray;
    var pages = doc.getPages();
    pages.forEach(function (page, idx) {
      var dims = page.getSize();
      var w = font.widthOfTextAtSize(text, size);
      page.drawText(text, {
        x: (dims.width - w) / 2, y: dims.height / 2, size: size, font: font,
        color: color, opacity: opacity, rotate: global.PDFLib.degrees(angle)
      });
      prog((idx + 1) / pages.length, 'Watermarking page ' + (idx + 1) + ' of ' + pages.length + '...');
    });
    var bytes = await doc.save();
    return { files: [{ name: baseOf(file.name) + '-watermarked.pdf', blob: uint8ToBlob(bytes, 'application/pdf') }] };
  }

  async function toolCompressPdf(files, opts, prog) {
    needLib('pdfjs'); needLib('jspdf');
    var file = files[0]; assertSize(file);
    var quality = opts.quality || 'medium';
    var settings = { low: { scale: 1.0, jpeg: 0.55 }, medium: { scale: 1.4, jpeg: 0.72 }, high: { scale: 2.0, jpeg: 0.85 } };
    var cfg = settings[quality] || settings.medium;
    var pdf = await loadPdfJs(file);
    var doc = null;
    for (var p = 1; p <= pdf.numPages; p++) {
      var page = await pdf.getPage(p);
      var viewport = page.getViewport({ scale: cfg.scale });
      var canvas = document.createElement('canvas');
      canvas.width = viewport.width; canvas.height = viewport.height;
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: viewport }).promise;
      var wPt = viewport.width / cfg.scale, hPt = viewport.height / cfg.scale;
      if (!doc) {
        doc = new global.jspdf.jsPDF({ unit: 'pt', format: [wPt, hPt], orientation: wPt > hPt ? 'landscape' : 'portrait', compress: true });
      } else {
        doc.addPage([wPt, hPt], wPt > hPt ? 'landscape' : 'portrait');
      }
      doc.addImage(canvas.toDataURL('image/jpeg', cfg.jpeg), 'JPEG', 0, 0, wPt, hPt);
      prog(p / pdf.numPages, 'Compressing page ' + p + ' of ' + pdf.numPages + '...');
    }
    var blob = doc.output('blob');
    var saved = file.size > 0 ? Math.max(0, Math.round((1 - blob.size / file.size) * 100)) : 0;
    return {
      files: [{ name: baseOf(file.name) + '-compressed.pdf', blob: blob }],
      note: 'New size: ' + (blob.size / 1048576).toFixed(2) + ' MB — about ' + saved + '% smaller than the original.'
    };
  }

  /* ================= Convert FROM pdf (pdf.js) ================= */
  async function toolPdfToText(files, opts, prog) {
    var file = files[0]; assertSize(file);
    var result = await pdfPagesText(file, function (p, total, label) { prog(p / total, label || ('Reading page ' + p + ' of ' + total + '...')); });
    var text = result.pages.map(function (lines) { return lines.join('\n'); }).join('\n\n');
    if (!text.trim()) throw new Error('No readable text was found in this PDF, even after scanning the pages as images. The scan may be too blurry, handwritten, or the text too small to read.');
    return { files: [{ name: baseOf(file.name) + '.txt', blob: new Blob([text], { type: 'text/plain' }) }] };
  }

  async function toolPdfToDocx(files, opts, prog) {
    needLib('jszip');
    var file = files[0]; assertSize(file);
    var result = await pdfPagesText(file, function (p, total, label) { prog(p / total * 0.8, label || ('Reading page ' + p + ' of ' + total + '...')); });
    var paragraphs = [];
    result.pages.forEach(function (lines, idx) {
      if (idx > 0) paragraphs.push('');
      lines.forEach(function (l) { paragraphs.push(l); });
    });
    if (!paragraphs.some(function (l) { return l.trim(); })) {
      throw new Error('No readable text was found in this PDF, even after scanning the pages as images. The scan may be too blurry, handwritten, or the text too small to read.');
    }
    prog(0.9, 'Building the Word document...');
    var blob = await buildDocxBlob(paragraphs);
    return { files: [{ name: baseOf(file.name) + '.docx', blob: blob }] };
  }

  async function toolPdfToImages(files, opts, prog, format) {
    var file = files[0]; assertSize(file);
    var scale = parseFloat(opts.scale || '2') || 2;
    var quality = format === 'jpg' ? (parseFloat(opts.quality || '0.92') || 0.92) : undefined;
    var pdf = await loadPdfJs(file);
    var out = [];
    for (var p = 1; p <= pdf.numPages; p++) {
      var page = await pdf.getPage(p);
      var viewport = page.getViewport({ scale: scale });
      var canvas = document.createElement('canvas');
      canvas.width = viewport.width; canvas.height = viewport.height;
      var ctx = canvas.getContext('2d');
      if (format === 'jpg') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
      await page.render({ canvasContext: ctx, viewport: viewport }).promise;
      var blob = await canvasToBlob(canvas, format === 'jpg' ? 'image/jpeg' : 'image/png', quality);
      out.push({ name: baseOf(file.name) + '-page-' + p + '.' + format, blob: blob });
      prog(p / pdf.numPages, 'Rendering page ' + p + ' of ' + pdf.numPages + '...');
    }
    return { files: out };
  }

  async function toolPdfToExcel(files, opts, prog) {
    needLib('xlsx');
    var file = files[0]; assertSize(file);
    var result = await pdfPagesText(file, function (p, total, label) { prog(p / total * 0.8, label || ('Reading page ' + p + ' of ' + total + '...')); });
    var rows = [];
    result.pages.forEach(function (lines, idx) {
      if (idx > 0) rows.push([]);
      lines.forEach(function (line) {
        rows.push(line.split(/\t| {2,}/).map(function (c) { return c.trim(); }));
      });
    });
    if (!rows.length) throw new Error('No readable text was found in this PDF, even after scanning the pages as images. The scan may be too blurry, handwritten, or the text too small to read.');
    var wb = global.XLSX.utils.book_new();
    global.XLSX.utils.book_append_sheet(wb, global.XLSX.utils.aoa_to_sheet(rows), 'PDF Text');
    var arr = global.XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    return { files: [{ name: baseOf(file.name) + '.xlsx', blob: new Blob([arr], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }) }] };
  }

  /* ================= Convert TO pdf ================= */
  async function toolWordToPdf(files, opts, prog) {
    needLib('mammoth');
    var file = files[0]; assertSize(file);
    prog(0.15, 'Reading the Word document...');
    var buf = await readArrayBuffer(file);
    var res = await global.mammoth.convertToHtml({ arrayBuffer: buf });
    if (!res.value || !res.value.replace(/<[^>]+>/g, '').trim()) {
      throw new Error('This Word document appears to be empty, or its content could not be read.');
    }
    prog(0.45, 'Laying out the pages...');
    var styled = '<div style="font-family:Georgia,serif">' + res.value + '</div>';
    var wrapped = '<style>h1{font-size:24px}h2{font-size:19px}h3{font-size:16px}' +
      'table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:6px 8px;text-align:left}' +
      'img{max-width:100%;height:auto}p{margin:0 0 12px}</style>' + styled;
    var blob = await htmlStringToPdf(wrapped, {});
    prog(1, 'Done');
    return { files: [{ name: baseOf(file.name) + '.pdf', blob: blob }] };
  }

  async function toolExcelToPdf(files, opts, prog) {
    needLib('xlsx');
    var file = files[0]; assertSize(file);
    prog(0.15, 'Reading the spreadsheet...');
    var buf = await readArrayBuffer(file);
    var wb = global.XLSX.read(buf, { type: 'array' });
    var sheetName = wb.SheetNames[0];
    var rows = global.XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '' });
    rows = rows.filter(function (r) { return r.some(function (c) { return String(c).trim() !== ''; }); });
    if (!rows.length) throw new Error('The spreadsheet appears to be empty.');
    prog(0.4, 'Building the table...');
    var html = '<h2 style="font-family:system-ui,sans-serif">' + escapeHtml(sheetName) + '</h2>' + tableHtml(rows, { maxRows: 300 });
    var blob = await htmlStringToPdf(html, {});
    prog(1, 'Done');
    return { files: [{ name: baseOf(file.name) + '.pdf', blob: blob }] };
  }

  async function toolImagesToPdf(files, opts, prog) {
    needLib('jspdf');
    if (!files.length) throw new Error('Please add at least one image.');
    var pageSize = opts.pageSize || 'fit';
    var margin = parseInt(opts.margin || '20', 10) || 0;
    var doc = null;
    for (var i = 0; i < files.length; i++) {
      assertSize(files[i]);
      var img = await loadImage(await readDataURL(files[i]));
      var imgW = img.naturalWidth, imgH = img.naturalHeight;
      var orientation = imgW > imgH ? 'landscape' : 'portrait';
      var pageW, pageH;
      if (pageSize === 'a4') { pageW = 595.28; pageH = 841.89; if (orientation === 'landscape') { var t = pageW; pageW = pageH; pageH = t; } }
      else if (pageSize === 'letter') { pageW = 612; pageH = 792; if (orientation === 'landscape') { var t2 = pageW; pageW = pageH; pageH = t2; } }
      else { pageW = imgW * 72 / 96 + margin * 2; pageH = imgH * 72 / 96 + margin * 2; }
      if (!doc) {
        doc = new global.jspdf.jsPDF({ unit: 'pt', format: [pageW, pageH], orientation: orientation, compress: true });
      } else {
        doc.addPage([pageW, pageH], orientation);
      }
      var availW = pageW - margin * 2, availH = pageH - margin * 2;
      var ratio = Math.min(availW / (imgW * 72 / 96), availH / (imgH * 72 / 96));
      var w = imgW * 72 / 96 * ratio, h = imgH * 72 / 96 * ratio;
      var flat = document.createElement('canvas');
      flat.width = imgW; flat.height = imgH;
      var fctx = flat.getContext('2d');
      fctx.fillStyle = '#ffffff'; fctx.fillRect(0, 0, imgW, imgH);
      fctx.drawImage(img, 0, 0);
      doc.addImage(flat.toDataURL('image/jpeg', 0.92), 'JPEG', margin + (availW - w) / 2, margin + (availH - h) / 2, w, h);
      prog((i + 1) / files.length, 'Adding image ' + (i + 1) + ' of ' + files.length + '...');
    }
    var name = files.length === 1 ? baseOf(files[0].name) + '.pdf' : 'images.pdf';
    return { files: [{ name: name, blob: doc.output('blob') }] };
  }

  async function toolTextToPdf(files, opts, prog) {
    needLib('jspdf');
    var file = files[0]; assertSize(file);
    var text = await readText(file);
    if (!text.trim()) throw new Error('The text file is empty.');
    var fontSize = parseInt(opts.fontSize || '12', 10) || 12;
    var doc = new global.jspdf.jsPDF({ unit: 'pt', format: 'a4' });
    var pageW = doc.internal.pageSize.getWidth(), pageH = doc.internal.pageSize.getHeight();
    var margin = 54, lineHeight = fontSize * 1.5;
    doc.setFont('courier', 'normal'); doc.setFontSize(fontSize);
    var lines = doc.splitTextToSize(text.replace(/\t/g, '    '), pageW - margin * 2);
    var perPage = Math.floor((pageH - margin * 2) / lineHeight);
    for (var i = 0; i < lines.length; i += perPage) {
      if (i > 0) doc.addPage();
      doc.text(lines.slice(i, i + perPage), margin, margin + fontSize);
      prog(Math.min(1, (i + perPage) / lines.length), 'Writing the PDF...');
    }
    return { files: [{ name: baseOf(file.name) + '.pdf', blob: doc.output('blob') }] };
  }

  async function toolCsvToPdf(files, opts, prog) {
    var file = files[0]; assertSize(file);
    var text = await readText(file);
    var rows = parseCsv(text);
    if (!rows.length) throw new Error('The CSV file appears to be empty.');
    prog(0.3, 'Building the table...');
    var blob = await htmlStringToPdf(tableHtml(rows, { maxRows: 500 }), {});
    prog(1, 'Done');
    return { files: [{ name: baseOf(file.name) + '.pdf', blob: blob }] };
  }

  async function toolHtmlToPdf(files, opts, prog) {
    var html = String(opts.htmlCode || '').trim();
    if (!html && files.length) {
      var file = files[0]; assertSize(file);
      html = await readText(file);
    }
    if (!html) throw new Error('Please paste your HTML code or upload an .html file.');
    prog(0.3, 'Rendering the page...');
    var blob = await htmlStringToPdf(html, {});
    prog(1, 'Done');
    var name = files.length ? baseOf(files[0].name) + '.pdf' : 'webpage.pdf';
    return { files: [{ name: name, blob: blob }] };
  }

  /* ================= Images & documents ================= */
  async function toolImageToImage(files, opts, prog, target) {
    var file = files[0]; assertSize(file);
    var img = await loadImage(await readDataURL(file));
    prog(0.4, 'Converting the image...');
    var canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    var ctx = canvas.getContext('2d');
    if (target === 'jpg') { ctx.fillStyle = opts.bgColor || '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    ctx.drawImage(img, 0, 0);
    var quality = parseFloat(opts.quality || '0.92') || 0.92;
    var mime = target === 'jpg' ? 'image/jpeg' : (target === 'webp' ? 'image/webp' : 'image/png');
    var blob = await canvasToBlob(canvas, mime, quality);
    return { files: [{ name: baseOf(file.name) + '.' + target, blob: blob }] };
  }

  async function toolTextToDocx(files, opts, prog) {
    needLib('jszip');
    var file = files[0]; assertSize(file);
    var text = await readText(file);
    if (!text.trim()) throw new Error('The text file is empty.');
    prog(0.5, 'Building the Word document...');
    var blob = await buildDocxBlob(text.split(/\n/));
    return { files: [{ name: baseOf(file.name) + '.docx', blob: blob }] };
  }

  async function toolDocxToText(files, opts, prog) {
    needLib('mammoth');
    var file = files[0]; assertSize(file);
    prog(0.3, 'Reading the Word document...');
    var buf = await readArrayBuffer(file);
    var res = await global.mammoth.extractRawText({ arrayBuffer: buf });
    if (!res.value.trim()) throw new Error('No text was found in this Word document. It may contain only images.');
    return { files: [{ name: baseOf(file.name) + '.txt', blob: new Blob([res.value], { type: 'text/plain' }) }] };
  }

  async function toolSheetConvert(files, opts, prog, target) {
    needLib('xlsx');
    var file = files[0]; assertSize(file);
    prog(0.3, 'Reading the spreadsheet...');
    var buf = await readArrayBuffer(file);
    var wb = global.XLSX.read(buf, { type: 'array' });
    var ext = extOf(file.name);
    if (target === 'json') {
      var sheet = wb.Sheets[wb.SheetNames[0]];
      var json = JSON.stringify(global.XLSX.utils.sheet_to_json(sheet, { defval: '' }), null, 2);
      return { files: [{ name: baseOf(file.name) + '.json', blob: new Blob([json], { type: 'application/json' }) }] };
    }
    if (ext === target) throw new Error('The file is already in ' + target.toUpperCase() + ' format.');
    var out = global.XLSX.write(wb, { bookType: target, type: 'array' });
    var mime = target === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv';
    return { files: [{ name: baseOf(file.name) + '.' + target, blob: new Blob([out], { type: mime }) }] };
  }

  /* ZIP many outputs into one download. */
  async function zipFiles(outFiles, zipName) {
    needLib('jszip');
    var zip = new global.JSZip();
    outFiles.forEach(function (f) { zip.file(f.name, f.blob); });
    var blob = await zip.generateAsync({ type: 'blob' });
    return { name: zipName, blob: blob };
  }

  /* ================= Tool registry ================= */
  var TOOLS = {
    'merge-pdf': { libs: ['pdflib'], run: toolMergePdf },
    'split-pdf': { libs: ['pdflib'], run: toolSplitPdf },
    'compress-pdf': { libs: ['pdfjs', 'jspdf'], run: toolCompressPdf },
    'rotate-pdf': { libs: ['pdflib'], run: toolRotatePdf },
    'delete-pages': { libs: ['pdflib'], run: toolDeletePages },
    'page-numbers': { libs: ['pdflib'], run: toolPageNumbers },
    'watermark-pdf': { libs: ['pdflib'], run: toolWatermark },
    'pdf-to-word': { libs: ['pdfjs', 'jszip'], run: toolPdfToDocx },
    'pdf-to-jpg': { libs: ['pdfjs'], run: function (f, o, p) { return toolPdfToImages(f, o, p, 'jpg'); } },
    'pdf-to-png': { libs: ['pdfjs'], run: function (f, o, p) { return toolPdfToImages(f, o, p, 'png'); } },
    'pdf-to-text': { libs: ['pdfjs'], run: toolPdfToText },
    'pdf-to-excel': { libs: ['pdfjs', 'xlsx'], run: toolPdfToExcel },
    'word-to-pdf': { libs: ['mammoth', 'html2canvas', 'jspdf'], run: toolWordToPdf },
    'excel-to-pdf': { libs: ['xlsx', 'html2canvas', 'jspdf'], run: toolExcelToPdf },
    'jpg-to-pdf': { libs: ['jspdf'], run: toolImagesToPdf },
    'txt-to-pdf': { libs: ['jspdf'], run: toolTextToPdf },
    'csv-to-pdf': { libs: ['html2canvas', 'jspdf'], run: toolCsvToPdf },
    'html-to-pdf': { libs: ['html2canvas', 'jspdf'], run: toolHtmlToPdf },
    'png-to-jpg': { libs: [], run: function (f, o, p) { return toolImageToImage(f, o, p, 'jpg'); } },
    'image-converter': { libs: [], run: function (f, o, p) { return toolImageToImage(f, o, p, o.target || 'jpg'); } },
    'txt-to-word': { libs: ['jszip'], run: toolTextToDocx },
    'word-to-text': { libs: ['mammoth'], run: toolDocxToText },
    'excel-to-csv': { libs: ['xlsx'], run: function (f, o, p) { return toolSheetConvert(f, o, p, o.target || 'csv'); } }
  };

  async function runTool(toolId, files, opts, onProgress) {
    var tool = TOOLS[toolId];
    if (!tool) throw new Error('Unknown tool: ' + toolId);
    var prog = onProgress || function () {};
    prog(0.05, 'Loading the converter...');
    await loadLibs(tool.libs);
    return tool.run(files, opts || {}, prog);
  }

  global.TrustFile = {
    run: runTool,
    loadLibs: loadLibs,
    zipFiles: zipFiles,
    download: downloadBlob,
    extOf: extOf,
    baseOf: baseOf,
    maxBytes: MAX_BYTES,
    _internals: {
      parsePageRanges: parsePageRanges,
      parseCsv: parseCsv,
      groupTextItems: groupTextItems,
      buildDocxXml: buildDocxXml,
      escapeXml: escapeXml
    }
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = global.TrustFile;
  }
})(typeof window !== 'undefined' ? window : globalThis);
