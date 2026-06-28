# Komi Store — Manga Design System (SSOT)

Single source of truth for the inked-comic redesign of the Komi Store marketing site
(Jekyll, `github-store.org`). Every page MUST conform to this. When a page deviates,
fix the page — never fork the rules.

Goal: hand-inked, bold, confident. NOT soft/synthetic. "Nothing you don't need."

---

## 0. Architecture facts (don't relearn)

- Jekyll multi-page site. Shared stylesheet `assets/css/site.css` skins ALL pages via
  shared class names. Editing a class skins every page that uses it.
- Shared chrome: `_includes/head.html`, `nav.html`, `footer.html`, `announce_bar.html`,
  `newsletter.html`, `scripts.html`; `_layouts/default.html`, `news_post.html`.
- Privacy page has its OWN stylesheet `assets/css/privacy.css` (must be reskinned to match).
- Stats come from `_data/stats.yml` via Liquid — never hardcode them.
- MEMORY: never write release version numbers into rendered HTML / JSON-LD (download href
  version strings are workflow-maintained — leave those alone, don't reskin link targets).

---

## 1. Color = roles, not hex (Day default, Night toggle)

Use the CSS variables, never raw hex in components.

| role                | var               | Day       | Night     |
|---------------------|-------------------|-----------|-----------|
| background (page)   | `--page`          | #f1eadc   | #0c0a07   |
| surface (panels)    | `--surface`       | #faf5ea   | #16120c   |
| surfaceVariant      | `--surface-variant` | #e7dec9 | #211b12   |
| ink (text/outline)  | `--ink`           | #1b150d   | #f0e9da   |
| ink soft (muted)    | `--ink-soft`      | #695f50   | #968b77   |
| shadow              | `--shadow`        | #1b150d   | #000000   |
| accent FILL         | `--accent`        | #d8202a   | #d8202a   |
| on-accent           | `--on-accent`     | #ffffff   | #ffffff   |
| warn (announce)     | `--warn`          | #f5a300   | #f5a300   |

**Accent rule (hard):** accent (Crimson) is a FILL color ONLY. Never accent-colored text
on paper — low contrast. The single sanctioned exception is the ONE hero headline word,
which uses accent fill + a 2.5px ink stroke (`--webkit-text-stroke`).

For links on paper: text stays `--ink`, with an **underline whose color is accent**
(`text-decoration-color: var(--accent); text-decoration-thickness: 2px;`). The line is a
fill, not text — allowed.

Themes: `:root` = Day. `[data-theme="dark"]` and dark-system `[data-theme="auto"]` = Night.
`[data-theme="light"]` stays Day (inherits `:root`). Toggle cycles auto → light → dark.

---

## 2. Type

- Display / headings / numbers: **Anton**, UPPERCASE, line-height ~0.95, letter-spacing ~0.01em.
  Anton ships weight 400 only — never set bold on it.
- Body / UI: **Zen Kaku Gothic New** (400/500/700/900).
- Code / technical / countdowns / timestamps: **JetBrains Mono**.
- Vars: `--font-display`, `--font-body`, `--font-mono`.
- `h1–h4` default to `--font-display`. Apply `text-transform: uppercase` on headings,
  card titles, button labels, nav brand, stat/fact values. Exception: long-form blog body
  `h2/h3` may stay sentence-case for readability (still display font).
- Japanese accents (発見, 検索…) are decorative only, always paired with English, never
  load-bearing. Use sparingly if at all.

---

## 3. Ink construction (the whole look)

- **Borders:** panels `--bw-panel` (3px), buttons/inputs `--bw-btn` (2.5px), chips `--bw-chip`
  (2px). Color = `--ink`. **Zero corner radius everywhere** (`border-radius: 0`).
- **Hard offset shadows, NO blur:** panels `--sh-panel` (6 6 0), sub-cards `--sh-sub` (3 3 0),
  buttons `--sh-btn` (4 4 0). Shadow color = `--shadow`. Never use blurred/soft shadows.
- **Press (stamp-down):** element translates `+(shadow)px` while shadow collapses to 0.
  Pattern: `:active { transform: translate(3px,3px); box-shadow: 0 0 0 var(--shadow); }`.
- **Desktop hover = lift:** `@media (hover:hover)` → `translate(-3px,-3px)` and shadow grows
  (e.g. 7 7 0). Always gate hover-lift behind `@media (hover:hover)`.
- **Screentone** (halftone): `radial-gradient(var(--screentone) 1.4px, transparent 1.6px);
  background-size: 5px;` used as a top-right CORNER wash (~120×90, radial-masked), never a
  full fill. Helper: `.scr` adds it via `::after`; feature cards bake it in.
- **Speed lines:** `repeating-conic-gradient(from 0deg at 50% 50%, var(--speedline) 0deg 0.7deg,
  transparent 0.7deg 3.4deg)`, radially masked — behind hero / section headers / primary CTA
  ONLY. Low opacity (0.06–0.10). Never everywhere.
- **Stamps:** skew chips/tags −8..−12°; rotate badges/pills ±2..8°. Section overlines and
  press boilerplate labels are accent-fill skewed stamp tags.
- **Hazard stripes:** announce bar uses `repeating-linear-gradient(-45deg …, var(--hatch) …)`
  over `--warn`.

---

## 4. Motion (calm by default — must NOT feel flashy)

- Default = subtle: short fades / small translateY. No decorative loops, no orbit/pulse/glow.
- Expressive bits are sparse & opt-in: hero speed-line wash, one stamp-in on the badge/logo,
  cards stamp-down on press, step number flips to accent fill when active.
- NO universal scroll-reveal scale-bounce. `.reveal` = short fade + 20px rise only.
- Respect `prefers-reduced-motion`: kill animations, pin opacity:1, keep static rotations.

---

## 5. KILL LIST (AI-slop tells — must not exist anywhere)

- ❌ gradient/mesh backgrounds, glow auras, radial glow blobs (`--md-glow*`, `.hero__orb`,
  `.hero__grid`, `.hero__phone-glow`, `.cta__glow`, `::after` radial auras).
- ❌ glassmorphism, `backdrop-filter: blur`, blurred translucent cards, soft drop shadows.
- ❌ rounded corners anywhere; purple→blue / teal hero gradients.
- ❌ generic fade-up-+-scale on every block; floating/parallax orbs; shimmer sweeps; particles.
- ❌ Inter / Roboto / Outfit for display type.
- ❌ accent-colored text on paper (see §1).

If you find any of these in HTML, delete the element; in CSS, it's already been removed —
flag if it reappears.

---

## 6. Component vocabulary (reuse, don't reinvent)

- **Button** `.btn` (+`--filled` accent, `--tonal` surfaceVariant, `--outlined`): Anton
  uppercase, 2.5px ink border, hard shadow, stamp-down press, hover-lift. Don't restyle inline.
- **Panel/Card** (`.feature-card`, `.download-card`, `.press-block`, `.sponsor article`,
  `.about__card`, `.faq__item`, `.newsletter`, etc.): 3px ink border, 6px hard shadow, zero
  radius, surface bg, optional screentone corner. Grouped in site.css — inherit, then tweak
  padding only.
- **Sub-card** (rails/tiers/facts/boiler): 2px ink border, 3px shadow, surfaceVariant bg.
- **Chip/Tag:** info = straight 2px ink; filter/label = skewed −10° accent-fill stamp.
- **Section header:** overline = accent-fill skewed stamp; title = Anton uppercase clamp.
- **Stat slab / hanko:** Anton number, ink-bordered slab, slight ±1.5° rotation for variety.

---

## 7. Per-page conformance checklist

For each page, verify:
- [ ] No kill-list elements remain in the HTML (orbs, grids, glows).
- [ ] All surfaces use ink borders + hard shadows + zero radius (via shared classes).
- [ ] Headings/titles/buttons are Anton uppercase; body is Zen Kaku; code is JetBrains Mono.
- [ ] No accent text on paper; links use ink text + accent underline.
- [ ] Speed lines/screentone only in sanctioned spots (hero, section headers, primary CTA).
- [ ] Mobile stack works; tap targets ≥44px; no horizontal overflow.
- [ ] `prefers-reduced-motion` respected.
- [ ] Liquid/stats/SEO/JSON-LD untouched (reskin presentation only, not data or markup logic).
- [ ] Renders correctly in BOTH Day and Night.

---

## 8. Page inventory & status

| Page / file | Status | Notes |
|---|---|---|
| `assets/css/site.css` | ✅ DONE | Full manga rewrite (foundation). Clean, braces balanced. |
| `_includes/head.html` | ✅ DONE | Fonts → Anton/Zen Kaku/JetBrains; theme-color metas → `#0c0a07` / `#f1eadc`. |
| `_includes/nav.html` | ✅ conforms | styled by `.top-bar*`, no markup change. |
| `_includes/footer.html` | ✅ conforms | styled by `.footer*`. |
| `_includes/announce_bar.html` | ✅ conforms | Sun-warn + ink hazard; countdown JS intact. |
| `_includes/newsletter.html` | ✅ conforms | styled by `.newsletter*`. |
| `index.html` (home) | ✅ DONE | orbs/grid/phone-glow → `.hero__speed`+`.hero__tone`; `.cta__glow` removed; parallax-orb JS removed. |
| `features/index.html` | ✅ DONE | `.cta__glow` removed. |
| `download/index.html` | ✅ conforms | styled by `.download-*`, 0 edits. |
| `press/index.html` | ✅ conforms | `.press-*`; palette swatches keep literal hex (content). |
| `sponsors/index.html` | ✅ conforms | `.sponsor-*`; alloc-bar `--w` is data-driven. |
| `blog/index.md` + `news_post` | ✅ conforms | styled by `.news-*`. |
| `privacy-policy/` + `privacy.css` | ✅ DONE | privacy.css rewritten to consume shared manga tokens; dead `--pp-text-light` → `--ink-soft`. |
| `app/index.html` (deep-link) | ✅ DONE | self-contained reskin; JS byte-for-byte intact; orbs/grid/teal/Outfit gone. |
| `admin/dashboard.html` | ⏭️ out of scope | Decap CMS internal tool — left on prior styling by decision. |

All marketing pages reskinned. Local Jekyll build is broken in this env (Ruby 4.0.1 vs jekyll 3.9.0) — GitHub Pages builds with its own pinned Ruby, unaffected.
