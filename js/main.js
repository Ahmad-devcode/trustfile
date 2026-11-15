/* TrustFile main.js — header nav, footer year, homepage tool search. */
(function () {
  'use strict';
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

  /* Homepage: live-filter the tool grid. */
  var search = document.getElementById('toolSearch');
  if (search) {
    var cards = Array.prototype.slice.call(document.querySelectorAll('.tool-card'));
    var noResults = document.getElementById('noResults');
    search.addEventListener('input', function () {
      var q = search.value.trim().toLowerCase();
      var visible = 0;
      cards.forEach(function (card) {
        var hit = !q || (card.getAttribute('data-search') || '').toLowerCase().indexOf(q) !== -1;
        card.style.display = hit ? '' : 'none';
        if (hit) visible++;
      });
      document.querySelectorAll('.category-block').forEach(function (block) {
        var anyVisible = block.querySelectorAll('.tool-card:not([style*="none"])').length > 0;
        block.style.display = anyVisible ? '' : 'none';
      });
      if (noResults) noResults.classList.toggle('show', visible === 0);
    });
  }
})();
