# Air Bohemia — poptávkový formulář: markup kontrakt a nasazení

## 1) GitHub repo

Nový repo **`Voitas-Ventures/airbohemia`**, do rootu nahraj:

- `booking-form.js`
- `flight-datepicker.js`
- `airport-autocomplete.js`
- `airports.json` — zkopíruj ze StyleJetu:
  `https://raw.githubusercontent.com/Voitas-Ventures/stylejet/main/airports.json`
  (otevři, Ctrl+A, Ctrl+C → v novém repu *Add file → Create new file* → vlož)

Pak **Releases → Create a new release → tag `v0.0.1`**.

> Pozn.: `AIRPORTS_URL` v `airport-autocomplete.js` už míří na `@v0.0.1` tvého
> nového repa. Kdyby ses rozhodl pro jiný název repa, uprav ho.

---

## 2) Webflow — Site Settings → Custom Code → Head Code

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/flatpickr@4/dist/flatpickr.min.css">
```

## 3) Page Settings stránky „Zažít let" → Before `</body>`

```html
<script src="https://cdn.jsdelivr.net/npm/flatpickr@4"></script>
<script src="https://cdn.jsdelivr.net/npm/flatpickr@4/dist/l10n/cs.js"></script>

<script src="https://cdn.jsdelivr.net/gh/Voitas-Ventures/airbohemia@v0.0.1/airport-autocomplete.js"></script>
<script src="https://cdn.jsdelivr.net/gh/Voitas-Ventures/airbohemia@v0.0.1/flight-datepicker.js"></script>
<script src="https://cdn.jsdelivr.net/gh/Voitas-Ventures/airbohemia@v0.0.1/booking-form.js"></script>
```

Pořadí je důležité: `booking-form.js` volá `FlightDatepicker.recompute()` při syncu.

---

## 4) Markup kontrakt (Webflow Designer)

Struktura **uvnitř komponenty** (název např. `Poptavka Letu`):

```
Div  [data-booking]                          ← ROOT komponenty
└── Form Block → Form
    ├── Div  [data-step="1"]
    │   └── Div  [data-leg]
    │       ├── Div (Odkud)
    │       │   ├── Label
    │       │   └── Text field   name="from"        class .airport-input
    │       │                    Custom attr: data-code-field = "from-code"
    │       ├── Text field (hidden) name="from-code"
    │       ├── Link/Div  [data-swap-route]         ← ikona ⇄
    │       ├── Div (Kam)
    │       │   └── Text field   name="to"          class .airport-input
    │       │                    Custom attr: data-code-field = "to-code"
    │       ├── Text field (hidden) name="to-code"
    │       ├── Number field     name="pax"      required, min=1
    │       ├── Text field       name="depart-at"   class .flight-date-input  required
    │       └── Text field       name="return-at"   class .flight-date-input  required
    │
    ├── Link/Button [data-step1-next]  „Pokračovat v nezávazné poptávce"
    │
    └── Div  [data-step="2"]                 ← Style: display: none
        ├── Text field  name="name"    required   („Jméno a příjmení")
        ├── Text field  name="phone"   required
        ├── Email field name="email"   required
        ├── Textarea    name="note"               („Doplňující informace")
        ├── Text field (hidden) name="itinerary"
        ├── Text field (hidden) name="itinerary-readable"
        ├── Text field (hidden) name="source"
        ├── Paragraph  „*Odesláním formuláře souhlasíte…"
        └── Submit button  „Odeslat"
```

### Poznámky k markupu

- **`[data-swap-route]`** — pokud je to `Link`, dej `href="#"`. JS dělá `preventDefault()`.
- **Hidden pole** = normální Text field, ve Style panelu `display: none`.
  (Nepoužívej Webflow „hidden" typ — ten nemá `name` editovatelný přes UI stejně dobře.)
- **`[data-step="2"]`** musí mít v Style panelu `display: none`. JS ho přepne na
  `display: flex` — proto ho udělej jako **Vertical Flex** (v-flex), ať layout sedí.
- **`name` atributy musí být přesně tyto** (ASCII, lowercase, pomlčky).
  Viditelný label může být klidně česky s diakritikou.
- **`label for`** — dej ho přes Custom attributes ručně (Webflow ho negeneruje
  správně, když měníš text pole). JS pak u druhé instance přepíše `id` i `for`
  na `email-2`, `name-2` atd., aby klik na label ve footeru fokusnul správné pole.

### Mimo komponentu (na stránce)

Sekci, do které komponentu vložíš, dej custom attribute:

- Hero sekce:   `data-form-source` = `hero`
- Footer sekce: `data-form-source` = `footer`

JS to zapíše do hidden pole `source`, takže v notifikaci uvidíš, odkud poptávka přišla.
(Uvnitř komponenty to udělat nejde — obě instance jsou identické.)

---

## 5) Webflow Form Settings

Obě instance komponenty budou mít **stejný form name** — to je v pořádku, Webflow
je zvládne. V notifikačním e-mailu (Site Settings → Forms) použij:

- `{{itinerary-readable}}` → vypíše se jako:
  ```
  Odkud: Praha (PRG)
  Kam: Nice (NCE)
  Počet osob: 4
  Datum odletu: 12.08.2026
  Datum návratu: 19.08.2026
  ```
- `{{itinerary}}` → strojový JSON pro pozdější napojení (CRM / Avinode)
- `{{source}}` → `hero` nebo `footer`

Nezapomeň, že `itinerary-readable` používá `<br>` — v HTML e-mailu se to
vykreslí správně, v plain-text ne.

---

## 6) QA checklist

- [ ] Vyplň hero formulář → sjeď do footeru → **musí být vyplněný taky**
- [ ] Klikni „Pokračovat" v hero → **krok 2 se otevře i ve footeru**
- [ ] Refresh stránky → letové údaje i rozepsané osobní údaje zůstanou
- [ ] Klik na label „E-mail" ve footeru → fokus musí skočit **na footer pole**, ne na hero
- [ ] Vyber letiště z nabídky → zkontroluj v DevTools, že `from-code` má IATA kód
      **v té správné instanci**
- [ ] Datum návratu nejde nastavit před datum odletu
- [ ] Po odeslání: nová session → jméno/telefon/e-mail se předvyplní (localStorage),
      letové údaje jsou prázdné
