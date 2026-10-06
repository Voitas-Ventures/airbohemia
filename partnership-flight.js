/* =========================================================================
   partnership-flight.js  v0.1.6  —  Air Bohemia, stránka Partnership
   -------------------------------------------------------------------------
   Rozšíření formuláře „Pošlete nám poptávku letu“ o údaje o letu.
   Vychází z booking-form.js (stránka Rezervovat let / Zažít let) a používá
   stejné konvence: pole se hledají podle data-f, atribut name je volný pro
   popisek v e-mailu (name="Odkud", data-f="from").

   CO DĚLÁ
   1) Blok [data-flight] je vidět jen u první možnosti „Typ poptávky“
      (Dostupnost a cenová nabídka / Availability and quote). Jinou možnost
      nastavíš atributem data-flight-option="1" (číslo = pořadí od nuly).
      Skrytý blok má všechna pole disabled → neodešlou se a nevadí required.
   2) Přepínač [data-trip="oneway"] / [data-trip="return"].
      Zpáteční ukáže [data-return-field] a vyžaduje datum návratu.
      Text aktivního tlačítka (i přeložený) se zapíše do data-f="trip-type".
      Výchozí režim: data-trip-default="return" | "oneway" na [data-flight].
   3) [data-swap-route] prohodí Odkud ⇄ Kam.
   4) data-f="pax" přijme jen celé číslo 1–99 (blokuje - + . , e).
   5) Kalendáře data-f="depart-at" / "return-at": dd.mm.rrrr, odlet ≥ dnes,
      návrat ≥ odlet, čeština podle <html lang>. Prázdné datum zastaví
      odeslání (flatpickr dělá pole readonly, takže required by nestačil).
   6) data-f="flight-summary" dostane čitelné shrnutí pro e-mail:
      „Praha (PRG) → Nice (NCE) · 12.08.2026 – 18.08.2026 · 4 os. · Zpáteční“
   7) Předvyplnění: let ze sessionStorage `ab_flight` (když už ho člověk
      zadal na Rezervovat let) a kontakt z localStorage `ab_contact`.
      Jen do prázdných polí. Po odeslání se kontakt uloží zpět.
   8) POJMENOVÁNÍ POLÍ PRO E-MAIL. Webflow v této komponentě generuje
      atributy name/data-name samo (field-6, field-7, …) a nastavení "Name"
      v Designeru se do výstupu nepropisuje. Navíc se některé názvy opakují
      (Odkud i Zpráva měly obě field-6), takže se hodnoty v e-mailu přepisovaly.
      Skript proto každému poli s data-f přepíše name i data-name na čitelný
      popisek z tabulky LABELS níže. Běží hned po načtení, tedy dávno před
      odesláním. Když Webflow někdy generování opraví, stačí tuhle část smazat.
   9) data-f="email-body" dostane CELÉ tělo notifikačního e-mailu. Ve Webflow
      (Site settings → Forms) pak stačí v těle zprávy jediné pole:
        {{Obsah e-mailu}}
      Důvod: Webflow si uvnitř komponenty generuje atributy name sám
      (field-2, field-6, …), takže popisky polí v e-mailu nedávají smysl
      a některé názvy se dokonce opakují. Tohle je obejde.

   VYŽADUJE (Page Settings → Before </body>, v tomhle pořadí):
     <script src="https://cdn.jsdelivr.net/npm/flatpickr@4"></script>
     <script src="https://cdn.jsdelivr.net/npm/flatpickr@4/dist/l10n/cs.js"></script>
     <script src="https://cdn.jsdelivr.net/gh/Voitas-Ventures/airbohemia@vX/airport-autocomplete.js"></script>
     <script src="https://cdn.jsdelivr.net/gh/Voitas-Ventures/airbohemia@vX/partnership-flight.js"></script>
   ========================================================================= */
