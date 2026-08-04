/* =========================================================================
   booking-form.js  v0.1.1  —  Air Bohemia poptávkový formulář
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

   ZMĚNY v0.1.1:
   - Pole pax (Počet osob) přijme jen celá kladná čísla. Znaky - + . , e
     se blokují při psaní i po vložení ze schránky.

   ZMĚNY v0.1.0:
   - Pole se hledají podle data-f, ne podle name. Atribut `name` je tím
     uvolněný pro české popisky, které Webflow použije v {{formData}}.
     Starý markup (jen name) funguje dál — fallback zůstal.
   - Nová pole trip-type a source-label (uvnitř <form>) → v e-mailu se
     objeví jako "Typ letu: zpáteční" a "Zdroj poptávky: hlavní sekce (hero)".
   ⚠️ Pomocná pole (from-code, to-code, itinerary, email-body) přesuň VEN
      z <form>, ale nech uvnitř [data-booking]. Skript je najde, Webflow
      je neodešle → nebudou špinit e-mail.

   ZMĚNY v0.0.9:
   - Návrat je nyní VOLITELNÝ. Bez data návratu = jednosměrný let.
     tripType v JSONu se přepíná 'return' / 'oneway', returnAt je null.
     V e-mailu se řádek "Datum návratu" u jednosměrného vůbec nezobrazí
     a přibyl řádek "Typ letu: zpáteční / jednosměrný".
   ⚠️ Ve Webflow SUNDEJ required z pole return-at.

   ZMĚNY v0.0.8:
   - Nové pole email-body: skript složí CELÝ notifikační e-mail (letové údaje
     + kontakt + zdroj) do jednoho pole. Ve Webflow Body pak stačí
     {{email-body}} — konec duplicitních polí a JSONu v e-mailu.
   - Prázdná poznámka → "—" (žádný ošklivý visící řádek).
   - source má i čitelnou variantu ("hlavní sekce (hero)").

   ZMĚNY v0.0.7:
   - Krok 2 se odhaluje animovaně (height + opacity, STEP2_ANIM_MS nahoře).
     Respektuje prefers-reduced-motion.

   ZMĚNY v0.0.6:
   - FIX: kliknutí na "Pokračovat" už neodskočí k druhé instanci formuláře.
     revealStep2() scrolluje jen tam, kde uživatel kliknul.

   ZMĚNY v0.0.5:
   - buildReadable() už nepřilepuje IATA kód v závorce. Našeptávač ho totiž
     zapisuje rovnou do viditelné hodnoty ("Praha (PRG)"), takže se kód
     v e-mailu objevoval dvakrát: "Odkud: Linz (LNZ) (LNZ)".
     Kód zůstává dostupný ve viditelné hodnotě i zvlášť v JSONu (fromCode).

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

  // Délka animace odhalení kroku 2 (ms). Chceš pomaleji? Zvyš tohle číslo.
  var STEP2_ANIM_MS = 550;

  var FLIGHT_FIELDS  = ['from', 'from-code', 'to', 'to-code', 'pax', 'depart-at', 'return-at'];
  var STEP2_FIELDS   = ['name', 'phone', 'email', 'note'];
  var CONTACT_FIELDS = ['name', 'phone', 'email'];

  var instances = [];   // všechny [data-booking] na stránce
  var syncing   = false; // guard proti echo smyčce při live syncu

  // ---- utils ---------------------------------------------------------------
  function $(sel, ctx)  { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }
  // Pole se hledají podle data-f, ne podle name. Důvod: atribut `name` musí
  // zůstat volný pro Webflow — v notifikačním e-mailu ({{formData}}) se totiž
  // `name` používá jako popisek řádku. Takže name="Odkud", data-f="from".
  // Fallback na [name] je kvůli zpětné kompatibilitě se starším markupem.
  function field(root, key) {
    return root.querySelector('[data-f="' + key + '"]') ||
           root.querySelector('[name="' + key + '"]');
  }
  function keyOf(el) { return (el && (el.getAttribute('data-f') || el.name)) || ''; }
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
  // Jednosměrný, když chybí datum návratu; jinak zpáteční.
  function isReturn(s) { return !!(s['return-at'] && s['return-at'].trim()); }

  function buildReadable(s) {
    var rows = [
      'Typ letu: '      + (isReturn(s) ? 'zpáteční' : 'jednosměrný'),
      'Odkud: '         + (s.from || '—'),
      'Kam: '           + (s.to   || '—'),
      'Počet osob: '    + (s.pax       || '—'),
      'Datum odletu: '  + (s['depart-at'] || '—')
    ];
    // řádek s návratem přidáme jen u zpátečního letu
    if (isReturn(s)) rows.push('Datum návratu: ' + s['return-at']);
    return rows.join('<br>');
  }

  // Čitelný název místa, odkud poptávka přišla (pro člověka, ne 'hero'/'footer').
  function sourceLabel(src) {
    if (src === 'hero')   return 'hlavní sekce (hero)';
    if (src === 'footer') return 'patička (footer)';
    return src || '—';
  }

  // Sestaví KOMPLETNÍ tělo notifikačního e-mailu do jednoho pole.
  // Webflow pak v Body stačí {{email-body}} — žádná duplicitní pole.
  function buildEmailBody(root, s) {
    var g = function (n) { return getVal(root, n); };
    var note = g('note');
    var srcEl = root.closest('[data-form-source]');
    var src = srcEl ? srcEl.getAttribute('data-form-source') : '';

    return [
      '<strong>Detaily letu</strong>',
      buildReadable(s),
      '',
      '<strong>Kontakt</strong>',
      'Jméno: '   + (g('name')  || '—'),
      'Telefon: ' + (g('phone') || '—'),
      'E-mail: '  + (g('email') || '—'),
      'Poznámka: ' + (note ? note : '—'),
      '',
      'Poptávka odeslána z: ' + sourceLabel(src)
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
      tripType: isReturn(s) ? 'return' : 'oneway',
      from:     s.from,
      fromCode: s['from-code'],
      to:       s.to,
      toCode:   s['to-code'],
      pax:      s.pax,
      departAt: s['depart-at'],
      returnAt: isReturn(s) ? s['return-at'] : null
    }));

    // 3) odkud poptávka přišla (hero / footer) — strojově
    var srcEl = root.closest('[data-form-source]');
    setVal(root, 'source', srcEl ? srcEl.getAttribute('data-form-source') : '');

    // 4) typ letu a čitelný zdroj — tahle DVĚ pole jsou uvnitř <form>,
    //    takže se objeví v {{formData}} jako řádky e-mailu
    setVal(root, 'trip-type', isReturn(s) ? 'zpáteční' : 'jednosměrný');
    setVal(root, 'source-label', sourceLabel(srcEl ? srcEl.getAttribute('data-form-source') : ''));

    // 5) kompletní tělo e-mailu — Webflow ho v notifikaci použít NEUMÍ
    //    (podporuje jen {{formData}}), ale necháváme pro budoucí napojení
    //    přes API / Make. Pole patří VEN z <form>, ať e-mail nešpiní.
    setVal(root, 'email-body', buildEmailBody(root, s));
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
  // scroll = true jen pro instanci, ve které uživatel kliknul. Krok 2 se otevírá
  // v OBOU instancích, ale scrollovat smí jen jedna — jinak druhé volání
  // "vyhraje" a odsune uživatele k druhému formuláři.
  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  // scroll = true jen pro instanci, ve které uživatel kliknul.
  // animate = false pro okamžité otevření (obnova po refreshi).
  function revealStep2(root, scroll, animate) {
    var step2   = $('[data-step="2"]', root);
    var nextBtn = $('[data-step1-next]', root);
    if (!step2) return;
    if (root.getAttribute('data-step2-open') === 'true') return;  // už otevřeno
    root.setAttribute('data-step2-open', 'true');

    if (nextBtn) nextBtn.style.display = 'none';
    step2.style.display = 'flex';   // explicitní hodnota přebije class s display:none

    var dur = (animate === false || prefersReducedMotion()) ? 0 : STEP2_ANIM_MS;

    if (!dur) {
      if (scroll) step2.scrollIntoView({ behavior: 'auto', block: 'nearest' });
      return;
    }

    // display se animovat nedá — měříme cílovou výšku a animujeme height + opacity
    var target = step2.scrollHeight;
    step2.style.overflow   = 'hidden';
    step2.style.height     = '0px';
    step2.style.opacity    = '0';
    step2.style.transition = 'height ' + dur + 'ms cubic-bezier(.22,.61,.36,1), ' +
                             'opacity ' + Math.round(dur * 0.8) + 'ms ease';
    void step2.offsetHeight;        // vynutí reflow, jinak prohlížeč sloučí obě hodnoty

    step2.style.height  = target + 'px';
    step2.style.opacity = '1';

    // po dojetí uklidíme inline styly — jinak by pevná výška ořízla obsah,
    // který se objeví později (např. hlášky o chybné validaci)
    setTimeout(function () {
      step2.style.height     = '';
      step2.style.overflow   = '';
      step2.style.transition = '';
      step2.style.opacity    = '';
    }, dur + 40);

    if (scroll) {
      setTimeout(function () {
        step2.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, Math.round(dur * 0.35));   // scroll až když je panel částečně rozbalený
    }
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

    // Počet osob: jen celá kladná čísla. Blokujeme - + . , e při psaní
    // a čistíme i vložení ze schránky (keydown samo nestačí).
    var paxEl = field(root, 'pax');
    if (paxEl) {
      paxEl.addEventListener('keydown', function (e) {
        if (['-', '+', '.', ',', 'e', 'E'].indexOf(e.key) !== -1) e.preventDefault();
      });
      paxEl.addEventListener('input', function () {
        var clean = paxEl.value.replace(/[^0-9]/g, '');
        if (clean !== paxEl.value) paxEl.value = clean;
      });
    }

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
      revealStep2(root, true, true);    // tady scrollujeme
      // otevřít krok 2 i v druhé instanci, ale BEZ scrollu
      instances.forEach(function (other) {
        if (other !== root) revealStep2(other, false, true);
      });
    });

    // 4) auto-save (debounce 300 ms)
    function onEdit(e) {
      if (syncing) return;
      var k = keyOf(e.target);
      if (FLIGHT_FIELDS.indexOf(k) !== -1) scheduleSave(root);
      else if (STEP2_FIELDS.indexOf(k) !== -1) scheduleStep2Save(root);
    }
    root.addEventListener('input', onEdit);
    root.addEventListener('change', onEdit);

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
