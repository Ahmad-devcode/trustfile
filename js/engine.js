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

  function itemWidth(it) {
    if (typeof it.width === 'number' && it.width > 0) return it.width;
    var size = Math.abs(it.transform[0]) || 10;
    return String(it.str || '').length * size * 0.55;
  }
  /* ---- Reading-order layout analysis (XY-cut) ----
     Both the text layer and OCR words are reduced to boxes
     {text, x0, y0, x1, y1} with y growing downward, then ordered by
     recursively cutting whitespace gutters: vertical cuts split columns,
     horizontal cuts split stacked blocks. This keeps two-column resumes
     and nested layouts (e.g. a split bottom section) in reading order,
     even when a column sits on a colored background. */
  function dedupeBoxes(boxes) {
    var seen = {};
    return boxes.filter(function (b) {
      var key = b.text + '|' + Math.round(b.x0) + '|' + Math.round(b.y0);
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }
  function cleanFontName(fontName) {
    var name = String(fontName || '').replace(/^[^+]*\+/, ''); /* strip subset prefix */
    name = name.split(/[-,]/)[0].trim();
    return /^[A-Za-z][A-Za-z0-9 ]*$/.test(name) ? name : '';
  }
  function boxesFromTextItems(items, pageHeight, styles) {
    var ph = pageHeight;
    if (!ph) {
      ph = 0;
      items.forEach(function (it) {
        ph = Math.max(ph, it.transform[5] + (Math.abs(it.transform[3]) || 10));
      });
      ph += 10;
    }
    return dedupeBoxes(items.map(function (it) {
      var size = Math.abs(it.transform[3]) || Math.abs(it.transform[0]) || 10;
      var x0 = it.transform[4];
      var yBottom = it.transform[5];
      /* pdf.js fontName is usually an internal id (g_d0_f1); the styles
         table sometimes carries the real family name for embedded fonts. */
      var styleInfo = (styles && styles[it.fontName]) || {};
      var fontLabel = String(styleInfo.fontFamily || '') + ' ' + String(it.fontName || '');
      return {
        text: String(it.str || ''),
        x0: x0, x1: x0 + itemWidth(it),
        y1: ph - yBottom,
        y0: ph - yBottom - size,
        size: size,
        bold: /bold/i.test(fontLabel),
        italic: /italic|oblique/i.test(fontLabel),
        font: cleanFontName(styleInfo.fontFamily || it.fontName)
      };
    }).filter(function (b) { return b.text.trim() !== ''; }));
  }
  function boxesFromOcrWords(words, scale) {
    var s = scale || 1;
    return dedupeBoxes(words.map(function (w) {
      var bb = w.bbox || {};
      var h = ((bb.y1 || 0) - (bb.y0 || 0)) / s;
      return {
        text: String(w.text || ''),
        x0: (bb.x0 || 0) / s, y0: (bb.y0 || 0) / s, x1: (bb.x1 || 0) / s, y1: (bb.y1 || 0) / s,
        size: Math.max(6, h / 1.15),
        bold: false, italic: false, font: ''
      };
    }).filter(function (b) {
      var t = b.text.trim();
      if (!t) return false;
      if (t.length === 1 && !/[A-Za-z0-9]/.test(t)) return false; /* icon/symbol noise */
      return b.x1 > b.x0 && b.y1 > b.y0;
    }));
  }
  function medianHeight(boxes) {
    var hs = boxes.map(function (b) { return b.y1 - b.y0; }).sort(function (a, b) { return a - b; });
    return hs.length ? hs[Math.floor(hs.length / 2)] : 0;
  }
  /* Group boxes into lines: same baseline (y-overlap) and a small x-gap.
     The x-gap limit keeps words from different columns on separate lines
     even when they share a baseline; over-splitting a line is harmless
     (order is preserved), over-merging columns is not. */
  function groupLines(boxes) {
    var medH = medianHeight(boxes) || 10;
    var maxGap = Math.max(8, medH);
    var sorted = boxes.slice().sort(function (a, b) { return (a.y0 - b.y0) || (a.x0 - b.x0); });
    var lines = [];
    sorted.forEach(function (b) {
      var best = null;
      for (var i = lines.length - 1; i >= 0; i--) {
        var line = lines[i];
        var yOverlap = Math.min(b.y1, line.y1) - Math.max(b.y0, line.y0);
        var minH = Math.min(b.y1 - b.y0, line.y1 - line.y0);
        if (yOverlap <= minH * 0.4) continue;
        var xGap = b.x0 >= line.x1 ? b.x0 - line.x1 : (b.x1 <= line.x0 ? line.x0 - b.x1 : 0);
        if (xGap > maxGap) continue;
        best = line; break;
      }
      if (best) {
        best.boxes.push(b);
        best.x0 = Math.min(best.x0, b.x0); best.x1 = Math.max(best.x1, b.x1);
        best.y0 = Math.min(best.y0, b.y0); best.y1 = Math.max(best.y1, b.y1);
      } else {
        lines.push({ x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, boxes: [b] });
      }
    });
    return lines;
  }
  function renderLines(lines) {
    var ordered = lines.slice().sort(function (a, b) { return (a.y0 - b.y0) || (a.x0 - b.x0); });
    return ordered.map(function (line) {
      var words = line.boxes.slice().sort(function (a, b) { return a.x0 - b.x0; });
      return words.map(function (b) { return b.text; }).join(' ').replace(/\s+/g, ' ').trim();
    }).filter(function (l) { return l !== ''; });
  }
  /* Whitespace gaps between merged spans on one axis, widest first. */
  function cutCandidates(lines, vertical, minGap) {
    var intervals = lines.map(function (l) {
      return vertical ? [l.x0, l.x1] : [l.y0, l.y1];
    }).sort(function (a, b) { return a[0] - b[0]; });
    var merged = [];
    intervals.forEach(function (iv) {
      var last = merged[merged.length - 1];
      if (last && iv[0] <= last[1] + 2) { last[1] = Math.max(last[1], iv[1]); }
      else merged.push([iv[0], iv[1]]);
    });
    var out = [];
    for (var i = 0; i + 1 < merged.length; i++) {
      var gap = merged[i + 1][0] - merged[i][1];
      if (gap >= minGap) out.push({ pos: (merged[i][1] + merged[i + 1][0]) / 2, gap: gap });
    }
    out.sort(function (a, b) { return b.gap - a.gap; });
    return out;
  }
  function tryVerticalCut(lines, candidates) {
    for (var c = 0; c < candidates.length; c++) {
      var pos = candidates[c].pos;
      var left = [], right = [], spanning = [];
      lines.forEach(function (l) {
        if (l.x1 <= pos) left.push(l);
        else if (l.x0 >= pos) right.push(l);
        else spanning.push(l);
      });
      if (left.length < 2 || right.length < 2) continue;
      var before = [], after = [];
      if (spanning.length) {
        var rest = left.concat(right);
        var minTop = Math.min.apply(null, rest.map(function (l) { return l.y0; }));
        var maxBottom = Math.max.apply(null, rest.map(function (l) { return l.y1; }));
        var allAbove = spanning.every(function (l) { return l.y1 <= minTop; });
        var allBelow = spanning.every(function (l) { return l.y0 >= maxBottom; });
        if (allAbove) before = spanning;
        else if (allBelow) after = spanning;
        else continue;
      }
      return { before: before, left: left, right: right, after: after };
    }
    return null;
  }
  function tryHorizontalCut(lines, candidates) {
    for (var c = 0; c < candidates.length; c++) {
      var pos = candidates[c].pos;
      var top = lines.filter(function (l) { return l.y1 <= pos; });
      var bottom = lines.filter(function (l) { return l.y0 >= pos; });
      if (top.length && bottom.length && top.length + bottom.length === lines.length) {
        return { top: top, bottom: bottom };
      }
    }
    return null;
  }
  function xyCutLines(lines, depth) {
    if (!lines.length) return [];
    if (lines.length < 2 || depth > 6) return renderLines(lines);
    var x0 = Math.min.apply(null, lines.map(function (l) { return l.x0; }));
    var x1 = Math.max.apply(null, lines.map(function (l) { return l.x1; }));
    var y0 = Math.min.apply(null, lines.map(function (l) { return l.y0; }));
    var y1 = Math.max.apply(null, lines.map(function (l) { return l.y1; }));
    var regionW = Math.max(1, x1 - x0), regionH = Math.max(1, y1 - y0);
    var vCuts = cutCandidates(lines, true, Math.max(8, regionW * 0.02));
    var hCuts = cutCandidates(lines, false, Math.max(8, regionH * 0.01));
    var vScore = vCuts.length ? vCuts[0].gap / regionW : 0;
    var hScore = hCuts.length ? hCuts[0].gap / regionH : 0;
    var axes = (vCuts.length && vScore >= 0.5 * hScore) ? ['v', 'h'] : ['h', 'v'];
    for (var a = 0; a < axes.length; a++) {
      if (axes[a] === 'v') {
        var v = tryVerticalCut(lines, vCuts);
        if (v) {
          var out = renderLines(v.before);
          out = out.concat(xyCutLines(v.left, depth + 1));
          out.push('');
          out = out.concat(xyCutLines(v.right, depth + 1));
          out = out.concat(renderLines(v.after));
          return out;
        }
      } else {
        var h = tryHorizontalCut(lines, hCuts);
        if (h) return xyCutLines(h.top, depth + 1).concat(xyCutLines(h.bottom, depth + 1));
      }
    }
    return renderLines(lines);
  }
  function xyCut(boxes, depth) {
    return xyCutLines(groupLines(boxes), depth || 0);
  }
  /* Group pdf.js text items into lines, top to bottom, column-aware. */
  function groupTextItems(items, pageWidth, pageHeight) {
    if (!items || !items.length) return [];
    return xyCut(boxesFromTextItems(items, pageHeight), 0);
  }
  /* Is this line OCR noise (icon misreads, separator debris)? */
  function isNoiseLine(text) {
    var l = String(text).replace(/\s+/g, ' ').trim();
    if (!l) return true;
    var alnum = (l.match(/[A-Za-z0-9]/g) || []).length;
    if (alnum === 0) return true;
    if (alnum <= 1 && l.length <= 6 && l.indexOf('+') === -1 && l.indexOf('#') === -1) return true;
    if (l.length <= 3 && alnum <= 2 && l.indexOf('+') === -1 && l.indexOf('#') === -1) return true;
    return false;
  }
  /* Turn positioned boxes into styled lines for the layout-preserving
     Word output: text, position (points from the page's top-left corner),
     size, bold/italic and font. */
  function layoutLinesFromBoxes(boxes, isOcr) {
    var lines = groupLines(boxes);
    var styled = lines.map(function (line) {
      var words = line.boxes.slice().sort(function (a, b) { return a.x0 - b.x0; });
      var text = words.map(function (b) { return b.text; }).join(' ').replace(/\s+/g, ' ').trim();
      var size = 0, bold = false, italic = false;
      var fonts = {};
      words.forEach(function (b) {
        size = Math.max(size, b.size || 0);
        if (b.bold) bold = true;
        if (b.italic) italic = true;
        if (b.font) fonts[b.font] = (fonts[b.font] || 0) + 1;
      });
      var font = '';
      Object.keys(fonts).forEach(function (f) { if (!font || fonts[f] > fonts[font]) font = f; });
      return { text: text, x: line.x0, y: line.y0, w: Math.max(10, line.x1 - line.x0), size: size || 11, bold: bold, italic: italic, font: font };
    }).filter(function (l) { return l.text !== '' && (!isOcr || !isNoiseLine(l.text)); });
    /* Headings read bold even when the font name does not say so. */
    var sizes = styled.map(function (l) { return l.size; }).sort(function (a, b) { return a - b; });
    var median = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 11;
    styled.forEach(function (l) { if (l.size >= median * 1.25) l.bold = true; });
    return styled;
  }

  /* ---------------- DOCX builder (JSZip + minimal OOXML, no docx lib) ---------------- */
  var SECTION_WORDS = /^(summary|professional summary|career objective|objective|contact|contact summary|contact info|contact information|skills|technical skills|key skills|languages?|education|academic|experience|work experience|employment|projects?|certifications?|certificates|references?|personal details|personal information|hobbies|interests|about me|profile)$/i;
  /* Detect section headings and names/titles so the Word output keeps
     the document's structure instead of one flat list of paragraphs. */
  function isHeadingLine(line) {
    var t = String(line || '').trim();
    if (!t || t.length > 45) return false;
    if (SECTION_WORDS.test(t.replace(/[:.]+$/, '').trim())) return true;
    var letters = (t.match(/[A-Za-z]/g) || []).length;
    if (letters >= 3 && t === t.toUpperCase() && /[A-Z]/.test(t) && !/\d{4,}/.test(t)) return true;
    return false;
  }
  function toDocxItems(lines) {
    return lines.map(function (line) {
      var t = String(line).trim();
      if (!t) return { text: '' };
      if (isHeadingLine(t)) return { text: t, heading: true };
      return { text: t };
    });
  }
  function buildDocxXml(paragraphs) {
    var body = paragraphs.map(function (p) {
      var item = typeof p === 'string' ? { text: p } : p;
      var text = String(item.text == null ? '' : item.text);
      if (!text.trim()) return '<w:p/>';
      if (item.heading) {
        return '<w:p><w:pPr><w:spacing w:before="240" w:after="80"/><w:keepNext/></w:pPr>' +
          '<w:r><w:rPr><w:b/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr>' +
          '<w:t xml:space="preserve">' + escapeXml(text) + '</w:t></w:r></w:p>';
      }
      return '<w:p><w:r><w:t xml:space="preserve">' + escapeXml(text) + '</w:t></w:r></w:p>';
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
  async function buildDocxZip(documentXml) {
    needLib('jszip');
    var zip = new global.JSZip();
    zip.file('[Content_Types].xml', DOCX_CONTENT_TYPES);
    zip.file('_rels/.rels', DOCX_RELS);
    zip.file('word/document.xml', documentXml);
    zip.file('word/_rels/document.rels', DOCX_WORD_RELS);
    zip.file('word/styles.xml', DOCX_STYLES);
    zip.file('docProps/core.xml', DOCX_CORE);
    return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  }
  async function buildDocxBlob(paragraphs) {
    return buildDocxZip(buildDocxXml(paragraphs));
  }
  /* Layout-preserving Word output: every line becomes an absolutely
     positioned text box at its original PDF coordinates, on a page of
     the PDF's own size, with its font size, bold/italic and font kept.
     Text stays fully editable — each box holds real text, not an image. */
  function buildLayoutDocxXml(pages) {
    var shapeId = 0;
    var parts = [];
    parts.push('<w:p><w:r><w:pict><v:shapetype id="_x0000_t202" coordsize="21600,21600" o:spt="202" path="m,l,21600r21600,l21600,xe"><v:stroke joinstyle="miter"/><v:path gradientshapeok="t" o:connecttype="rect"/></v:shapetype></w:pict></w:r></w:p>');
    pages.forEach(function (pg, pi) {
      pg.lines.forEach(function (line) {
        shapeId++;
        /* Letter-spaced headings (common in CV templates: "C O N T A C T")
           store their spacing as glyph positions, not characters, so the
           extracted text looks joined in Word. When a line's span is much
           wider than its text, spread the letters with character spacing
           so it looks the way it did in the PDF. */
        var chars = line.text.replace(/ /g, '').length;
        var spaces = line.text.length - chars;
        var letters = (line.text.match(/[A-Za-z]/g) || []).length;
        var caps = (line.text.match(/[A-Z]/g) || []).length;
        var capsRatio = letters ? caps / letters : 0;
        var charFactor = 0.5 + 0.18 * capsRatio; /* capitals are wider */
        var expected = (chars * charFactor + spaces * 0.25) * line.size;
        var spacingTwips = 0;
        if (chars >= 3 && line.w > expected * 1.25) {
          var gaps = Math.max(1, line.text.length - 1);
          spacingTwips = Math.min(160, Math.max(0, Math.round((line.w - expected) / gaps * 20)));
        }
        var x = Math.max(0, Math.min(line.x, pg.width - 20)).toFixed(1);
        var y = Math.max(0, line.y).toFixed(1);
        /* Generous box: font substitution in Word can render text wider
           than in the PDF, and a too-narrow box clips the end of a line.
           Clamped so the box never runs off the page edge. */
        var w = Math.max(10, Math.min(line.w * 1.2 + 12, pg.width - parseFloat(x) - 2)).toFixed(1);
        var h = (line.size * 1.5).toFixed(1);
        var rPr = '';
        if (line.font) rPr += '<w:rFonts w:ascii="' + escapeXml(line.font) + '" w:hAnsi="' + escapeXml(line.font) + '"/>';
        if (line.bold) rPr += '<w:b/>';
        if (line.italic) rPr += '<w:i/>';
        if (spacingTwips > 0) rPr += '<w:spacing w:val="' + spacingTwips + '"/>';
        rPr += '<w:sz w:val="' + Math.round(line.size * 2) + '"/><w:szCs w:val="' + Math.round(line.size * 2) + '"/>';
        parts.push(
          '<w:p><w:pPr><w:spacing w:after="0" w:before="0" w:line="40" w:lineRule="exact"/></w:pPr>' +
          '<w:r><w:pict>' +
          '<v:shape id="tf' + shapeId + '" type="#_x0000_t202" style="position:absolute;left:' + x + 'pt;top:' + y + 'pt;width:' + w + 'pt;height:' + h + 'pt;mso-position-horizontal-relative:page;mso-position-vertical-relative:page" filled="f" stroked="f">' +
          '<v:textbox inset="0,0,0,0"><w:txbxContent><w:p><w:pPr><w:spacing w:after="0" w:before="0" w:line="240" w:lineRule="auto"/></w:pPr>' +
          '<w:r><w:rPr>' + rPr + '</w:rPr><w:t xml:space="preserve">' + escapeXml(line.text) + '</w:t></w:r>' +
          '</w:p></w:txbxContent></v:textbox></v:shape>' +
          '</w:pict></w:r></w:p>'
        );
      });
      if (pi < pages.length - 1) {
        /* Section break carrying this page's size, so mixed page sizes keep working. */
        parts.push('<w:p><w:pPr><w:sectPr><w:pgSz w:w="' + Math.round(pg.width * 20) + '" w:h="' + Math.round(pg.height * 20) + '"/><w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0" w:header="0" w:footer="0" w:gutter="0"/><w:type w:val="nextPage"/></w:sectPr></w:pPr></w:p>');
      }
    });
    var last = pages[pages.length - 1] || { width: 595, height: 842 };
    parts.push('<w:sectPr><w:pgSz w:w="' + Math.round(last.width * 20) + '" w:h="' + Math.round(last.height * 20) + '"/><w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">' +
      '<w:body>' + parts.join('') + '</w:body></w:document>';
  }
  async function buildLayoutDocxBlob(pages) {
    return buildDocxZip(buildLayoutDocxXml(pages));
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
  /* Grayscale + contrast stretch: helps Tesseract on photos and faint scans. */
  function prepCanvas(src) {
    var out = document.createElement('canvas');
    out.width = src.width; out.height = src.height;
    var ctx = out.getContext('2d');
    ctx.drawImage(src, 0, 0);
    try {
      var img = ctx.getImageData(0, 0, out.width, out.height);
      var d = img.data;
      var lo = 40, hi = 210;
      for (var i = 0; i < d.length; i += 4) {
        var lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        var v = (lum - lo) * 255 / (hi - lo);
        v = v < 0 ? 0 : (v > 255 ? 255 : v);
        d[i] = d[i + 1] = d[i + 2] = v;
      }
      ctx.putImageData(img, 0, 0);
    } catch (e) { /* canvas unreadable — use the original pixels */ }
    return out;
  }
  /* Drop OCR noise: icon misreads and separator lines. Blank separators
     between layout blocks are preserved (collapsed to one). */
  function cleanOcrLines(lines) {
    var out = [];
    lines.forEach(function (raw) {
      var l = String(raw).replace(/\s+/g, ' ').trim();
      if (!l) {
        if (out.length && out[out.length - 1] !== '') out.push('');
        return;
      }
      var alnum = (l.match(/[A-Za-z0-9]/g) || []).length;
      if (alnum === 0) return;
      if (alnum <= 1 && l.length <= 6 && l.indexOf('+') === -1 && l.indexOf('#') === -1) return;
      if (l.length <= 3 && alnum <= 2 && l.indexOf('+') === -1 && l.indexOf('#') === -1) return;
      out.push(l);
    });
    while (out.length && out[0] === '') out.shift();
    while (out.length && out[out.length - 1] === '') out.pop();
    return out;
  }

  /* Read the text of every page. Pages with no selectable text (scanned /
     image-only pages) are read automatically with OCR (Tesseract.js),
     so scanned PDFs work too. onPage(pageNum, total, label) reports progress. */
  /* Read every page once: positioned boxes (with style info) from the
     text layer, or from OCR when a page has no text layer. Consumers
     either order the boxes into reading order (text/Excel) or lay them
     out at their original positions (Word with layout kept). */
  async function pdfPages(file, onPage) {
    var pdf = await loadPdfJs(file);
    var pages = [];
    var ocrWorker = null;
    var ocrTried = false;
    async function ocrPageBoxes(page, pageNum, total) {
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
      var ret = await ocrWorker.recognize(prepCanvas(canvas));
      var words = (ret && ret.data && ret.data.words) || [];
      var boxes = boxesFromOcrWords(words, 2);
      var fallbackLines = [];
      if (!boxes.length) {
        var text = (ret && ret.data && ret.data.text) || '';
        fallbackLines = text.split(/\n/).map(function (l) { return l.trim(); }).filter(function (l) { return l !== ''; });
      }
      return { boxes: boxes, fallbackLines: fallbackLines };
    }
    try {
      for (var p = 1; p <= pdf.numPages; p++) {
        var page = await pdf.getPage(p);
        var vp = page.getViewport({ scale: 1 });
        var content = await page.getTextContent();
        var boxes = boxesFromTextItems(content.items, vp.height, content.styles);
        var isOcr = false, fallbackLines = [];
        if (!boxes.length) {
          try {
            var ocr = await ocrPageBoxes(page, p, pdf.numPages);
            boxes = ocr.boxes; fallbackLines = ocr.fallbackLines; isOcr = true;
          } catch (ocrErr) {
            /* OCR unavailable (e.g. no network for the language data) —
               keep the page empty; the tool reports clearly if ALL pages
               end up empty. */
            boxes = [];
          }
        }
        pages.push({ width: vp.width, height: vp.height, boxes: boxes, fallbackLines: fallbackLines, isOcr: isOcr });
        if (onPage) onPage(p, pdf.numPages);
      }
    } finally {
      if (ocrWorker) { try { await ocrWorker.terminate(); } catch (e) { /* ignore */ } }
    }
    return { numPages: pdf.numPages, pages: pages };
  }

  async function pdfPagesText(file, onPage) {
    var result = await pdfPages(file, onPage);
    var pages = result.pages.map(function (pg) {
      if (pg.boxes.length) {
        var lines = xyCut(pg.boxes, 0);
        return pg.isOcr ? cleanOcrLines(lines) : lines;
      }
      return pg.isOcr ? cleanOcrLines(pg.fallbackLines) : pg.fallbackLines;
    });
    return { numPages: result.numPages, pages: pages };
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
    var keepLayout = !opts || opts.keepLayout !== false;
    if (keepLayout) {
      /* Layout mode (default): every line keeps its original position,
         size, bold/italic and font — CVs and two-column layouts look
         the same in Word as they did in the PDF. */
      var layout = await pdfPages(file, function (p, total, label) { prog(p / total * 0.8, label || ('Reading page ' + p + ' of ' + total + '...')); });
      var layoutPages = layout.pages.map(function (pg) {
        var lines = pg.boxes.length ? layoutLinesFromBoxes(pg.boxes, pg.isOcr) : [];
        if (!lines.length && pg.fallbackLines.length) {
          lines = pg.fallbackLines.map(function (t, i) {
            return { text: t, x: 36, y: 36 + i * 18, w: pg.width - 72, size: 11, bold: false, italic: false, font: '' };
          });
        }
        return { width: pg.width, height: pg.height, lines: lines };
      });
      if (!layoutPages.some(function (pg) { return pg.lines.length; })) {
        throw new Error('No readable text was found in this PDF, even after scanning the pages as images. The scan may be too blurry, handwritten, or the text too small to read.');
      }
      prog(0.9, 'Building the Word document...');
      var layoutBlob = await buildLayoutDocxBlob(layoutPages);
      return { files: [{ name: baseOf(file.name) + '.docx', blob: layoutBlob }] };
    }
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
    var blob = await buildDocxBlob(toDocxItems(paragraphs));
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
    var blob = await buildDocxBlob(toDocxItems(text.split(/\n/)));
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
  async function toolResizeImage(files, opts, prog) {
    var file = files[0]; assertSize(file);
    var img = await loadImage(await readDataURL(file));
    var srcW = img.naturalWidth, srcH = img.naturalHeight;
    var mode = opts.mode || 'percent';
    var newW, newH;
    if (mode === 'pixels') {
      var w = parseInt(opts.width, 10) || 0, h = parseInt(opts.height, 10) || 0;
      if (!w && !h) throw new Error('Enter a width, a height, or both.');
      if (opts.keepAspect !== false) {
        if (w && h) { var r = Math.min(w / srcW, h / srcH); newW = Math.round(srcW * r); newH = Math.round(srcH * r); }
        else if (w) { newW = w; newH = Math.round(srcH * w / srcW); }
        else { newH = h; newW = Math.round(srcW * h / srcH); }
      } else {
        newW = w || srcW; newH = h || srcH;
      }
    } else {
      var pct = parseFloat(opts.percent || '50') || 50;
      if (pct <= 0 || pct > 1000) throw new Error('Percentage must be between 1 and 1000.');
      newW = Math.max(1, Math.round(srcW * pct / 100));
      newH = Math.max(1, Math.round(srcH * pct / 100));
    }
    if (newW > 8000 || newH > 8000) throw new Error('The resized image is too large (max 8000 px on a side).');
    prog(0.4, 'Resizing to ' + newW + ' x ' + newH + ' px...');
    var canvas = document.createElement('canvas');
    canvas.width = newW; canvas.height = newH;
    var ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    var format = opts.format || 'keep';
    var ext = (file.name.split('.').pop() || '').toLowerCase();
    var target = format === 'keep' ? (ext === 'jpg' || ext === 'jpeg' ? 'jpg' : (ext === 'webp' ? 'webp' : 'png')) : format;
    if (target === 'jpg') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, newW, newH); }
    ctx.drawImage(img, 0, 0, newW, newH);
    var quality = parseFloat(opts.quality || '0.92') || 0.92;
    var mime = target === 'jpg' ? 'image/jpeg' : (target === 'webp' ? 'image/webp' : 'image/png');
    var blob = await canvasToBlob(canvas, mime, quality);
    return { files: [{ name: baseOf(file.name) + '-' + newW + 'x' + newH + '.' + target, blob: blob }] };
  }

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
    'resize-image': { libs: [], run: toolResizeImage },
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
      escapeXml: escapeXml,
      isHeadingLine: isHeadingLine,
      toDocxItems: toDocxItems,
      cleanOcrLines: cleanOcrLines,
      orderBoxes: xyCut,
      boxesFromOcrWords: boxesFromOcrWords,
      boxesFromTextItems: boxesFromTextItems,
      layoutLinesFromBoxes: layoutLinesFromBoxes,
      buildLayoutDocxXml: buildLayoutDocxXml,
      isNoiseLine: isNoiseLine
    }
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = global.TrustFile;
  }
})(typeof window !== 'undefined' ? window : globalThis);
