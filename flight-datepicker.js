/* =========================================================================
   flight-datepicker.js  v0.0.1  —  Air Bohemia (jen datum, bez času)
   -------------------------------------------------------------------------
   Odvozeno ze StyleJet v0.0.7. Rozdíly:
   - enableTime: false, dateFormat 'd.m.Y' (dd.mm.rrrr dle návrhu)
   - žádné řetězení mezi úseky (je jen jeden úsek)
   - scoped na [data-booking] instanci, ne na první form v documentu

   PRAVIDLA:
   1) Odlet ≥ dnes
   2) Návrat ≥ odlet (a když se odlet posune za návrat, návrat se vyčistí)

   Vyžaduje flatpickr (Site Settings → Custom Code → Head Code):
     <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/flatpickr@4/dist/flatpickr.min.css">
     <script src="https://cdn.jsdelivr.net/npm/flatpickr@4"></script>
     <script src="https://cdn.jsdelivr.net/npm/flatpickr@4/dist/l10n/cs.js"></script>
   ========================================================================= */
(function () {
  'use strict';

  var ROOT_SELECTOR = '[data-booking]';
  var DATE_SELECTOR = '.flight-date-input';
  var DEPART_NAME   = 'depart-at';
  var RETURN_NAME   = 'return-at';

  function ready() { return typeof window !== 'undefined' && !!window.flatpickr; }

  function getLocale() {
    var lang = (document.documentElement.lang || '').toLowerCase();
    if (lang.indexOf('cs') === 0 && window.flatpickr.l10ns && window.flatpickr.l10ns.cs) {
      return window.flatpickr.l10ns.cs;
    }
    return 'default';
  }

  function initPicker(input) {
    if (!input || input._fpReady || !ready()) return;
    input._fpReady = true;
    window.flatpickr(input, {
      enableTime: false,
      dateFormat: 'd.m.Y',        // 12.08.2026
      locale: getLocale(),
      minDate: 'today',
      allowInput: false,
      disableMobile: true,        // konzistentní kalendář i na iOS/Androidu
      onChange: function (dates, str, instance) {
        var root = instance.input.closest(ROOT_SELECTOR);
        if (root) recompute(root);
      }
    });
  }

  var recomputing = false;

  function recompute(root) {
    if (recomputing || !root || !ready()) return;
    recomputing = true;
    try {
      var dep = root.querySelector('[name="' + DEPART_NAME + '"]');
      var ret = root.querySelector('[name="' + RETURN_NAME + '"]');
      if (!ret || !ret._flatpickr) return;

      var depDate = (dep && dep._flatpickr && dep._flatpickr.selectedDates[0]) || null;
      var rfp = ret._flatpickr;

      rfp.set('minDate', depDate || 'today');

      var rcur = rfp.selectedDates[0];
      if (rcur && depDate && rcur < depDate) rfp.clear();   // návrat před odletem → pryč
    } finally {
      recomputing = false;
    }
  }

  function attachAll() {
    if (!ready()) return;
    document.querySelectorAll(ROOT_SELECTOR).forEach(function (root) {
      root.querySelectorAll(DATE_SELECTOR).forEach(initPicker);
      recompute(root);
    });
  }

  if (document.readyState !== 'loading') attachAll();
  else document.addEventListener('DOMContentLoaded', function () { attachAll(); });

  window.FlightDatepicker = { attachAll: attachAll, recompute: recompute };
})();
