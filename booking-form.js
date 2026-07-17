/* =========================================================================
   booking-form.js  v0.0.1  —  Air Bohemia poptávkový formulář
   -------------------------------------------------------------------------
   Odvozeno z StyleJet booking-form.js v0.0.25, ale výrazně zjednodušeno:

   ROZDÍLY OPROTI STYLEJET:
   - Jeden úsek (žádné add/remove leg, žádný MAX_LEGS).
   - Vždy zpáteční let (žádné trip-type radio, žádný normalizeMode/syncMode).
   - Krok 2 se ODHALUJE pod krokem 1, letové údaje zůstávají viditelné.
     → žádný showStep toggle, žádné tlačítko Zpět.
   - Jeden <form> na instanci (ne dva) → letová pole se odesílají nativně.
   - Žádný cross-page redirect (formulář žije jen na /zazit-let).
   - VŠECHNO je scoped na [data-booking] instanci, ne na document.
     Na stránce jsou DVĚ instance komponenty (hero + footer).
   - NOVÉ: live sync mezi instancemi. Co napíšeš v hero, objeví se ve footeru
     a naopak. StyleJet měl jen "kdo uloží poslední, vyhrál" bez propisování.
   - NOVÉ: uniquifier duplicitních id/for (Webflow komponenta = 2× stejné id).

   ÚLOŽIŠTĚ:
   - sessionStorage `ab_flight`   — letové údaje (přežije refresh, ne zavření tabu)
   - sessionStorage `ab_draft`    — rozepsané osobní údaje (mizí po odeslání)
   - localStorage   `ab_contact`  — jméno/telefon/e-mail (returning customer)
   ========================================================================= */
