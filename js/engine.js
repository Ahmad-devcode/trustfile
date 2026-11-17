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
    docxpreview: {
      urls: [
        'https://cdn.jsdelivr.net/npm/docx-preview@0.3.7/dist/docx-preview.js',
        'https://unpkg.com/docx-preview@0.3.7/dist/docx-preview.js'
      ],
      check: function () { return !!(global.docx && global.docx.renderAsync); }
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
    },
    pptxgenjs: {
      urls: [
        'https://cdn.jsdelivr.net/npm/pptxgenjs@4.0.1/dist/pptxgen.bundle.js',
        'https://unpkg.com/pptxgenjs@4.0.1/dist/pptxgen.bundle.js'
      ],
      check: function () { return !!global.PptxGenJS; }
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
  function fmtSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(2) + ' MB';
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
    if (!/^[A-Za-z][A-Za-z0-9 ]*$/.test(name)) return '';
    /* PDF base-14 font names have no Word equivalent under the same name;
       map them to the metric-compatible Word fonts. Symbol/dingbat fonts
       carry no readable text, so they fall back to the default. */
    var lower = name.toLowerCase().replace(/[\s_]/g, '');
    if (lower.indexOf('times') === 0) return 'Times New Roman';
    if (lower.indexOf('helvetica') === 0) return 'Arial';
    if (lower.indexOf('courier') === 0) return 'Courier New';
    if (lower.indexOf('symbol') === 0 || lower.indexOf('zapfdingbats') === 0) return '';
    return name;
  }
  /* ---- Letter-spaced heading repair (Canva-style PDFs) ----
     Canva emits headings glyph-by-glyph (one showText per glyph, with
     moveText advances), including REAL space glyphs at word boundaries.
     pdf.js getTextContent collapses that into one item with a uniform
     space between every glyph ("S A L E ' S M A N ..."), erasing word
     boundaries. The operator list still carries the true glyph stream,
     so for items that are all single characters we match them against
     the glyph blocks and restore the real words — plus the per-gap
     letter-spacing, recovered from the item width minus the true glyph
     advances, so the heading still renders spread out. */
  function despaceKey(s) {
    return String(s || '').replace(/[\s\u200B-\u200D\uFEFF]+/g, '');
  }
  function glyphBlocksFromOps(fnArray, argsArray, OPS) {
    var blocks = [];
    var cur = null;
    function flush() { if (cur && cur.glyphs.length) blocks.push(cur); cur = null; }
    /* The text-showing op carrying the string differs per op
       (showText: args[0]; nextLineSetSpacingShowText: args[2]). */
    function textArg(args) {
      for (var i = 0; i < args.length; i++) {
        if (typeof args[i] === 'string' || (args[i] && args[i].length !== undefined)) return args[i];
      }
      return null;
    }
    for (var i = 0; i < fnArray.length; i++) {
      var fn = fnArray[i], args = argsArray[i] || [];
      if (fn === OPS.beginText || fn === OPS.setTextMatrix || fn === OPS.setTextLineMatrix) { flush(); cur = { glyphs: [] }; }
      else if (fn === OPS.endText) { flush(); }
      else if (fn === OPS.showText || fn === OPS.showSpacedText || fn === OPS.nextLineShowText || fn === OPS.nextLineSetSpacingShowText) {
        if (!cur) cur = { glyphs: [] };
        var arr = textArg(args);
        if (typeof arr === 'string') {
          for (var s = 0; s < arr.length; s++) cur.glyphs.push({ ch: arr[s], w: 0 });
        } else if (arr) {
          for (var g = 0; g < arr.length; g++) {
            var el = arr[g];
            if (typeof el === 'string') {
              for (var k = 0; k < el.length; k++) cur.glyphs.push({ ch: el[k], w: 0 });
            } else if (el && typeof el === 'object' && typeof el.unicode === 'string') {
              cur.glyphs.push({ ch: el.unicode, w: parseFloat(el.width) || 0 });
            }
            /* Numbers in a TJ array are kerning adjustments — ignored:
               word boundaries come from the space glyphs themselves. */
          }
        }
      }
    }
    flush();
    return blocks.map(function (b) {
      var text = b.glyphs.map(function (g) { return g.ch; }).join('');
      var widthSum = 0, haveWidths = true;
      b.glyphs.forEach(function (g) { if (!g.w) haveWidths = false; widthSum += g.w; });
      return { text: text, key: despaceKey(text), widthSum: widthSum, haveWidths: haveWidths, glyphs: b.glyphs.length };
    }).filter(function (b) { return b.key !== ''; });
  }
  async function repairSpacedItems(page, items) {
    var opList = await page.getOperatorList();
    var blocks = glyphBlocksFromOps(opList.fnArray, opList.argsArray, global.pdfjsLib.OPS);
    var byKey = {};
    blocks.forEach(function (b) { if (!byKey[b.key]) byKey[b.key] = b; });
    items.forEach(function (it) {
      var str = String(it.str || '');
      if (!isAlreadySpaced(str)) return;
      var block = byKey[despaceKey(str)];
      /* Only repair when the glyph stream carries REAL word spaces —
         a spaceless block means the producer gave no word boundaries,
         and the uniform-spread rendering is the honest fallback. */
      if (!block || block.text.indexOf(' ') === -1 || block.text === str) return;
      it.str = block.text;
      if (block.haveWidths && typeof it.width === 'number' && it.width > 0 && block.glyphs > 1) {
        var size = Math.abs(it.transform[3]) || Math.abs(it.transform[0]) || 10;
        var advance = block.widthSum / 1000 * size;
        var spacing = (it.width - advance) / (block.glyphs - 1);
        if (spacing > 0 && isFinite(spacing)) it._spacing = Math.min(8, spacing);
      }
    });
  }
  /* Extract the painted string from a text-showing op's args: a plain
     string, or a TJ array of strings and {unicode, width} glyphs. */
  function showTextString(args) {
    var arr = null;
    for (var i = 0; i < args.length; i++) {
      if (typeof args[i] === 'string' || (args[i] && args[i].length !== undefined)) { arr = args[i]; break; }
    }
    if (arr == null) return '';
    if (typeof arr === 'string') return arr;
    var s = '';
    for (var g = 0; g < arr.length; g++) {
      var el = arr[g];
      if (typeof el === 'string') s += el;
      else if (el && typeof el === 'object' && typeof el.unicode === 'string') s += el.unicode;
    }
    return s;
  }
  /* Recover text colour: pdf.js getTextContent drops colour, but the
     operator list still sets the fill colour before each showText op.
     Walk the ops tracking the current fill (with the q/Q stack), record
     each painted string with its colour, then match them to the text
     items in order — merging consecutive shows when one item spans
     several, as pdf.js merges same-state fragments. Items that cannot
     be matched keep the default colour: a missing colour is always
     safer than a wrong one. */
  async function colorizeTextItems(page, items) {
    var opList = await page.getOperatorList();
    var OPS = global.pdfjsLib.OPS;
    var fill = { r: 0, g: 0, b: 0 };
    var stack = [];
    var shows = [];
    for (var i = 0; i < opList.fnArray.length; i++) {
      var fn = opList.fnArray[i], args = opList.argsArray[i] || [];
      if (fn === OPS.save) stack.push(fill);
      else if (fn === OPS.restore) { var s = stack.pop(); if (s) fill = s; }
      else if (fn === OPS.setFillRGBColor) fill = rgbFromColorArgs('rgb', args);
      else if (fn === OPS.setFillGray) fill = rgbFromColorArgs('gray', args);
      else if (fn === OPS.setFillCMYKColor) fill = rgbFromColorArgs('cmyk', args);
      else if (fn === OPS.showText || fn === OPS.showSpacedText || fn === OPS.nextLineShowText || fn === OPS.nextLineSetSpacingShowText) {
        var key = despaceKey(showTextString(args));
        if (key) shows.push({ key: key, color: rgbHex(fill) });
      }
    }
    var si = 0;
    items.forEach(function (it) {
      var key = despaceKey(it.str);
      if (!key) return;
      var acc = '', j = si, firstColor = null, mixed = false;
      while (j < shows.length && acc.length < key.length) {
        var sh = shows[j++];
        if (!firstColor) firstColor = sh.color;
        else if (sh.color !== firstColor) mixed = true;
        acc += sh.key;
      }
      if (acc === key) {
        si = j;
        if (!mixed && firstColor && firstColor !== '000000') it._color = firstColor;
        return;
      }
      for (var k = si; k < shows.length; k++) {
        if (shows[k].key === key) { si = k + 1; if (shows[k].color !== '000000') it._color = shows[k].color; return; }
      }
    });
  }
  /* Symbol/OpenSymbol list markers (LibreOffice bullets) arrive from
     pdf.js as private-use characters (U+F0B7) that render as empty
     boxes in Word and PowerPoint with ordinary fonts — the font table
     reports them as "monospace", so the character itself is the only
     reliable signal. Map the known bullet code points to a real
     bullet; every other character passes through untouched. */
  function normalizePdfText(str) {
    return String(str || '').replace(/[\uF0B7\uF0A7]/g, '\u2022');
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
        text: normalizePdfText(it.str),
        x0: x0, x1: x0 + itemWidth(it),
        y1: ph - yBottom,
        y0: ph - yBottom - size,
        size: size,
        bold: /bold/i.test(fontLabel),
        italic: /italic|oblique/i.test(fontLabel),
        font: cleanFontName(styleInfo.fontFamily || it.fontName),
        color: it._color || null, /* fill colour recovered from the operator list, if any */
        spacing: it._spacing || 0 /* letter-spacing recovered from the glyph stream, if any */
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
        bold: false, italic: false, font: '',
        conf: (typeof w.confidence === 'number' ? w.confidence : 100)
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
  /* ---- Table rows for PDF to Excel ----
     XY-cut reading order is right for prose but destroys tables: it
     splits a table's columns apart and emits them column-major. For a
     spreadsheet, group boxes into rows by shared baseline and split
     each row into cells where the horizontal gap is wide — but only
     when the page actually looks like a grid (column starts that line
     up across rows, and a consistent cell count). Prose and
     free-flowing two-column layouts fall back to XY-cut reading order,
     so resumes never regress. */
  function groupRowsByBaseline(boxes) {
    var sorted = boxes.slice().sort(function (a, b) { return (a.y0 - b.y0) || (a.x0 - b.x0); });
    var rows = [];
    sorted.forEach(function (b) {
      var row = null;
      for (var i = rows.length - 1; i >= 0; i--) {
        var r = rows[i];
        var yOverlap = Math.min(b.y1, r.y1) - Math.max(b.y0, r.y0);
        var minH = Math.min(b.y1 - b.y0, r.y1 - r.y0);
        if (yOverlap > minH * 0.4) { row = r; break; }
      }
      if (row) {
        row.boxes.push(b);
        row.x0 = Math.min(row.x0, b.x0); row.x1 = Math.max(row.x1, b.x1);
        row.y0 = Math.min(row.y0, b.y0); row.y1 = Math.max(row.y1, b.y1);
      } else {
        rows.push({ x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, boxes: [b] });
      }
    });
    return rows;
  }
  /* Split one baseline row into cells on wide x-gaps. Returns
     { cells: [text], starts: [x0 of each cell] }. */
  function splitRowCells(rowBoxes, gapThreshold) {
    var words = rowBoxes.slice().sort(function (a, b) { return a.x0 - b.x0; });
    var groups = [[words[0]]];
    for (var i = 1; i < words.length; i++) {
      if (words[i].x0 - words[i - 1].x1 > gapThreshold) groups.push([words[i]]);
      else groups[groups.length - 1].push(words[i]);
    }
    return {
      cells: groups.map(function (g) {
        return g.map(function (b) { return b.text; }).join(' ').replace(/\s+/g, ' ').trim();
      }),
      starts: groups.map(function (g) { return g[0].x0; })
    };
  }
  /* Cluster x-starts within `tol` points; returns cluster sizes. */
  function clusterStarts(starts, tol) {
    var sorted = starts.slice().sort(function (a, b) { return a - b; });
    var clusters = [];
    sorted.forEach(function (x) {
      var last = clusters[clusters.length - 1];
      if (last && x - last.anchor <= tol) { last.count++; }
      else clusters.push({ anchor: x, count: 1 });
    });
    return clusters.map(function (c) { return c.count; });
  }
  /* Rows for one PDF page in a spreadsheet: a grid when the page looks
     like a table, otherwise XY-cut reading order (one column). */
  function excelRowsFromPage(pg) {
    var boxes = pg.boxes;
    if (!boxes.length) return pg.fallbackLines.map(function (l) { return [l]; });
    var medH = medianHeight(boxes) || 10;
    var gapThreshold = Math.max(6, medH * 0.75);
    var rows = groupRowsByBaseline(boxes);
    var split = rows.map(function (r) { return splitRowCells(r.boxes, gapThreshold); });
    var multi = split.filter(function (s) { return s.cells.length > 1; });
    /* Grid test, on NON-first column starts only: first-cell starts
       always cluster at the left margin, which would misread prose as
       a grid. A real grid has aligned later columns and a consistent
       cell count; word-by-word prose splits too, but its starts never
       align and its cell counts vary wildly. */
    var laterStarts = [];
    split.forEach(function (s) { for (var i = 1; i < s.starts.length; i++) laterStarts.push(s.starts[i]); });
    var clusters = clusterStarts(laterStarts, 10);
    var strongCols = clusters.filter(function (n) { return n >= 3; }).length;
    var weakCols = clusters.filter(function (n) { return n >= 2; }).length;
    var counts = {};
    multi.forEach(function (s) { counts[s.cells.length] = (counts[s.cells.length] || 0) + 1; });
    var modal = 0, modalN = 0, maxCells = 0;
    Object.keys(counts).forEach(function (k) { if (counts[k] > modalN) { modalN = counts[k]; modal = parseInt(k, 10); } });
    multi.forEach(function (s) { maxCells = Math.max(maxCells, s.cells.length); });
    var modalShare = multi.length ? modalN / multi.length : 0;
    /* A table's rows share a cell count; word-by-word prose (Canva CVs)
       splits one line into many cells next to two-cell rows — the
       max-cells check rejects that shape even when its columns align. */
    var isGrid = multi.length >= 2 && modal <= 8 && modalShare >= 0.5 && maxCells <= modal + 1 &&
      (strongCols >= 2 || weakCols >= 2 || (strongCols >= 1 && multi.length >= 3 && multi.length / split.length >= 0.6));
    if (!isGrid) {
      var lines = xyCutLines(groupLines(boxes), 0);
      if (pg.isOcr) lines = cleanOcrLines(lines);
      return lines.map(function (l) { return [l]; });
    }
    var maxCols = Math.max.apply(null, split.map(function (s) { return s.cells.length; }));
    var out = [];
    split.forEach(function (s) {
      if (pg.isOcr && isNoiseLine(s.cells.join(' '))) return;
      var row = s.cells.slice();
      while (row.length < maxCols) row.push('');
      out.push(row);
    });
    return out;
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
    /* OCR reads photos and decorations as garbage words ("mm eo oO") with
       low confidence — drop them before grouping so they cannot overlap
       real text. Real words on readable scans score well above this. */
    var usable = isOcr ? boxes.filter(function (b) { return b.conf === undefined || b.conf >= 30; }) : boxes;
    if (isOcr && usable.length && usable.length < boxes.length) boxes = usable;
    var lines = mergeRowFragments(groupLines(boxes));
    var styled = lines.map(function (line) {
      var words = line.boxes.slice().sort(function (a, b) { return a.x0 - b.x0; });
      /* Build the line text exactly as before (words joined with single
         spaces, whitespace collapsed, trimmed) while tracking which box
         each character came from, so the line can split into per-word
         runs wherever size/bold/italic/font/colour changes. A mixed
         line keeps every word's own formatting instead of collapsing
         to one style (which used to bleed bold across the whole line). */
      var chars = [];
      words.forEach(function (b, bi) {
        var t = String(b.text || '').replace(/\s+/g, ' ');
        for (var k = 0; k < t.length; k++) chars.push({ ch: t[k], box: bi });
        if (bi < words.length - 1) chars.push({ ch: ' ', box: bi });
      });
      var collapsed = [];
      chars.forEach(function (c) {
        if (c.ch === ' ' && collapsed.length && collapsed[collapsed.length - 1].ch === ' ') return;
        collapsed.push(c);
      });
      while (collapsed.length && collapsed[0].ch === ' ') collapsed.shift();
      while (collapsed.length && collapsed[collapsed.length - 1].ch === ' ') collapsed.pop();
      var text = collapsed.map(function (c) { return c.ch; }).join('');
      var runs = [];
      collapsed.forEach(function (c) {
        var b = words[c.box];
        var styleKey = [b.size || 0, b.bold ? 1 : 0, b.italic ? 1 : 0, b.font || '', b.color || ''].join('|');
        var last = runs[runs.length - 1];
        if (last && last.key === styleKey) { last.text += c.ch; }
        else runs.push({ key: styleKey, text: c.ch, size: b.size || 0, bold: !!b.bold, italic: !!b.italic, font: b.font || '', color: b.color || null });
      });
      runs.forEach(function (r) { delete r.key; });
      var size = 0, bold = false, italic = false;
      var fonts = {};
      var colors = {};
      words.forEach(function (b) {
        size = Math.max(size, b.size || 0);
        if (b.bold) bold = true;
        if (b.italic) italic = true;
        if (b.font) fonts[b.font] = (fonts[b.font] || 0) + 1;
        if (b.color) colors[b.color] = (colors[b.color] || 0) + String(b.text || '').length;
      });
      var font = '';
      Object.keys(fonts).forEach(function (f) { if (!font || fonts[f] > fonts[font]) font = f; });
      var color = null;
      Object.keys(colors).forEach(function (c) { if (!color || colors[c] > colors[color]) color = c; });
      /* Letter-spacing recovered from the glyph stream belongs to one
         box (a heading); only carry it when the line is that one box,
         so a repaired heading never spreads its neighbours. */
      var spacing = words.length === 1 ? (words[0].spacing || 0) : 0;
      return { text: text, x: line.x0, y: line.y0, w: Math.max(10, line.x1 - line.x0), size: size || 11, bold: bold, italic: italic, font: font, color: color, runs: runs, spacing: spacing };
    }).filter(function (l) { return l.text !== '' && (!isOcr || (!isNoiseLine(l.text) && !isFragmentLine(l.text))); });
    /* Headings read bold even when the font name does not say so. The
       line-level flag stays for single-style consumers; runs get the
       same treatment individually so a big word bolds without bolding
       its smaller neighbours. */
    var sizes = styled.map(function (l) { return l.size; }).sort(function (a, b) { return a - b; });
    var median = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 11;
    styled.forEach(function (l) {
      if (l.size >= median * 1.25) {
        l.bold = true;
        l.runs.forEach(function (r) { if (r.size >= median * 1.25) r.bold = true; });
      }
    });
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
  async function buildDocxZip(documentXml, media) {
    needLib('jszip');
    var zip = new global.JSZip();
    var contentTypes = DOCX_CONTENT_TYPES;
    var wordRels = DOCX_WORD_RELS;
    if (media && media.length) {
      var exts = {};
      media.forEach(function (m) { exts[m.ext] = m.contentType; });
      var defaults = Object.keys(exts).map(function (e) { return '<Default Extension="' + e + '" ContentType="' + exts[e] + '"/>'; }).join('');
      contentTypes = contentTypes.replace('</Types>', defaults + '</Types>');
      var relsXml = media.map(function (m) {
        return '<Relationship Id="' + m.relId + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="' + m.partName + '"/>';
      }).join('');
      wordRels = wordRels.replace('</Relationships>', relsXml + '</Relationships>');
      media.forEach(function (m) { zip.file('word/' + m.partName, m.base64, { base64: true }); });
    }
    zip.file('[Content_Types].xml', contentTypes);
    zip.file('_rels/.rels', DOCX_RELS);
    zip.file('word/document.xml', documentXml);
    /* The relationships part for word/document.xml lives at
       word/_rels/document.xml.rels (OOXML standard) — image references
       only resolve from this exact path. */
    zip.file('word/_rels/document.xml.rels', wordRels);
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
  /* Rough rendered width of a line of text (points), for box sizing and
     letter-spacing detection. Capitals are wider than lowercase. */
  function estTextWidthPt(text, size) {
    var chars = text.replace(/ /g, '').length;
    var spaces = text.length - chars;
    var letters = (text.match(/[A-Za-z]/g) || []).length;
    var caps = (text.match(/[A-Z]/g) || []).length;
    var capsRatio = letters ? caps / letters : 0;
    var charFactor = 0.55 + 0.17 * capsRatio;
    return (chars * charFactor + spaces * 0.25) * size;
  }

  /* Canva-style headings store their letter-spacing as literal spaces:
     "S A L E ' S M A N". The spread is already in the string, so adding
     character spacing on top would spread it twice. */
  function isAlreadySpaced(text) {
    var tokens = String(text).trim().split(/\s+/).filter(Boolean);
    if (tokens.length < 4) return false;
    var singles = tokens.filter(function (t) { return t.length === 1; }).length;
    return singles / tokens.length > 0.6;
  }

  /* Letter-spaced headings (common in CV templates: "C O N T A C T") store
     their spacing as glyph positions, not characters, so the extracted
     text looks joined in Word/PowerPoint. When a line's span is much
     wider than its text, return the extra spacing per character (points)
     so it can be rendered spread out the way it looked in the PDF. */
  function letterSpacingPts(line) {
    /* Spacing recovered from the PDF's glyph stream (letter-spaced
       heading repair) always wins over the width heuristic below. */
    if (line.spacing && line.spacing > 0) return Math.min(8, line.spacing);
    if (isAlreadySpaced(line.text)) return 0;
    var chars = line.text.replace(/ /g, '').length;
    var expected = estTextWidthPt(line.text, line.size);
    if (chars < 3 || line.w <= expected * 1.25) return 0;
    var gaps = Math.max(1, line.text.length - 1);
    return Math.min(8, Math.max(0, (line.w - expected) / gaps));
  }

  /* Fit each line's box: wide enough for its rendered text, but never
     running into the next box on the same row (the next column) — a long
     line in a narrow column wraps inside its own box instead of painting
     over the neighbour, the way it wrapped in the PDF. A line that would
     wrap and spill onto the row below (rows in a CV sit ~13pt apart, so
     a wrapped line always collides with the next row) instead shrinks its
     font a little until it fits on one line — never more than 20%
     smaller, and only when it actually overflows its column. Returns a
     parallel array of { w, h, size, wraps }. */
  function fitLineBoxes(lines, pageWidth, graphics) {
    return lines.map(function (line) {
      var x = Math.max(0, Math.min(line.x, pageWidth - 20));
      var rightLimit = pageWidth;
      lines.forEach(function (other) {
        if (other === line || other.x <= line.x) return;
        var yOverlap = Math.min(line.y + line.size, other.y + other.size) - Math.max(line.y, other.y);
        var minH = Math.min(line.size, other.size);
        if (yOverlap > minH * 0.3) rightLimit = Math.min(rightLimit, other.x - 4);
      });
      /* Table borders and panel edges are graphic boundaries: a line
         inside a table cell must not grow past the cell's right border
         just because no other text box sits to its right (the old code
         let table text spill across the border). Clamp to the nearest
         vertical graphic edge that overlaps this line's band: stroked
         segments at least a line tall (table grid lines), and tall
         rectangle edges (cell/panel borders). Short rules, highlights
         and chips are excluded by the height guards, and images are
         never boundaries — text legitimately sits on top of photos. */
      if (graphics) {
        var bandTop = line.y, bandBot = line.y + line.size;
        function edgeClamp(edgeX, top, bot) {
          if (edgeX <= x + 4) return;
          var overlap = Math.min(bandBot, bot) - Math.max(bandTop, top);
          if (overlap >= line.size * 0.5) rightLimit = Math.min(rightLimit, edgeX - 2);
        }
        (graphics.lines || []).forEach(function (ln) {
          if (ln.h > ln.w * 3 && ln.h >= line.size) edgeClamp(ln.x + ln.w / 2, ln.y, ln.y + ln.h);
        });
        (graphics.rects || []).forEach(function (r) {
          if (r.h >= line.size * 2) {
            edgeClamp(r.x, r.y, r.y + r.h);
            edgeClamp(r.x + r.w, r.y, r.y + r.h);
          }
        });
      }
      var size = line.size;
      var estW = estTextWidthPt(line.text, size);
      var avail = Math.max(20, Math.min(pageWidth - x - 2, rightLimit - x));
      var w = Math.max(10, Math.min(Math.max(line.w * 1.2 + 12, estW * 1.15 + 6), avail));
      if (estW > avail) {
        /* Shrink to fit one line. Single words cannot wrap at all, so
           they get a wider safety margin; wide characters (w, m, @)
           render wider than the average estimate. */
        var singleWord = line.text.trim().indexOf(' ') === -1;
        var margin = singleWord ? 0.9 : 0.95;
        /* Single words cannot wrap, so they shrink as far as needed;
           multi-word lines shrink at most 20% and wrap past that. */
        var floor = singleWord ? 6 : size * 0.8;
        size = Math.max(floor, Math.min(size, size * ((avail * margin) / estW)));
        estW = estTextWidthPt(line.text, size);
        w = Math.max(10, Math.min(Math.max(line.w * 1.2 + 12, estW * 1.15 + 6), avail));
      }
      var wraps = Math.min(4, Math.max(1, Math.ceil(estW / Math.max(w, 20))));
      return { w: w, h: size * 1.5 * wraps, size: size, wraps: wraps };
    });
  }
  function isFragmentLine(text) {
    var words = String(text).trim().split(/\s+/).filter(Boolean);
    if (!words.length || words.length > 3) return false;
    var alnum = (String(text).match(/[A-Za-z0-9]/g) || []).length;
    if (alnum > 6) return false;
    return words.every(function (w) { return (w.match(/[A-Za-z0-9]/g) || []).length <= 2; });
  }

  /* Merge fragments of one visual row that grouping split apart: words in
     different sizes sit on the same baseline but their boxes overlap too
     little in height to group, so they render on top of each other
     ("3 yearxperience"). Only merges when baselines align AND the boxes
     touch or overlap horizontally — justified text and columns keep
     their gaps, so they are never merged. */
  function mergeRowFragments(lines) {
    var sorted = lines.slice().sort(function (a, b) { return (a.y0 - b.y0) || (a.x0 - b.x0); });
    var merged = [];
    sorted.forEach(function (line) {
      var target = null;
      for (var i = merged.length - 1; i >= 0 && i >= merged.length - 3; i--) {
        var m = merged[i];
        var maxH = Math.max(m.y1 - m.y0, line.y1 - line.y0);
        var baselineDiff = Math.abs(m.y1 - line.y1);
        var xGap = line.x0 >= m.x1 ? line.x0 - m.x1 : (line.x1 <= m.x0 ? m.x0 - line.x1 : 0);
        if (baselineDiff <= maxH * 0.35 && xGap < 3) { target = m; break; }
      }
      if (target) {
        target.boxes = target.boxes.concat(line.boxes);
        target.x0 = Math.min(target.x0, line.x0); target.x1 = Math.max(target.x1, line.x1);
        target.y0 = Math.min(target.y0, line.y0); target.y1 = Math.max(target.y1, line.y1);
      } else {
        merged.push(line);
      }
    });
    return merged;
  }

  /* One line's runs as Word runs: each run keeps its own size (scaled by
     the line's shrink-to-fit factor), bold/italic, font and colour. */
  function lineRunsXml(line, fit, spacingTwips) {
    var scale = line.size > 0 ? fit.size / line.size : 1;
    var runs = line.runs && line.runs.length ? line.runs : [{ text: line.text, size: line.size, bold: line.bold, italic: line.italic, font: line.font, color: line.color || null }];
    return runs.map(function (run) {
      var rPr = '';
      var f = run.font || line.font;
      if (f) rPr += '<w:rFonts w:ascii="' + escapeXml(f) + '" w:hAnsi="' + escapeXml(f) + '"/>';
      if (run.bold) rPr += '<w:b/>';
      if (run.italic) rPr += '<w:i/>';
      if (run.color && /^[0-9A-Fa-f]{6}$/.test(run.color)) rPr += '<w:color w:val="' + run.color.toUpperCase() + '"/>';
      if (spacingTwips > 0) rPr += '<w:spacing w:val="' + spacingTwips + '"/>';
      var sz = Math.max(8, Math.round((run.size || line.size) * scale * 2));
      rPr += '<w:sz w:val="' + sz + '"/><w:szCs w:val="' + sz + '"/>';
      return '<w:r><w:rPr>' + rPr + '</w:rPr><w:t xml:space="preserve">' + escapeXml(run.text) + '</w:t></w:r>';
    }).join('');
  }
  /* Background graphics as DrawingML floating shapes with behindDoc:
     VML rectangles always paint ABOVE VML text boxes in LibreOffice no
     matter the document order, which hid every heading sitting on a
     colour band. DrawingML anchors with behindDoc="1" paint behind the
     text in both Word and LibreOffice (verified empirically). */
  function dmlAnchorOpen(id, x, y, w, h, z) {
    function emu(pt) { return Math.round(pt * 12700); }
    return '<w:p><w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="' + (z || 0) + '" behindDoc="1" locked="0" layoutInCell="1" allowOverlap="1">' +
      '<wp:simplePos x="0" y="0"/>' +
      '<wp:positionH relativeFrom="page"><wp:posOffset>' + emu(x) + '</wp:posOffset></wp:positionH>' +
      '<wp:positionV relativeFrom="page"><wp:posOffset>' + emu(y) + '</wp:posOffset></wp:positionV>' +
      '<wp:extent cx="' + emu(w) + '" cy="' + emu(h) + '"/>' +
      '<wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>' +
      '<wp:docPr id="' + id + '" name="TrustFile Graphic ' + id + '"/><wp:cNvGraphicFramePr/>';
  }
  function dmlAnchorClose() {
    return '</wp:anchor></w:drawing></w:r></w:p>';
  }
  function dmlRectXml(id, x, y, w, h, fillHex, strokeHex, strokeWpt, z) {
    var fill = fillHex ? '<a:solidFill><a:srgbClr val="' + fillHex + '"/></a:solidFill>' : '<a:noFill/>';
    var ln = strokeHex
      ? '<a:ln w="' + Math.round(Math.max(0.5, strokeWpt || 1) * 12700) + '"><a:solidFill><a:srgbClr val="' + strokeHex + '"/></a:solidFill></a:ln>'
      : '<a:ln><a:noFill/></a:ln>';
    return dmlAnchorOpen(id, x, y, w, h, z) +
      '<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">' +
      '<wps:wsp><wps:cNvSpPr/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + Math.round(w * 12700) + '" cy="' + Math.round(h * 12700) + '"/></a:xfrm>' +
      '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' + fill + ln +
      '</wps:spPr></wps:wsp></a:graphicData></a:graphic>' + dmlAnchorClose();
  }
  function dmlPictureXml(id, x, y, w, h, relId, z) {
    return dmlAnchorOpen(id, x, y, w, h, z) +
      '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      '<pic:pic><pic:nvPicPr><pic:cNvPr id="' + id + '" name="TrustFile Image ' + id + '"/><pic:cNvPicPr/></pic:nvPicPr>' +
      '<pic:blipFill><a:blip r:embed="' + relId + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
      '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + Math.round(w * 12700) + '" cy="' + Math.round(h * 12700) + '"/></a:xfrm>' +
      '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:ln><a:noFill/></a:ln></pic:spPr>' +
      '</pic:pic></a:graphicData></a:graphic>' + dmlAnchorClose();
  }
  function buildLayoutDocxXml(pages, graphics) {
    var shapeId = 0;
    var parts = [];
    parts.push('<w:p><w:r><w:pict><v:shapetype id="_x0000_t202" coordsize="21600,21600" o:spt="202" path="m,l,21600r21600,l21600,xe"><v:stroke joinstyle="miter"/><v:path gradientshapeok="t" o:connecttype="rect"/></v:shapetype></w:pict></w:r></w:p>');
    pages.forEach(function (pg, pi) {
      /* Background graphics first — photos, colour blocks and rules sit
         BEHIND the text boxes, at their original PDF positions. Skipped
         on OCR pages: the scan itself is the background there, and
         painting it again would double the text. */
      var g = graphics && graphics[pi];
      if (g && !pg.isOcr) {
        /* Emit in the PDF's paint order (seq), with rising relativeHeight
           so overlapping graphics stack exactly as the PDF painted them:
           a photo painted after a white panel stays visible above it. */
        var ordered = [];
        (g.rects || []).forEach(function (r) { ordered.push({ kind: 'rect', seq: r.seq || 0, item: r }); });
        (g.lines || []).forEach(function (ln) { ordered.push({ kind: 'line', seq: ln.seq || 0, item: ln }); });
        (g.images || []).forEach(function (im) { ordered.push({ kind: 'image', seq: im.seq || 0, item: im }); });
        ordered.sort(function (a, b) { return a.seq - b.seq; });
        ordered.forEach(function (entry, zi) {
          shapeId++;
          if (entry.kind === 'rect') {
            var r = entry.item;
            parts.push(dmlRectXml(shapeId, r.x, r.y, r.w, r.h,
              r.fill ? rgbHex(r.fill) : null, r.stroke ? rgbHex(r.stroke) : null, r.lineWidth, zi + 1));
          } else if (entry.kind === 'line') {
            var ln = entry.item;
            parts.push(dmlRectXml(shapeId, ln.x, ln.y, ln.w, ln.h, rgbHex(ln.color), null, 0, zi + 1));
          } else if (entry.item._relId) {
            var im = entry.item;
            parts.push(dmlPictureXml(shapeId, im.x, im.y, im.w, im.h, im._relId, zi + 1));
          }
        });
      }
      var fitted = fitLineBoxes(pg.lines, pg.width, pg.isOcr ? null : g);
      pg.lines.forEach(function (line, li) {
        shapeId++;
        /* Never spread OCR lines: OCR word boxes already carry the visual
           spacing, and their sizes are underestimated, which made the
           spacing detector spread every scanned line absurdly wide. */
        var spacingTwips = pg.isOcr ? 0 : Math.round(letterSpacingPts(line) * 20);
        var x = Math.max(0, Math.min(line.x, pg.width - 20)).toFixed(1);
        var y = Math.max(0, line.y).toFixed(1);
        var w = fitted[li].w.toFixed(1);
        var h = fitted[li].h.toFixed(1);
        parts.push(
          '<w:p><w:pPr><w:spacing w:after="0" w:before="0" w:line="40" w:lineRule="exact"/></w:pPr>' +
          '<w:r><w:pict>' +
          '<v:shape id="tf' + shapeId + '" type="#_x0000_t202" style="position:absolute;left:' + x + 'pt;top:' + y + 'pt;width:' + w + 'pt;height:' + h + 'pt;mso-position-horizontal-relative:page;mso-position-vertical-relative:page" filled="f" stroked="f">' +
          '<v:textbox inset="0,0,0,0"><w:txbxContent><w:p><w:pPr><w:spacing w:after="0" w:before="0" w:line="240" w:lineRule="auto"/></w:pPr>' +
          lineRunsXml(line, fitted[li], spacingTwips) +
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
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">' +
      '<w:body>' + parts.join('') + '</w:body></w:document>';
  }
  async function buildLayoutDocxBlob(pages, graphics) {
    /* Collect the page images into media parts (deduped: a repeated logo
       is stored once), and stamp each graphic with its relationship id
       for the document XML to reference. */
    var media = [], mediaByKey = {};
    if (graphics) {
      graphics.forEach(function (g, gi) {
        if (!g || (pages[gi] && pages[gi].isOcr)) return;
        (g.images || []).forEach(function (im) {
          if (mediaByKey[im.dataUrl]) { im._relId = mediaByKey[im.dataUrl]; return; }
          var m = /^data:([^;,]+);base64,(.*)$/.exec(im.dataUrl || '');
          if (!m) return;
          var relId = 'rId' + (media.length + 1);
          var ext = m[1] === 'image/jpeg' ? 'jpg' : 'png';
          media.push({ relId: relId, partName: 'media/image' + (media.length + 1) + '.' + ext, contentType: m[1], ext: ext, base64: m[2] });
          mediaByKey[im.dataUrl] = relId;
          im._relId = relId;
        });
      });
    }
    return buildDocxZip(buildLayoutDocxXml(pages, graphics), media.length ? media : null);
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
        /* Recover text colours from the operator list before boxing.
           Failures never block the conversion — colours stay default. */
        try { await colorizeTextItems(page, content.items); } catch (e) { /* keep the original items */ }
        /* Repair Canva-style letter-spaced headings before boxing: the
           operator list carries the true word boundaries that
           getTextContent loses. Only runs when a spaced item exists,
           and failures never block the conversion. */
        if (content.items.some(function (it) { return it.str && isAlreadySpaced(it.str); })) {
          try { await repairSpacedItems(page, content.items); } catch (e) { /* keep the original items */ }
        }
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
    /* The header row is rows[0]: show it plus maxRows data rows, so the
       truncation note counts data rows truthfully. */
    var shown = rows.slice(0, maxRows + 1);
    var css = '<style>table{border-collapse:collapse;width:100%;font-size:13px}' +
      'th,td{border:1px solid #cbd5e1;padding:7px 9px;text-align:left;vertical-align:top;word-break:break-word}' +
      'th{background:#f1f5f9;font-weight:700}tr:nth-child(even) td{background:#f8fafc}</style>';
    var html = css + '<table><thead><tr>' +
      shown[0].map(function (c) { return '<th>' + escapeHtml(c) + '</th>'; }).join('') + '</tr></thead><tbody>';
    for (var i = 1; i < shown.length; i++) {
      html += '<tr>' + shown[i].map(function (c) { return '<td>' + escapeHtml(c) + '</td>'; }).join('') + '</tr>';
    }
    html += '</tbody></table>';
    if (rows.length > maxRows + 1) {
      html += '<p style="color:#6b7280;font-size:12px">Showing the first ' + maxRows + ' of ' + (rows.length - 1) + ' data rows.</p>';
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
    var outFiles = [{ name: baseOf(file.name) + '-compressed.pdf', blob: blob }];
    var note;
    if (blob.size >= file.size) {
      /* Re-rendering a mostly-text or already-compact PDF as images can
         grow the file — say so plainly and include the original, so the
         user still leaves with the smaller file. */
      outFiles.push({ name: file.name, blob: file });
      note = 'The compressed file (' + fmtSize(blob.size) + ') is larger than the original (' + fmtSize(file.size) + ') — this PDF is mostly text or already compact, so re-rendering its pages as images grew it. The original file is included too; keep that one instead.';
    } else {
      var saved = Math.round((1 - blob.size / file.size) * 100);
      note = saved >= 1
        ? 'New size: ' + fmtSize(blob.size) + ' — about ' + saved + '% smaller than the original (' + fmtSize(file.size) + ').'
        : 'New size: ' + fmtSize(blob.size) + ' — about the same as the original (' + fmtSize(file.size) + '). This PDF was already compact.';
    }
    return { files: outFiles, note: note };
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
        return { width: pg.width, height: pg.height, lines: lines, isOcr: pg.isOcr };
      });
      if (!layoutPages.some(function (pg) { return pg.lines.length; })) {
        throw new Error('No readable text was found in this PDF, even after scanning the pages as images. The scan may be too blurry, handwritten, or the text too small to read.');
      }
      /* Photos, colour blocks and rules from the PDF, placed at their
         original positions behind the text — the Word file keeps its
         look, not just its words. A failure here never blocks the text
         conversion. */
      var graphics = [];
      try {
        var gpdf = await loadPdfJs(file);
        for (var gp = 1; gp <= gpdf.numPages; gp++) {
          var gpage = await gpdf.getPage(gp);
          var gvp = gpage.getViewport({ scale: 1 });
          graphics.push(await extractPageGraphics(gpage, gvp.width, gvp.height));
        }
      } catch (gErr) { graphics = []; }
      prog(0.9, 'Building the Word document...');
      var layoutBlob = await buildLayoutDocxBlob(layoutPages, graphics);
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

  /* PDF to PowerPoint. A presentation has one slide size, so the first
     page's size is used for every slide (nearly all PDFs use one size).
     Editable-text mode: every line becomes a text box at its original
     position, size and styling — fully editable. Page-image mode: each
     page is rendered as a picture that fills the slide — pixel-perfect,
     but not editable. */
  /* ---- PDF graphics extraction (images + filled rectangles) ----
     The editable-text PowerPoint mode used to carry text only, so photos
     and colour blocks vanished. Reading the page's operator list recovers
     them: paintImageXObject paints an image in the unit square mapped by
     the current transform, and rectangle+fill paints a solid block. Only
     axis-aligned graphics are kept (rotated decorations stay in the
     page-image mode, which is pixel-exact). Coordinates come out in
     points, y growing downward, matching the text lines. */
  function rgbHex(c) {
    function h(v) { var s = Math.max(0, Math.min(255, Math.round(v))).toString(16); return s.length === 1 ? '0' + s : s; }
    return (h(c.r) + h(c.g) + h(c.b)).toUpperCase();
  }
  function composeAffine(m1, m2) {
    /* Apply m2 first, then m1. */
    return [
      m1[0] * m2[0] + m1[2] * m2[1],
      m1[1] * m2[0] + m1[3] * m2[1],
      m1[0] * m2[2] + m1[2] * m2[3],
      m1[1] * m2[2] + m1[3] * m2[3],
      m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
      m1[1] * m2[4] + m1[3] * m2[5] + m1[5]
    ];
  }
  function rgbFromColorArgs(kind, args) {
    /* pdf.js passes colours as 0-255 integers in the operator list (older
       versions used 0..1 floats); normalise per component either way. */
    function n(v) { v = parseFloat(v) || 0; return v > 1 ? v / 255 : v; }
    if (kind === 'rgb') return { r: Math.round(n(args[0]) * 255), g: Math.round(n(args[1]) * 255), b: Math.round(n(args[2]) * 255) };
    if (kind === 'gray') { var v = Math.round(n(args[0]) * 255); return { r: v, g: v, b: v }; }
    var r = (1 - n(args[0])) * (1 - n(args[3])), g = (1 - n(args[1])) * (1 - n(args[3])), b = (1 - n(args[2])) * (1 - n(args[3]));
    return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
  }
  /* Decode one constructPath op (pdf.js batches all path construction
     into it): ops array + flat coordinate array. Returns { rects, pts,
     curves } where pts are the moveTo/lineTo points in order. */
  function decodeConstructPath(ops, coords, OPS) {
    var rects = [], pts = [], curves = false, j = 0;
    for (var i = 0; i < ops.length; i++) {
      var op = ops[i] | 0;
      if (op === OPS.rectangle) {
        rects.push([coords[j], coords[j + 1], coords[j + 2], coords[j + 3]]);
        j += 4;
      } else if (op === OPS.moveTo || op === OPS.lineTo) {
        pts.push([coords[j], coords[j + 1]]);
        j += 2;
      } else if (op === OPS.curveTo) { curves = true; j += 6; }
      else if (op === OPS.curveTo2 || op === OPS.curveTo3) { curves = true; j += 4; }
    }
    return { rects: rects, pts: pts, curves: curves };
  }
  function interpretPdfOps(fnArray, argsArray, OPS, pageW, pageH) {
    var IDENTITY = [1, 0, 0, 1, 0, 0];
    var ctm = IDENTITY.slice();
    var stack = [];
    var fill = { r: 0, g: 0, b: 0 }, stroke = { r: 0, g: 0, b: 0 }, lineWidth = 1;
    var fillAlpha = 1, strokeAlpha = 1;
    var pathRects = [], pathPts = [], pathCurves = false;
    var images = [], rects = [], lines = [];
    var paintSeq = 0; /* paint order: graphics must stack in op-list order */
    function clearPath() { pathRects = []; pathPts = []; pathCurves = false; }
    function axisAligned(m) { return Math.abs(m[1]) < 0.01 && Math.abs(m[2]) < 0.01; }
    function mapPoint(x, y) {
      return [ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]];
    }
    function intersectBox(b) {
      var x0 = Math.max(b.x0, 0), y0 = Math.max(b.y0, 0);
      var x1 = Math.min(b.x1, pageW), y1 = Math.min(b.y1, pageH);
      if (x1 - x0 < 1 || y1 - y0 < 1) return null;
      return { x0: x0, y0: y0, x1: x1, y1: y1 };
    }
    function boxToTopOrigin(b) {
      return { x: b.x0, y: pageH - b.y1, w: b.x1 - b.x0, h: b.y1 - b.y0 };
    }
    function mapRectDevice(x, y, w, h) {
      var p0 = mapPoint(x, y), p1 = mapPoint(x + w, y + h);
      return { x0: Math.min(p0[0], p1[0]), y0: Math.min(p0[1], p1[1]), x1: Math.max(p0[0], p1[0]), y1: Math.max(p0[1], p1[1]) };
    }
    function pushRectDevice(b, doFill, doStroke) {
      /* Transparent fills are shadows, glows and masks — painting them
         solid would black out the slide. Only opaque paint is kept. */
      if (doFill && fillAlpha < 0.95) doFill = false;
      if (doStroke && strokeAlpha < 0.95) doStroke = false;
      if (!doFill && !doStroke) return;
      var clipped = intersectBox(b);
      if (!clipped) return;
      var r = boxToTopOrigin(clipped);
      if (doFill && !doStroke && fill.r === 255 && fill.g === 255 && fill.b === 255 && r.w * r.h >= pageW * pageH * 0.95) return;
      rects.push({ x: r.x, y: r.y, w: r.w, h: r.h, fill: doFill ? fill : null, stroke: doStroke ? stroke : null, lineWidth: lineWidth, seq: paintSeq++ });
    }
    function emitPath(doFill, doStroke) {
      if (!axisAligned(ctm)) { clearPath(); return; }
      var rectsBefore = rects.length;
      var i;
      for (i = 0; i < pathRects.length; i++) {
        var pr = pathRects[i];
        pushRectDevice(mapRectDevice(pr[0], pr[1], pr[2], pr[3]), doFill, doStroke);
      }
      /* A path of straight segments that forms an axis-aligned rectangle
         (Canva and friends draw bars as quads, not rectangle ops). */
      if (!pathRects.length && !pathCurves && pathPts.length >= 4) {
        var dev = pathPts.map(function (p) { return mapPoint(p[0], p[1]); });
        var xs = dev.map(function (p) { return p[0]; }), ys = dev.map(function (p) { return p[1]; });
        var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
        var minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
        var corners = [[minX, minY], [minX, maxY], [maxX, minY], [maxX, maxY]];
        var eps = 1.5;
        var allCorners = corners.every(function (c) {
          return dev.some(function (p) { return Math.abs(p[0] - c[0]) < eps && Math.abs(p[1] - c[1]) < eps; });
        });
        var onEdges = dev.every(function (p) {
          return Math.abs(p[0] - minX) < eps || Math.abs(p[0] - maxX) < eps || Math.abs(p[1] - minY) < eps || Math.abs(p[1] - maxY) < eps;
        });
        if (allCorners && onEdges) {
          pushRectDevice({ x0: minX, y0: minY, x1: maxX, y1: maxY }, doFill, doStroke);
        }
      }
      /* Stroked open paths that are not rectangles: table grid lines,
         underlines and rules. Record their axis-aligned segments so
         converters can redraw them as thin bars at the same positions.
         Diagonal segments (charts, slanted decorations) are skipped. */
      if (doStroke && rects.length === rectsBefore && !pathCurves && pathPts.length >= 2 && pathPts.length <= 128 && strokeAlpha >= 0.95) {
        var seg = pathPts.map(function (p) { return mapPoint(p[0], p[1]); });
        for (var sgi = 0; sgi + 1 < seg.length; sgi++) {
          var ax = seg[sgi][0], ay = seg[sgi][1], bx = seg[sgi + 1][0], by = seg[sgi + 1][1];
          var horiz = Math.abs(by - ay) < 0.6, vert = Math.abs(bx - ax) < 0.6;
          if (!horiz && !vert) continue;
          var len = horiz ? Math.abs(bx - ax) : Math.abs(by - ay);
          if (len < 2) continue;
          var lw = Math.max(1, lineWidth);
          var b = horiz
            ? { x0: Math.min(ax, bx), y0: ay - lw / 2, x1: Math.max(ax, bx), y1: ay + lw / 2 }
            : { x0: ax - lw / 2, y0: Math.min(ay, by), x1: ax + lw / 2, y1: Math.max(ay, by) };
          var clipped = intersectBox(b);
          if (!clipped) continue;
          var r = boxToTopOrigin(clipped);
          lines.push({ x: r.x, y: r.y, w: r.w, h: r.h, color: stroke, lineWidth: lineWidth, seq: paintSeq++ });
        }
      }
      clearPath();
    }
    for (var i = 0; i < fnArray.length; i++) {
      var fn = fnArray[i], args = argsArray[i] || [];
      if (fn === OPS.save) { stack.push({ ctm: ctm.slice(), fill: fill, stroke: stroke, lineWidth: lineWidth, fillAlpha: fillAlpha, strokeAlpha: strokeAlpha }); }
      else if (fn === OPS.restore) { var s = stack.pop(); if (s) { ctm = s.ctm; fill = s.fill; stroke = s.stroke; lineWidth = s.lineWidth; fillAlpha = s.fillAlpha; strokeAlpha = s.strokeAlpha; } }
      else if (fn === OPS.setGState) {
        /* Graphics state carries fill/stroke alpha (ca/CA). The args are
           nested key/value pairs; walk them defensively. */
        (function walk(v) {
          if (!v || typeof v !== 'object') return;
          if (v.length === 2 && typeof v[0] === 'string') {
            if (v[0] === 'ca') fillAlpha = parseFloat(v[1]);
            if (v[0] === 'CA') strokeAlpha = parseFloat(v[1]);
            return;
          }
          for (var k = 0; k < v.length; k++) walk(v[k]);
        })(args);
      }
      else if (fn === OPS.transform) { ctm = composeAffine(ctm, args); }
      else if (fn === OPS.setFillRGBColor) { fill = rgbFromColorArgs('rgb', args); }
      else if (fn === OPS.setFillGray) { fill = rgbFromColorArgs('gray', args); }
      else if (fn === OPS.setFillCMYKColor) { fill = rgbFromColorArgs('cmyk', args); }
      else if (fn === OPS.setStrokeRGBColor) { stroke = rgbFromColorArgs('rgb', args); }
      else if (fn === OPS.setStrokeGray) { stroke = rgbFromColorArgs('gray', args); }
      else if (fn === OPS.setStrokeCMYKColor) { stroke = rgbFromColorArgs('cmyk', args); }
      else if (fn === OPS.setLineWidth) { lineWidth = args[0] || 1; }
      else if (fn === OPS.constructPath) {
        var decoded = decodeConstructPath(args[0] || [], args[1] || [], OPS);
        pathRects = pathRects.concat(decoded.rects);
        pathPts = pathPts.concat(decoded.pts);
        pathCurves = pathCurves || decoded.curves;
      }
      else if (fn === OPS.rectangle) { pathRects.push([args[0], args[1], args[2], args[3]]); }
      else if (fn === OPS.moveTo || fn === OPS.lineTo) { pathPts.push([args[0], args[1]]); }
      else if (fn === OPS.curveTo || fn === OPS.curveTo2 || fn === OPS.curveTo3) { pathCurves = true; }
      else if (fn === OPS.fill || fn === OPS.eoFill) { emitPath(true, false); }
      else if (fn === OPS.stroke) { emitPath(false, true); }
      else if (fn === OPS.fillStroke || fn === OPS.eoFillStroke || fn === OPS.closeFillStroke || fn === OPS.closeEOFillStroke) { emitPath(true, true); }
      else if (fn === OPS.closeStroke) { emitPath(false, true); }
      else if (fn === OPS.clip || fn === OPS.eoClip) { clearPath(); /* Clip regions are not tracked: fully transparent paint is already dropped by the alpha check, and rects are clamped to the page. Tracking clip bboxes wrongly hid real bars in Canva files. */ }
      else if (fn === OPS.endPath) { clearPath(); }
      else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintJpegXObject) {
        if (axisAligned(ctm)) {
          var ib = mapRectDevice(0, 0, 1, 1);
          var vis = intersectBox(ib);
          /* Keep the image only if most of it is actually visible —
             heavily clipped images are masks and decorations. */
          if (vis && (vis.x1 - vis.x0) * (vis.y1 - vis.y0) >= 0.5 * (ib.x1 - ib.x0) * (ib.y1 - ib.y0)) {
            var ir = boxToTopOrigin(ib);
            if (ir.w >= 2 && ir.h >= 2) images.push({ x: ir.x, y: ir.y, w: ir.w, h: ir.h, objId: args[0], seq: paintSeq++ });
          }
        }
      }
    }
    /* Drop exact duplicates (painted backgrounds often repeat). */
    var seen = {};
    rects = rects.filter(function (r) {
      var k = [Math.round(r.x), Math.round(r.y), Math.round(r.w), Math.round(r.h), r.fill && (r.fill.r + ',' + r.fill.g + ',' + r.fill.b)].join('|');
      if (seen[k]) return false;
      seen[k] = true; return true;
    });
    var seenLines = {};
    lines = lines.filter(function (l) {
      var k = [Math.round(l.x), Math.round(l.y), Math.round(l.w), Math.round(l.h), l.color.r + ',' + l.color.g + ',' + l.color.b].join('|');
      if (seenLines[k]) return false;
      seenLines[k] = true; return true;
    }).slice(0, 1000);
    return { images: images, rects: rects, lines: lines };
  }
  function getPdfObj(page, objId, timeoutMs) {
    return new Promise(function (resolve) {
      var done = false;
      var timer = setTimeout(function () { if (!done) { done = true; resolve(null); } }, timeoutMs || 5000);
      try {
        page.objs.get(objId, function (data) {
          if (!done) { done = true; clearTimeout(timer); resolve(data || null); }
        });
      } catch (e) { if (!done) { done = true; clearTimeout(timer); resolve(null); } }
    });
  }
  function imageDataToDataUrl(img) {
    if (!img || typeof document === 'undefined') return null;
    try {
      var w = img.width, h = img.height;
      if (!w || !h) return null;
      var canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      var ctx = canvas.getContext('2d');
      if (img.bitmap) { ctx.drawImage(img.bitmap, 0, 0); }
      else if (img.data && img.data.length >= w * h * 4) {
        ctx.putImageData(new global.ImageData(new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, w * h * 4), w, h), 0, 0);
      } else if (img.data && img.data.length >= w * h * 3) {
        var rgba = new Uint8ClampedArray(w * h * 4);
        for (var i = 0, j = 0; i < w * h; i++, j += 3) {
          rgba[i * 4] = img.data[j]; rgba[i * 4 + 1] = img.data[j + 1]; rgba[i * 4 + 2] = img.data[j + 2]; rgba[i * 4 + 3] = 255;
        }
        ctx.putImageData(new global.ImageData(rgba, w, h), 0, 0);
      } else if (img.data && img.data.length === w * h) {
        var gray = new Uint8ClampedArray(w * h * 4);
        for (var k = 0; k < w * h; k++) { gray[k * 4] = img.data[k]; gray[k * 4 + 1] = img.data[k]; gray[k * 4 + 2] = img.data[k]; gray[k * 4 + 3] = 255; }
        ctx.putImageData(new global.ImageData(gray, w, h), 0, 0);
      } else { return null; }
      return canvas.toDataURL('image/png');
    } catch (e) { return null; }
  }
  async function extractPageGraphics(page, pageW, pageH) {
    var opList = await page.getOperatorList();
    var OPS = global.pdfjsLib.OPS;
    var found = interpretPdfOps(opList.fnArray, opList.argsArray, OPS, pageW, pageH);
    var images = [];
    for (var i = 0; i < found.images.length; i++) {
      var im = found.images[i];
      var data = await getPdfObj(page, im.objId, 5000);
      var dataUrl = data ? imageDataToDataUrl(data) : null;
      if (dataUrl) images.push({ x: im.x, y: im.y, w: im.w, h: im.h, dataUrl: dataUrl, seq: im.seq });
    }
    return { images: images, rects: found.rects, lines: found.lines };
  }
  async function toolPdfToPptx(files, opts, prog) {
    needLib('pptxgenjs');
    var file = files[0]; assertSize(file);
    var mode = (opts && opts.slideContent) || 'text';
    var pptx = new global.PptxGenJS();
    pptx.author = 'TrustFile';
    pptx.title = baseOf(file.name);
    if (mode === 'image') {
      var pdf = await loadPdfJs(file);
      var firstVp = null;
      for (var p = 1; p <= pdf.numPages; p++) {
        var page = await pdf.getPage(p);
        var vp1 = page.getViewport({ scale: 1 });
        if (!firstVp) {
          firstVp = vp1;
          pptx.defineLayout({ name: 'PDF', width: vp1.width / 72, height: vp1.height / 72 });
          pptx.layout = 'PDF';
        }
        var scale = 2;
        var viewport = page.getViewport({ scale: scale });
        var canvas = document.createElement('canvas');
        canvas.width = viewport.width; canvas.height = viewport.height;
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport: viewport }).promise;
        var slide = pptx.addSlide();
        slide.addImage({ data: canvas.toDataURL('image/png'), x: 0, y: 0, w: firstVp.width / 72, h: firstVp.height / 72, sizingType: 'cover' });
        prog(p / pdf.numPages * 0.9, 'Rendering page ' + p + ' of ' + pdf.numPages + '...');
      }
    } else {
      var layout = await pdfPages(file, function (p, total, label) { prog(p / total * 0.8, label || ('Reading page ' + p + ' of ' + total + '...')); });
      var slidePages = layout.pages.map(function (pg) {
        var lines = pg.boxes.length ? layoutLinesFromBoxes(pg.boxes, pg.isOcr) : [];
        if (!lines.length && pg.fallbackLines.length) {
          lines = pg.fallbackLines.map(function (t, i) {
            return { text: t, x: 36, y: 36 + i * 18, w: pg.width - 72, size: 11, bold: false, italic: false, font: '' };
          });
        }
        return { width: pg.width, height: pg.height, lines: lines, isOcr: pg.isOcr };
      });
      if (!slidePages.some(function (pg) { return pg.lines.length; })) {
        throw new Error('No readable text was found in this PDF, even after scanning the pages as images. The scan may be too blurry, handwritten, or the text too small to read.');
      }
      var first = slidePages[0];
      pptx.defineLayout({ name: 'PDF', width: first.width / 72, height: first.height / 72 });
      pptx.layout = 'PDF';
      /* Photos and colour blocks from the PDF, placed at their original
         positions behind the text — the slide keeps its look, not just
         its words. A failure here never blocks the text conversion. */
      var graphics = [];
      try {
        var gpdf = await loadPdfJs(file);
        for (var gp = 1; gp <= gpdf.numPages; gp++) {
          var gpage = await gpdf.getPage(gp);
          var gvp = gpage.getViewport({ scale: 1 });
          graphics.push(await extractPageGraphics(gpage, gvp.width, gvp.height));
        }
      } catch (gErr) { graphics = []; }
      slidePages.forEach(function (pg, idx) {
        var s = pptx.addSlide();
        var g = graphics[idx];
        if (g) {
          /* Paint order (seq): overlapping graphics stack as the PDF
             painted them — a photo painted after a white panel stays
             visible above it. */
          var ordered = [];
          g.rects.forEach(function (r) { ordered.push({ kind: 'rect', seq: r.seq || 0, item: r }); });
          (g.lines || []).forEach(function (ln) { ordered.push({ kind: 'line', seq: ln.seq || 0, item: ln }); });
          g.images.forEach(function (im) { ordered.push({ kind: 'image', seq: im.seq || 0, item: im }); });
          ordered.sort(function (a, b) { return a.seq - b.seq; });
          ordered.forEach(function (entry) {
            try {
              if (entry.kind === 'rect') {
                var r = entry.item;
                var shapeOpts = { x: r.x / 72, y: r.y / 72, w: r.w / 72, h: r.h / 72 };
                if (r.fill) shapeOpts.fill = { color: rgbHex(r.fill) };
                if (r.stroke) shapeOpts.line = { color: rgbHex(r.stroke), width: Math.max(0.5, r.lineWidth) };
                else shapeOpts.line = { type: 'none' };
                s.addShape(pptx.ShapeType.rect, shapeOpts);
              } else if (entry.kind === 'line') {
                var ln = entry.item;
                s.addShape(pptx.ShapeType.rect, { x: ln.x / 72, y: ln.y / 72, w: ln.w / 72, h: ln.h / 72, fill: { color: rgbHex(ln.color) }, line: { type: 'none' } });
              } else {
                var im = entry.item;
                s.addImage({ data: im.dataUrl, x: im.x / 72, y: im.y / 72, w: im.w / 72, h: im.h / 72 });
              }
            } catch (e) { /* skip */ }
          });
        }
        var fitted = fitLineBoxes(pg.lines, pg.width, pg.isOcr ? null : g);
        pg.lines.forEach(function (line, li) {
          var spacing = pg.isOcr ? 0 : letterSpacingPts(line);
          var box = {
            x: Math.max(0, line.x) / 72,
            y: Math.max(0, line.y) / 72,
            w: Math.max(0.15, fitted[li].w / 72),
            h: fitted[li].h / 72,
            fontSize: Math.max(6, fitted[li].size),
            bold: !!line.bold,
            italic: !!line.italic,
            color: line.color || '000000',
            valign: 'top',
            wrap: fitted[li].wraps > 1,
            margin: 0
          };
          if (line.font) box.fontFace = line.font;
          if (spacing > 0) box.charSpacing = Math.round(spacing * 10) / 10;
          s.addText(line.text, box);
        });
        prog(0.8 + (idx + 1) / slidePages.length * 0.1, 'Building slide ' + (idx + 1) + ' of ' + slidePages.length + '...');
      });
    }
    prog(0.95, 'Building the PowerPoint file...');
    var outBlob = await pptx.write({ outputType: 'blob' });
    return { files: [{ name: baseOf(file.name) + '.pptx', blob: outBlob }] };
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
    var result = await pdfPages(file, function (p, total, label) { prog(p / total * 0.8, label || ('Reading page ' + p + ' of ' + total + '...')); });
    var rows = [];
    result.pages.forEach(function (pg, idx) {
      if (idx > 0) rows.push([]);
      excelRowsFromPage(pg).forEach(function (r) { rows.push(r); });
    });
    if (!rows.some(function (r) { return r.some(function (c) { return String(c).trim() !== ''; }); })) throw new Error('No readable text was found in this PDF, even after scanning the pages as images. The scan may be too blurry, handwritten, or the text too small to read.');
    var wb = global.XLSX.utils.book_new();
    global.XLSX.utils.book_append_sheet(wb, global.XLSX.utils.aoa_to_sheet(rows), 'PDF Text');
    var arr = global.XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    return { files: [{ name: baseOf(file.name) + '.xlsx', blob: new Blob([arr], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }) }] };
  }

  /* ================= Convert TO pdf ================= */
  /* Render an already-laid-out DOM container (A4 width, 794px at 96dpi)
     to a PDF, cutting pages BETWEEN block elements so no line of text is
     ever split across a page boundary. Each slice keeps the document's
     own margins, so the PDF looks like the document, not a reflow. */
  /* ---------- DOCX structure: floating drawings + page size ----------
     docx-preview drops wps:wsp picture shapes entirely (the shape-with-
     picture-fill Word uses for logos) and renders floating pic:pic
     anchors at the wrong position — inline at the paragraph start,
     ignoring positionH/positionV and text wrap. We parse document.xml
     ourselves so Word->PDF can inject the dropped images and reposition
     the misplaced ones. The same pass reads the page size, so Letter,
     legal and landscape documents keep their size instead of being
     forced onto A4. The zip is read locally with JSZip; nothing is
     uploaded. */
  function docxNum(v, def) {
    var n = parseFloat(v);
    return isFinite(n) ? n : (def || 0);
  }
  function docxXmlText(el) {
    return el ? String(el.textContent || '').trim() : '';
  }
  function parseAnchorPos(posEl) {
    if (!posEl) return null;
    var off = elChild(posEl, 'posOffset');
    var al = elChild(posEl, 'align');
    return {
      relativeFrom: posEl.getAttribute('relativeFrom') || 'page',
      offset: off ? docxNum(docxXmlText(off)) / 9525 : null,
      align: al ? docxXmlText(al) : null
    };
  }
  function parseDrawingGeom(spPr) {
    var geom = { prst: 'rect', radiusPct: 0, border: null };
    if (!spPr) return geom;
    var prstGeom = elChild(spPr, 'prstGeom');
    if (prstGeom) {
      geom.prst = prstGeom.getAttribute('prst') || 'rect';
      if (geom.prst === 'roundRect') {
        geom.radiusPct = 0.16667;
        var avLst = elChild(prstGeom, 'avLst');
        var gd = avLst && elChild(avLst, 'gd');
        if (gd && gd.getAttribute('name') === 'adj') {
          var fmla = String(gd.getAttribute('fmla') || '');
          var vm = /val\s+(\d+)/.exec(fmla);
          var f = vm ? parseInt(vm[1], 10) : docxNum(fmla, NaN);
          if (isFinite(f)) geom.radiusPct = Math.max(0, Math.min(0.5, f / 100000));
        }
      }
    }
    var ln = elChild(spPr, 'ln');
    if (ln && !elChild(ln, 'noFill')) {
      var c = solidFillColor(ln);
      if (c) {
        geom.border = {
          color: '#' + ('0' + c.r.toString(16)).slice(-2) + ('0' + c.g.toString(16)).slice(-2) + ('0' + c.b.toString(16)).slice(-2),
          width: Math.max(0.5, docxNum(ln.getAttribute('w'), 9525) / 9525)
        };
      }
    }
    return geom;
  }
  function parseSrcRect(blipFill) {
    var srcRect = blipFill && elChild(blipFill, 'srcRect');
    if (!srcRect) return null;
    var c = {
      l: docxNum(srcRect.getAttribute('l')) / 100000, t: docxNum(srcRect.getAttribute('t')) / 100000,
      r: docxNum(srcRect.getAttribute('r')) / 100000, b: docxNum(srcRect.getAttribute('b')) / 100000
    };
    if (!(c.l || c.t || c.r || c.b)) return null;
    return c;
  }
  function parseDocxDrawing(drawing, rels) {
    if (elChild(drawing, 'inline')) return { kind: 'inline' };
    var anchor = elChild(drawing, 'anchor');
    if (!anchor) return null;
    var out = {
      kind: 'anchor',
      behindDoc: anchor.getAttribute('behindDoc') === '1',
      simplePos: anchor.getAttribute('simplePos') === '1',
      distL: docxNum(anchor.getAttribute('distL')) / 9525,
      distR: docxNum(anchor.getAttribute('distR')) / 9525,
      distT: docxNum(anchor.getAttribute('distT')) / 9525,
      distB: docxNum(anchor.getAttribute('distB')) / 9525,
      posH: parseAnchorPos(elChild(anchor, 'positionH')),
      posV: parseAnchorPos(elChild(anchor, 'positionV')),
      wrap: 'wrapNone', crop: null, geom: null, rid: null, target: null, shape: null
    };
    var sp = elChild(anchor, 'simplePos');
    if (sp) { out.simpleX = docxNum(sp.getAttribute('x')) / 9525; out.simpleY = docxNum(sp.getAttribute('y')) / 9525; }
    var ext = elChild(anchor, 'extent');
    out.w = ext ? docxNum(ext.getAttribute('cx')) / 9525 : 0;
    out.h = ext ? docxNum(ext.getAttribute('cy')) / 9525 : 0;
    ['wrapNone', 'wrapSquare', 'wrapTight', 'wrapThrough', 'wrapTopAndBottom'].forEach(function (w) {
      if (elChild(anchor, w)) out.wrap = w;
    });
    var picEl = elDescendants(anchor, 'pic')[0];
    var wspEl = elDescendants(anchor, 'wsp')[0];
    if (picEl) {
      out.shape = 'pic';
      var picSpPr = elChild(picEl, 'spPr');
      /* In pic:pic the blipFill is a direct child of pic, not in spPr. */
      var blipFill = elChild(picEl, 'blipFill');
      var blip = blipFill && elChild(blipFill, 'blip');
      out.rid = blip ? relAttr(blip, 'embed') : null;
      out.crop = parseSrcRect(blipFill);
      out.geom = parseDrawingGeom(picSpPr);
    } else if (wspEl) {
      out.shape = 'wsp';
      var wspSpPr = elChild(wspEl, 'spPr');
      var wBlipFill = wspSpPr && elChild(wspSpPr, 'blipFill');
      var wBlip = wBlipFill && elChild(wBlipFill, 'blip');
      out.rid = wBlip ? relAttr(wBlip, 'embed') : null;
      out.crop = parseSrcRect(wBlipFill);
      out.geom = parseDrawingGeom(wspSpPr);
    } else {
      return null;
    }
    if (!out.rid || !rels[out.rid]) return null;
    out.target = rels[out.rid];
    if (!out.w || !out.h) return null;
    return out;
  }
  function parseDocxStructure(docXmlText, relsXmlText) {
    var result = { drawings: [], bodyCount: 0, page: { wPt: 595.28, hPt: 841.89 } };
    var doc = xmlDoc(docXmlText);
    var rels = relsXmlText ? parseRels(relsXmlText) : {};
    var body = doc.documentElement && elChild(doc.documentElement, 'body');
    if (!body) return result;
    var sectPrs = elDescendants(body, 'sectPr');
    if (sectPrs.length) {
      var pgSz = elChild(sectPrs[0], 'pgSz');
      if (pgSz) {
        /* Attributes are namespace-prefixed (w:w / w:h) in Word files. */
        var w = docxNum(pgSz.getAttribute('w:w') || pgSz.getAttribute('w'));
        var h = docxNum(pgSz.getAttribute('w:h') || pgSz.getAttribute('h'));
        if (w > 0 && h > 0) { result.page.wPt = w / 20; result.page.hPt = h / 20; }
      }
    }
    var bodyKids = [];
    for (var i = 0; i < body.childNodes.length; i++) {
      var n = body.childNodes[i];
      if (n.nodeType === 1) {
        var ln = localNameOf(n);
        if (ln === 'p' || ln === 'tbl') bodyKids.push(n);
      }
    }
    result.bodyCount = bodyKids.length;
    elDescendants(body, 'drawing').forEach(function (drawing) {
      /* Skip VML fallbacks: mc:Fallback duplicates the DrawingML drawing. */
      var anc = drawing.parentNode, inFallback = false, topKid = null, inTbl = false;
      while (anc && anc !== body) {
        if (localNameOf(anc) === 'Fallback') inFallback = true;
        if (localNameOf(anc) === 'tbl') inTbl = true;
        if (anc.parentNode === body) topKid = anc;
        anc = anc.parentNode;
      }
      if (inFallback) return;
      var d = parseDocxDrawing(drawing, rels);
      if (!d) return;
      d.bodyIndex = topKid ? bodyKids.indexOf(topKid) : -1;
      d.inTable = inTbl;
      result.drawings.push(d);
    });
    return result;
  }
  function resolveAnchorCoord(pos, origins, sizes, extent) {
    if (!pos) return null;
    var frame = pos.relativeFrom || 'page';
    var origin = origins[frame] != null ? origins[frame] : origins.page;
    var size = sizes[frame] != null ? sizes[frame] : sizes.page;
    if (pos.align) {
      var a = pos.align;
      if (a === 'left' || a === 'top' || a === 'inside') return origin;
      if (a === 'center' || a === 'middle') return origin + (size - extent) / 2;
      if (a === 'right' || a === 'bottom' || a === 'outside') return origin + size - extent;
      return origin;
    }
    if (pos.offset != null) return origin + pos.offset;
    return origin;
  }
  function applyDrawingGeom(el, d) {
    var g = d.geom;
    if (!g) return;
    if (g.prst === 'roundRect' && g.radiusPct > 0) {
      el.style.borderRadius = (g.radiusPct * Math.min(d.w, d.h)).toFixed(1) + 'px';
    } else if (g.prst === 'ellipse') {
      el.style.borderRadius = '50%';
    }
    if (g.border) {
      el.style.border = g.border.width.toFixed(1) + 'px solid ' + g.border.color;
      el.style.boxSizing = 'border-box';
    }
  }
  /* Wrap an image in a clipping box when the picture has a crop rectangle
     (a:srcRect): the box shows the kept region at the drawing's size. */
  function cropBoxFor(img, d) {
    if (!d.crop) return img;
    var c = d.crop;
    var kw = Math.max(0.05, 1 - c.l - c.r), kh = Math.max(0.05, 1 - c.t - c.b);
    var box = document.createElement('div');
    box.style.cssText = 'overflow:hidden;width:' + d.w + 'px;height:' + d.h + 'px;';
    img.style.cssText = 'width:' + (d.w / kw).toFixed(1) + 'px;height:' + (d.h / kh).toFixed(1) + 'px;' +
      'margin-left:' + (-c.l * d.w / kw).toFixed(1) + 'px;margin-top:' + (-c.t * d.h / kh).toFixed(1) + 'px;max-width:none;';
    box.appendChild(img);
    return box;
  }
  function placeDrawingImg(container, img, d, anchorEl, anchorSection, cRect) {
    var sec = anchorSection || container;
    var sRect = sec.getBoundingClientRect();
    var cs = global.getComputedStyle(sec);
    var padL = parseFloat(cs.paddingLeft) || 0, padT = parseFloat(cs.paddingTop) || 0;
    var padR = parseFloat(cs.paddingRight) || 0, padB = parseFloat(cs.paddingBottom) || 0;
    var contentX = sRect.left - cRect.left + padL;
    var contentY = sRect.top - cRect.top + padT;
    var contentW = Math.max(1, sRect.width - padL - padR);
    var contentH = Math.max(1, sRect.height - padT - padB);
    var pRect = anchorEl.getBoundingClientRect();
    var pX = pRect.left - cRect.left, pY = pRect.top - cRect.top;
    var x = resolveAnchorCoord(d.posH,
      { page: sRect.left - cRect.left, margin: contentX, column: contentX, paragraph: pX, character: pX },
      { page: sRect.width, margin: contentW, column: contentW, paragraph: pRect.width, character: pRect.width }, d.w);
    var y = resolveAnchorCoord(d.posV,
      { page: sRect.top - cRect.top, margin: contentY, column: contentY, paragraph: pY, line: pY },
      { page: sRect.height, margin: contentH, column: contentH, paragraph: pRect.height, line: pRect.height }, d.h);
    if (d.simplePos) {
      x = (sRect.left - cRect.left) + (d.simpleX || 0);
      y = (sRect.top - cRect.top) + (d.simpleY || 0);
    }
    if (x == null || !isFinite(x)) x = contentX;
    if (y == null || !isFinite(y)) y = pY;
    var box = cropBoxFor(img, d);
    var floatWrap = d.wrap === 'wrapSquare' || d.wrap === 'wrapTight' || d.wrap === 'wrapThrough';
    if (floatWrap && !d.behindDoc) {
      /* Float so the paragraph text wraps around the picture, as in Word. */
      var side = (x + d.w / 2) > (contentX + contentW / 2) ? 'right' : 'left';
      var mTop = 0;
      if (d.posV && (d.posV.relativeFrom === 'paragraph' || d.posV.relativeFrom === 'line') && d.posV.offset != null) mTop = Math.max(0, d.posV.offset);
      box.style.cssText = 'float:' + side + ';width:' + d.w.toFixed(1) + 'px;height:' + d.h.toFixed(1) + 'px;' +
        'margin:' + mTop.toFixed(1) + 'px ' + d.distR.toFixed(1) + 'px ' + d.distB.toFixed(1) + 'px ' + d.distL.toFixed(1) + 'px;';
      applyDrawingGeom(box, d);
      if (box.parentNode !== anchorEl) anchorEl.insertBefore(box, anchorEl.firstChild);
      return;
    }
    box.style.cssText = 'position:absolute;left:' + x.toFixed(1) + 'px;top:' + y.toFixed(1) + 'px;' +
      'width:' + d.w.toFixed(1) + 'px;height:' + d.h.toFixed(1) + 'px;margin:0;padding:0;z-index:5;';
    applyDrawingGeom(box, d);
    container.appendChild(box);
  }
  async function placeFloatingDrawings(container, zip, structure) {
    var drawings = structure.drawings;
    if (!drawings.length) return { placed: 0, skipped: 0 };
    var sections = Array.prototype.slice.call(container.querySelectorAll('section.docx'));
    var blocks = [], blockSections = [];
    sections.forEach(function (sec) {
      Array.prototype.forEach.call(sec.children, function (ch) {
        if (ch.tagName === 'ARTICLE') {
          Array.prototype.forEach.call(ch.children, function (el) { blocks.push(el); blockSections.push(sec); });
        }
      });
    });
    if (!blocks.length) {
      Array.prototype.forEach.call(container.children, function (el) { blocks.push(el); blockSections.push(container); });
    }
    /* docx-preview renders inline pictures and floating pic anchors, in
       document order. Only reposition floating pictures when the counts
       line up exactly — otherwise a header/footer image would shift the
       mapping and the wrong picture would move. */
    var renderedImgs = Array.prototype.slice.call(container.querySelectorAll('img'));
    var expected = 0;
    drawings.forEach(function (d) { if (d.kind === 'inline' || d.shape === 'pic') expected++; });
    var canReposition = renderedImgs.length === expected;
    var imgCursor = 0, placed = 0, skipped = 0;
    var cRect = container.getBoundingClientRect();
    for (var i = 0; i < drawings.length; i++) {
      var d = drawings[i];
      if (d.kind === 'inline') { imgCursor++; continue; }
      if (d.inTable || d.bodyIndex < 0 || d.bodyIndex >= blocks.length) {
        if (d.shape === 'pic') imgCursor++;
        skipped++;
        continue;
      }
      var img = null;
      if (d.shape === 'pic' && canReposition) {
        img = renderedImgs[imgCursor] || null;
        imgCursor++;
      } else if (d.shape === 'pic') {
        imgCursor++;
        skipped++;
        continue; /* leave docx-preview's rendering untouched */
      }
      if (!img) {
        var path = resolveTarget('word', d.target);
        var file = zip.file(path);
        if (!file) { skipped++; continue; }
        var ext = (path.split('.').pop() || '').toLowerCase();
        var mime = { png: 'image/png', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg' }[ext];
        if (!mime) { skipped++; continue; } /* EMF/WMF/TIFF cannot render in a browser */
        var b64 = await file.async('base64');
        img = document.createElement('img');
        img.src = 'data:' + mime + ';base64,' + b64;
        img.alt = '';
      }
      try {
        placeDrawingImg(container, img, d, blocks[d.bodyIndex], blockSections[d.bodyIndex], cRect);
        placed++;
      } catch (e) { skipped++; }
    }
    return { placed: placed, skipped: skipped };
  }

  async function htmlContainerToPdf(container, prog, opts) {
    needLib('html2canvas'); needLib('jspdf');
    opts = opts || {};
    var imgs = container.querySelectorAll('img');
    await Promise.all(Array.prototype.map.call(imgs, function (img) {
      if (img.complete) return Promise.resolve();
      return new Promise(function (res) {
        var done = function () { res(); };
        img.addEventListener('load', done, { once: true });
        img.addEventListener('error', done, { once: true });
        setTimeout(done, 5000);
      });
    }));
    var canvas = await global.html2canvas(container, { scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false });
    var pageW = opts.pageW || 595.28, pageH = opts.pageH || 841.89;
    var pxPerPt = canvas.width / pageW;
    var sliceHpx = Math.floor(pageH * pxPerPt);
    /* Cut points: bottom edges of rendered blocks, in canvas pixels.
       Scope to each rendered section's article children (docx-preview
       output) so content splits between blocks, add table-row bottoms so
       a long table splits between rows instead of mid-row, and treat
       every section boundary as a mandatory cut (Word sections and
       explicit page breaks start a new page). */
    var cRect = container.getBoundingClientRect();
    var renderScale = cRect.width > 0 ? canvas.width / cRect.width : 2;
    var blocks = [];
    var mandatory = [];
    var sections = container.querySelectorAll('section.docx');
    if (sections.length) {
      Array.prototype.forEach.call(sections, function (sec) {
        var articles = sec.querySelectorAll('article');
        var scopeEls = articles.length ? articles : [sec];
        Array.prototype.forEach.call(scopeEls, function (scope) {
          Array.prototype.forEach.call(scope.children, function (el) {
            var r = el.getBoundingClientRect();
            if (r.height > 0) blocks.push((r.bottom - cRect.top) * renderScale);
          });
        });
        Array.prototype.forEach.call(sec.querySelectorAll('tr'), function (tr) {
          var r = tr.getBoundingClientRect();
          if (r.height > 0) blocks.push((r.bottom - cRect.top) * renderScale);
        });
        var sr = sec.getBoundingClientRect();
        if (sr.height > 0) mandatory.push((sr.bottom - cRect.top) * renderScale);
      });
    } else {
      Array.prototype.forEach.call(container.children, function (el) {
        var r = el.getBoundingClientRect();
        if (r.height > 0) blocks.push((r.bottom - cRect.top) * renderScale);
      });
    }
    blocks.sort(function (a, b) { return a - b; });
    mandatory.sort(function (a, b) { return a - b; });
    var cuts = [0];
    var bandEnd = sliceHpx;
    while (bandEnd < canvas.height) {
      var lastCut = cuts[cuts.length - 1];
      var cut = bandEnd;
      /* Never slice across a section boundary: if one falls inside this
         band, cut there even if the page is not full yet. */
      for (var mi = 0; mi < mandatory.length; mi++) {
        if (mandatory[mi] > lastCut + 40 && mandatory[mi] <= bandEnd) { cut = Math.floor(mandatory[mi]); break; }
      }
      if (cut === bandEnd) {
        for (var i = blocks.length - 1; i >= 0; i--) {
          if (blocks[i] > lastCut + 40 && blocks[i] <= bandEnd) { cut = Math.floor(blocks[i]); break; }
        }
      }
      cuts.push(cut);
      bandEnd = cut + sliceHpx;
    }
    cuts.push(canvas.height);
    var doc = new global.jspdf.jsPDF({ unit: 'pt', format: [pageW, pageH], orientation: pageW > pageH ? 'landscape' : 'portrait', compress: true });
    for (var p = 0; p < cuts.length - 1; p++) {
      var top = cuts[p], h = cuts[p + 1] - top;
      if (h <= 0) continue;
      var slice = document.createElement('canvas');
      slice.width = canvas.width; slice.height = h;
      slice.getContext('2d').drawImage(canvas, 0, top, canvas.width, h, 0, 0, canvas.width, h);
      if (p > 0) doc.addPage();
      doc.addImage(slice.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, pageW, h / pxPerPt);
      if (prog) prog(0.5 + (p + 1) / (cuts.length - 1) * 0.45, 'Writing page ' + (p + 1) + '...');
    }
    return doc.output('blob');
  }

  /* docx-preview draws list markers (bullets, numbers) with CSS
     ::before content and counters, which the page renderer cannot
     reproduce — bullets came out invisible and numbers missing. Replace
     them with literal marker text in the document itself: bullets become
     a real bullet character, numbered items get their sequence number.
     Marker styles are read from the stylesheet docx-preview injects. */
  function fixDocxListMarkers(container) {
    var cssText = '';
    container.querySelectorAll('style').forEach(function (st) { cssText += st.textContent + '\n'; });
    var markerByClass = {};
    /* Numbered rules look like: content: ""counter(docx-num-5-0, decimal)".\9";
       bullet rules like: content: "<glyph>\9"; — capture the whole value. */
    var re = /p\.(docx-num-[\w-]+):before\s*\{[^}]*content:\s*([^;]+);/g;
    var m;
    while ((m = re.exec(cssText)) !== null) {
      var raw = m[2].trim();
      var cm = raw.match(/counter\([^,)]+(?:,\s*([\w-]+))?\)/);
      if (cm) {
        var after = raw.slice(raw.indexOf(cm[0]) + cm[0].length);
        var suffix = '';
        after.replace(/"((?:[^"\\]|\\.)*)"/g, function (_, s) { suffix += s.replace(/\\9/g, ' ').replace(/\\"/g, '"'); });
        markerByClass[m[1]] = { type: 'counter', style: (cm[1] || 'decimal').toLowerCase(), suffix: suffix || '. ' };
      } else {
        var q = raw.match(/"((?:[^"\\]|\\.)*)"/);
        var ch = q ? q[1].replace(/\\9/g, '').trim().charAt(0) : '';
        if (ch) markerByClass[m[1]] = { type: 'bullet', ch: ch };
      }
    }
    var counters = {};
    function toAlpha(n, upper) {
      var s = '';
      while (n > 0) { var r = (n - 1) % 26; s = String.fromCharCode((upper ? 65 : 97) + r) + s; n = Math.floor((n - 1) / 26); }
      return s || 'a';
    }
    function toRoman(n, upper) {
      var table = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
      var s = '';
      for (var i = 0; i < table.length; i++) { while (n >= table[i][0]) { s += table[i][1]; n -= table[i][0]; } }
      return upper ? s : s.toLowerCase();
    }
    container.querySelectorAll('p[class*="docx-num-"]').forEach(function (p) {
      var cls = null;
      for (var i = 0; i < p.classList.length; i++) {
        if (p.classList[i].indexOf('docx-num-') === 0) { cls = p.classList[i]; break; }
      }
      if (!cls || !markerByClass[cls]) return;
      var marker = markerByClass[cls];
      var text;
      if (marker.type === 'counter') {
        counters[cls] = (counters[cls] || 0) + 1;
        var n = counters[cls], style = marker.style;
        var num = style === 'lower-alpha' ? toAlpha(n, false) : style === 'upper-alpha' ? toAlpha(n, true) :
          style === 'lower-roman' ? toRoman(n, false) : style === 'upper-roman' ? toRoman(n, true) : String(n);
        text = num + marker.suffix;
      } else {
        /* Symbol/Wingdings private-use bullets map to plain glyphs. */
        var ch = marker.ch;
        var code = ch.charCodeAt(0);
        var bulletMap = { 0xF0B7: '•', 0xF0A7: '▪', 0xF0D8: '➢', 0xF0FC: '✓', 0xF02D: '–', 0xF0BE: '›' };
        text = (bulletMap[code] || (code >= 0xF000 && code <= 0xF8FF ? '•' : ch)) + '  ';
      }
      var span = document.createElement('span');
      span.textContent = text;
      p.insertBefore(span, p.firstChild);
    });
  }

  async function toolWordToPdf(files, opts, prog) {
    var file = files[0]; assertSize(file);
    prog(0.1, 'Reading the Word document...');
    var buf = await readArrayBuffer(file);
    var usedFallback = false;
    var blob = null;
    var floatingNote = null;
    try {
      /* docx-preview needs JSZip loaded first: its bundle takes
         window.JSZip as a factory argument when it loads. */
      await loadLib('jszip');
      await loadLib('docxpreview');
      needLib('docxpreview'); needLib('html2canvas'); needLib('jspdf');
      /* Parse the document structure first: page size + floating
         drawings. Best-effort — a parse failure must never break the
         conversion; the plain render below still stands. */
      var structure = null, zip = null;
      try {
        zip = new global.JSZip();
        await zip.loadAsync(buf.slice(0));
        var docXmlFile = zip.file('word/document.xml');
        var relsFile = zip.file('word/_rels/document.xml.rels');
        if (docXmlFile) {
          structure = parseDocxStructure(await docXmlFile.async('text'), relsFile ? await relsFile.async('text') : null);
        }
      } catch (e) { structure = null; }
      var pageW = structure ? structure.page.wPt : 595.28;
      var pageH = structure ? structure.page.hPt : 841.89;
      var containerW = Math.round(pageW * 96 / 72);
      var container = document.createElement('div');
      container.style.cssText = 'position:absolute;left:-10000px;top:0;width:' + containerW + 'px;background:#ffffff;';
      document.body.appendChild(container);
      try {
        await global.docx.renderAsync(buf.slice(0), container);
        if (!container.textContent.trim() && !container.querySelector('img, table')) {
          throw new Error('empty render');
        }
        /* docx-preview draws its pages on a grey frame with shadows, like
           a document viewer — flatten it to plain white pages for print. */
        var flat = document.createElement('style');
        flat.textContent = '.docx-wrapper{background:#ffffff!important;padding:0!important;}' +
          '.docx-wrapper section.docx{box-shadow:none!important;margin:0 auto!important;}' +
          'p[class*="docx-num-"]:before{content:none!important;}';
        container.appendChild(flat);
        /* docx-preview copies the TABLE's page alignment (tblPr jc) onto
           every row as text-align, which wrongly centres all cell text.
           In Word, cell text alignment comes from the paragraph, which
           docx-preview already renders inline on each <p>. */
        container.querySelectorAll('tr').forEach(function (tr) {
          if (tr.style && tr.style.textAlign) tr.style.textAlign = '';
        });
        fixDocxListMarkers(container);
        if (structure && zip) {
          try {
            var placed = await placeFloatingDrawings(container, zip, structure);
            if (placed.skipped > 0 && placed.placed === 0) {
              floatingNote = 'Some floating pictures in this document could not be placed exactly as in Word.';
            }
          } catch (e) { /* floating images are best-effort; the text render stands */ }
        }
        prog(0.4, 'Laying out the pages...');
        blob = await htmlContainerToPdf(container, prog, { pageW: pageW, pageH: pageH });
      } finally {
        container.remove();
      }
    } catch (e) {
      /* Compatibility mode: mammoth keeps the text, tables, lists and
         images (as embedded pictures), with simpler styling. */
      usedFallback = true;
      await loadLib('mammoth');
      needLib('mammoth');
      var res = await global.mammoth.convertToHtml({
        arrayBuffer: buf.slice(0),
        convertImage: global.mammoth.images.imgElement(function (image) {
          return image.read('base64').then(function (b64) {
            return { src: 'data:' + image.contentType + ';base64,' + b64 };
          });
        })
      });
      if (!res.value || !res.value.replace(/<[^>]+>/g, '').trim()) {
        throw new Error('This Word document appears to be empty, or its content could not be read.');
      }
      var wrap = document.createElement('div');
      wrap.style.cssText = 'position:absolute;left:-10000px;top:0;width:794px;background:#ffffff;color:#111111;' +
        'font-family:Calibri,Arial,sans-serif;font-size:14px;line-height:1.6;padding:72px;box-sizing:border-box;';
      wrap.innerHTML = '<style>h1{font-size:24px}h2{font-size:19px}h3{font-size:16px}' +
        'table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:6px 8px;text-align:left}' +
        'img{max-width:100%;height:auto}p{margin:0 0 12px}</style>' + res.value;
      document.body.appendChild(wrap);
      try {
        prog(0.45, 'Laying out the pages...');
        blob = await htmlContainerToPdf(wrap, prog);
      } finally {
        wrap.remove();
      }
    }
    prog(1, 'Done');
    var result = { files: [{ name: baseOf(file.name) + '.pdf', blob: blob }] };
    if (usedFallback) result.note = 'Rendered in compatibility mode (the high-fidelity renderer could not be used for this file), so some formatting may differ from Word. Images and tables are kept.';
    else if (floatingNote) result.note = floatingNote;
    return result;
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

  /* ---------------- PowerPoint reading (PPTX -> PDF) ----------------
     A .pptx file is a zip of XML. We read each slide's shapes — text
     boxes, pictures and solid fills — with their original positions and
     styling, and redraw them on PDF pages of the same size. Charts,
     tables, SmartArt and effects need a full presentation renderer, so
     they are skipped honestly (counted in the result note). */
  var EMU_PER_PT = 12700;
  var REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

  function xmlDoc(text) {
    return new global.DOMParser().parseFromString(text, 'text/xml');
  }
  function localNameOf(node) {
    if (node.localName) return node.localName;
    return String(node.nodeName || '').split(':').pop();
  }
  function elChildren(el, local) {
    var out = [];
    var kids = el.childNodes || [];
    for (var i = 0; i < kids.length; i++) {
      if (kids[i].nodeType === 1 && localNameOf(kids[i]) === local) out.push(kids[i]);
    }
    return out;
  }
  function elChild(el, local) {
    var c = elChildren(el, local);
    return c.length ? c[0] : null;
  }
  function elDescendants(el, local, out) {
    out = out || [];
    var kids = el.childNodes || [];
    for (var i = 0; i < kids.length; i++) {
      if (kids[i].nodeType !== 1) continue;
      if (localNameOf(kids[i]) === local) out.push(kids[i]);
      elDescendants(kids[i], local, out);
    }
    return out;
  }
  function relAttr(el, name) {
    if (el.getAttributeNS) {
      var v = null;
      try { v = el.getAttributeNS(REL_NS, name); } catch (e) { v = null; }
      if (v) return v;
    }
    return el.getAttribute('r:' + name);
  }
  function parseRels(xmlText) {
    var doc = xmlDoc(xmlText);
    var map = {};
    elDescendants(doc.documentElement, 'Relationship').forEach(function (r) {
      map[r.getAttribute('Id')] = r.getAttribute('Target');
    });
    return map;
  }
  function resolveTarget(baseDir, target) {
    var parts = baseDir ? baseDir.split('/') : [];
    target.split('/').forEach(function (seg) {
      if (seg === '..') parts.pop();
      else if (seg !== '.' && seg !== '') parts.push(seg);
    });
    return parts.join('/');
  }
  /* Office theme colours: the scheme lives in ppt/theme/theme1.xml and
     differs per file (a deck's accent1 may be orange, not Office blue).
     Without the theme we fall back to the Office 2007 palette. */
  var PPT_THEME_FALLBACK = { dk1: '000000', lt1: 'FFFFFF', dk2: '1F497D', lt2: 'EEECE1', accent1: '4F81BD', accent2: 'C0504D', accent3: '9BBB59', accent4: '8064A2', accent5: '4BACC6', accent6: 'F79646', hlink: '0563C1', folHlink: '954F72', bg1: 'FFFFFF', tx1: '000000', bg2: 'EEECE1', tx2: '1F497D' };
  function hexToRgb(hex) {
    if (!/^[0-9a-fA-F]{6}$/.test(hex || '')) return null;
    return { r: parseInt(hex.substr(0, 2), 16), g: parseInt(hex.substr(2, 2), 16), b: parseInt(hex.substr(4, 2), 16) };
  }
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b), h = 0, s = 0, l = (max + min) / 2;
    if (max !== min) {
      var d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    return { h: h, s: s, l: l };
  }
  function hslToRgb(h, s, l) {
    var r, g, b;
    if (s === 0) { r = g = b = l; } else {
      var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      var p = 2 * l - q;
      var f = function (t) {
        if (t < 0) t += 1; if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
      };
      r = f(h + 1 / 3); g = f(h); b = f(h - 1 / 3);
    }
    return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
  }
  /* DrawingML colour transforms (children of srgbClr/schemeClr/sysClr):
     tint lightens toward white, shade darkens toward black, lumMod scales
     luminance, lumOff shifts it. Applied in document order. */
  function applyClrTransforms(rgb, clrEl) {
    if (!rgb || !clrEl) return rgb;
    var hsl = null;
    function ensureHsl() { if (!hsl) hsl = rgbToHsl(rgb.r, rgb.g, rgb.b); }
    var kids = clrEl.childNodes || [];
    for (var i = 0; i < kids.length; i++) {
      var k = kids[i];
      if (k.nodeType !== 1) continue;
      var v = parseFloat(k.getAttribute('val') || '0') / 100000;
      var ln = localNameOf(k);
      if (ln === 'tint') { ensureHsl(); hsl.l = hsl.l + (1 - hsl.l) * v; }
      else if (ln === 'shade') { ensureHsl(); hsl.l = hsl.l * (1 - v); }
      else if (ln === 'lumMod') { ensureHsl(); hsl.l = hsl.l * v; }
      else if (ln === 'lumOff') { ensureHsl(); hsl.l = hsl.l + v; }
    }
    if (!hsl) return rgb;
    hsl.l = Math.max(0, Math.min(1, hsl.l));
    return hslToRgb(hsl.h, hsl.s, hsl.l);
  }
  function parseThemeColors(themeDoc) {
    var map = {};
    if (!themeDoc) return map;
    var scheme = elDescendants(themeDoc.documentElement, 'clrScheme')[0];
    if (!scheme) return map;
    var kids = scheme.childNodes || [];
    for (var i = 0; i < kids.length; i++) {
      var k = kids[i];
      if (k.nodeType !== 1) continue;
      var name = localNameOf(k);
      var srgb = elChild(k, 'srgbClr');
      var sys = elChild(k, 'sysClr');
      var rgb = srgb ? hexToRgb(srgb.getAttribute('val')) : (sys ? hexToRgb(sys.getAttribute('lastClr')) : null);
      if (rgb) map[name] = rgb;
    }
    return map;
  }
  function parseThemeLnWidths(themeDoc) {
    /* fmtScheme/lnStyleLst defines the widths for lnRef idx 1/2/3.
       Without it, use the Office defaults (0.75 / 1.5 / 2.25 pt). */
    var widths = [0.75, 1.5, 2.25];
    if (!themeDoc) return widths;
    var fmt = elDescendants(themeDoc.documentElement, 'fmtScheme')[0];
    var lst = fmt && elChild(fmt, 'lnStyleLst');
    if (!lst) return widths;
    var lns = elChildren(lst, 'ln');
    lns.forEach(function (ln, i) {
      var w = ln.getAttribute('w');
      if (w) widths[i] = Math.max(0.25, parseFloat(w) / EMU_PER_PT);
    });
    return widths;
  }
  /* Colour carried by a style reference (lnRef/fillRef): the ref's child
     colour element overrides the theme style's own colour. */
  function styleRefColor(refEl, theme) {
    if (!refEl) return null;
    var clr = elChild(refEl, 'srgbClr');
    if (clr) return applyClrTransforms(hexToRgb(clr.getAttribute('val')), clr);
    var scheme = elChild(refEl, 'schemeClr');
    if (scheme) return applyClrTransforms(themeColor(theme, scheme.getAttribute('val')), scheme);
    var sys = elChild(refEl, 'sysClr');
    if (sys) return applyClrTransforms(hexToRgb(sys.getAttribute('lastClr')), sys);
    return null;
  }
  function themeColor(theme, name) {
    if (theme && theme[name]) return theme[name];
    var hex = PPT_THEME_FALLBACK[name];
    return hex ? hexToRgb(hex) : null;
  }
  function solidFillColor(parentEl, theme) {
    var fill = parentEl && elChild(parentEl, 'solidFill');
    if (!fill) return null;
    var clr = elChild(fill, 'srgbClr');
    if (clr) return applyClrTransforms(hexToRgb(clr.getAttribute('val')), clr);
    var scheme = elChild(fill, 'schemeClr');
    if (scheme) return applyClrTransforms(themeColor(theme, scheme.getAttribute('val')), scheme);
    var sys = elChild(fill, 'sysClr');
    if (sys) return applyClrTransforms(hexToRgb(sys.getAttribute('lastClr')), sys);
    return null;
  }
  /* Gradient fills cannot be reproduced by the vector renderer; the first
     gradient stop is a much closer approximation than no fill at all
     (a white-on-gradient label stays readable). */
  function gradientFirstColor(parentEl, theme) {
    var grad = parentEl && elChild(parentEl, 'gradFill');
    if (!grad) return null;
    var gsLst = elChild(grad, 'gsLst');
    var gs = gsLst && elChild(gsLst, 'gs');
    if (!gs) return null;
    var clr = elChild(gs, 'srgbClr');
    if (clr) return applyClrTransforms(hexToRgb(clr.getAttribute('val')), clr);
    var scheme = elChild(gs, 'schemeClr');
    if (scheme) return applyClrTransforms(themeColor(theme, scheme.getAttribute('val')), scheme);
    var sys = elChild(gs, 'sysClr');
    if (sys) return applyClrTransforms(hexToRgb(sys.getAttribute('lastClr')), sys);
    return null;
  }
  function shapeBox(spPr, tf) {
    var xfrm = spPr && elChild(spPr, 'xfrm');
    var off = xfrm && elChild(xfrm, 'off');
    var ext = xfrm && elChild(xfrm, 'ext');
    if (!off || !ext) return null;
    var x = parseFloat(off.getAttribute('x')) / EMU_PER_PT;
    var y = parseFloat(off.getAttribute('y')) / EMU_PER_PT;
    var w = parseFloat(ext.getAttribute('cx')) / EMU_PER_PT;
    var h = parseFloat(ext.getAttribute('cy')) / EMU_PER_PT;
    return { x: tf.dx + x * tf.sx, y: tf.dy + y * tf.sy, w: w * tf.sx, h: h * tf.sy };
  }
  function runStyle(rPr, text, theme) {
    var style = { text: text, size: 18, bold: false, italic: false, underline: false, color: null, font: '' };
    if (rPr) {
      if (rPr.getAttribute('sz')) style.size = Math.max(4, parseInt(rPr.getAttribute('sz'), 10) / 100);
      if (rPr.getAttribute('b') === '1') style.bold = true;
      if (rPr.getAttribute('i') === '1') style.italic = true;
      var u = rPr.getAttribute('u');
      if (u && u !== 'none') style.underline = true;
      style.color = solidFillColor(rPr, theme);
      var latin = elChild(rPr, 'latin');
      if (latin && latin.getAttribute('typeface')) style.font = latin.getAttribute('typeface');
    }
    return style;
  }
  /* One paragraph's properties as inherited through
     master txStyles -> layout lstStyle -> slide pPr, most specific wins.
     Undefined fields mean "keep inheriting". */
  function parseParaProps(pPrEl, theme) {
    var p = {};
    if (!pPrEl) return p;
    var algn = pPrEl.getAttribute('algn');
    if (algn) p.align = algn === 'ctr' ? 'center' : (algn === 'r' ? 'right' : (algn === 'just' ? 'left' : 'left'));
    var marL = pPrEl.getAttribute('marL');
    if (marL !== null && marL !== '') p.marL = parseFloat(marL) / EMU_PER_PT;
    var indent = pPrEl.getAttribute('indent');
    if (indent !== null && indent !== '') p.indent = parseFloat(indent) / EMU_PER_PT;
    var lnSpc = elChild(pPrEl, 'lnSpc');
    if (lnSpc) {
      var pct = elChild(lnSpc, 'spcPct');
      var pts = elChild(lnSpc, 'spcPts');
      if (pct) p.lnSpc = { pct: parseFloat(pct.getAttribute('val') || '100000') / 100000 };
      else if (pts) p.lnSpc = { pts: parseFloat(pts.getAttribute('val') || '0') / 100 };
    }
    [['spcBef', 'spcBef'], ['spcAft', 'spcAft']].forEach(function (pair) {
      var sp = elChild(pPrEl, pair[0]);
      if (!sp) return;
      var pct = elChild(sp, 'spcPct');
      var pts = elChild(sp, 'spcPts');
      if (pct) p[pair[1]] = { pct: parseFloat(pct.getAttribute('val') || '0') / 100000 };
      else if (pts) p[pair[1]] = { pts: parseFloat(pts.getAttribute('val') || '0') / 100 };
    });
    if (elChild(pPrEl, 'buNone')) p.bullet = { type: 'none' };
    else {
      var buChar = elChild(pPrEl, 'buChar');
      if (buChar) p.bullet = { type: 'char', char: buChar.getAttribute('char') || '•' };
      else {
        var buAuto = elChild(pPrEl, 'buAutoNum');
        if (buAuto) p.bullet = { type: 'autoNum', numType: buAuto.getAttribute('type') || 'arabicPeriod', startAt: parseInt(buAuto.getAttribute('startAt') || '1', 10) || 1 };
        else if (elChild(pPrEl, 'buBlip')) p.bullet = { type: 'char', char: '•' };
      }
    }
    var defRPr = elChild(pPrEl, 'defRPr');
    if (defRPr) {
      /* Only record attributes actually present: an absent attribute
         must keep inheriting instead of resetting to a default. */
      if (defRPr.getAttribute('sz')) p.defSize = Math.max(4, parseInt(defRPr.getAttribute('sz'), 10) / 100);
      if (defRPr.getAttribute('b') !== null) p.defBold = defRPr.getAttribute('b') === '1';
      if (defRPr.getAttribute('i') !== null) p.defItalic = defRPr.getAttribute('i') === '1';
      if (defRPr.getAttribute('u') !== null) p.defUnderline = defRPr.getAttribute('u') !== 'none';
      var dc = solidFillColor(defRPr, theme);
      if (dc) p.defColor = dc;
      var latin = elChild(defRPr, 'latin');
      if (latin && latin.getAttribute('typeface')) p.defFont = latin.getAttribute('typeface');
    }
    return p;
  }
  function mergeParaProps(base, over) {
    var out = {};
    var keys = ['align', 'marL', 'indent', 'lnSpc', 'spcBef', 'spcAft', 'bullet', 'defSize', 'defBold', 'defItalic', 'defUnderline', 'defColor', 'defFont'];
    keys.forEach(function (k) {
      if (over && over[k] !== undefined) out[k] = over[k];
      else if (base && base[k] !== undefined) out[k] = base[k];
    });
    return out;
  }
  /* lstStyle / txStyle: defPPr + lvl1pPr..lvl9pPr -> array of 9 level
     property objects (each level inherits from the level above it, and
     level 0 inherits from defPPr). */
  function parseLevelStyles(styleEl, theme) {
    var levels = [];
    var base = parseParaProps(styleEl && elChild(styleEl, 'defPPr'), theme);
    var prev = base;
    for (var lvl = 1; lvl <= 9; lvl++) {
      var lvlEl = styleEl && elChild(styleEl, 'lvl' + lvl + 'pPr');
      var cur = mergeParaProps(prev, parseParaProps(lvlEl, theme));
      levels.push(cur);
      prev = cur;
    }
    return levels;
  }
  function parseSlideParagraph(pEl, theme, levelProps) {
    var pPr = elChild(pEl, 'pPr');
    var lvl = 0;
    if (pPr && pPr.getAttribute('lvl')) lvl = Math.max(0, Math.min(8, parseInt(pPr.getAttribute('lvl'), 10) || 0));
    var props = mergeParaProps(levelProps && levelProps[lvl], parseParaProps(pPr, theme));
    var defRPr = pPr && elChild(pPr, 'defRPr');
    var runs = [];
    var kids = pEl.childNodes || [];
    for (var i = 0; i < kids.length; i++) {
      var k = kids[i];
      if (k.nodeType !== 1) continue;
      var ln = localNameOf(k);
      if (ln === 'r' || ln === 'fld') {
        var tEl = elChild(k, 't');
        var text = tEl ? (tEl.textContent || '') : '';
        if (!text) continue;
        var rPr = elChild(k, 'rPr') || defRPr;
        var r = runStyle(rPr, text, theme);
        /* Fill in anything the run itself did not specify from the
           paragraph's inherited defaults. */
        if (!rPr || !rPr.getAttribute('sz')) { if (props.defSize !== undefined) r.size = props.defSize; }
        if (!rPr || rPr.getAttribute('b') === null) { if (props.defBold !== undefined) r.bold = props.defBold; }
        if (!rPr || rPr.getAttribute('i') === null) { if (props.defItalic !== undefined) r.italic = props.defItalic; }
        if (!rPr || rPr.getAttribute('u') === null) { if (props.defUnderline !== undefined) r.underline = props.defUnderline; }
        if (!r.color && props.defColor) r.color = props.defColor;
        if (!r.font && props.defFont) r.font = props.defFont;
        runs.push(r);
      } else if (ln === 'br') {
        runs.push({ br: true });
      }
    }
    return {
      align: props.align || 'left', runs: runs, level: lvl,
      marL: props.marL || 0, indent: props.indent || 0,
      bullet: props.bullet || null, lnSpc: props.lnSpc || null,
      spcBef: props.spcBef || null, spcAft: props.spcAft || null
    };
  }
  /* Placeholder shapes (<p:ph>) usually carry no position of their own:
     position, size and text styles come from the matching placeholder on
     the slide layout, with the slide master's txStyles as the fallback. */
  function phInfoOf(el) {
    var nvSpPr = elChild(el, 'nvSpPr');
    var nvPr = nvSpPr && elChild(nvSpPr, 'nvPr');
    var ph = nvPr && elChild(nvPr, 'ph');
    if (!ph) return null;
    return { type: ph.getAttribute('type') || 'body', idx: parseInt(ph.getAttribute('idx') || '0', 10) || 0 };
  }
  function txStyleKey(phType) {
    if (phType === 'title' || phType === 'ctrTitle') return 'title';
    if (phType === 'body' || phType === 'obj' || phType === 'subTitle') return 'body';
    return 'other';
  }
  /* Placeholder matching is by idx first (the OOXML identity of a
     placeholder), then by type. */
  function matchPhShape(shapes, type, idx) {
    var exact = null, byIdx = null, byType = null;
    (shapes || []).forEach(function (el) {
      var info = phInfoOf(el);
      if (!info) return;
      if (info.idx === idx && info.type === type && !exact) exact = el;
      else if (info.idx === idx && !byIdx) byIdx = el;
      else if (info.type === type && !byType) byType = el;
    });
    return exact || byIdx || byType;
  }
  function shapeLevelProps(el, txBody, ctx) {
    if (!ctx) return null;
    var ph = phInfoOf(el);
    var levels = null;
    if (ph && ctx.txStyles) {
      levels = ctx.txStyles[txStyleKey(ph.type)] || null;
      /* Master placeholder lstStyle sits between txStyles and the
         layout placeholder lstStyle in the inheritance chain. */
      var masterEl = ctx.findMasterPh && ctx.findMasterPh(ph.type, ph.idx);
      if (masterEl) {
        var masterTx = elChild(masterEl, 'txBody');
        var masterLst = masterTx && elChild(masterTx, 'lstStyle');
        if (masterLst) {
          var masterLevels = parseLevelStyles(masterLst, ctx.theme);
          levels = (levels || []).map(function (lv, i) { return mergeParaProps(lv, masterLevels[i]); });
          if (!levels.length) levels = masterLevels;
        }
      }
      var layoutEl = ctx.findLayoutPh && ctx.findLayoutPh(ph.type, ph.idx);
      if (layoutEl) {
        var layoutTx = elChild(layoutEl, 'txBody');
        var layoutLst = layoutTx && elChild(layoutTx, 'lstStyle');
        if (layoutLst) {
          var layoutLevels = parseLevelStyles(layoutLst, ctx.theme);
          levels = (levels || []).map(function (lv, i) { return mergeParaProps(lv, layoutLevels[i]); });
          if (!levels.length) levels = layoutLevels;
        }
      }
    }
    /* The shape's own lstStyle wins over everything inherited. */
    var ownLst = txBody && elChild(txBody, 'lstStyle');
    if (ownLst) {
      var ownLevels = parseLevelStyles(ownLst, ctx.theme);
      levels = (levels || ownLevels.map(function () { return {}; })).map(function (lv, i) { return mergeParaProps(lv, ownLevels[i]); });
    }
    return levels;
  }
  function parseTextShape(el, tf, ctx) {
    var spPr = elChild(el, 'spPr');
    var box = shapeBox(spPr, tf);
    var theme = ctx && ctx.theme;
    if (!box && ctx) {
      /* Placeholder without its own geometry: inherit the box from the
         layout placeholder, then from the slide master placeholder
         (the default template keeps geometry only on the master). */
      var ph = phInfoOf(el);
      if (ph) {
        var inheritEls = [];
        if (ctx.findLayoutPh) inheritEls.push(ctx.findLayoutPh(ph.type, ph.idx));
        if (ctx.findMasterPh) inheritEls.push(ctx.findMasterPh(ph.type, ph.idx));
        for (var ii = 0; ii < inheritEls.length && !box; ii++) {
          if (inheritEls[ii]) box = shapeBox(elChild(inheritEls[ii], 'spPr'), tf);
        }
      }
    }
    if (!box) box = { x: 0, y: 0, w: 100, h: 50 };
    var fill = spPr ? (solidFillColor(spPr, theme) || gradientFirstColor(spPr, theme)) : null;
    if (spPr && elChild(spPr, 'noFill')) fill = null;
    var geom = 'rect', line = null, rot = 0;
    /* Shape style references (fillRef/lnRef) apply when the shape has no
       explicit fill/line of its own. */
    var styleEl = elChild(el, 'style');
    if (!fill && !(spPr && elChild(spPr, 'noFill')) && styleEl) {
      var fillRef = elChild(styleEl, 'fillRef');
      if (fillRef && fillRef.getAttribute('idx') !== '0') fill = styleRefColor(fillRef, theme);
    }
    if (spPr) {
      var prst = elChild(spPr, 'prstGeom');
      if (prst && prst.getAttribute('prst')) geom = prst.getAttribute('prst');
      var ln = elChild(spPr, 'ln');
      if (ln && !elChild(ln, 'noFill')) {
        var lc = solidFillColor(ln, theme);
        var lw = ln.getAttribute('w') ? parseFloat(ln.getAttribute('w')) / EMU_PER_PT : 1;
        if (lc) line = { color: lc, width: Math.max(0.5, lw) };
      } else if (!ln && styleEl) {
        var lnRef = elChild(styleEl, 'lnRef');
        if (lnRef && lnRef.getAttribute('idx') !== '0') {
          var rc = styleRefColor(lnRef, theme);
          if (rc) {
            var widths = (ctx && ctx.lnWidths) || [0.75, 1.5, 2.25];
            var widx = Math.max(1, parseInt(lnRef.getAttribute('idx') || '1', 10) || 1) - 1;
            line = { color: rc, width: Math.max(0.5, widths[widx] || 1) };
          }
        }
      }
      var xfrm = elChild(spPr, 'xfrm');
      if (xfrm && xfrm.getAttribute('rot')) rot = (parseFloat(xfrm.getAttribute('rot')) || 0) / 60000;
    }
    var txBody = elChild(el, 'txBody');
    var paras = [];
    var anchor = 't', wrap = true, autoFit = false;
    var insets = { l: 91440 / EMU_PER_PT, t: 45720 / EMU_PER_PT, r: 91440 / EMU_PER_PT, b: 45720 / EMU_PER_PT };
    var levels = shapeLevelProps(el, txBody, ctx);
    if (txBody) {
      var bodyPr = elChild(txBody, 'bodyPr');
      if (bodyPr) {
        if (bodyPr.getAttribute('anchor')) anchor = bodyPr.getAttribute('anchor');
        if (bodyPr.getAttribute('wrap') === 'none') wrap = false;
        if (elChild(bodyPr, 'spAutoFit')) autoFit = true;
        ['lIns', 'tIns', 'rIns', 'bIns'].forEach(function (a, idx) {
          var v = bodyPr.getAttribute(a);
          if (v !== null && v !== '') insets[['l', 't', 'r', 'b'][idx]] = parseFloat(v) / EMU_PER_PT;
        });
      }
      elChildren(txBody, 'p').forEach(function (pEl) { paras.push(parseSlideParagraph(pEl, theme, levels)); });
    }
    return { kind: 'text', box: box, fill: fill, geom: geom, line: line, paras: paras, anchor: anchor, wrap: wrap, insets: insets, rot: rot, autoFit: autoFit };
  }
  /* Tables live in graphicFrames: <a:tbl> with a grid, rows and cells.
     Charts and diagrams share the graphicFrame element, so only frames
     that actually contain a table become table shapes. */
  function parseTableShape(el, tf, ctx) {
    var tbl = elDescendants(el, 'tbl')[0];
    if (!tbl) return { kind: 'unsupported' };
    var box = shapeBox(el, tf);
    if (!box) return { kind: 'unsupported' };
    var theme = ctx && ctx.theme;
    var grid = [];
    var gridEl = elChild(tbl, 'tblGrid');
    if (gridEl) elChildren(gridEl, 'gridCol').forEach(function (gc) {
      grid.push((parseFloat(gc.getAttribute('w')) || 0) / EMU_PER_PT * tf.sx);
    });
    var tblPr = elChild(tbl, 'tblPr');
    var firstRow = tblPr && tblPr.getAttribute('firstRow') !== '0';
    var rows = [];
    elChildren(tbl, 'tr').forEach(function (tr) {
      var rowH = (parseFloat(tr.getAttribute('h')) || 0) / EMU_PER_PT * tf.sy;
      var cells = [];
      var gridIdx = 0;
      elChildren(tr, 'tc').forEach(function (tc) {
        var tcPr = elChild(tc, 'tcPr');
        /* gridSpan/rowSpan/vMerge are attributes of <a:tc> itself in
           DrawingML (unlike WordprocessingML, where gridSpan is in tcPr). */
        var span = tc.getAttribute('gridSpan') ? parseInt(tc.getAttribute('gridSpan'), 10)
          : (tcPr && tcPr.getAttribute('gridSpan') ? parseInt(tcPr.getAttribute('gridSpan'), 10) : 1);
        var rowSpan = tc.getAttribute('rowSpan') ? parseInt(tc.getAttribute('rowSpan'), 10) : 1;
        var vMerge = tc.getAttribute('vMerge') === '1' || (tcPr && tcPr.getAttribute('vMerge') === '1');
        var hMerge = tc.getAttribute('hMerge') === '1' || (tcPr && tcPr.getAttribute('hMerge') === '1');
        var cellFill = tcPr ? (solidFillColor(tcPr, theme) || gradientFirstColor(tcPr, theme)) : null;
        var margins = { l: 91440 / EMU_PER_PT, t: 45720 / EMU_PER_PT, r: 91440 / EMU_PER_PT, b: 45720 / EMU_PER_PT };
        var anchor = 't';
        if (tcPr) {
          if (tcPr.getAttribute('anchor')) anchor = tcPr.getAttribute('anchor');
          ['marL', 'marT', 'marR', 'marB'].forEach(function (a, idx) {
            var v = tcPr.getAttribute(a);
            if (v !== null && v !== '') margins[['l', 't', 'r', 'b'][idx]] = parseFloat(v) / EMU_PER_PT;
          });
        }
        var paras = [];
        var txBody = elChild(tc, 'txBody');
        if (txBody) {
          var lst = elChild(txBody, 'lstStyle');
          var levels = lst ? parseLevelStyles(lst, theme) : null;
          elChildren(txBody, 'p').forEach(function (pEl) { paras.push(parseSlideParagraph(pEl, theme, levels)); });
        }
        cells.push({ paras: paras, fill: cellFill, span: Math.max(1, span), rowSpan: Math.max(1, rowSpan), vMerge: !!vMerge, hMerge: !!hMerge, gridIdx: gridIdx, margins: margins, anchor: anchor });
        /* Every <a:tc> occupies exactly one grid column in sequence;
           the spanning cell's width comes from its span, not from
           skipping grid positions. */
        gridIdx += 1;
      });
      rows.push({ h: rowH, cells: cells });
    });
    if (!rows.length || !grid.length) return { kind: 'unsupported' };
    return { kind: 'table', box: box, grid: grid, rows: rows, firstRow: !!firstRow };
  }
  function parseConnectorShape(el, tf, ctx) {
    var spPr = elChild(el, 'spPr');
    var box = shapeBox(spPr, tf) || { x: 0, y: 0, w: 100, h: 0 };
    var xfrm = spPr && elChild(spPr, 'xfrm');
    var flipH = xfrm && xfrm.getAttribute('flipH') === '1';
    var flipV = xfrm && xfrm.getAttribute('flipV') === '1';
    var line = null;
    if (spPr) {
      var ln = elChild(spPr, 'ln');
      if (ln && !elChild(ln, 'noFill')) {
        var lc = solidFillColor(ln, ctx && ctx.theme) || { r: 0, g: 0, b: 0 };
        var lw = ln.getAttribute('w') ? parseFloat(ln.getAttribute('w')) / EMU_PER_PT : 1;
        line = { color: lc, width: Math.max(0.5, lw) };
      }
    }
    return { kind: 'line', box: box, flipH: !!flipH, flipV: !!flipV, line: line || { color: { r: 0, g: 0, b: 0 }, width: 1 } };
  }
  function parsePicShape(el, tf, rels, dir) {
    var spPr = elChild(el, 'spPr');
    var box = shapeBox(spPr, tf) || { x: 0, y: 0, w: 100, h: 100 };
    var blipFill = elChild(el, 'blipFill');
    var blip = blipFill && elChild(blipFill, 'blip');
    var mediaPath = null;
    if (blip) {
      var target = rels[relAttr(blip, 'embed')];
      if (target) mediaPath = resolveTarget(dir, target);
    }
    var crop = null;
    var srcRect = blipFill && elChild(blipFill, 'srcRect');
    if (srcRect) {
      crop = {
        l: (parseFloat(srcRect.getAttribute('l') || '0') || 0) / 100000,
        t: (parseFloat(srcRect.getAttribute('t') || '0') || 0) / 100000,
        r: (parseFloat(srcRect.getAttribute('r') || '0') || 0) / 100000,
        b: (parseFloat(srcRect.getAttribute('b') || '0') || 0) / 100000
      };
      if (!(crop.l || crop.t || crop.r || crop.b)) crop = null;
    }
    return { kind: 'pic', box: box, mediaPath: mediaPath, crop: crop };
  }
  function walkSlideShapes(container, tf, out, rels, dir, ctx) {
    var kids = container.childNodes || [];
    for (var i = 0; i < kids.length; i++) {
      var el = kids[i];
      if (el.nodeType !== 1) continue;
      var ln = localNameOf(el);
      if (ln === 'grpSp') {
        var ntf = tf;
        var grpPr = elChild(el, 'grpSpPr');
        var xfrm = grpPr && elChild(grpPr, 'xfrm');
        var off = xfrm && elChild(xfrm, 'off'), ext = xfrm && elChild(xfrm, 'ext');
        var chOff = xfrm && elChild(xfrm, 'chOff'), chExt = xfrm && elChild(xfrm, 'chExt');
        if (off && ext && chOff && chExt) {
          var sx = parseFloat(ext.getAttribute('cx')) / parseFloat(chExt.getAttribute('cx'));
          var sy = parseFloat(ext.getAttribute('cy')) / parseFloat(chExt.getAttribute('cy'));
          var ox = parseFloat(off.getAttribute('x')) / EMU_PER_PT, oy = parseFloat(off.getAttribute('y')) / EMU_PER_PT;
          var cx = parseFloat(chOff.getAttribute('x')) / EMU_PER_PT, cy = parseFloat(chOff.getAttribute('y')) / EMU_PER_PT;
          ntf = { dx: tf.dx + (ox - cx * sx) * tf.sx, dy: tf.dy + (oy - cy * sy) * tf.sy, sx: tf.sx * sx, sy: tf.sy * sy };
        }
        walkSlideShapes(el, ntf, out, rels, dir, ctx);
      } else if (ln === 'sp') {
        out.push(parseTextShape(el, tf, ctx));
      } else if (ln === 'pic') {
        out.push(parsePicShape(el, tf, rels, dir));
      } else if (ln === 'cxnSp') {
        out.push(parseConnectorShape(el, tf, ctx));
      } else if (ln === 'graphicFrame') {
        out.push(parseTableShape(el, tf, ctx));
      }
    }
  }
  function parseSlideDoc(doc, rels, dir, ctx) {
    var root = doc.documentElement;
    var cSld = elChild(root, 'cSld');
    var theme = ctx && ctx.theme;
    var bg = null;
    var bgEl = cSld && elChild(cSld, 'bg');
    if (bgEl) {
      var bgPr = elChild(bgEl, 'bgPr');
      bg = solidFillColor(bgPr, theme) || gradientFirstColor(bgPr, theme);
    }
    /* Background fallback chain: slide -> layout -> master. */
    if (!bg && ctx) bg = ctx.layoutBg || ctx.masterBg || null;
    var shapes = [];
    var spTree = cSld && elChild(cSld, 'spTree');
    if (spTree) walkSlideShapes(spTree, { dx: 0, dy: 0, sx: 1, sy: 1 }, shapes, rels, dir, ctx);
    return { bg: bg, shapes: shapes };
  }
  async function parsePptx(zip, prog) {
    var presXml = await zip.file('ppt/presentation.xml').async('text');
    var presDoc = xmlDoc(presXml);
    var sldSz = elDescendants(presDoc.documentElement, 'sldSz')[0];
    var slideW = sldSz ? parseFloat(sldSz.getAttribute('cx')) / EMU_PER_PT : 960;
    var slideH = sldSz ? parseFloat(sldSz.getAttribute('cy')) / EMU_PER_PT : 540;
    var presRels = {};
    if (zip.file('ppt/_rels/presentation.xml.rels')) {
      presRels = parseRels(await zip.file('ppt/_rels/presentation.xml.rels').async('text'));
    }
    var order = [];
    elDescendants(presDoc.documentElement, 'sldId').forEach(function (idEl) {
      var target = presRels[relAttr(idEl, 'id')];
      if (target) order.push(resolveTarget('ppt', target));
    });
    if (!order.length) {
      var names = Object.keys(zip.files).filter(function (n) { return /^ppt\/slides\/slide\d+\.xml$/.test(n); });
      names.sort(function (a, b) { return parseInt(a.match(/(\d+)\.xml$/)[1], 10) - parseInt(b.match(/(\d+)\.xml$/)[1], 10); });
      order = names;
    }
    var slides = [];
    var skipped = 0;
    /* --- Slide masters, layouts and themes (placeholder inheritance) --- */
    var themeCache = {};
    async function loadTheme(path) {
      if (!path) return { colors: {}, lnWidths: [0.75, 1.5, 2.25] };
      if (themeCache[path]) return themeCache[path];
      var rec = { colors: {}, lnWidths: [0.75, 1.5, 2.25] };
      try {
        var f = zip.file(path);
        if (f) {
          var themeDoc = xmlDoc(await f.async('text'));
          rec.colors = parseThemeColors(themeDoc);
          rec.lnWidths = parseThemeLnWidths(themeDoc);
        }
      } catch (e) { /* fall back to the built-in palette */ }
      themeCache[path] = rec;
      return rec;
    }
    async function relsFor(partPath) {
      var dir = partPath.split('/').slice(0, -1).join('/');
      var relsPath = dir + '/_rels/' + partPath.split('/').pop() + '.rels';
      if (!zip.file(relsPath)) return {};
      try { return parseRels(await zip.file(relsPath).async('text')); } catch (e) { return {}; }
    }
    function bgOfDoc(doc, theme) {
      var cSld = doc.documentElement && elChild(doc.documentElement, 'cSld');
      var bgEl = cSld && elChild(cSld, 'bg');
      if (!bgEl) return null;
      var bgPr = elChild(bgEl, 'bgPr');
      return solidFillColor(bgPr, theme) || gradientFirstColor(bgPr, theme);
    }
    var masters = [];
    var layoutByPath = {};
    try {
      var masterPaths = [];
      elDescendants(presDoc.documentElement, 'sldMasterId').forEach(function (idEl) {
        var target = presRels[relAttr(idEl, 'id')];
        if (target) masterPaths.push(resolveTarget('ppt', target));
      });
      for (var mi = 0; mi < masterPaths.length; mi++) {
        var mPath = masterPaths[mi];
        var mFile = zip.file(mPath);
        if (!mFile) continue;
        var mDoc = xmlDoc(await mFile.async('text'));
        var mRels = await relsFor(mPath);
        var mDir = mPath.split('/').slice(0, -1).join('/');
        var themePath = null;
        Object.keys(mRels).forEach(function (rid) {
          var t = mRels[rid];
          if (/\/theme\/theme\d+\.xml$/.test(t)) themePath = resolveTarget(mDir, t);
        });
        if (!themePath && zip.file('ppt/theme/theme1.xml')) themePath = 'ppt/theme/theme1.xml';
        var themeRec = await loadTheme(themePath);
        var theme = themeRec.colors;
        var txStylesEl = elChild(mDoc.documentElement, 'txStyles');
        var txStyles = {
          title: parseLevelStyles(txStylesEl && elChild(txStylesEl, 'titleStyle'), theme),
          body: parseLevelStyles(txStylesEl && elChild(txStylesEl, 'bodyStyle'), theme),
          other: parseLevelStyles(txStylesEl && elChild(txStylesEl, 'otherStyle'), theme)
        };
        var master = { theme: theme, lnWidths: themeRec.lnWidths, txStyles: txStyles, bg: bgOfDoc(mDoc, theme), phShapes: [] };
        var mCSld = elChild(mDoc.documentElement, 'cSld');
        var mSpTree = mCSld && elChild(mCSld, 'spTree');
        if (mSpTree) {
          var mKids = mSpTree.childNodes || [];
          for (var pi = 0; pi < mKids.length; pi++) {
            var mEl = mKids[pi];
            if (mEl.nodeType === 1 && localNameOf(mEl) === 'sp' && phInfoOf(mEl)) master.phShapes.push(mEl);
          }
        }
        masters.push(master);
        elDescendants(mDoc.documentElement, 'sldLayoutId').forEach(function (idEl) {
          var target = mRels[relAttr(idEl, 'id')];
          if (target) layoutByPath[resolveTarget(mDir, target)] = master;
        });
      }
    } catch (e) { /* masters/layouts are best-effort; slides still parse */ }
    var layoutDocCache = {};
    async function layoutPlaceholders(layoutPath) {
      if (layoutDocCache[layoutPath]) return layoutDocCache[layoutPath];
      var rec = { shapes: [], bg: null };
      try {
        var f = zip.file(layoutPath);
        if (f) {
          var doc = xmlDoc(await f.async('text'));
          var master = layoutByPath[layoutPath];
          rec.bg = master ? bgOfDoc(doc, master.theme) : null;
          var cSld = elChild(doc.documentElement, 'cSld');
          var spTree = cSld && elChild(cSld, 'spTree');
          if (spTree) {
            var kids = spTree.childNodes || [];
            for (var i = 0; i < kids.length; i++) {
              var el = kids[i];
              if (el.nodeType === 1 && localNameOf(el) === 'sp' && phInfoOf(el)) rec.shapes.push(el);
            }
          }
        }
      } catch (e) { /* ignore */ }
      layoutDocCache[layoutPath] = rec;
      return rec;
    }
    for (var i = 0; i < order.length; i++) {
      var path = order[i];
      var file = zip.file(path);
      if (!file) continue;
      var dir = path.split('/').slice(0, -1).join('/');
      var slideRels = {};
      var relsPath = dir + '/_rels/' + path.split('/').pop() + '.rels';
      if (zip.file(relsPath)) slideRels = parseRels(await zip.file(relsPath).async('text'));
      /* Resolve this slide's layout (and through it, its master/theme). */
      var ctx = null;
      var layoutPath = null;
      Object.keys(slideRels).forEach(function (rid) {
        var t = slideRels[rid];
        if (/slideLayouts\/slideLayout\d+\.xml$/.test(t)) layoutPath = resolveTarget(dir, t);
      });
      var master = (layoutPath && layoutByPath[layoutPath]) || masters[0] || null;
      var layoutRec = layoutPath ? await layoutPlaceholders(layoutPath) : null;
      if (master || layoutRec) {
        var phShapes = layoutRec ? layoutRec.shapes : [];
        var masterPhShapes = master ? master.phShapes : [];
        ctx = {
          theme: master ? master.theme : {},
          lnWidths: master ? master.lnWidths : [0.75, 1.5, 2.25],
          txStyles: master ? master.txStyles : null,
          layoutBg: layoutRec ? layoutRec.bg : null,
          masterBg: master ? master.bg : null,
          findLayoutPh: function (type, idx) { return matchPhShape(phShapes, type, idx); },
          findMasterPh: function (type, idx) { return matchPhShape(masterPhShapes, type, idx); }
        };
      }
      var slide = parseSlideDoc(xmlDoc(await file.async('text')), slideRels, dir, ctx);
      for (var j = 0; j < slide.shapes.length; j++) {
        var sh = slide.shapes[j];
        if (sh.kind === 'unsupported') { skipped++; continue; }
        if (sh.kind === 'pic' && sh.mediaPath) {
          var media = zip.file(sh.mediaPath);
          if (media) {
            var ext = (sh.mediaPath.split('.').pop() || '').toLowerCase();
            if (ext === 'jpg' || ext === 'jpeg' || ext === 'png') {
              var b64 = await media.async('base64');
              sh.dataUrl = 'data:image/' + (ext === 'png' ? 'png' : 'jpeg') + ';base64,' + b64;
              sh.imgFormat = ext === 'png' ? 'PNG' : 'JPEG';
            } else if (typeof document !== 'undefined') {
              /* GIF/BMP/WebP: redraw through a canvas as PNG. */
              try {
                var bytes = await media.async('uint8array');
                var blobUrl = URL.createObjectURL(new Blob([bytes]));
                var img = await loadImage(blobUrl);
                URL.revokeObjectURL(blobUrl);
                var cv = document.createElement('canvas');
                cv.width = img.naturalWidth; cv.height = img.naturalHeight;
                cv.getContext('2d').drawImage(img, 0, 0);
                sh.dataUrl = cv.toDataURL('image/png');
                sh.imgFormat = 'PNG';
              } catch (e) { /* leave the picture out */ }
            }
            /* srcRect crop: redraw only the visible region. */
            if (sh.crop && sh.dataUrl && typeof document !== 'undefined') {
              try {
                var cimg = await loadImage(sh.dataUrl);
                var sx = Math.round(sh.crop.l * cimg.naturalWidth);
                var sy = Math.round(sh.crop.t * cimg.naturalHeight);
                var sw = Math.round((1 - sh.crop.l - sh.crop.r) * cimg.naturalWidth);
                var shh = Math.round((1 - sh.crop.t - sh.crop.b) * cimg.naturalHeight);
                if (sw > 0 && shh > 0) {
                  var ccv = document.createElement('canvas');
                  ccv.width = sw; ccv.height = shh;
                  ccv.getContext('2d').drawImage(cimg, sx, sy, sw, shh, 0, 0, sw, shh);
                  sh.dataUrl = ccv.toDataURL('image/png');
                  sh.imgFormat = 'PNG';
                }
              } catch (e) { /* keep the uncropped picture */ }
            }
          }
        }
      }
      slides.push(slide);
      if (prog) prog((i + 1) / order.length * 0.5, 'Reading slide ' + (i + 1) + ' of ' + order.length + '...');
    }
    return { width: slideW, height: slideH, slides: slides, skipped: skipped };
  }
  function jsPdfFontName(face) {
    var f = String(face || '').toLowerCase();
    if (/times|georgia|serif|garamond|cambria|palatino/.test(f)) return 'times';
    if (/courier|mono|consolas|monaco|menlo/.test(f)) return 'courier';
    return 'helvetica';
  }
  function setRunFont(doc, r) {
    doc.setFont(jsPdfFontName(r.font), r.bold && r.italic ? 'bolditalic' : r.bold ? 'bold' : r.italic ? 'italic' : 'normal');
    doc.setFontSize(r.size);
  }
  function maxRunSize(runs) {
    var m = 18;
    runs.forEach(function (r) { if (r.size > m) m = r.size; });
    return m;
  }
  function wrapRuns(doc, seg, maxW, wrap, align, lines) {
    if (!wrap || !seg.length) {
      lines.push({ runs: seg, align: align, size: maxRunSize(seg) });
      return;
    }
    var words = [];
    seg.forEach(function (r) {
      r.text.split(/(\s+)/).forEach(function (p) {
        if (p !== '') words.push({ text: p, run: r });
      });
    });
    var cur = [], curW = 0;
    function flush() {
      if (!cur.length) return;
      var runs = [];
      cur.forEach(function (wd) {
        var last = runs[runs.length - 1];
        if (last && last.src === wd.run) last.text += wd.text;
        else runs.push({ text: wd.text, size: wd.run.size, bold: wd.run.bold, italic: wd.run.italic, underline: wd.run.underline, color: wd.run.color, font: wd.run.font, src: wd.run });
      });
      runs.forEach(function (r) { delete r.src; });
      lines.push({ runs: runs, align: align, size: maxRunSize(runs) });
      cur = []; curW = 0;
    }
    words.forEach(function (wd) {
      setRunFont(doc, wd.run);
      var ww = doc.getTextWidth(wd.text);
      if (cur.length && curW + ww > maxW && !/^\s+$/.test(wd.text)) flush();
      if (/^\s+$/.test(wd.text) && !cur.length) return;
      cur.push(wd); curW += ww;
    });
    flush();
  }
  var GEOM_POINTS = {
    triangle: [[0.5, 0], [1, 1], [0, 1]],
    isoscelesTriangle: [[0.5, 0], [1, 1], [0, 1]],
    diamond: [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]],
    parallelogram: [[0.28, 0], [1, 0], [0.72, 1], [0, 1]],
    trapezoid: [[0.2, 0], [0.8, 0], [1, 1], [0, 1]],
    chevron: [[0, 0], [0.6, 0], [1, 0.5], [0.6, 1], [0, 1], [0.4, 0.5]],
    pentagon: [[0, 0.4], [0.5, 0], [1, 0.4], [1, 1], [0, 1]],
    homePlate: [[0, 0.4], [0.5, 0], [1, 0.4], [1, 1], [0, 1]],
    rightTriangle: [[0, 0], [1, 1], [0, 1]],
    hexagon: [[0.25, 0], [0.75, 0], [1, 0.5], [0.75, 1], [0.25, 1], [0, 0.5]],
    octagon: [[0.3, 0], [0.7, 0], [1, 0.3], [1, 0.7], [0.7, 1], [0.3, 1], [0, 0.7], [0, 0.3]]
  };
  /* Rotate a point about a centre by rad radians, clockwise in
     screen coordinates (y grows downward), matching OOXML rot. */
  function rotPt(x, y, cx, cy, rad) {
    var dx = x - cx, dy = y - cy;
    var c = Math.cos(rad), s = Math.sin(rad);
    return { x: cx + dx * c - dy * s, y: cy + dx * s + dy * c };
  }
  function drawPolygon(doc, pts, style) {
    if (typeof doc.moveTo !== 'function' || typeof doc.lineTo !== 'function') return false;
    doc.moveTo(pts[0].x, pts[0].y);
    for (var i = 1; i < pts.length; i++) doc.lineTo(pts[i].x, pts[i].y);
    doc.close();
    if (style === 'FD') doc.fillStroke();
    else if (style === 'F') doc.fill();
    else doc.stroke();
    return true;
  }
  function drawShapeGeometry(doc, box, geom, fill, line, rotDeg) {
    var style = (fill && line) ? 'FD' : (fill ? 'F' : (line ? 'D' : null));
    if (!style) return;
    if (fill) doc.setFillColor(fill.r, fill.g, fill.b);
    if (line) { doc.setDrawColor(line.color.r, line.color.g, line.color.b); doc.setLineWidth(line.width); }
    var rad = (rotDeg || 0) * Math.PI / 180;
    var cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    var pts = GEOM_POINTS[geom];
    if (pts) {
      var abs = pts.map(function (p) {
        var x = box.x + p[0] * box.w, y = box.y + p[1] * box.h;
        return rad ? rotPt(x, y, cx, cy, rad) : { x: x, y: y };
      });
      if (drawPolygon(doc, abs, style)) return;
    }
    if (rad && geom !== 'ellipse') {
      /* Rotated rect / roundRect: draw as a rotated polygon (corners
         lose their rounding when rotated — an acceptable trade). */
      var corners = [
        rotPt(box.x, box.y, cx, cy, rad), rotPt(box.x + box.w, box.y, cx, cy, rad),
        rotPt(box.x + box.w, box.y + box.h, cx, cy, rad), rotPt(box.x, box.y + box.h, cx, cy, rad)
      ];
      if (drawPolygon(doc, corners, style)) return;
    }
    if (geom === 'ellipse') {
      doc.ellipse(box.x + box.w / 2, box.y + box.h / 2, box.w / 2, box.h / 2, style);
    } else if (geom === 'roundRect' || geom === 'roundSameRect' || geom === 'round1Rect' || geom === 'round2DiagRect' || geom === 'round2SameRect') {
      var r = Math.min(box.w, box.h) * 0.12;
      doc.roundedRect(box.x, box.y, box.w, box.h, r, r, style);
    } else if (geom === 'line') {
      if (line) { doc.setDrawColor(line.color.r, line.color.g, line.color.b); doc.setLineWidth(line.width); doc.line(box.x, box.y + box.h / 2, box.x + box.w, box.y + box.h / 2); }
    } else {
      doc.rect(box.x, box.y, box.w, box.h, style);
    }
  }
  function alphaNum(n) {
    var s = '';
    while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
    return s || 'A';
  }
  function romanNum(n) {
    if (n <= 0) return 'i';
    var table = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
    var s = '';
    table.forEach(function (pair) { while (n >= pair[0]) { s += pair[1]; n -= pair[0]; } });
    return s;
  }
  function formatAutoNum(type, n) {
    switch (type) {
      case 'arabicParenR': return n + ')';
      case 'arabicParenBoth': return '(' + n + ')';
      case 'arabicPlain': return String(n);
      case 'alphaLcPeriod': return alphaNum(n).toLowerCase() + '.';
      case 'alphaLcParenR': return alphaNum(n).toLowerCase() + ')';
      case 'alphaLcParenBoth': return '(' + alphaNum(n).toLowerCase() + ')';
      case 'alphaUcPeriod': return alphaNum(n) + '.';
      case 'alphaUcParenR': return alphaNum(n) + ')';
      case 'alphaUcParenBoth': return '(' + alphaNum(n) + ')';
      case 'romanLcPeriod': return romanNum(n).toLowerCase() + '.';
      case 'romanLcParenR': return romanNum(n).toLowerCase() + ')';
      case 'romanLcParenBoth': return '(' + romanNum(n).toLowerCase() + ')';
      case 'romanUcPeriod': return romanNum(n) + '.';
      case 'romanUcParenR': return romanNum(n) + ')';
      case 'romanUcParenBoth': return '(' + romanNum(n) + ')';
      default: return n + '.';
    }
  }
  function renderTableShape(doc, sh) {
    var box = sh.box;
    var x = box.x, y = box.y;
    var colX = [x];
    sh.grid.forEach(function (gw) { colX.push(colX[colX.length - 1] + gw); });
    var totalW = colX[colX.length - 1] - x;
    if (totalW <= 0) return;
    var rowH = sh.rows.map(function (r) { return r.h > 0 ? r.h : 20; });
    var rowY = [y];
    rowH.forEach(function (rh) { rowY.push(rowY[rowY.length - 1] + rh); });
    sh.rows.forEach(function (row, ri) {
      row.cells.forEach(function (cell) {
        if (cell.vMerge || cell.hMerge) return; /* covered by the spanning cell */
        var gi = Math.min(cell.gridIdx, sh.grid.length - 1);
        var cx = colX[gi];
        var cw = 0;
        for (var s = 0; s < cell.span && gi + s < sh.grid.length; s++) cw += sh.grid[gi + s];
        if (cw <= 0) cw = totalW / row.cells.length;
        var rh = 0;
        for (var rs = 0; rs < cell.rowSpan && ri + rs < rowH.length; rs++) rh += rowH[ri + rs];
        var cy = rowY[ri];
        /* Only the cell's own explicit fill is drawn. Table-style fills
           (header colour, banded rows) live in the application, not the
           file, so they are not invented here. */
        if (cell.fill) { doc.setFillColor(cell.fill.r, cell.fill.g, cell.fill.b); doc.rect(cx, cy, cw, rh, 'F'); }
        doc.setDrawColor(160, 160, 160); doc.setLineWidth(0.5); doc.rect(cx, cy, cw, rh, 'D');
        var m = cell.margins;
        var tx0 = cx + m.l, ty0 = cy + m.t;
        var tw = Math.max(10, cw - m.l - m.r);
        var th = Math.max(10, rh - m.t - m.b);
        var lines = [];
        (cell.paras || []).forEach(function (para) {
          var segments = [[]];
          para.runs.forEach(function (r) {
            if (r.br) segments.push([]);
            else segments[segments.length - 1].push(r);
          });
          segments.forEach(function (seg) {
            if (!seg.length) { lines.push({ runs: [], align: para.align, size: 12 }); return; }
            wrapRuns(doc, seg, tw, true, para.align, lines);
          });
        });
        var totalH = 0;
        lines.forEach(function (l) { totalH += l.size * 1.2; });
        var ly = ty0;
        if (cell.anchor === 'ctr') ly = ty0 + Math.max(0, (th - totalH) / 2);
        else if (cell.anchor === 'b') ly = ty0 + Math.max(0, th - totalH);
        lines.forEach(function (line) {
          var baseline = ly + line.size * 0.85;
          var lineW = 0;
          line.runs.forEach(function (r) { setRunFont(doc, r); lineW += doc.getTextWidth(r.text); });
          var rx = tx0;
          if (line.align === 'center') rx = tx0 + (tw - lineW) / 2;
          else if (line.align === 'right') rx = tx0 + tw - lineW;
          line.runs.forEach(function (r) {
            setRunFont(doc, r);
            if (r.color) doc.setTextColor(r.color.r, r.color.g, r.color.b); else doc.setTextColor(0, 0, 0);
            doc.text(r.text, rx, baseline);
            if (r.underline) {
              var rw = doc.getTextWidth(r.text);
              doc.setDrawColor(r.color ? r.color.r : 0, r.color ? r.color.g : 0, r.color ? r.color.b : 0);
              doc.setLineWidth(Math.max(0.5, r.size / 24));
              doc.line(rx, baseline + r.size * 0.12, rx + rw, baseline + r.size * 0.12);
            }
            rx += doc.getTextWidth(r.text);
          });
          ly += line.size * 1.2;
        });
      });
    });
  }
  function renderTextShape(doc, sh) {
    var box = sh.box;
    var rot = sh.rot || 0;
    var x0 = box.x + sh.insets.l, y0 = box.y + sh.insets.t;
    var w = Math.max(10, box.w - sh.insets.l - sh.insets.r);
    var h = Math.max(10, box.h - sh.insets.t - sh.insets.b);
    var counters = {};
    var lines = [];
    sh.paras.forEach(function (para) {
      var paraSize = 18;
      para.runs.forEach(function (r) { if (r.size && r.size > paraSize) paraSize = r.size; });
      var marL = Math.max(0, para.marL || 0);
      var bulletX = Math.max(0, marL + (para.indent || 0));
      var bulletText = null;
      if (para.bullet && para.bullet.type === 'char') bulletText = para.bullet.char;
      else if (para.bullet && para.bullet.type === 'autoNum') {
        var lvl = para.level || 0;
        counters[lvl] = (counters[lvl] || 0) + 1;
        for (var L = lvl + 1; L < 9; L++) counters[L] = 0;
        bulletText = formatAutoNum(para.bullet.numType, counters[lvl] + (para.bullet.startAt || 1) - 1);
      }
      var segments = [[]];
      para.runs.forEach(function (r) {
        if (r.br) segments.push([]);
        else segments[segments.length - 1].push(r);
      });
      var paraLines = [];
      segments.forEach(function (seg) {
        if (!seg.length) { paraLines.push({ runs: [], align: para.align, size: paraSize }); return; }
        wrapRuns(doc, seg, Math.max(10, w - marL), sh.wrap, para.align, paraLines);
      });
      var lnSpc = para.lnSpc;
      var sb = para.spcBef ? (para.spcBef.pts !== undefined ? para.spcBef.pts : para.spcBef.pct * paraSize) : 0;
      var sa = para.spcAft ? (para.spcAft.pts !== undefined ? para.spcAft.pts : para.spcAft.pct * paraSize) : 0;
      paraLines.forEach(function (l, li) {
        l.h = lnSpc ? (lnSpc.pts !== undefined ? lnSpc.pts : l.size * 1.2 * lnSpc.pct) : l.size * 1.2;
        l.xOff = marL;
        l.sb = li === 0 ? sb : 0;
        l.sa = li === paraLines.length - 1 ? sa : 0;
        if (li === 0 && bulletText) { l.bullet = bulletText; l.bulletX = bulletX; }
        lines.push(l);
      });
    });
    var totalH = 0;
    lines.forEach(function (l) { totalH += l.sb + l.h + l.sa; });
    if (sh.autoFit) {
      /* <a:spAutoFit/>: the shape resizes to fit its text. Height always
         shrinks/grows to the content; width too when wrapping is off.
         The top-left corner is kept (bottom/centre-anchored shapes keep
         their bottom/centre edge instead). */
      var newH = totalH + sh.insets.t + sh.insets.b;
      var newW = box.w;
      if (!sh.wrap) {
        var maxW = 0;
        lines.forEach(function (l) {
          var lw = l.xOff || 0;
          l.runs.forEach(function (r) { setRunFont(doc, r); lw += doc.getTextWidth(r.text); });
          if (l.bullet) {
            var br = l.runs[0] || { size: l.size, bold: false, italic: false, font: '' };
            setRunFont(doc, br);
            lw = Math.max(lw, (l.bulletX || 0) + doc.getTextWidth(l.bullet + ' '));
          }
          if (lw > maxW) maxW = lw;
        });
        newW = maxW + sh.insets.l + sh.insets.r;
      }
      var newBox = { x: box.x, y: box.y, w: Math.max(10, newW), h: Math.max(10, newH) };
      if (sh.anchor === 'b') newBox.y = box.y + box.h - newBox.h;
      else if (sh.anchor === 'ctr') newBox.y = box.y + (box.h - newBox.h) / 2;
      box = newBox;
      x0 = box.x + sh.insets.l; y0 = box.y + sh.insets.t;
      w = Math.max(10, box.w - sh.insets.l - sh.insets.r);
      h = Math.max(10, box.h - sh.insets.t - sh.insets.b);
    }
    drawShapeGeometry(doc, box, sh.geom || 'rect', sh.fill, sh.line, rot);
    var y = y0;
    if (sh.anchor === 'ctr') y = y0 + Math.max(0, (h - totalH) / 2);
    else if (sh.anchor === 'b') y = y0 + Math.max(0, h - totalH);
    var rad = rot * Math.PI / 180;
    var cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    function place(x, yy) { return rad ? rotPt(x, yy, cx, cy, rad) : { x: x, y: yy }; }
    lines.forEach(function (line) {
      y += line.sb;
      var baseline = y + line.size * 0.85;
      var lineW = 0;
      line.runs.forEach(function (r) { setRunFont(doc, r); lineW += doc.getTextWidth(r.text); });
      var colW = Math.max(10, w - line.xOff);
      var rx = x0 + line.xOff;
      if (line.align === 'center') rx = x0 + line.xOff + (colW - lineW) / 2;
      else if (line.align === 'right') rx = x0 + line.xOff + colW - lineW;
      if (line.bullet) {
        var bRun = line.runs[0] || { size: line.size, bold: false, italic: false, color: null, font: '' };
        setRunFont(doc, bRun);
        if (bRun.color) doc.setTextColor(bRun.color.r, bRun.color.g, bRun.color.b); else doc.setTextColor(0, 0, 0);
        var bp = place(x0 + line.bulletX, baseline);
        if (rad) doc.text(line.bullet, bp.x, bp.y, { angle: -rot });
        else doc.text(line.bullet, bp.x, bp.y);
      }
      line.runs.forEach(function (r) {
        setRunFont(doc, r);
        if (r.color) doc.setTextColor(r.color.r, r.color.g, r.color.b); else doc.setTextColor(0, 0, 0);
        var rp = place(rx, baseline);
        var rw = doc.getTextWidth(r.text);
        if (rad) doc.text(r.text, rp.x, rp.y, { angle: -rot });
        else doc.text(r.text, rp.x, rp.y);
        if (r.underline) {
          doc.setDrawColor(r.color ? r.color.r : 0, r.color ? r.color.g : 0, r.color ? r.color.b : 0);
          doc.setLineWidth(Math.max(0.5, r.size / 24));
          var u1 = place(rx, baseline + r.size * 0.12);
          var u2 = rad
            ? { x: u1.x + rw * Math.cos(rad), y: u1.y + rw * Math.sin(rad) }
            : { x: rx + rw, y: baseline + r.size * 0.12 };
          doc.line(u1.x, u1.y, u2.x, u2.y);
        }
        rx += rw;
      });
      y += line.h + line.sa;
    });
  }
  async function toolPptxToPdf(files, opts, prog) {
    needLib('jszip'); needLib('jspdf');
    var file = files[0]; assertSize(file);
    var zip = new global.JSZip();
    await zip.loadAsync(await readArrayBuffer(file));
    if (!zip.file('ppt/presentation.xml')) {
      throw new Error('This does not look like a PowerPoint (.pptx) file. Only .pptx files are supported — older .ppt files need to be re-saved as .pptx first.');
    }
    var model = await parsePptx(zip, prog);
    if (!model.slides.length) throw new Error('No slides were found in this presentation.');
    var doc = null;
    for (var i = 0; i < model.slides.length; i++) {
      var slide = model.slides[i];
      if (!doc) {
        doc = new global.jspdf.jsPDF({ unit: 'pt', format: [model.width, model.height], orientation: model.width > model.height ? 'landscape' : 'portrait', compress: true });
      } else {
        doc.addPage([model.width, model.height], model.width > model.height ? 'landscape' : 'portrait');
      }
      if (slide.bg) { doc.setFillColor(slide.bg.r, slide.bg.g, slide.bg.b); doc.rect(0, 0, model.width, model.height, 'F'); }
      slide.shapes.forEach(function (sh) {
        if (sh.kind === 'text') renderTextShape(doc, sh);
        else if (sh.kind === 'table') renderTableShape(doc, sh);
        else if (sh.kind === 'line') {
          doc.setDrawColor(sh.line.color.r, sh.line.color.g, sh.line.color.b);
          doc.setLineWidth(sh.line.width);
          var x1 = sh.flipH ? sh.box.x + sh.box.w : sh.box.x;
          var x2 = sh.flipH ? sh.box.x : sh.box.x + sh.box.w;
          var y1 = sh.flipV ? sh.box.y + sh.box.h : sh.box.y;
          var y2 = sh.flipV ? sh.box.y : sh.box.y + sh.box.h;
          doc.line(x1, y1, x2, y2);
        }
        else if (sh.kind === 'pic' && sh.dataUrl) {
          try { doc.addImage(sh.dataUrl, sh.imgFormat, sh.box.x, sh.box.y, sh.box.w, sh.box.h); } catch (e) { /* skip a broken picture */ }
        }
      });
      prog(0.5 + (i + 1) / model.slides.length * 0.45, 'Drawing slide ' + (i + 1) + ' of ' + model.slides.length + '...');
    }
    var blob = doc.output('blob');
    var note = null;
    if (model.skipped) {
      note = model.skipped + ' chart/SmartArt shape(s) could not be drawn — charts and SmartArt need a full presentation renderer and are not rendered in this version.';
    }
    var result = { files: [{ name: baseOf(file.name) + '.pdf', blob: blob }] };
    if (note) result.note = note;
    return result;
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
    'pdf-to-powerpoint': { libs: ['pdfjs', 'pptxgenjs'], run: toolPdfToPptx },
    'word-to-pdf': { libs: ['jszip', 'docxpreview', 'html2canvas', 'jspdf'], run: toolWordToPdf },
    'excel-to-pdf': { libs: ['xlsx', 'html2canvas', 'jspdf'], run: toolExcelToPdf },
    'jpg-to-pdf': { libs: ['jspdf'], run: toolImagesToPdf },
    'txt-to-pdf': { libs: ['jspdf'], run: toolTextToPdf },
    'csv-to-pdf': { libs: ['html2canvas', 'jspdf'], run: toolCsvToPdf },
    'html-to-pdf': { libs: ['html2canvas', 'jspdf'], run: toolHtmlToPdf },
    'powerpoint-to-pdf': { libs: ['jszip', 'jspdf'], run: toolPptxToPdf },
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
      fixDocxListMarkers: fixDocxListMarkers,
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
      lineRunsXml: lineRunsXml,
      showTextString: showTextString,
      letterSpacingPts: letterSpacingPts,
      fitLineBoxes: fitLineBoxes,
      parsePptx: parsePptx,
      parseDocxStructure: parseDocxStructure,
      placeFloatingDrawings: placeFloatingDrawings,
      interpretPdfOps: interpretPdfOps,
      isNoiseLine: isNoiseLine,
      excelRowsFromPage: excelRowsFromPage,
      groupRowsByBaseline: groupRowsByBaseline,
      splitRowCells: splitRowCells,
      glyphBlocksFromOps: glyphBlocksFromOps,
      isAlreadySpaced: isAlreadySpaced
    }
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = global.TrustFile;
  }
})(typeof window !== 'undefined' ? window : globalThis);
