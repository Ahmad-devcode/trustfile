// trustfile-client-converter.js — lifetime-free, client-side converter for TrustFile
// Plain JavaScript, no build step, no API key, no server, no credits.
// Drop-in replacement for the broken ConvertAPI v2 flow in js/main.js:
//   instead of POSTing the file + secret to ConvertAPI, call
//   TrustFileConvert.convert(file, targetFormat) and it returns a Blob.
//
// HOW TO WIRE IT IN (when the project files arrive):
//   1. Add the <script> tags from the LIBRARIES section below to index.html
//      (only the libraries for the conversions you actually offer).
//   2. <script src="/js/client-side-converter.js"></script>  (this file, as js/client-side-converter.js)
//   3. In main.js, replace the ConvertAPI fetch with:
//        const blob = await TrustFileConvert.convert(file, targetExt);
//        TrustFileConvert.download(blob, outputName);
//   The old `const secret = "..."` line can then be DELETED entirely.
//
// SUPPORTED (all in the browser — the file never leaves the user's device):
//   image -> jpg / png / webp            (Canvas API, no library)
//   image(s) -> pdf                      (jsPDF)
//   txt -> pdf / docx / txt              (jsPDF / docx lib)
//   docx -> txt / html                   (mammoth.js)
//   pdf -> txt                           (pdf.js, text layer only)
//   pdf -> jpg / png  (one image per page) (pdf.js render to canvas)
//   pdf -> docx  (plain text, simple formatting — see note in code)
//   xlsx / csv -> xlsx / csv / json      (SheetJS)
//   csv -> pdf  (simple table)           (jsPDF)
// NOT possible fully client-side (honest limit, same as told on 11 Nov):
//   pdf -> docx with full formatting, pptx -> pdf, docx -> pdf with exact
//   layout. For those, keep a clear "not supported in free mode" message
//   instead of a failing API call.
//
// LIBRARIES (load only what you need, before this file):
//   jsPDF:    https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js
//   mammoth:  https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js
//   pdf.js:   https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js
//             (+ pdf.worker.min.js from the same version)
//   SheetJS:  https://cdn.sheetjs.com/xlsx-0.20.2/package/dist/xlsx.full.min.js
//   docx lib: https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js
// If a needed library failed to load, convert() throws a plain-English error
// naming the missing library instead of failing silently.