(function () {
  'use strict';

  var FLIGHT_KEY  = 'ab_flight';    // sessionStorage
  var DRAFT_KEY   = 'ab_draft';     // sessionStorage
  var CONTACT_KEY = 'ab_contact';   // localStorage

  var FLIGHT_FIELDS  = ['from', 'from-code', 'to', 'to-code', 'pax', 'depart-at', 'return-at'];
  var STEP2_FIELDS   = ['name', 'phone', 'email', 'note'];
  var CONTACT_FIELDS = ['name', 'phone', 'email'];

  var instances = [];   // všechny [data-booking] na stránce
  var syncing   = false; // guard proti echo smyčce při live syncu

  // ---- utils ---------------------------------------------------------------
  function $(sel, ctx)  { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }
  function field(root, name) { return root.querySelector('[name="' + name + '"]'); }
  function getVal(root, name) { var el = field(root, name); return el ? el.value : ''; }
  function setVal(root, name, v) {
    var el = field(root, name);
    if (el && el.value !== (v || '')) el.value = (v != null ? v : '');
  }

  function readJSON(store, key) {
    try { return JSON.parse(store.getItem(key) || '{}'); } catch (e) { return {}; }
  }
  function writeJSON(store, key, obj) {
    try { store.setItem(key, JSON.stringify(obj)); } catch (e) {}
  }

  // ---- uniquifier duplicitních id / for ------------------------------------
  // Webflow generuje na form fieldech `id` z názvu pole. Dvě instance
  // komponenty na jedné stránce = dvě `id="email"`. Klik na <label for="email">
  // ve footeru by pak fokusnul pole v HERO sekci. Přepíšeme id + for per instanci.
  function uniquifyIds(root, idx) {
    if (idx === 0) return;              // první instance si nechá původní id
    var suffix = '-' + (idx + 1);
    $$('input, select, textarea', root).forEach(function (el) {
      if (!el.id) return;
      var oldId = el.id;
      var newId = oldId + suffix;
      var label = root.querySelector('label[for="' + oldId + '"]');
      el.id = newId;
      if (label) label.setAttribute('for', newId);
    });
  }

  // ---- lidsky čitelný výstup (pro e-mailovou notifikaci) --------------------
  function buildReadable(s) {
    return [
      'Odkud: '         + (s.from      || '—') + (s['from-code'] ? ' (' + s['from-code'] + ')' : ''),
      'Kam: '           + (s.to        || '—') + (s['to-code']   ? ' (' + s['to-code']   + ')' : ''),
      'Počet osob: '    + (s.pax       || '—'),
      'Datum odletu: '  + (s['depart-at'] || '—'),
      'Datum návratu: ' + (s['return-at'] || '—')
    ].join('<br>');
  }

  // ---- letové údaje: read / write ------------------------------------------
  function collectFlight(root) {
    var s = {};
    FLIGHT_FIELDS.forEach(function (n) { s[n] = getVal(root, n); });
    return s;
  }

  function applyFlight(root, s) {
    FLIGHT_FIELDS.forEach(function (n) {
      if (n === 'depart-at' || n === 'return-at') {
        // datumy jdou přes flatpickr API, ať si je vezme i do interního stavu
        var inp = field(root, n);
        if (!inp) return;
        if (inp._flatpickr) {
          if (s[n]) inp._flatpickr.setDate(s[n], false);
          else inp._flatpickr.clear(false);
        } else {
          inp.value = s[n] || '';
        }
      } else {
        setVal(root, n, s[n]);
      }
    });
  }

  function saveFlight(root) {
    var s = collectFlight(root);
    writeJSON(sessionStorage, FLIGHT_KEY, s);
    broadcast(root, s);
  }

  // ---- live sync mezi instancemi -------------------------------------------
  // Propíše stav do všech OSTATNÍCH instancí. Pole, ve kterém uživatel právě
  // píše, přeskočíme — jinak by mu kurzor skákal na konec.
  function broadcast(sourceRoot, s) {
    if (syncing) return;
    syncing = true;
    try {
      instances.forEach(function (root) {
        if (root === sourceRoot) return;
        applyFlight(root, s);
        if (window.FlightDatepicker && window.FlightDatepicker.recompute) {
          window.FlightDatepicker.recompute(root);
        }
      });
    } finally {
      syncing = false;
    }
  }

  function scheduleSave(root) {
    if (root._saveTimer) clearTimeout(root._saveTimer);
    root._saveTimer = setTimeout(function () { saveFlight(root); }, 300);
  }

  // ---- krok 2: draft (session) + kontakt (local) ----------------------------
  function saveStep2(root) {
    var draft = {};
    STEP2_FIELDS.forEach(function (n) { draft[n] = getVal(root, n); });
    writeJSON(sessionStorage, DRAFT_KEY, draft);

    var contact = {};
    CONTACT_FIELDS.forEach(function (n) {
      var v = getVal(root, n);
      if (v) contact[n] = v;
    });
    writeJSON(localStorage, CONTACT_KEY, contact);

    // propsat i do druhé instance
    if (syncing) return;
    syncing = true;
    try {
      instances.forEach(function (other) {
        if (other === root) return;
        STEP2_FIELDS.forEach(function (n) { setVal(other, n, draft[n]); });
      });
    } finally {
      syncing = false;
    }
  }

  function scheduleStep2Save(root) {
    if (root._step2Timer) clearTimeout(root._step2Timer);
    root._step2Timer = setTimeout(function () { saveStep2(root); }, 300);
  }

  function restoreStep2(root) {
    var draft = readJSON(sessionStorage, DRAFT_KEY);
    STEP2_FIELDS.forEach(function (n) {
      if (draft[n]) setVal(root, n, draft[n]);
    });
    // localStorage kontakt jen do PRÁZDNÝCH polí — draft má přednost
    var contact = readJSON(localStorage, CONTACT_KEY);
    CONTACT_FIELDS.forEach(function (n) {
      var el = field(root, n);
      if (el && !el.value && contact[n]) el.value = contact[n];
    });
  }

  // ---- swap Odkud ⇄ Kam -----------------------------------------------------
  function swapRoute(root) {
    var pairs = [['from', 'to'], ['from-code', 'to-code']];
    pairs.forEach(function (p) {
      var a = field(root, p[0]), b = field(root, p[1]);
      if (!a || !b) return;
      var tmp = a.value; a.value = b.value; b.value = tmp;
    });
    saveFlight(root);
  }

  // ---- populace hidden polí před odesláním ---------------------------------
  function populateHidden(root) {
    var s = collectFlight(root);

    // 1) lidsky čitelné — pro tělo notifikačního e-mailu
    setVal(root, 'itinerary-readable', buildReadable(s));

    // 2) strojové JSON — pro pozdější napojení (Avinode, CRM, …)
    setVal(root, 'itinerary', JSON.stringify({
      tripType: 'return',
      from:     s.from,
      fromCode: s['from-code'],
      to:       s.to,
      toCode:   s['to-code'],
      pax:      s.pax,
      departAt: s['depart-at'],
      returnAt: s['return-at']
    }));

    // 3) odkud poptávka přišla (hero / footer)
    var srcEl = root.closest('[data-form-source]');
    setVal(root, 'source', srcEl ? srcEl.getAttribute('data-form-source') : '');
  }

  // ---- validace kroku 1 -----------------------------------------------------
  // reportValidity() na celém <form> by spadl na required polích kroku 2,
  // která jsou v tu chvíli ještě schovaná (a nefokusovatelná → browser hodí
  // "An invalid form control is not focusable"). Validujeme jen krok 1.
  function validateStep1(root) {
    var step1 = $('[data-step="1"]', root);
    if (!step1) return true;
    var inputs = $$('input, select, textarea', step1);
    for (var i = 0; i < inputs.length; i++) {
      if (!inputs[i].checkValidity()) {
        inputs[i].reportValidity();
        return false;
      }
    }
    return true;
  }

  // ---- odhalení kroku 2 -----------------------------------------------------
  function revealStep2(root) {
    var step2   = $('[data-step="2"]', root);
    var nextBtn = $('[data-step1-next]', root);
    if (!step2) return;
    step2.style.display = 'flex';   // explicitní hodnota přebije class s display:none
    if (nextBtn) nextBtn.style.display = 'none';
    root.setAttribute('data-step2-open', 'true');
    step2.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // =========================================================================
  //  INIT
  // =========================================================================
  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);

  function init() {
    instances = $$('[data-booking]');
    if (!instances.length) return;

    instances.forEach(function (root, idx) {
      if (root.dataset.abInit) return;
      root.dataset.abInit = '1';
      initInstance(root, idx);
    });
  }

  function initInstance(root, idx) {
    uniquifyIds(root, idx);

    // 1) obnovit uložený stav
    var saved = readJSON(sessionStorage, FLIGHT_KEY);
    if (Object.keys(saved).length) applyFlight(root, saved);
    restoreStep2(root);

    // 2) swap tlačítko
    var swapBtn = $('[data-swap-route]', root);
    if (swapBtn) swapBtn.addEventListener('click', function (e) {
      e.preventDefault();
      swapRoute(root);
    });

    // 3) Pokračovat v nezávazné poptávce
    var nextBtn = $('[data-step1-next]', root);
    if (nextBtn) nextBtn.addEventListener('click', function (e) {
      e.preventDefault();
      if (!validateStep1(root)) return;
      saveFlight(root);
      revealStep2(root);
      // otevřít krok 2 i v druhé instanci, ať jsou opravdu "jako jeden"
      instances.forEach(function (other) {
        if (other !== root) revealStep2(other);
      });
    });

    // 4) auto-save (debounce 300 ms)
    root.addEventListener('input', function (e) {
      if (syncing) return;
      var name = e.target.name || '';
      if (FLIGHT_FIELDS.indexOf(name) !== -1) scheduleSave(root);
      else if (STEP2_FIELDS.indexOf(name) !== -1) scheduleStep2Save(root);
    });
    root.addEventListener('change', function (e) {
      if (syncing) return;
      var name = e.target.name || '';
      if (FLIGHT_FIELDS.indexOf(name) !== -1) scheduleSave(root);
      else if (STEP2_FIELDS.indexOf(name) !== -1) scheduleStep2Save(root);
    });

    // 5) Odeslat
    var form = root.querySelector('form');
    if (form) form.addEventListener('submit', function () {
      populateHidden(root);
      saveStep2(root);   // synchronně, dokud máme hodnoty v DOM (kvůli localStorage kontaktu)
      setTimeout(function () {
        sessionStorage.removeItem(FLIGHT_KEY);
        sessionStorage.removeItem(DRAFT_KEY);
        // localStorage ab_contact ZŮSTÁVÁ — prefill pro příští poptávku
      }, 600);
    });
  }

  // veřejné API (debug / budoucí rozšíření)
  window.ABBooking = {
    getFlight: function () { return readJSON(sessionStorage, FLIGHT_KEY); },
    reinit: init
  };
})();
