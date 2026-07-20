/* =========================================================================
   airport-autocomplete.js  v0.0.5  —  Air Bohemia našeptávač letišť
   -------------------------------------------------------------------------
   Odvozeno ze StyleJet v0.0.3. Rozdíly:
   - AIRPORTS_URL míří na vlastní kopii v AB repu (StyleJet visel na
     osobním účtu VikyExp — to jsme odstřihli).
   - Světlý theme dropdownu (AB má bílá pole na tmavě modré).
   - FIX: scope pro dohledání `from-code` / `to-code` je [data-booking].
     StyleJet fallbackoval na `document`, což by při DVOU instancích
     komponenty na jedné stránce zapsalo IATA kód vždy do té první (hero),
     i když uživatel píše ve footeru.

   ZMĚNY v0.0.5:
   - Nová funkce czCity(): z "Milan [Milán] / Malpensa" udělá
     "Milán / Malpensa". Data v airports.json mají formát
     "Anglicky [Česky]" — hledá se podle obojího, zobrazuje se česky.
   - czCity() se používá na DVOU místech: ve vybrané hodnotě (choose)
     i v rozbalené nabídce. Kdyby jen v jednom, uživatel by v nabídce
     viděl hranaté závorky.

   ⚡ PŘECHOD NA AVINODE = upravíš JEN funkci fetchAirports() níže.
      Musí vracet Promise pole: [{code, name, city, country}, ...]
   ========================================================================= */
(function () {
  'use strict';

  var AIRPORTS_URL = 'https://cdn.jsdelivr.net/gh/Voitas-Ventures/airbohemia@v0.0.5/airports.json';
  var MAX_RESULTS  = 8;
  var MIN_CHARS    = 2;

  var _airportsPromise = null;
  function loadAirports() {
    if (!_airportsPromise) {
      _airportsPromise = fetch(AIRPORTS_URL)
        .then(function (r) { return r.json(); })
        .catch(function () { return []; });
    }
    return _airportsPromise;
  }

  async function fetchAirports(query) {
    var q = String(query || '').trim().toLowerCase();
    if (q.length < MIN_CHARS) return [];
    var data = await loadAirports();
    var res = [];
    for (var i = 0; i < data.length && res.length < MAX_RESULTS; i++) {
      var a = data[i];
      // hledá se i v původním (anglickém) názvu — "munich" i "mnichov" najde MUC
      var hay = (a.code + ' ' + a.name + ' ' + a.city + ' ' + a.country).toLowerCase();
      if (hay.indexOf(q) !== -1) res.push(a);
    }
    return res;
  }

  /* -----------------------------------------------------------------------
     czCity() — normalizace názvu města pro zobrazení
     "Milan [Milán] / Malpensa"  → "Milán / Malpensa"
     "Prague [Praha]"            → "Praha"
     "Nice"                      → "Nice"   (bez závorky = beze změny)
     ----------------------------------------------------------------------- */
  function czCity(a) {
    var c = (a.city || a.name || '');
    return c.replace(/\s*[^\[\]]*\[([^\]]+)\]/, '$1').trim();
  }

  function injectStyles() {
    if (document.getElementById('airport-ac-styles')) return;
    var s = document.createElement('style');
    s.id = 'airport-ac-styles';
    s.textContent =
      '.airport-suggestions{position:absolute;z-index:60;left:0;right:0;top:100%;' +
      'background:#fff;border:1px solid #d9dfe8;border-radius:10px;margin-top:6px;' +
      'max-height:260px;overflow:auto;display:none;box-shadow:0 12px 32px rgba(10,26,58,.18)}' +
      '.airport-suggestions.is-open{display:block}' +
      '.airport-suggestion{padding:10px 14px;cursor:pointer;color:#0f2a5c;font-size:14px;line-height:1.35}' +
      '.airport-suggestion small{color:#7c8aa3;display:block;font-size:12px}' +
      '.airport-suggestion.is-active,.airport-suggestion:hover{background:#eef3fa}';
    document.head.appendChild(s);
  }

  function debounce(fn, ms) {
    var t;
    return function () {
      var ctx = this, args = arguments;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, args); }, ms);
    };
  }

  function attach(input) {
    if (input._acReady) return;
    input._acReady = true;

    var wrap = input.parentNode;
    if (getComputedStyle(wrap).position === 'static') wrap.style.position = 'relative';

    // KLÍČOVÉ: scope na vlastní instanci komponenty, ne na document
    var scope = input.closest('[data-booking]') || document;
    var codeField = input.dataset.codeField
      ? scope.querySelector('[name="' + input.dataset.codeField + '"]')
      : null;

    var list = document.createElement('div');
    list.className = 'airport-suggestions';
    wrap.appendChild(list);

    var items = [], active = -1;

    function close() {
      list.classList.remove('is-open');
      list.innerHTML = '';
      items = [];
      active = -1;
    }

    function setActive(i) {
      if (!items.length) return;
      active = (i + items.length) % items.length;
      items.forEach(function (el, idx) { el.classList.toggle('is-active', idx === active); });
      items[active].scrollIntoView({ block: 'nearest' });
    }

    function choose(a) {
      input.value = czCity(a) + ' (' + a.code + ')';
      if (codeField) codeField.value = a.code;
      close();
      // ať booking-form.js zachytí změnu (auto-save + sync do druhé instance)
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    var run = debounce(function () {
      fetchAirports(input.value).then(function (matches) {
        list.innerHTML = '';
        items = [];
        active = -1;
        if (!matches.length) { close(); return; }
        matches.forEach(function (a) {
          var el = document.createElement('div');
          el.className = 'airport-suggestion';
          var sub = (a.name ? a.name + ' \u00b7 ' : '') + (a.country || '');
          el.innerHTML = czCity(a) + ' (' + a.code + ') <small>' + sub + '</small>';
          el.addEventListener('mousedown', function (e) { e.preventDefault(); choose(a); });
          list.appendChild(el);
          items.push(el);
        });
        list.classList.add('is-open');
      });
    }, 200);

    input.addEventListener('input', function () {
      if (codeField) codeField.value = '';
      run();
    });

    input.addEventListener('keydown', function (e) {
      if (!list.classList.contains('is-open')) return;
      if (e.key === 'ArrowDown')    { e.preventDefault(); setActive(active + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
      else if (e.key === 'Enter' && active > -1) {
        e.preventDefault();
        items[active].dispatchEvent(new MouseEvent('mousedown', { cancelable: true }));
      }
      else if (e.key === 'Escape')  { close(); }
    });

    input.addEventListener('blur', function () { setTimeout(close, 150); });
  }

  function attachAll() {
    injectStyles();
    document.querySelectorAll('.airport-input').forEach(attach);
  }

  if (document.readyState !== 'loading') attachAll();
  else document.addEventListener('DOMContentLoaded', attachAll);

  window.AirportAutocomplete = { attachAll: attachAll, fetchAirports: fetchAirports, czCity: czCity };
})();