(function (global) {
  'use strict';

  var IMAGE_TYPES = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'];
  var MIME = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
    pdf: 'application/pdf',
    txt: 'text/plain', html: 'text/html',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    csv: 'text/csv', json: 'application/json'
  };

  function extOf(name) {
    var parts = String(name || '').split('.');
    return parts.length > 1 ? parts.pop().toLowerCase() : '';
  }
  function baseOf(name) {
    return String(name || 'file').replace(/\.[^.]+$/, '');
  }
  function need(libName, ok) {
    if (!ok) throw new Error(libName + ' library load nahi hui — index.html mein uska <script> tag check karein.');
  }
  function readAsArrayBuffer(file) { return file.arrayBuffer(); }
  function readAsText(file) { return file.text(); }
  function readAsDataURL(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(new Error('File parh nahi sakta.')); };
      r.readAsDataURL(file);
    });
  }
  function loadImage(dataUrl) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('Image load nahi hui — format support check karein.')); };
      img.src = dataUrl;
    });
  }
  function canvasToBlob(canvas, mime, quality) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (b) {
        if (b) resolve(b); else reject(new Error('Image convert nahi hui.'));
      }, mime, quality);
    });
  }

  // --- Image -> image (Canvas, no library) ---
  async function imageToImage(file, target) {
    var img = await loadImage(await readAsDataURL(file));
    var canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    var ctx = canvas.getContext('2d');
    if (target === 'jpg' || target === 'jpeg') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    ctx.drawImage(img, 0, 0);
    return canvasToBlob(canvas, MIME[target] || 'image/png', 0.92);
  }

  // --- Image(s) -> PDF (jsPDF) ---
  async function imagesToPdf(files) {
    need('jsPDF', global.jspdf && global.jspdf.jsPDF);
    var doc = new global.jspdf.jsPDF();
    for (var i = 0; i < files.length; i++) {
      var img = await loadImage(await readAsDataURL(files[i]));
      var pageW = doc.internal.pageSize.getWidth();
      var pageH = doc.internal.pageSize.getHeight();
      var ratio = Math.min(pageW / img.naturalWidth, pageH / img.naturalHeight);
      var w = img.naturalWidth * ratio, h = img.naturalHeight * ratio;
      if (i > 0) doc.addPage();
      doc.addImage(img, 'JPEG', (pageW - w) / 2, (pageH - h) / 2, w, h);
    }
    return doc.output('blob');
  }

  // --- Text -> PDF / DOCX ---
  async function textToPdf(text) {
    need('jsPDF', global.jspdf && global.jspdf.jsPDF);
    var doc = new global.jspdf.jsPDF();
    var lines = doc.splitTextToSize(text, 170);
    doc.text(lines, 15, 15);
    return doc.output('blob');
  }
  async function textToDocx(text) {
    need('docx library', global.docx);
    var doc = new global.docx.Document({
      sections: [{ children: text.split(/\n/).map(function (line) {
        return new global.docx.Paragraph({ children: [new global.docx.TextRun(line || ' ')] });
      }) }]
    });
    return global.docx.Packer.toBlob(doc);
  }

  // --- DOCX -> TXT / HTML (mammoth) ---
  async function docxToText(file) {
    need('mammoth.js', global.mammoth);
    var buf = await readAsArrayBuffer(file);
    var res = await global.mammoth.extractRawText({ arrayBuffer: buf });
    return new Blob([res.value], { type: 'text/plain' });
  }
  async function docxToHtml(file) {
    need('mammoth.js', global.mammoth);
    var buf = await readAsArrayBuffer(file);
    var res = await global.mammoth.convertToHtml({ arrayBuffer: buf });
    return new Blob([res.value], { type: 'text/html' });
  }

  // --- PDF -> TXT / images / DOCX (text only) ---
  async function loadPdf(file) {
    need('pdf.js', global.pdfjsLib);
    var buf = await readAsArrayBuffer(file);
    return global.pdfjsLib.getDocument({ data: buf }).promise;
  }
  async function pdfToText(file) {
    var pdf = await loadPdf(file);
    var out = [];
    for (var p = 1; p <= pdf.numPages; p++) {
      var page = await pdf.getPage(p);
      var content = await page.getTextContent();
      out.push(content.items.map(function (it) { return it.str; }).join(' '));
    }
    return new Blob([out.join('\n\n')], { type: 'text/plain' });
  }
  async function pdfToImages(file, target) {
    var pdf = await loadPdf(file);
    var blobs = [];
    for (var p = 1; p <= pdf.numPages; p++) {
      var page = await pdf.getPage(p);
      var viewport = page.getViewport({ scale: 2 });
      var canvas = document.createElement('canvas');
      canvas.width = viewport.width; canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: viewport }).promise;
      blobs.push(await canvasToBlob(canvas, MIME[target] || 'image/png', 0.92));
    }
    return blobs; // one Blob per page — download each as page-1.jpg, page-2.jpg...
  }
  async function pdfToDocx(file) {
    // Text only: formatting simple hogi (yehi limit 11 Nov ko batayi thi).
    var blob = await pdfToText(file);
    return textToDocx(await blob.text());
  }

  // --- Spreadsheet: XLSX / CSV -> XLSX / CSV / JSON (SheetJS) ---
  async function sheetTo(file, target) {
    need('SheetJS (XLSX)', global.XLSX);
    var buf = await readAsArrayBuffer(file);
    var wb = global.XLSX.read(buf, { type: 'array' });
    if (target === 'json') {
      var sheet = wb.Sheets[wb.SheetNames[0]];
      return new Blob([JSON.stringify(global.XLSX.utils.sheet_to_json(sheet), null, 2)], { type: 'application/json' });
    }
    var out = global.XLSX.write(wb, { bookType: target, type: 'array' });
    return new Blob([out], { type: MIME[target] || 'application/octet-stream' });
  }
  async function csvToPdf(file) {
    need('jsPDF', global.jspdf && global.jspdf.jsPDF);
    var text = await readAsText(file);
    var doc = new global.jspdf.jsPDF();
    doc.text(doc.splitTextToSize(text, 170), 15, 15);
    return doc.output('blob');
  }

  // --- Main dispatcher: convert(file, targetExt) -> Blob (or Blob[] for pdf->image) ---
  async function convert(file, target) {
    target = String(target || '').toLowerCase().replace(/^\./, '');
    var source = extOf(file.name);
    if (!target) throw new Error('Target format batayein, masalan "pdf" ya "jpg".');
    if (source === target) throw new Error('File pehle se ' + target.toUpperCase() + ' mein hai.');
    if (IMAGE_TYPES.indexOf(source) !== -1 && IMAGE_TYPES.indexOf(target) !== -1) return imageToImage(file, target);
    if (IMAGE_TYPES.indexOf(source) !== -1 && target === 'pdf') return imagesToPdf([file]);
    if (source === 'txt' && target === 'pdf') return textToPdf(await readAsText(file));
    if (source === 'txt' && target === 'docx') return textToDocx(await readAsText(file));
    if (source === 'docx' && target === 'txt') return docxToText(file);
    if (source === 'docx' && target === 'html') return docxToHtml(file);
    if (source === 'pdf' && target === 'txt') return pdfToText(file);
    if (source === 'pdf' && (target === 'jpg' || target === 'png')) return pdfToImages(file, target);
    if (source === 'pdf' && target === 'docx') return pdfToDocx(file);
    if ((source === 'xlsx' || source === 'csv') && (target === 'xlsx' || target === 'csv' || target === 'json')) return sheetTo(file, target);
    if (source === 'csv' && target === 'pdf') return csvToPdf(file);
    throw new Error('Ye conversion browser mein free nahi hoti: ' + source.toUpperCase() + ' -> ' + target.toUpperCase() + '. (PDF -> Word full formatting aur PPTX -> PDF ke liye server chahiye.)');
  }

  function download(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
  }
  function outputName(file, target, page) {
    var name = baseOf(file.name) + '.' + target;
    return page ? baseOf(file.name) + '-page-' + page + '.' + target : name;
  }

  global.TrustFileConvert = { convert: convert, download: download, outputName: outputName };
})(typeof window !== 'undefined' ? window : globalThis);
