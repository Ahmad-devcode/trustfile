/* TrustFile main.js - nav, theme, converter widget with lazy library loading. */
(function () {
  'use strict';
  // Footer year + nav toggle + theme
  var yearEl = document.getElementById('currentYear');
  if (yearEl) yearEl.textContent = new Date().getFullYear();
  var navToggle = document.getElementById('navToggle');
  var siteNav = document.getElementById('siteNav');
  if (navToggle && siteNav) {
    navToggle.addEventListener('click', function () {
      var open = siteNav.classList.toggle('open');
      navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }
  var root = document.documentElement;
  var savedTheme = null;
  try { savedTheme = localStorage.getItem('trustfile-theme'); } catch (e) {}
  if (savedTheme) root.setAttribute('data-theme', savedTheme);
  var themeBtn = document.getElementById('themeToggle');
  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('trustfile-theme', next); } catch (e) {}
    });
  }

  // ---- Converter widget ----
  var dropzone = document.getElementById('dropzone');
  if (!dropzone) return;
  var fileInput = document.getElementById('fileInput');
  var controls = document.getElementById('converterControls');
  var fileNameEl = document.getElementById('fileName');
  var fileSizeEl = document.getElementById('fileSize');
  var targetSelect = document.getElementById('targetSelect');
  var convertBtn = document.getElementById('convertBtn');
  var resetBtn = document.getElementById('resetBtn');
  var statusMsg = document.getElementById('statusMsg');
  var errorMsg = document.getElementById('errorMsg');
  var currentFile = null;
  var presetTarget = dropzone.getAttribute('data-target') || '';

  var TARGETS = {
    jpg: ['png', 'webp', 'pdf'], jpeg: ['png', 'webp', 'pdf'],
    png: ['jpg', 'webp', 'pdf'], webp: ['jpg', 'png', 'pdf'],
    gif: ['jpg', 'png', 'pdf'], bmp: ['jpg', 'png', 'pdf'],
    pdf: ['docx', 'txt', 'jpg', 'png'],
    txt: ['pdf', 'docx'], docx: ['txt', 'html'],
    xlsx: ['csv', 'json'], csv: ['xlsx', 'json', 'pdf']
  };
  var LABELS = { jpg: 'JPG image', png: 'PNG image', webp: 'WebP image', pdf: 'PDF document',
    docx: 'Word (.docx)', txt: 'Text (.txt)', html: 'HTML (.html)', csv: 'CSV (.csv)',
    json: 'JSON (.json)', xlsx: 'Excel (.xlsx)' };
  var LIBS = {
    jspdf: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
    mammoth: 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js',
    pdfjs: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
    xlsx: 'https://cdn.sheetjs.com/xlsx-0.20.2/package/dist/xlsx.full.min.js',
    docxlib: 'https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js'
  };
  var loadedLibs = {};
  function loadScript(key) {
    if (loadedLibs[key]) return loadedLibs[key];
    loadedLibs[key] = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = LIBS[key]; s.async = true;
      s.onload = function () {
        if (key === 'pdfjs' && window.pdfjsLib) {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc =
            'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        }
        resolve();
      };
      s.onerror = function () { reject(new Error('Library load nahi hui: ' + key)); };
      document.head.appendChild(s);
    });
    return loadedLibs[key];
  }
  function libsFor(source, target) {
    var need = [];
    if (source === 'pdf' || target === 'pdf') {
      if (source === 'pdf') need.push('pdfjs');
      if (target === 'pdf' && source !== 'pdf') need.push('jspdf');
      if (target === 'pdf' && (source === 'jpg' || source === 'jpeg' || source === 'png' || source === 'webp' || source === 'gif' || source === 'bmp' || source === 'csv')) need.push('jspdf');
    }
    if (source === 'docx') need.push('mammoth');
    if (target === 'docx') need.push('docxlib');
    if (source === 'xlsx' || target === 'xlsx' || target === 'json') need.push('xlsx');
    if (target === 'pdf' && source === 'txt') need.push('jspdf');
    return need.filter(function (v, i, a) { return a.indexOf(v) === i; });
  }
  function extOf(name) {
    var p = String(name || '').split('.');
    return p.length > 1 ? p.pop().toLowerCase() : '';
  }
  function fmtSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }
  function setStatus(t) { statusMsg.textContent = t || ''; }
  function setError(t) { errorMsg.textContent = t || ''; }

  function showFile(file) {
    var ext = extOf(file.name);
    var allowed = dropzone.getAttribute('data-source');
    setError(''); setStatus('');
    if (file.size > 50 * 1024 * 1024) { setError('File 50 MB se bara hai. Chhoti file try karein.'); return; }
    if (allowed && allowed.split(',').indexOf(ext) === -1) {
      setError('Is tool ke liye ' + allowed.split(',').map(function (e) { return '.' + e; }).join(', ') + ' file chahiye. Aapki file .' + ext + ' hai.');
      return;
    }
    if (!TARGETS[ext]) { setError('Is format (.' + ext + ') ki conversion support nahi hai.'); return; }
    currentFile = file;
    fileNameEl.textContent = file.name;
    fileSizeEl.textContent = fmtSize(file.size);
    targetSelect.innerHTML = '';
    TARGETS[ext].forEach(function (t) {
      var o = document.createElement('option');
      o.value = t; o.textContent = LABELS[t] || t.toUpperCase();
      targetSelect.appendChild(o);
    });
    if (presetTarget && TARGETS[ext].indexOf(presetTarget) !== -1) targetSelect.value = presetTarget;
    controls.hidden = false;
    dropzone.style.display = 'none';
    setStatus('Ready. Convert dabayein - file aapke device par hi convert hogi.');
  }
  function reset() {
    currentFile = null; fileInput.value = '';
    controls.hidden = true; dropzone.style.display = '';
    setStatus(''); setError('');
  }
  dropzone.addEventListener('click', function () { fileInput.click(); });
  dropzone.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });
  ['dragover', 'dragenter'].forEach(function (ev) {
    dropzone.addEventListener(ev, function (e) { e.preventDefault(); dropzone.classList.add('dragover'); });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    dropzone.addEventListener(ev, function (e) { e.preventDefault(); dropzone.classList.remove('dragover'); });
  });
  dropzone.addEventListener('drop', function (e) {
    var f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) showFile(f);
  });
  fileInput.addEventListener('change', function () {
    if (fileInput.files[0]) showFile(fileInput.files[0]);
  });
  resetBtn.addEventListener('click', reset);

  convertBtn.addEventListener('click', async function () {
    if (!currentFile) return;
    var target = targetSelect.value;
    var source = extOf(currentFile.name);
    setError(''); setStatus('Converter load ho raha hai...');
    convertBtn.disabled = true;
    try {
      var needs = libsFor(source, target);
      for (var i = 0; i < needs.length; i++) { await loadScript(needs[i]); }
      setStatus('Converting... (aapke browser mein, upload nahi ho raha)');
      var result = await window.TrustFileConvert.convert(currentFile, target);
      if (Array.isArray(result)) {
        for (var p = 0; p < result.length; p++) {
          window.TrustFileConvert.download(result[p], window.TrustFileConvert.outputName(currentFile, target, p + 1));
          await new Promise(function (r) { setTimeout(r, 350); });
        }
        setStatus('Ho gaya! ' + result.length + ' files download ho gayi hain.');
      } else {
        window.TrustFileConvert.download(result, window.TrustFileConvert.outputName(currentFile, target));
        setStatus('Ho gaya! Aapki file download ho gayi hai.');
      }
    } catch (err) {
      setError(err && err.message ? err.message : 'Conversion fail ho gayi. Dobara try karein.');
      setStatus('');
    } finally {
      convertBtn.disabled = false;
    }
  });
})();