(function () {
  'use strict';

  var ANIM_MS     = 300;           // délka rozbalení bloku s letem
  var FLIGHT_KEY  = 'ab_flight';   // sessionStorage (booking-form.js)
  var CONTACT_KEY = 'ab_contact';  // localStorage   (booking-form.js)
  var CONTACT_FIELDS = ['name', 'phone', 'email'];

  // Popisky pro tělo e-mailu. Klíč = data-f, hodnota = [česky, anglicky].
  var LABELS = {
    'request-type': ['Typ poptávky', 'Request type'],
    'from':         ['Odkud', 'From'],
    'to':           ['Kam', 'To'],
    'pax':          ['Počet osob', 'Passengers'],
    'depart-at':    ['Odlet', 'Departure'],
    'return-at':    ['Návrat', 'Return'],
    'trip-type':    ['Typ letu', 'Trip type'],
    'company':      ['Společnost', 'Company'],
    'name':         ['Jméno', 'Name'],
    'phone':        ['Telefon', 'Phone'],
    'email':        ['E-mail', 'E-mail'],
    'note':         ['Zpráva', 'Message'],
    'flight':       ['LET', 'FLIGHT'],
    'contact':      ['KONTAKT', 'CONTACT']
  };

  var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function $(root, sel)  { return root ? root.querySelector(sel) : null; }
  function $$(root, sel) { return root ? [].slice.call(root.querySelectorAll(sel)) : []; }
  function f(root, key)  { return $(root, '[data-f="' + key + '"]'); }

  function isCs() { return (document.documentElement.lang || '').toLowerCase().indexOf('cs') === 0; }

  function readJSON(store, key) {
    try { return JSON.parse(store.getItem(key) || '{}') || {}; } catch (e) { return {}; }
  }
  function writeJSON(store, key, val) {
    try { store.setItem(key, JSON.stringify(val)); } catch (e) { /* private mode */ }
  }

  function initBlock(block) {
    if (block._flightReady) return;
    block._flightReady = true;

    var form = block.closest('form');
    if (!form) return;

    var select    = f(form, 'request-type') || $(form, 'select');
    var showIndex = parseInt(block.getAttribute('data-flight-option') || '0', 10);

    var from    = f(block, 'from');
    var to      = f(block, 'to');
    var pax     = f(block, 'pax');
    var dep     = f(block, 'depart-at');
    var ret     = f(block, 'return-at');
    var trip    = f(block, 'trip-type');
    var summary = f(block, 'flight-summary');
    var retWrap = $(block, '[data-return-field]');
    var tripBtns = $$(block, '[data-trip]');

    // skryte pole se swapem uvnitr embedu: tlacitko hleda az po vlozeni
    var fields = $$(block, 'input, select, textarea');
    fields.forEach(function (el) { el._wasRequired = el.required; });

    var mode = block.getAttribute('data-trip-default') === 'oneway' ? 'oneway' : 'return';
    var shown = null;

    // ---- názvy polí pro notifikační e-mail --------------------------------
    function renameFields() {
      var seen = {};
      $$(form, '[data-f]').forEach(function (el) {
        if (!('name' in el)) return;
        var key = el.getAttribute('data-f');
        var nm = (LABELS[key] || [key, key])[isCs() ? 0 : 1];
        if (seen[nm]) nm = nm + ' ' + (++seen[nm]); else seen[nm] = 1;
        el.name = nm;
        el.setAttribute('data-name', nm);
      });
    }

    // ---- zapnutí / vypnutí polí ------------------------------------------
    function isShown() { return select ? select.selectedIndex === showIndex : true; }

    function applyEnabled() {
      var on = isShown();
      fields.forEach(function (el) {
        var enabled = on && !(el === ret && mode === 'oneway');
        el.disabled = !enabled;
        if (el._wasRequired) {
          if (enabled) el.setAttribute('required', ''); else el.removeAttribute('required');
        }
      });
    }

    // ---- rozbalení bloku (height + opacity) ------------------------------
    function show(animate) {
      var on = isShown();
      applyEnabled();
      if (on === shown) return;
      shown = on;

      clearTimeout(block._animTimer);
      if (!animate || reduce) {
        block.style.display = on ? '' : 'none';
        block.style.height = block.style.opacity = block.style.overflow = block.style.transition = '';
        return;
      }
      block.style.display = '';
      var full = block.scrollHeight;
      block.style.overflow = 'hidden';
      block.style.height = (on ? 0 : full) + 'px';
      block.style.opacity = on ? '0' : '1';
      block.offsetHeight; // reflow
      block.style.transition = 'height ' + ANIM_MS + 'ms ease-out, opacity ' + ANIM_MS + 'ms ease-out';
      block.style.height = (on ? full : 0) + 'px';
      block.style.opacity = on ? '1' : '0';
      block._animTimer = setTimeout(function () {
        block.style.height = block.style.opacity = block.style.overflow = block.style.transition = '';
        if (!on) block.style.display = 'none';
      }, ANIM_MS);
    }

    // ---- shrnutí letu pro e-mail ----------------------------------------
    function updateSummary() {
      if (!summary) return;
      var parts = [];
      var route = [from && from.value, to && to.value].filter(Boolean).join(' \u2192 ');
      if (route) parts.push(route);
      var dates = [dep && dep.value, mode === 'return' && ret && ret.value].filter(Boolean).join(' \u2013 ');
      if (dates) parts.push(dates);
      if (pax && pax.value) parts.push(pax.value + (isCs() ? ' os.' : ' pax'));
      if (trip && trip.value) parts.push(trip.value);
      summary.value = parts.join(' \u00b7 ');
    }

    // ---- celé tělo notifikačního e-mailu -----------------------------------
    function label(key) { return (LABELS[key] || [key, key])[isCs() ? 0 : 1]; }

    function buildEmailBody() {
      var body = f(form, 'email-body');
      if (!body) return;
      var lines = [];
      var dash = String.fromCharCode(8212);  // —

      function row(key, el) {
        lines.push(label(key) + ': ' + ((el && el.value.trim()) || dash));
      }

      var sel = select && select.options[select.selectedIndex];
      lines.push(label('request-type') + ': ' + ((sel && sel.text.trim()) || dash));

      if (isShown()) {
        lines.push('', label('flight'));
        row('from', from);
        row('to', to);
        row('pax', pax);
        row('depart-at', dep);
        if (mode === 'return') row('return-at', ret);
        row('trip-type', trip);
      }

      lines.push('', label('contact'));
      ['company', 'name', 'phone', 'email'].forEach(function (k) { row(k, f(form, k)); });

      var note = f(form, 'note');
      if (note) { lines.push('', label('note'), (note.value.trim() || dash)); }

      body.value = lines.join(String.fromCharCode(10));
    }

    // ---- jednosměrný / zpáteční -------------------------------------------
    function setMode(m) {
      mode = m === 'oneway' ? 'oneway' : 'return';
      tripBtns.forEach(function (b) {
        var on = b.getAttribute('data-trip') === mode;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        if (on && trip) trip.value = b.textContent.trim();
      });
      if (retWrap) retWrap.style.display = mode === 'oneway' ? 'none' : '';
      if (mode === 'oneway' && ret) {
        if (ret._flatpickr) ret._flatpickr.clear(); else ret.value = '';
        ret.classList.remove('is-invalid');
      }
      applyEnabled();
      updateSummary();
    }

    tripBtns.forEach(function (b) {
      if (b.tagName !== 'BUTTON') { b.setAttribute('role', 'button'); b.tabIndex = 0; }
      else b.type = 'button';
      b.addEventListener('click', function (e) { e.preventDefault(); setMode(b.getAttribute('data-trip')); });
      b.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setMode(b.getAttribute('data-trip')); }
      });
    });

    // ---- prohození trasy -------------------------------------------------
    // Swap je uvnitr embedu, takze se posloucha delegovane na celem bloku.
    block.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-swap-route], .partnership-form2_swap-btn');
      if (!btn || !block.contains(btn)) return;
      e.preventDefault();
      if (!from || !to) return;
      var tmp = from.value; from.value = to.value; to.value = tmp;
      var fc = f(block, 'from-code'), tc = f(block, 'to-code');
      if (fc && tc) { var t2 = fc.value; fc.value = tc.value; tc.value = t2; }
      updateSummary();
    });

    // ---- počet osob: jen celé číslo 1–99 ---------------------------------
    if (pax) {
      pax.addEventListener('keydown', function (e) {
        if (['-', '+', '.', ',', 'e', 'E'].indexOf(e.key) > -1) e.preventDefault();
      });
      pax.addEventListener('input', function () {
        var v = pax.value.replace(/\D/g, '').slice(0, 2);
        if (v === '0' || v === '00') v = '1';
        if (pax.value !== v) pax.value = v;
        updateSummary();
      });
    }

    [from, to].forEach(function (el) {
      if (!el) return;
      el.addEventListener('input', updateSummary);
      el.addEventListener('change', updateSummary);
    });

    // ---- kalendáře -------------------------------------------------------
    function initDates() {
      if (!window.flatpickr) return;
      var cs = isCs() && window.flatpickr.l10ns && window.flatpickr.l10ns.cs;
      var base = {
        dateFormat: 'd.m.Y',
        locale: cs ? window.flatpickr.l10ns.cs : 'default',
        minDate: 'today',
        allowInput: false,
        disableMobile: true
      };
      function onDep() {
        dep.classList.remove('is-invalid');
        if (ret && ret._flatpickr) {
          var d = dep._flatpickr.selectedDates[0] || null;
          ret._flatpickr.set('minDate', d || 'today');
          var r = ret._flatpickr.selectedDates[0];
          if (r && d && r < d) ret._flatpickr.clear();
        }
        updateSummary();
      }
      function onRet() { ret.classList.remove('is-invalid'); updateSummary(); }
      if (dep && !dep._flatpickr) window.flatpickr(dep, Object.assign({}, base, { onChange: onDep }));
      if (ret && !ret._flatpickr) window.flatpickr(ret, Object.assign({}, base, { onChange: onRet }));
    }

    // ---- předvyplnění z Rezervovat let -----------------------------------
    function prefill() {
      var fl = readJSON(sessionStorage, FLIGHT_KEY);
      [['from', from], ['to', to], ['pax', pax]].forEach(function (p) {
        if (p[1] && !p[1].value && fl[p[0]]) p[1].value = fl[p[0]];
      });
      [['depart-at', dep], ['return-at', ret]].forEach(function (p) {
        var el = p[1], v = fl[p[0]];
        if (!el || el.value || !v) return;
        if (el._flatpickr) el._flatpickr.setDate(v, true, 'd.m.Y'); else el.value = v;
      });
      if (fl['return-at'] === '' && fl['depart-at']) setMode('oneway');

      var contact = readJSON(localStorage, CONTACT_KEY);
      CONTACT_FIELDS.forEach(function (n) {
        var el = f(form, n);
        if (el && !el.value && contact[n]) el.value = contact[n];
      });
    }

    // ---- kontrola před odesláním -----------------------------------------
    // Capture na documentu proběhne dřív než handler Webflow formuláře.
    document.addEventListener('submit', function (e) {
      if (e.target !== form) return;
      if (isShown()) {
        var missing = [];
        if (dep && !dep.value) missing.push(dep);
        if (mode === 'return' && ret && !ret.value) missing.push(ret);
        if (missing.length) {
          e.preventDefault();
          e.stopImmediatePropagation();
          missing.forEach(function (el) { el.classList.add('is-invalid'); });
          var first = missing[0];
          first.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
          if (first._flatpickr) setTimeout(function () { first._flatpickr.open(); }, reduce ? 0 : 350);
          return;
        }
        updateSummary();
      // Když se let neposílá, polím se sebere name → Webflow je vůbec nedostane
      if (!isShown()) {
        fields.forEach(function (el) {
          if (!el.name) return;
          el.setAttribute('data-name-off', el.name);
          el.removeAttribute('name');
          el.removeAttribute('data-name');
          el.value = '';
        });
      }
      }
      buildEmailBody();
      var contact = readJSON(localStorage, CONTACT_KEY);
      CONTACT_FIELDS.forEach(function (n) {
        var el = f(form, n);
        if (el && el.value) contact[n] = el.value;
      });
      writeJSON(localStorage, CONTACT_KEY, contact);
    }, true);

    // ---- start -----------------------------------------------------------
    renameFields();
    initDates();
    setMode(mode);
    prefill();
    updateSummary();
    show(false);
    if (select) select.addEventListener('change', function () { show(true); });
  }

  function init() { $$(document, '[data-flight]').forEach(initBlock); }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.PartnershipFlight = { init: init };
})();
