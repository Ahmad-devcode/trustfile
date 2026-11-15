/* TrustFile tool workspace UI — dropzone, file list, options, progress, results.
   Reads its configuration from <script type="application/json" id="tool-config">.
   All processing is done by js/engine.js, in the browser. */
(function () {
  'use strict';
  var cfgEl = document.getElementById('tool-config');
  if (!cfgEl) return;
  var cfg;
  try { cfg = JSON.parse(cfgEl.textContent); } catch (e) { return; }

  var dropzone = document.getElementById('dropzone');
  var fileInput = document.getElementById('fileInput');
  var workspaceCard = document.getElementById('workspaceCard');
  var fileList = document.getElementById('fileList');
  var addMoreBtn = document.getElementById('addMoreBtn');
  var optionsPanel = document.getElementById('optionsPanel');
  var optionsBody = document.getElementById('optionsBody');
  var actionBtn = document.getElementById('actionBtn');
  var resetBtn = document.getElementById('resetBtn');
  var progressWrap = document.getElementById('progressWrap');
  var progressBar = document.getElementById('progressBar');
  var progressLabel = document.getElementById('progressLabel');
  var progressPct = document.getElementById('progressPct');
  var errorAlert = document.getElementById('errorAlert');
  var noteAlert = document.getElementById('noteAlert');
  var resultCard = document.getElementById('resultCard');
  var resultFiles = document.getElementById('resultFiles');
  var resultNote = document.getElementById('resultNote');
  var downloadAllBtn = document.getElementById('downloadAllBtn');
  var startOverBtn = document.getElementById('startOverBtn');
  var pasteInsteadBtn = document.getElementById('pasteInsteadBtn');

  var files = [];
  var results = [];
  var zipBlob = null;
  var zipName = '';
  var running = false;

  var ACCEPT = (cfg.accept || '').split(',').map(function (s) { return s.trim().replace(/^\./, '').toLowerCase(); }).filter(Boolean);
  var MAX_FILES = cfg.maxFiles || (cfg.multiple ? 20 : 1);
  var REQUIRES_FILE = cfg.requiresFile !== false;

  function fmtSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(2) + ' MB';
  }
  function extOf(name) {
    var p = String(name || '').split('.');
    return p.length > 1 ? p.pop().toLowerCase() : '';
  }
  function showError(msg) {
    errorAlert.textContent = msg;
    errorAlert.classList.add('show');
  }
  function hideError() { errorAlert.textContent = ''; errorAlert.classList.remove('show'); }
  function showNote(msg) {
    if (!msg) { noteAlert.classList.remove('show'); noteAlert.textContent = ''; return; }
    noteAlert.textContent = msg;
    noteAlert.classList.add('show');
  }
  function setProgress(frac, label) {
    progressWrap.classList.add('show');
    var pct = Math.max(0, Math.min(100, Math.round(frac * 100)));
    progressBar.style.width = pct + '%';
    progressPct.textContent = pct + '%';
    if (label) progressLabel.textContent = label;
  }
  function hideProgress() {
    progressWrap.classList.remove('show');
    progressBar.style.width = '0%';
  }

  /* ---------- options rendering ---------- */
  var optionInputs = {};
  function renderOptions() {
    var opts = cfg.options || [];
    if (!opts.length) { optionsPanel.style.display = 'none'; return; }
    optionsPanel.style.display = '';
    optionsBody.innerHTML = '';
    optionInputs = {};
    opts.forEach(function (opt) {
      var wrap = document.createElement('div');
      wrap.className = 'field';
      wrap.dataset.optId = opt.id;
      var label = document.createElement('label');
      label.textContent = opt.label;
      label.htmlFor = 'opt-' + opt.id;
      var input = null;
      if (opt.type === 'select') {
        input = document.createElement('select');
        input.id = 'opt-' + opt.id;
        (opt.options || []).forEach(function (o) {
          var el = document.createElement('option');
          el.value = o.value; el.textContent = o.label;
          input.appendChild(el);
        });
        input.value = opt.default !== undefined ? opt.default : (opt.options[0] && opt.options[0].value);
      } else if (opt.type === 'textarea') {
        input = document.createElement('textarea');
        input.id = 'opt-' + opt.id;
        input.placeholder = opt.placeholder || '';
      } else if (opt.type === 'checkbox') {
        wrap.className = 'field check-field';
        input = document.createElement('input');
        input.type = 'checkbox';
        input.id = 'opt-' + opt.id;
        input.checked = !!opt.default;
        label.htmlFor = input.id;
        wrap.appendChild(input);
        wrap.appendChild(label);
        optionsBody.appendChild(wrap);
        optionInputs[opt.id] = input;
        if (opt.showIf) wrap.dataset.showIf = JSON.stringify(opt.showIf);
        return;
      } else if (opt.type === 'range') {
        var rangeWrap = document.createElement('div');
        rangeWrap.className = 'range-wrap';
        input = document.createElement('input');
        input.type = 'range';
        input.id = 'opt-' + opt.id;
        input.min = opt.min !== undefined ? opt.min : 0;
        input.max = opt.max !== undefined ? opt.max : 100;
        input.step = opt.step || 1;
        input.value = opt.default !== undefined ? opt.default : input.min;
        var val = document.createElement('span');
        val.className = 'range-val';
        val.textContent = input.value + (opt.suffix || '');
        input.addEventListener('input', function () { val.textContent = input.value + (opt.suffix || ''); });
        rangeWrap.appendChild(input);
        rangeWrap.appendChild(val);
        wrap.appendChild(label);
        wrap.appendChild(rangeWrap);
        if (opt.help) { var h = document.createElement('p'); h.className = 'help'; h.textContent = opt.help; wrap.appendChild(h); }
        optionsBody.appendChild(wrap);
        optionInputs[opt.id] = input;
        if (opt.showIf) wrap.dataset.showIf = JSON.stringify(opt.showIf);
        return;
      } else {
        input = document.createElement('input');
        input.type = opt.type === 'number' ? 'number' : 'text';
        input.id = 'opt-' + opt.id;
        if (opt.placeholder) input.placeholder = opt.placeholder;
        if (opt.default !== undefined) input.value = opt.default;
        if (opt.min !== undefined) input.min = opt.min;
        if (opt.max !== undefined) input.max = opt.max;
      }
      wrap.appendChild(label);
      wrap.appendChild(input);
      if (opt.help) { var help = document.createElement('p'); help.className = 'help'; help.textContent = opt.help; wrap.appendChild(help); }
      optionsBody.appendChild(wrap);
      optionInputs[opt.id] = input;
      if (opt.showIf) wrap.dataset.showIf = JSON.stringify(opt.showIf);
    });
    applyShowIf();
    Object.keys(optionInputs).forEach(function (key) {
      optionInputs[key].addEventListener('change', applyShowIf);
      optionInputs[key].addEventListener('input', applyShowIf);
    });
  }
  function applyShowIf() {
    var fields = optionsBody.querySelectorAll('.field[data-show-if]');
    fields.forEach(function (field) {
      var rule = JSON.parse(field.dataset.showIf);
      var src = optionInputs[rule.option];
      var val = src ? (src.type === 'checkbox' ? String(src.checked) : src.value) : '';
      field.style.display = (val === String(rule.value)) ? '' : 'none';
    });
  }
  function collectOptions() {
    var out = {};
    Object.keys(optionInputs).forEach(function (key) {
      var el = optionInputs[key];
      out[key] = el.type === 'checkbox' ? el.checked : el.value;
    });
    return out;
  }

  /* ---------- file list ---------- */
  function renderFileList() {
    fileList.innerHTML = '';
    if (!files.length) {
      fileList.innerHTML = '<p class="muted" style="margin:0">No file selected yet.</p>';
      return;
    }
    files.forEach(function (file, idx) {
      var chip = document.createElement('div');
      chip.className = 'file-chip';
      var ico = document.createElement('span');
      ico.className = 'file-ico';
      ico.textContent = extOf(file.name).slice(0, 4) || 'file';
      var name = document.createElement('span');
      name.className = 'file-name';
      name.textContent = file.name;
      var size = document.createElement('span');
      size.className = 'file-size';
      size.textContent = fmtSize(file.size);
      chip.appendChild(ico);
      chip.appendChild(name);
      chip.appendChild(size);
      if (cfg.multiple && files.length > 1) {
        var up = document.createElement('button');
        up.type = 'button'; up.className = 'chip-btn'; up.textContent = '↑'; up.title = 'Move up';
        up.disabled = idx === 0;
        up.addEventListener('click', function () {
          var t = files[idx - 1]; files[idx - 1] = files[idx]; files[idx] = t;
          renderFileList();
        });
        var down = document.createElement('button');
        down.type = 'button'; down.className = 'chip-btn'; down.textContent = '↓'; down.title = 'Move down';
        down.disabled = idx === files.length - 1;
        down.addEventListener('click', function () {
          var t = files[idx + 1]; files[idx + 1] = files[idx]; files[idx] = t;
          renderFileList();
        });
        chip.appendChild(up);
        chip.appendChild(down);
      }
      var rm = document.createElement('button');
      rm.type = 'button'; rm.className = 'chip-btn danger'; rm.textContent = '✕'; rm.title = 'Remove';
      rm.addEventListener('click', function () {
        files.splice(idx, 1);
        if (!files.length && REQUIRES_FILE) resetAll();
        else renderFileList();
      });
      chip.appendChild(rm);
      fileList.appendChild(chip);
    });
  }

  function addFiles(list) {
    hideError();
    var added = 0;
    for (var i = 0; i < list.length; i++) {
      var file = list[i];
      var ext = extOf(file.name);
      if (ACCEPT.length && ACCEPT.indexOf(ext) === -1) {
        showError('"' + file.name + '" is a .' + (ext || '?') + ' file. This tool accepts: ' + ACCEPT.map(function (e) { return '.' + e; }).join(', ') + '.');
        continue;
      }
      if (file.size > window.TrustFile.maxBytes) {
        showError('"' + file.name + '" is larger than 50 MB. Please use a smaller file.');
        continue;
      }
      if (files.length >= MAX_FILES) {
        showError('You can add up to ' + MAX_FILES + ' file' + (MAX_FILES > 1 ? 's' : '') + ' at a time.');
        break;
      }
      files.push(file);
      added++;
    }
    if (added || files.length) openWorkspace();
  }

  function openWorkspace() {
    dropzone.style.display = 'none';
    if (pasteInsteadBtn) pasteInsteadBtn.style.display = 'none';
    workspaceCard.hidden = false;
    renderFileList();
    addMoreBtn.style.display = cfg.multiple ? '' : 'none';
    resultCard.classList.remove('show');
    hideProgress();
  }

  function resetAll() {
    files = [];
    results = [];
    zipBlob = null;
    fileInput.value = '';
    workspaceCard.hidden = true;
    dropzone.style.display = '';
    if (pasteInsteadBtn) pasteInsteadBtn.style.display = '';
    resultCard.classList.remove('show');
    hideError();
    showNote('');
    hideProgress();
    actionBtn.disabled = false;
  }

  /* ---------- run ---------- */
  async function run() {
    if (running) return;
    hideError();
    showNote('');
    if (REQUIRES_FILE && !files.length) {
      showError('Please add a file first.');
      return;
    }
    var opts = collectOptions();
    running = true;
    actionBtn.disabled = true;
    resultCard.classList.remove('show');
    setProgress(0.02, 'Preparing...');
    try {
      var out = await window.TrustFile.run(cfg.id, files.slice(), opts, function (frac, label) {
        setProgress(frac, label);
      });
      setProgress(1, 'Done!');
      results = out.files || [];
      if (!results.length) throw new Error('The tool finished but produced no file. Please try again.');
      if (out.note) showNote(out.note);
      renderResults();
      if (results.length === 1) {
        window.TrustFile.download(results[0].blob, results[0].name);
      } else {
        prepareZip();
      }
    } catch (err) {
      showError(err && err.message ? err.message : 'Something went wrong. Please try again.');
      hideProgress();
    } finally {
      running = false;
      actionBtn.disabled = false;
    }
  }

  function renderResults() {
    resultFiles.innerHTML = '';
    results.forEach(function (f) {
      var row = document.createElement('div');
      row.className = 'result-file';
      var name = document.createElement('span');
      name.className = 'file-name';
      name.textContent = f.name;
      var size = document.createElement('span');
      size.className = 'file-size';
      size.textContent = fmtSize(f.blob.size);
      var btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'chip-btn'; btn.textContent = 'Download';
      btn.addEventListener('click', function () { window.TrustFile.download(f.blob, f.name); });
      row.appendChild(name);
      row.appendChild(size);
      row.appendChild(btn);
      resultFiles.appendChild(row);
    });
    resultNote.textContent = results.length === 1
      ? 'Your file has been downloaded. If the download did not start, use the button above.'
      : results.length + ' files were created. Download them individually, or all at once as a ZIP file.';
    downloadAllBtn.style.display = results.length > 1 ? '' : 'none';
    downloadAllBtn.textContent = 'Download all as ZIP';
    resultCard.classList.add('show');
    resultCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function prepareZip() {
    try {
      downloadAllBtn.disabled = true;
      downloadAllBtn.textContent = 'Preparing ZIP...';
      await window.TrustFile.loadLibs(['jszip']);
      zipName = (files.length ? window.TrustFile.baseOf(files[0].name) : 'trustfile') + '-files.zip';
      var zipped = await window.TrustFile.zipFiles(results, zipName);
      zipBlob = zipped.blob;
      downloadAllBtn.disabled = false;
      downloadAllBtn.textContent = 'Download all as ZIP (' + fmtSize(zipBlob.size) + ')';
      window.TrustFile.download(zipBlob, zipName);
    } catch (e) {
      downloadAllBtn.disabled = false;
      downloadAllBtn.textContent = 'Download all as ZIP';
    }
  }

  /* ---------- events ---------- */
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
    if (e.dataTransfer.files && e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  });
  fileInput.addEventListener('change', function () {
    if (fileInput.files.length) addFiles(fileInput.files);
    fileInput.value = '';
  });
  if (addMoreBtn) addMoreBtn.addEventListener('click', function () { fileInput.click(); });
  actionBtn.addEventListener('click', run);
  resetBtn.addEventListener('click', resetAll);
  startOverBtn.addEventListener('click', resetAll);
  downloadAllBtn.addEventListener('click', function () {
    if (zipBlob) window.TrustFile.download(zipBlob, zipName);
  });
  if (pasteInsteadBtn) {
    pasteInsteadBtn.addEventListener('click', function () {
      files = [];
      openWorkspace();
    });
  }

  fileInput.accept = (cfg.accept || '').split(',').map(function (s) { return s.trim(); }).join(',');
  if (cfg.multiple) fileInput.multiple = true;
  actionBtn.textContent = cfg.actionLabel || 'Convert';
  renderOptions();
})();
