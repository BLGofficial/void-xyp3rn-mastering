# XYP3RN MASTERING — Design System

**Version:** 1.0 (extracted from source at commit `4408fa7`)
**Scope:** XYP3RN Tech product UI — the browser mastering studio
**Source of truth:** `tailwind.config.ts`, `app/globals.css`, `app/layout.tsx`, `components/**`, `app/icon.svg`, `README.md`
**Machine-readable companion:** [`design-tokens.css`](./design-tokens.css)

---

## How to read this document

Every claim carries a marker:

| Marker | Meaning |
| --- | --- |
| **[O]** | **Observed.** Present verbatim in the repository: a declared token, a class, a CSS rule, a rendered value. |
| **[R]** | **Recommended.** Not supplied by the source. A proposal that extends the system without contradicting it, with a one-line reason. |
| **Not specified** | The source is silent. No value is invented. |

Where the source conflicts with general design convention, the source wins. Where the source conflicts with itself, the conflict is logged in [Appendix D](#appendix-d--gaps-conflicts-and-open-questions) rather than silently resolved.

---

## Project context

The brief's context fields were placeholders. They are filled below from repository evidence; anything the code cannot establish is marked.

| Field | Value | Basis |
| --- | --- | --- |
| **Product or brand** | **XYP3RN MASTERING**; brand family **XYP3RN TECH**; product line dated **"Color Palette 2026"** | `README.md`, `Header.tsx`, `tailwind.config.ts` |
| **Product type** | Single-page browser audio mastering studio. Next.js 14, static export, all DSP in the browser via AudioWorklet + Web Worker. A professional audio instrument, not a marketing site. | `README.md`, `next.config.mjs`, `audio/` |
| **Audience** | **[O]** Professional-adjacent: engineers and producers who understand LUFS, dBTP, LRA, mid/side and dither. Evidence: BS.1770/R128 measurement, −23 LUFS broadcast / −14 streaming / −16 podcast targets, "already mastered — go light" detection, 16/24/32-bit and up-to-8-channel WAV. **[R]** Secondary audience: self-releasing artists who need standards-compliant output without understanding the standards — served by the Auto panel and plain-language notes. | `OutputPanel.tsx`, `SourcePanel.tsx`, `lib/auto` |
| **Brand posture** | Precision instrument meets studio hardware understatement: near-black, one gold accent, hairline borders, mono microlabels, zero decoration for its own sake. Authority is asserted through measurement, never through adjectives. The governing line is **"Suggests — never decides."** | `tailwind.config.ts` palette comment, `Studio.tsx`, `AutoPanel.tsx` |
| **Primary use case** | Drop a WAV → read its measured profile → accept or edit a processing chain → render to a loudness target → download the file. One linear session, one page. | `Studio.tsx` flow |
| **Source pages or materials** | The running application source. No design files, screenshots, Figma, or brand PDF shipped in the repo. Brand Guidelines are *referenced* ("Brand Guidelines ch. 02", "Color Palette 2026") but **not present**. | see [Appendix C](#appendix-c--observed-pages-or-source-materials) |

### Evidence base and confidence

| File | What it establishes | Confidence |
| --- | --- | --- |
| `tailwind.config.ts` | Full palette with role comments, four font families, `tracking-label` | High — authoritative token file |
| `app/globals.css` | Glass surfaces, elevation, motion curves, component classes, focus, selection, reduced motion | High |
| `app/layout.tsx` | Font loading and pairing, `theme-color`, `color-scheme: dark` | High |
| `components/studio/*.tsx` | Component anatomy, states, sizes, breakpoint behavior, copy | High |
| `components/brand/*`, `app/icon.svg` | Logo construction, clear space, minimum size | High |
| `README.md` | Brand rules ("gold on Studio Black only, never below 24 px") | High |
| `e2e/studio.e2e.test.ts` | Canonical desktop viewport: **1440 × 1000** | High |

**Not available:** light theme, multi-page navigation, illustration or icon library, motion specs for transitions between screens, email/social templates, any marketing or pricing surface. Treat all of those as **Not specified** and design them from the rules below.

---

## 1. Visual theme and atmosphere

### 1.1 The idea

**[O]** A black anodised rack unit rendered in software. The interface is a single sheet of smoked glass floating over near-black, with gold used the way a hardware manufacturer uses it: for the mark, the active state, and the number that matters. Everything else is grey, hairline, and square.

The atmosphere is **dark, precise, quiet, and measured** — closer to a laboratory instrument than to a music product. There is no photographic imagery, no gradient hero, no rounded friendliness. Depth comes from translucency and shadow, not from colour.

### 1.2 Visual density

**[O] Dense.** The workspace is the densest surface in the system: up to 8 processor modules, each exposing 1–8 continuous controls; 6 source readouts; 4 live meters; 4 output fields; a 4-value report. A single desktop view can carry 60+ interactive or numeric elements.

Density is made legible by four rules, all observed:

1. **Generous outer rhythm, tight inner rhythm.** 16px between panels, 10–12px inside them (`gap-4` / `space-y-3` / `py-2.5`).
2. **Size encodes importance.** 12px mono for labels and metadata, 16–24px mono for values. Nothing else competes.
3. **One accent.** Gold is reserved for active state, measured results, and the mark. It is never used to fill large areas.
4. **Hairlines over boxes.** 1px borders at `#282828`/`#343434` separate without adding weight.

**[O] Sparse only on first load**, where a single dropzone and one 14px paragraph occupy the workspace. This contrast — near-empty to fully loaded — is intentional and should be preserved.

### 1.3 Signature motifs

| Motif | Detail |
| --- | --- |
| **Single-gold discipline** | `#FACD68` is the only chromatic hue in the entire UI. Amplitude, state, and hierarchy all resolve to it. |
| **Square corners** | Radius is **0** everywhere. The only curve in the product is the 6px status dot (`h-1.5 w-1.5 rounded-full`). |
| **Mono microlabels** | 12px uppercase JetBrains Mono at `0.12em` tracking, in gold (panel titles) or muted grey (metadata). The instrument-panel voice. |
| **Hairline chrome** | 1px borders, plus an `inset 0 1px 0 rgba(255,255,255,0.04)` highlight that reads as a machined bevel edge. |
| **Smoked glass panels** | `rgba(13,13,13,0.78)` + `backdrop-filter: blur(18px) saturate(115%)`, layered over the gold glow below. |
| **Gold atmosphere bleed** | Two fixed radial glows (7% and 4% gold) at 12%/8% and 88%/32%, plus a 145° black gradient. |
| **Engineering grid** | 36px × 36px white grid at 2% opacity, masked to fade out by 70% of the viewport height. |
| **Dual-trace waveform** | Source in grey `#444444`, master in gold at 85% alpha, playhead as a 1px `#E8E8E8` bar. |
| **Numbered reasoning** | Auto-generated notes are prefixed `01`, `02`, `03` in gold mono. Warnings use a gold `▸`. |
| **The interlocking X** | Symmetrical four-arm mark with diamond holes, gold, always on black. |

### 1.4 Existing design constraints

**[O]** These are structural rules that any new screen must respect:

1. **Amber is forbidden here.** `tailwind.config.ts` states: *"Amber is Records-only and deliberately absent."* Amber belongs to the sibling brand XYP3RN Records. Introducing it into a Tech surface crosses a brand boundary.
2. **The mark is gold `#FACD68` on Studio Black `#080808` only, never recoloured, never below 24 px** (`README.md`, `XyperMark.tsx`, enforced in code by `Math.max(24, size)`).
3. **Four typefaces, one role each** (`layout.tsx` cites "Brand Guidelines ch. 02"). A fifth family is a violation, not a variation.
4. **Dark only.** `color-scheme: dark` is set at `:root` and on `<html>`; there is no light theme and no toggle.
5. **No server.** Static export means no image optimisation, no server-side personalisation, no runtime image pipeline. Imagery must be pre-sized and self-hosted.
6. **Reduced motion is mandatory.** Global override collapses transition/animation to 0.01ms; the render orb swaps video for a still poster under `motion-reduce`.
7. **Hover effects are gated** behind `@media (hover: hover) and (pointer: fine)` — never assume a pointer.

### 1.5 Atmosphere for new surfaces

**[R]** Extend the system by *addition of structure, not addition of colour*. A new surface (onboarding, pricing, docs) should inherit: Studio Black canvas, one glass panel per logical grouping, mono microlabels, gold only for the primary action and for measured/confirmed values. If a new screen needs a "second accent" to work, the layout is not doing its job.

---

## 2. Color palette and semantic roles

### 2.1 Core roles

Values below are verbatim from `tailwind.config.ts` ("XYP3RN Tech palette (Color Palette 2026)"). Names are preserved exactly as declared.

| Role | Semantic name | Value | Usage |
| --- | --- | --- | --- |
| **Primary action** | `gold` | `#FACD68` | Primary button fill; panel titles; active toggle fill; measured result values; the mark; status dot; selection background; progress fill; slider fill; focus ring |
| **Accent** | `gold-dim` | `#C9A03E` | Primary button hover fill; active module border; alert border; secondary emphasis. Never a large fill. |
| **Background** | `studio` | `#080808` | Primary canvas; page background base; text colour *on* gold |
| **Surface** | `panel` | `#0D0D0D` | Cards and sections (base for the 78% glass) |
| **Surface (raised)** | `surface` | `#111111` | Raised UI, unpressed toggles, module bases, disabled button fill |
| **Surface (chrome)** | `chrome` | `#000000` | Bars and nav; render orb frame; `bg-black` overlays |
| **Primary text** | `cloud` | `#E8E8E8` | Headings, key content, numeric readouts, control values |
| **Secondary text** | `ash` | `#A6A6A6` | Body copy, field labels, helper text, slider labels |
| **Border** | `line-card` | `#343434` | Default card and control border |
| **Border (subtle)** | `line` | `#282828` | Internal dividers, panel header rule, bypassed module border |
| **Tertiary text** | `muted` | `#686868` | Metadata, units, disabled label text, footer, timestamps |
| **Emphasis only** | `white` | `#FFFFFF` | High-contrast emphasis only — **used zero times in current components** |
| **Tint** | `gold-glow` | `#2A1E00` | Alert background, drag-over dropzone background |
| **Code** | `code.bg` / `code.fg` | `#0A0A0A` / `#D4D4D4` | Code blocks; waveform canvas background |

### 2.2 Surface hierarchy

**[O]** Four steps, deliberately narrow. Depth is communicated by translucency and shadow as much as by value.

```
chrome  #000000   bars, nav, video frame, overlays      ← outermost / darkest
panel   #0D0D0D   cards, sections (rendered as 78% glass over the page)
surface #111111   controls, modules, raised elements
code.bg #0A0A0A   waveform well
studio  #080808   page canvas                           ← base, under everything
```

Note that `studio` is *not* the darkest value — `chrome` and `code.bg` are. The page canvas sits between them so that glass panels read as lifted.

### 2.3 Glass and translucent surfaces

**[O]** Declared in `globals.css`, not in the Tailwind palette:

| Token | Value | Used by |
| --- | --- | --- |
| `--xr-glass` | `rgb(13 13 13 / 78%)` | `.xr-panel` |
| `--xr-glass-raised` | `rgb(20 20 20 / 72%)` | `.xr-button` default |
| `--xr-glass-line` | `rgb(255 255 255 / 11%)` | Panel hover border, `.xr-glass` border |
| `--xr-gold-line` | `rgb(250 205 104 / 32%)` | Secondary button hover border |
| — | `rgb(0 0 0 / 68%)` | `.xr-glass` (header bar, footer) |
| — | `rgb(17 17 17 / 62%)` | `.xr-dropzone` |
| — | `rgb(17 17 17 / 64%)` | `.xr-module` |
| — | `rgb(17 17 17 / 82%)` | `.xr-select` |
| — | `rgb(24 24 24 / 90%)` | `.xr-select` hover |
| — | `rgb(28 25 19 / 78%)` | `.xr-button` hover (gold-tinted black) |

### 2.4 Gradients and atmosphere

**[O]**

- Page background: `radial-gradient(circle at 12% 8%, rgb(250 205 104 / 7%), transparent 28rem)`, `radial-gradient(circle at 88% 32%, rgb(250 205 104 / 4%), transparent 24rem)`, plus `linear-gradient(145deg, #080808 0%, #0b0b0b 48%, #070707 100%)`. Fixed attachment.
- Grid overlay: two `linear-gradient` rules producing a 36px grid at `rgb(255 255 255 / 2%)`, opacity `0.32`, masked `linear-gradient(to bottom, black, transparent 70%)`.
- Panel sheen: `linear-gradient(135deg, rgb(255 255 255 / 4%), transparent 32%, rgb(250 205 104 / 2%))` behind every `.xr-panel`.
- No linear gradient is ever used to fill a control.

### 2.5 Semantic status colours

**[O] There are no green / amber / red semantics.** This is a defining constraint:

- **Warnings** → gold `▸` glyph + `ash` text, inside the result block.
- **Errors** → border `gold-dim`, background `gold-glow`, text `cloud`, `role="alert"`.
- **Success / ready** → gold text and a gold dot; the status word carries meaning, not colour.
- **Bypassed / inactive** → desaturation: border drops to `line`, text to `ash`, slider fill to `#444444`.
- **Target missed** → the word `limited` renders in `ash` (vs `gold` when achieved). Colour signals *achievement*, not *failure*.

**[R]** Do not introduce green/red for status. If a new surface needs destructive semantics, express it with wording and weight first, and at most `gold-dim` borders. A red destructive button would be the single loudest object in the product.

### 2.6 Measured contrast (computed from the palette above)

WCAG 2.1 ratios, calculated for every foreground/background pair actually in use:

| Foreground | On | Ratio | Verdict |
| --- | --- | --- | --- |
| `cloud` `#E8E8E8` | `panel` `#0D0D0D` | **15.86:1** | AAA |
| `cloud` on | `studio` `#080808` | **16.35:1** | AAA |
| `ash` `#A6A6A6` | `panel` | **7.98:1** | AAA |
| `ash` on | `studio` | **8.23:1** | AAA |
| `gold` | `panel` | **12.95:1** | AAA |
| `gold` on | `studio` | **13.35:1** | AAA |
| `gold-dim` `#C9A03E` | `studio` | **8.18:1** | AAA |
| `studio` on `gold` (primary button) | — | **13.35:1** | AAA |
| `muted` `#686868` | `panel` | **3.49:1** | AA large text only |
| `muted` on | `studio` | **3.59:1** | AA large text only |
| `muted` on `gold-glow` | — | 2.93:1 | **Fails** — combination not used |

**[O] Finding:** `muted` at 12px satisfies only the large-text threshold (3:1), not the 4.5:1 normal-text threshold. It is currently used for panel asides, units, file sizes, timestamps, the footer, and the disabled state. For units and timestamps that sit beside a high-contrast value, the practical effect is acceptable because the value carries the meaning.

**[R]** Restrict `muted` to *non-essential* text: units, timestamps, file sizes, decorative asides, disabled labels. Never use `muted` for the only rendering of a required value or label. Use `ash` (7.98:1) for anything a user must read to complete a task. Do not lighten `muted` globally — it would collapse the three-step text hierarchy that gives the dense UI its calm.

### 2.7 Quick copy values

```
CANVAS      #080808 studio      #0D0D0D panel     #111111 surface    #000000 chrome
GOLD        #FACD68            #C9A03E dim       #2A1E00 glow
TEXT        #E8E8E8 cloud      #A6A6A6 ash       #686868 muted      #FFFFFF (sparing)
LINES       #343434 card       #282828 subtle    rgba(255,255,255,0.11) glass edge
CODE        #0A0A0A bg         #D4D4D4 fg
```

---

## 3. Typography rules and hierarchy

### 3.1 Families

**[O]** Four families, loaded via `next/font/google` with `display: 'swap'`, exposed as CSS variables, one role each. The brief's single "primary font" field is ambiguous for this system, so the mapping is given explicitly:

| Role | Family | Variable | Fallback stack | Declared by |
| --- | --- | --- | --- | --- |
| **Primary (body)** | **DM Sans** | `--font-dm-sans` | `system-ui, sans-serif` | `<body class="font-body">` |
| **Display** | **Bebas Neue** (400 only) | `--font-bebas` | `Impact, sans-serif` | Wordmark only |
| **Heading** | **Syne** | `--font-syne` | `system-ui, sans-serif` | Module titles, dropzone title |
| **Monospace** | **JetBrains Mono** | `--font-jetbrains` | `ui-monospace, monospace` | All labels, numbers, buttons, chrome |

**Why these four** — **[R] (interpretation):** Bebas Neue is condensed, uppercase, hardware-stencil; it makes the wordmark read as a chassis label. Syne's slightly unusual letterforms carry the contemporary-music signal that the rest of the palette suppresses. DM Sans keeps long helper text neutral. JetBrains Mono makes every measurement read as instrumentation and — critically — makes digits monospaced so live meters don't jitter.

**Weights used [O]:** Bebas 400; Syne 700 (`font-bold`, module and dropzone titles); DM Sans default/regular; JetBrains Mono 400 and 700 (primary button). **No italics anywhere. No weights below 400.**

### 3.2 Tracking and casing

| Token | Value | Applied to |
| --- | --- | --- |
| `tracking-label` | **`0.12em`** | Every mono uppercase element: panel titles, buttons, toggles, chrome, footer, status, warning labels |
| `tracking-wide` | `0.025em` (Tailwind default) | The `XYP3RN` / `MASTERING` wordmark |

**[O] Uppercase is a rule for mono text, not for prose.** Every mono microlabel, button label, and chrome string is uppercase. Every body string, field label, module title, and readout label is sentence case. Mixing the two breaks the instrument metaphor.

### 3.3 Type scale and roles

Sizes are the Tailwind utility values actually present in components. Line heights are **Tailwind defaults, not overridden** — the source declares no custom line heights.

| Role | Size / LH | Family | Weight | Tracking | Casing | Colour | Where |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Wordmark A** | **44px** / none (`leading-none`) | Bebas | 400 | wide | UPPER | `gold` | `XYP3RN` |
| **Wordmark B** | **28px** / none | Bebas | 400 | wide | UPPER | `cloud` | `MASTERING` |
| **Headline value** | **24px** / 2rem | Mono `tabular-nums` | 400 | — | — | `cloud` | Emphasised readout (Integrated, True peak) |
| **Panel title** | **12px** / 1rem | Mono | 400 | `0.12em` | UPPER | `gold` | Every panel header |
| **Readout value** | **16px** / 1.5rem | Mono `tabular-nums` | 400 | — | — | `cloud` | Secondary readouts (Range, Crest, Correlation, screens) |
| **Body / lead** | **14px** / 1.25rem | DM Sans | 400 | — | sentence | `ash` | Intro paragraph (`max-w-2xl`), errors |
| **Module title** | **14px** / 1.25rem | Syne | 700 | — | sentence | `cloud` (or `ash` if bypassed) | Processor module headings |
| **Control label** | **12px** / 1rem | DM Sans | 400 | — | sentence | `ash` | Slider labels, checkbox label |
| **Mono label / button** | **12px** / 1rem | Mono | 400 / 700 | `0.12em` | UPPER | `cloud`/`ash`/`gold`/`muted` | `.xr-label`, all buttons, toggles, chrome |
| **Unit** | **12px** / 1rem | Mono | 400 | — | UPPER | `muted` | `LUFS`, `dBTP`, `dB`, `LU` |
| **Helper / note** | **12px** / 1rem | DM Sans | 400 | — | sentence | `ash` | Preset hints, safety warnings, auto notes |
| **Metadata** | **12px** / 1rem | Mono | 400 | `0.12em` | UPPER | `muted` | Footer, file sizes, `In signal order` |

### 3.4 Typography principles

**[O]**

1. **Monospace means "this is a measurement."** Any number a user reads as data is JetBrains Mono with `tabular-nums`. This includes meter values at 24px and slider outputs at 12px.
2. **Roman text means "this is language."** Labels, module names, helper copy, and warnings are DM Sans or Syne.
3. **Hierarchy is carried by size and colour, not weight.** Almost everything is 400. Emphasis is a jump from 12px `ash` to 24px `cloud`, not a jump to 700.
4. **Typographic minus and trailing units are mandatory.** Negative values use U+2212 `−`, not the hyphen. Units follow the value with a space: `−0.9 dBTP`. Missing values render an em dash `—`; infinities render `∞`.
5. **Labels above values.** Every readout is a mono/grey label stacked over a mono/value pair; the label is always smaller and quieter than the value.
6. **Sentence case for all prose, uppercase only for mono.**

**[R]** Keep display type (Bebas) out of body contexts. It is a single-purpose face for the wordmark; using it for section headings would make the product read as a poster rather than an instrument. If a marketing page needs display type, constrain Bebas to 44px+ uppercase headline use only.

---

## 4. Component styling

All production components are class compositions (`.xr-*`) plus Tailwind utilities. Radius is **0** everywhere.

### 4.1 Buttons and links

#### Primary button — `.xr-button-primary`

| Property | Observed value |
| --- | --- |
| Fill | `gold` `#FACD68`; text `studio` `#080808` |
| Type | JetBrains Mono 12px, **700**, uppercase, `0.12em` |
| Padding / height | `px-5 py-2.5`; `min-h-11` (44px) below `sm`, `min-h-0` at `sm`+ |
| Border | none (the fill is the boundary) |
| Radius | 0 |
| Shadow | `0 8px 24px rgba(250,205,104,0.14)`, `inset 0 1px 0 rgba(255,255,255,0.35)` |
| Hover (fine pointer) | fill → `gold-dim` `#C9A03E`; `translateY(-2px)`; `0 12px 30px rgba(250,205,104,0.22)`, inset highlight drops to 28% |
| Active | `translateY(0) scale(0.985)` |
| Focus-visible | `outline: 2px solid #FACD68; outline-offset: 2px` |
| Disabled | fill `surface` `#111111`, text `muted`, `cursor: not-allowed` |
| Transition | `180ms cubic-bezier(0.16,1,0.3,1)` on transform, background, shadow |

**[O] One primary button per view.** In the studio it is *Render master*. Play/Pause is also primary-styled but is local to the transport (it owns the monitor row). No other component uses this class.

#### Secondary button — `.xr-button`

| Property | Observed value |
| --- | --- |
| Fill | `rgba(20,20,20,0.72)` + `inset 0 1px 0 rgba(255,255,255,0.05)` |
| Border | 1px `line-card` `#343434` |
| Type | Mono 12px 400, uppercase, `0.12em`; text `cloud` |
| Padding / height | `px-4 py-2`; `min-h-11` below `sm`, `min-h-0` at `sm`+ |
| Hover | text → `gold`; border → `rgba(250,205,104,0.32)`; fill → `rgba(28,25,19,0.78)`; `translateY(-2px)` |
| Active | `translateY(0) scale(0.985)` |
| Focus / disabled | identical to primary (gold ring / `muted` text) |

#### Text-only actions

**[O]** Remove-module `✕` and the download `<a>` are styled with `.xr-button` (the anchor is `block w-full text-center`). There is no separate "link" style: **actions are buttons or bordered blocks**, never inline underlined text. Navigation to a file is a button-shaped download, not a hyperlink.

**[R]** If a true inline text link is ever needed, use `ash` → `gold` on hover with a 1px `gold-dim` underline at `underline-offset-4`. Reason: it is the only treatment that stays inside the palette while remaining distinguishable from body copy.

### 4.2 Cards and containers

#### Panel — `.xr-panel` (the workhorse)

```
border:      1px solid #343434            (hover → rgba(255,255,255,0.11))
background:  rgba(13,13,13,0.78)
backdrop:    blur(18px) saturate(115%)    (inside @supports)
shadow:      0 18px 48px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.04)
sheen:       linear-gradient(135deg, rgba(255,255,255,0.04), transparent 32%, rgba(250,205,104,0.02)) — ::before, z-index -1
radius:      0
overflow:    hidden (clips sheen and headers)
isolation:   isolate
hover:       translateY(-1px); border rgba(255,255,255,0.11); shadow 0 22px 58px rgba(0,0,0,0.34)
transition:  420ms transform, 180ms border-color, 420ms shadow
```

**Anatomy [O]:** header bar `flex justify-between gap-3 border-b border-line px-4 py-2.5` containing an `<h2>` at 12px mono uppercase gold, plus an optional `aside` at 12px mono `muted`; body `p-4`.

#### Module card — `.xr-module` (inside the Chain panel)

```
border:      1px solid #C9A03E  (active)  /  1px solid #282828  (bypassed)
background:  rgba(17,17,17,0.64)
shadow:      inset 0 1px 0 rgba(255,255,255,0.03)
padding:     p-4
hover:       translateY(-2px); background rgba(20,20,20,0.78); 0 12px 28px rgba(0,0,0,0.22)
```

**[O]** Note the inversion: an *active* module is bordered in `gold-dim`, a *bypassed* one in `line`. Inactivity is a border downgrade, not a dimming overlay. Text also steps down (`cloud` → `ash`) and slider fill goes `#FACD68` → `#444444` via the `.xr-off` parent class — controls stay live and readable while reading as off.

#### Dropzone — `.xr-dropzone`

`1px dashed` border, fill `rgba(17,17,17,0.62)`, `px-4 py-6`, centred stack (Syne 700 14px `cloud` title over mono 12px `ash` hint). Hover: `translateY(-1px)` + `inset 0 0 0 1px rgba(250,205,104,0.08)`. Drag-over: border `gold`, background `gold-glow` `#2A1E00`. Busy: `opacity-60 pointer-events-none`.

#### Glass bar — `.xr-glass`

`rgba(0,0,0,0.68)`, border `rgba(255,255,255,0.11)`, `inset 0 1px 0 rgba(255,255,255,0.04)`, same 18px backdrop blur. Used by header chrome, footer, and inline alerts.

#### Alert — **[O]** `border border-gold-dim bg-gold-glow px-4 py-3 text-sm text-cloud` with `role="alert"`.

### 4.3 Inputs and controls

#### Select — `.xr-select`

`min-h-11` (44px) below `sm`, `min-h-0` at `sm`+; `w-full`; border `line-card`; fill `rgba(17,17,17,0.82)`; mono 12px `cloud`; `px-3 py-2`. Hover: border → glass line, fill → `rgba(24,24,24,0.90)`. Focus-visible: `outline: 2px solid #FACD68; outline-offset: 1px` **plus** a `0 0 0 4px rgba(250,205,104,0.09)` halo.

**[O]** Native `<select>` only. No custom listbox, no popover, no combobox. Options are plain text with a leading value and label: `−14 LUFS · streaming`.

#### Range slider — `.xr-range`

| Part | Observed value |
| --- | --- |
| Track height | **4px**, radius 0, colour `#222222` |
| Fill | `gold` `#FACD68`, width driven by `--slider-progress` set from JS |
| Thumb | **14px square**, radius 0, `2px solid #080808` keyline, fill = slider fill colour |
| Height (hit area) | `1.75rem` (28px) desktop; **`2.75rem` (44px) below `sm`** |
| Hover | thumb `scale(1.12)` + `0 0 0 4px rgba(250,205,104,0.12)` |
| Focus | `outline: 2px solid #FACD68; offset 2px` |
| Disabled / in `.xr-off` | fill `#444444`; disabled also `cursor: not-allowed` |

**[O]** WebKit has no progress pseudo-element, so the filled portion is a hard-stop `linear-gradient(to right, fill 0 var(--slider-progress), track var(--slider-progress) 100%)`. Vendor pseudo-elements live in separate rules because one unknown selector drops an entire rule.

**[O] Slider anatomy:** label left (`truncate`, 12px `ash`), `<output>` right (`shrink-0`, mono 12px `tabular-nums`, `cloud`), formatted to the parameter's step precision with its unit — e.g. `−3.5 dB`, `1.00`, `250 ms`. `aria-valuetext` mirrors the visible string.

#### Toggle — pressed/unpressed button

Two-state, `aria-pressed`, `min-h-11` below `sm` → `min-h-0` at `sm`+, `px-2.5 py-1`, mono 12px uppercase `0.12em`.
**Pressed:** fill `gold`, text `studio`, border `gold`.
**Unpressed:** fill `surface` `#111111`, text `ash`, border `line-card`; hover → border `gold-dim`, text `gold`.
**Disabled:** `opacity-40`, `cursor: not-allowed`.

**[O]** Used for: module On/Off, mode switches (`Peak|Hybrid`, `Sample|True peak`), quality (`Standard|4x Studio`), transport `Master|Source`, `Match LUFS`. Mode switches are rendered as *two adjacent toggles*, not a segmented control — the pair `[Peak][Hybrid]` with one filled.

#### Checkbox

**[O]** Native, `h-4 w-4`, `accent-color: #FACD68`, label 12px `ash`, row `min-h-11` below `sm`. One instance: "TPDF dither on PCM export", disabled for 32-bit float.

### 4.4 Navigation

**[O]** The product is a single page, so "navigation" is a **status chrome bar plus a wordmark lockup**. There is no menu, no tabs, no breadcrumb.

**Chrome bar** — full width, `.xr-glass`, `border-b border-gold`, `px-4 md:px-8 py-2`, mono 12px uppercase `0.12em`:
- left: `XYP3RN TECH · MASTERING` in `muted`
- right: gold dot + status string, `role="status" aria-live="polite"`, in `gold`
- far right (`md`+ only): `Where Music Shapes Technology` in `muted`

**Lockup** — `max-w-[1440px]`, `flex items-end gap-5 px-4 md:px-8 pb-3 pt-6`:
- `XyperMark` at **44px** height
- `XYP3RN` Bebas 44px `tracking-wide` gold
- `MASTERING` Bebas 28px `tracking-wide` cloud, `mb-1`, `leading-none`

**Footer** — `.xr-glass border-t border-line px-4 md:px-8 py-2`, mono 12px uppercase `muted`:
`XYP3RN Tech · Local processing · No audio leaves the machine`

**[O] Sticky behavior:** the right rail is `lg:sticky lg:top-4 lg:self-start`; the header is not sticky.

**[R]** If multi-page navigation is required, keep the chrome bar as the constant and place destinations inside it as mono uppercase text items separated by a 1px `line` divider, active item in `gold` with a 2px `gold` bottom border. Do not add a second navigation bar; do not add icons to nav items — there is no icon system.

### 4.5 Images and media

**[O]** Almost no imagery. Three media treatments exist:

1. **Waveform canvas** — `h-28` (112px), full width, `1px solid #282828`. Background `#0A0A0A`; centre line `#1A1A1A` at 1px; source envelope drawn in `#444444`; master envelope in `#FACD68` at `globalAlpha 0.85`; playhead `#E8E8E8` 1px. Channels are mixed down to a single min/max envelope; DPR-scaled; redrawn on `ResizeObserver`. Focus: `2px solid #FACD68` outline.
2. **Render orb** — the only "hero" media in the product. A looping muted MP4 (`/media/render-orb.mp4`) with a WebP poster, `aspect-video`, `object-cover`, framed by `1px solid gold-dim` on `<div>` with `bg-black` and `0 18px 48px rgba(0,0,0,0.45)`. A caption strip `absolute inset-x-0 bottom-0 bg-black/75` carries mono 12px gold `Rendering master · 42%`. Under `motion-reduce` the video is hidden and the poster is shown instead.
3. **Brand mark** — inline SVG, single path, `fillRule="evenodd"` so the inner diamonds cut through.

**[R] Rules for new media:** monochrome or gold-tinted only; never full-colour photography; if a photograph is unavoidable, desaturate toward black and overlay the gold at ≤8% opacity. Every video must ship a poster and a `motion-reduce` still. No rounded frames, no drop-shadow image treatments beyond the panel shadow.

### 4.6 Distinctive components

These are product-specific patterns worth reusing rather than reinventing:

| Pattern | Anatomy | Why it exists |
| --- | --- | --- |
| **Readout** | 12px mono `ash` label (`xr-label`) over a mono `tabular-nums` value in `cloud` with a 12px `muted` unit; `emphasis` variant promotes the value to 24px | Values must not jitter while streaming, and the same component serves 24px hero metrics and 12px metadata |
| **Source profile** | 2-col (mobile) / 3-col grid of six readouts: Integrated LUFS, True peak dBTP, Range LU, Crest dB, Correlation, Length; then a `▸` flag list | A measured verdict before any processing |
| **Signal-order chain** | Fixed core modules (Input Trim → Tone EQ → Glue Compressor → Stereo Width → Soft Ceiling Clip → Brickwall Limiter) with addable sends (Space, Echo) inserted *before* clip/limit; CSS multi-column masonry | The order is the product; sends must be peak-controlled by the limiter downstream |
| **Numbered reasoning list** | `<ol>` with gold mono `01`/`02`/`03` in a fixed-width gutter, 12px `ash` text, separated from the control block by a `border-t border-line` and `pt-3` | Makes an automatic decision auditable line by line |
| **Warning line** | gold `▸` + plain-language sentence + ` (in source)` suffix when the problem pre-existed the render | Distinguishes "the source is like this" from "we made it like this" |
| **A/B transport** | Primary Play/Pause + `m:ss.t / m:ss.t` mono timer + `Master` / `Source` toggle + `Match LUFS` toggle + 4 live meters | Honest comparison requires loudness matching, so it is a visible toggle not a hidden feature |
| **Progress** | `<progress>` `h-1 w-full`, gold fill, 1px `rgba(255,255,255,0.11)` border, plus percentage in the orb caption | Two redundant indicators because the progress value may be null during long phases |
| **Bypass state** | `.xr-off` parent → fill `#444444`, border `line`, heading `ash` | Controls remain operable while reading as off — the hardware metaphor |

---

## 5. Layout and spacing principles

### 5.1 Spacing

**[O]** No custom spacing scale is declared; Tailwind's default **4px base** is used throughout, with observed steps:

| Step | px | Observed use |
| --- | --- | --- |
| `gap-1` / `gap-1.5` | 4 / 6px | Toggle pairs, remove-button cluster |
| `gap-2` | 8px | Label-to-control, dot-to-status, `space-y-2.5` internal rhythm |
| `gap-3` / `py-2.5` | 12 / 10px | Panel header bar, module column gap, rail spacing |
| `gap-4` / `p-4` | **16px** | Page grid gap, panel body padding, module padding, meter grid |
| `gap-5` | 20px | Mark-to-wordmark, wordmark to `MASTERING` |
| `pt-6` | 24px | Lockup top |
| `md:px-8` | 32px | Page gutter on desktop |
| `pb-10` | 40px | Page bottom |

**Rhythm rule [O]:** vertical space *between* panels is always 16px (`gap-4` / `space-y-4`); space *inside* a panel is never more than 16px. Nothing is spaced by feel — every gap is one of the steps above.

### 5.2 Content width and grid

| Property | Value |
| --- | --- |
| Max content width | **1440px** (`max-w-[1440px]`), centred with `mx-auto` |
| Page gutter | 16px mobile, 32px at `md`+ |
| Workspace grid | `1fr` below `lg`; **`minmax(0, 1fr) 360px`** at `lg`+ with `gap-4` |
| Right rail | 360px fixed, `lg:sticky lg:top-4 lg:self-start` |
| Column count | **No 12-column grid.** A single asymmetric split. |
| Prose width | `max-w-2xl` (672px) for the intro paragraph |
| Panel stack | `space-y-4` in the main column, `space-y-4` in the rail |

**[O]** The `minmax(0, 1fr)` is deliberate: it prevents the dense control column from pushing the grid wider than the viewport when module content overflows.

### 5.3 Section layout

The single screen reads top-to-bottom in the order a session happens:

```
┌ chrome bar ─────────────────────────────────────────────┐
│ XYP3RN TECH · MASTERING      ● Engine: ready    tagline │
├ lockup ─────────────────────────────────────────────────┤
│ [mark]  XYP3RN MASTERING                                │
├ main ────────────────────────────────┬ rail ────────────┤
│ intro line (only before a file loads)│ AUTO             │
│ SOURCE   (dropzone → profile)        │  presets, intention, intensity
│ MONITOR  (waveform + transport)      │ OUTPUT           │
│ CHAIN    (module cards, 2–3 columns) │  target, ceiling, format, render
│                                      │  report, file, download
│                                      │ "Suggests — never decides."
├ footer ─────────────────────────────────────────────────┤
```

**[O]** Panel order in the left column: Source → Monitor → Chain. In the rail: Auto → Output. The rail also ends with a standalone caption in 12px mono uppercase `muted`: *"Suggests — never decides. You keep the final call."*

### 5.4 Panel internal layout

- Header: `flex items-center justify-between gap-3`, `border-b border-line`, `px-4 py-2.5`.
- Body: `p-4`.
- Sub-sections inside a body are separated by `border-t border-line pt-3` (notes) or `pt-4` (report block); never by a second card.
- **Two-level nesting maximum.** Panel → module. There is no card inside a card inside a card.

### 5.5 The multi-column module rack

**[O]** `gap-3 sm:columns-2 2xl:columns-3 [&>article]:mb-3 [&>article]:break-inside-avoid`

CSS multi-column, not grid, so uneven modules pack without leaving holes. Reading order remains top-to-bottom within each column, which is acceptable because module order is *also* labelled by the fixed signal chain. On mobile it collapses to one column with 12px `mb-3`.

**[R]** If module order ever becomes user-reorderable, multi-column flow stops being honest — switch to a grid at that point. Reason: columns break the visual left-to-right reading of a drag order.

---

## 6. Depth, focus, and motion

### 6.1 Elevation

**[O]** Four levels, built from translucency + shadow + border lightness. There is no primitive shadow scale; the values are hand-written per surface.

| Level | Object | Shadow | Border | Fill |
| --- | --- | --- | --- | --- |
| 0 — canvas | page | — | — | `#080808` + gold radials + grid |
| 1 — base panel | `.xr-panel`, `.xr-glass` | `0 18px 48px rgba(0,0,0,0.28)` + `inset 0 1px 0 rgba(255,255,255,0.04)` | `#343434` / glass line | `rgba(13,13,13,0.78)` / `rgba(0,0,0,0.68)` |
| 1 (hover) | panel | `0 22px 58px rgba(0,0,0,0.34)` | `rgba(255,255,255,0.11)` | unchanged |
| 2 — raised | `.xr-module`, `.xr-button` | `inset 0 1px 0 rgba(255,255,255,0.03–0.05)` | `#343434` / `#C9A03E` | `rgba(17,17,17,0.64)` / `rgba(20,20,20,0.72)` |
| 2 (hover) | module, button | `0 12px 28px rgba(0,0,0,0.22)` | `rgba(250,205,104,0.32)` | `rgba(20,20,20,0.78)` / `rgba(28,25,19,0.78)` |
| 3 — accent | `.xr-button-primary` | `0 8px 24px rgba(250,205,104,0.14)` + `inset 0 1px 0 rgba(255,255,255,0.35)` | none | `#FACD68` |
| 3 (hover) | primary | `0 12px 30px rgba(250,205,104,0.22)` | none | `#C9A03E` |
| 4 — modal media | render orb frame | `0 18px 48px rgba(0,0,0,0.45)` | `1px solid #C9A03E` | `#000000` |

**[O] The bevel rule:** every raised surface carries an `inset 0 1px 0` white highlight at 3–7% (up to 35% on the gold button, where it reads as a specular edge). This single detail is what makes flat rectangles read as machined hardware. Do not remove it from new surfaces.

### 6.2 Borders and focus rings

| Context | Treatment |
| --- | --- |
| Default control / card | `1px solid #343434` |
| Divider | `1px solid #282828` |
| Active module | `1px solid #C9A03E` |
| Hover | border lightens to `rgba(255,255,255,0.11)` or tints to `rgba(250,205,104,0.32)` |
| Focus-visible (buttons, toggles, sliders, waveform) | `outline: 2px solid #FACD68; outline-offset: 2px` |
| Focus-visible (select) | `outline: 2px solid #FACD68; outline-offset: 1px` + `0 0 0 4px rgba(250,205,104,0.09)` |
| Selection | `background: #FACD68; color: #080808` — gold block, black text |
| Chrome bar bottom edge | `1px solid #FACD68` — the only full-width gold hairline |

**[O]** Focus is always gold and always 2px; there is no "focus within" state, no dark focus ring, and no `outline: none` anywhere.

### 6.3 Blur and overlays

- `backdrop-filter: blur(18px) saturate(115%)` on `.xr-panel` and `.xr-glass`, wrapped in `@supports (backdrop-filter: blur(1px))` so unsupported browsers fall back to the flat translucent fill.
- Overlays are **black at 68–78%**, never white, never blurred images.
- The render-orb caption uses `bg-black/75`; the poster uses no overlay.
- No modal or dialog exists in the product — nothing traps focus, nothing dims the page.

### 6.4 Motion

**Tokens [O]**

| Token | Value | Use |
| --- | --- | --- |
| `--xr-ease` | `cubic-bezier(0.16, 1, 0.3, 1)` | Primary easing: lifts, reveals, thumb scale. A fast-out, long-settle curve. |
| `--xr-ease-soft` | `cubic-bezier(0.33, 1, 0.68, 1)` | Declared; **not currently referenced in any component** |
| `--xr-fast` | **180ms** | Colour, border, transform on interactive elements |
| `--xr-smooth` | **420ms** | Panel/module lift, shadow, reveal |
| `xr-reveal` | `420ms` `--xr-ease` both | New content entering: `opacity 0.76 → 1`, `translateY(10px → 0)`, `blur(4px → 0)` |
| `xr-studio-intro` | `620ms`, second child delayed **90ms** | Workspace entrance, triggered by `IntersectionObserver` at `threshold: 0.15` |

**Rules [O]**

1. **Only composited properties animate** — `transform`, `opacity`, `filter`, colours, `box-shadow`. Never width/height/top/left.
2. **Lift on hover, settle on press.** Hover `translateY(-1px)` for panels and `-2px` for modules/buttons; press always returns to `translateY(0) scale(0.985)`.
3. **Hover motion is gated** by `@media (hover: hover) and (pointer: fine)` — touch devices get no lift.
4. **Entrance is a blur-in lift**, not a slide: 10px rise, 4px blur, 24% opacity gap closed over 420ms. Staggered only in the workspace intro, only for the second child.
5. **Reduced motion is absolute:** `@media (prefers-reduced-motion: reduce)` forces all animations and transitions to `0.01ms`/1 iteration, and the intro class is never applied (checked in JS via `matchMedia` before observing). Videos swap to posters.
6. **No looping background animation, no parallax, no scroll-driven effects.** The only looping media is the render orb, and only while rendering.

**[R]** Reserve `--xr-smooth` for surfaces and content; keep `--xr-fast` for anything the pointer is touching. A 420ms response to a click feels laggy at this density — the code already respects this by using 180ms on controls. Treat `--xr-ease-soft` as available but unproven; prefer `--xr-ease`.

---

## 7. Do's and don'ts

### Do

1. **Do** set everything on Studio Black `#080808`, and lift surfaces with translucent fills + shadow + the 1px inset bevel.
2. **Do** use gold `#FACD68` for exactly three jobs: the mark, the active/primary state, and a confirmed measurement.
3. **Do** set every label, button, and chrome string in JetBrains Mono 12px, uppercase, `0.12em`.
4. **Do** set every number in mono with `tabular-nums`, a typographic minus `−`, and a trailing unit.
5. **Do** keep radius at 0. Square corners are the single strongest recognition cue after the colour.
6. **Do** separate with a 1px hairline before adding a new container.
7. **Do** maintain 16px between panels and ≤16px inside them.
8. **Do** give every automatic action a visible, editable result and a plain-language reason.
9. **Do** show states as *desaturation plus a word* (`Off`, `limited`, `(in source)`), not as a new colour.
10. **Do** honour `prefers-reduced-motion` and provide posters for all motion media.
11. **Do** keep mobile hit targets at 44px (`min-h-11`, slider `2.75rem`) and shrink to compact density at `sm`+.
12. **Do** pair every number with its unit, and every empty value with an em dash `—`.

### Don't

1. **Don't** introduce a second accent, a gradient-filled control, or a coloured illustration.
2. **Don't** use amber. `tailwind.config.ts`: *"Amber is Records-only and deliberately absent."*
3. **Don't** recolour or restyle the mark, place it on any non-black background, or render it below 24px.
4. **Don't** add a fifth typeface, an italic, or a weight below 400.
5. **Don't** round corners — not on cards, not on buttons, not on inputs. The 6px status dot is the only exception.
6. **Don't** use green/red/amber semantic colours for success, warning, or error. Warnings are gold `▸` + `ash` text.
7. **Don't** use `white` `#FFFFFF` for body or headings; it is reserved for "high-contrast emphasis only" and is currently unused.
8. **Don't** use `muted` `#686868` as the only rendering of a value a user must act on (3.49:1 at 12px).
9. **Don't** animate width, height, or layout position; don't add hover lift behind a coarse pointer.
10. **Don't** create inline underlined links for actions — actions are buttons or bordered blocks.
11. **Don't** nest cards more than two levels deep, or wrap a panel in a panel.
12. **Don't** write copy with adjectives, exclamation marks, or a first-person plural voice. The product reports; it does not cheer.

---

## 8. Responsive behavior

### 8.1 Breakpoints

**[O]** Breakpoints are **Tailwind defaults, not declared in `tailwind.config.ts`** (`theme.extend` adds only `letterSpacing`), so the values are framework defaults rather than explicit design decisions:

| Name | Min width | Used |
| --- | --- | --- |
| `sm` | **640px** | 11 utilities |
| `md` | **768px** | 5 utilities |
| `lg` | **1024px** | 7 utilities |
| `xl` | 1280px | **0 utilities** |
| `2xl` | **1536px** | 1 utility |

**Canonical viewport [O]:** `1440 × 1000` — the size the end-to-end suite asserts against. Design desktop at 1440 first.

Additionally **[O]**: the slider raises its hit area to `2.75rem` and the range control's block size via `@media (max-width: 639px)` — a max-width query used once, deliberately aligned to the `sm` boundary.

### 8.2 Behavior by width

| Range | Behavior |
| --- | --- |
| **< 640px** | Single column, everything stacked. Page gutter 16px. All buttons, toggles, selects and checkbox rows are `min-h-11` (44px); sliders get a 44px touch band. Remove buttons are `min-w-11 min-h-11`. Chain rack is one column. Source profile is 2 columns; transport meters 2 columns. Chrome bar shows only brand + status; the tagline is hidden. |
| **≥ 640px (`sm`)** | **Density inversion:** interactive heights drop to `min-h-0` (auto) because a pointer is assumed. Chain rack becomes 2 columns (12px apart). Source profile and transport meters become 3 / 4 columns. Remove buttons shrink to content width. |
| **≥ 768px (`md`)** | Page gutter widens to 32px. The tagline *Where Music Shapes Technology* appears in the chrome bar. |
| **≥ 1024px (`lg`)** | The workspace becomes `minmax(0,1fr) 360px`; the rail moves beside the main column and becomes `sticky top-4`. The transport switches from stacked to a single row (`lg:flex-row lg:items-center lg:justify-between`) and Play gets `min-w-24` (96px). |
| **≥ 1536px (`2xl`)** | Chain rack becomes 3 columns. Nothing else changes — the 1440px container has already capped the content width, so extra space becomes margin. |

### 8.3 Mobile adaptations

**[O]**

- **Stacking order:** Source → Monitor → Chain → Auto → Output. The rail (Auto, Output) moves *below* the chain, which means the render action is last on mobile. This is deliberate: the chain must be reviewed before rendering on a small screen.
- **Collapsing:** nothing collapses into accordions, tabs, or drawers. Density is reduced by reflow only. There is no hamburger menu.
- **Touch targets:** 44px minimum for anything tappable (`min-h-11`, slider `2.75rem`, remove `min-w-11 min-h-11`), removed at `sm`+ via `sm:min-h-0`.
- **Hover:** all lift and tint effects are suppressed behind `(hover: hover) and (pointer: fine)`; touch users see only pressed/active states.
- **Media:** the render orb stays `aspect-video` and full width; the waveform stays `h-28` (112px) — it is not scaled down.
- **Truncation:** slider labels use `truncate`; the readout value never truncates (`shrink-0`).

**[R]** Keep the 44px touch band even if the rest of the layout compresses. Removing it below 640px is the fastest way to make a dense console unusable on a phone. Also **[R]**: below 400px, the two-column source-profile grid will squeeze `Correlation` — allow it to become a single column at 360px rather than shrinking the mono values.

---

## 9. Reusable prompt guide

Paste a whole section, or combine the summary with one example prompt. All values are exact.

### 9.1 Quick color reference

```
Canvas          #080808  studio      — page
Panel           #0D0D0D  78% glass   — cards, sections
Raised          #111111  surface     — controls, modules
Chrome          #000000  chrome      — bars, nav, media frame
Gold            #FACD68  primary     — mark, active, primary CTA, confirmed values
Gold dim        #C9A03E  hover/press — primary hover fill, active module border
Gold glow       #2A1E00  tint        — alert / drag-over background
Text primary    #E8E8E8  cloud       — headings, values
Text secondary  #A6A6A6  ash         — body, labels
Text tertiary   #686868  muted       — units, metadata, footer (not for required text)
Border          #343434  line-card   — default border
Divider         #282828  line        — internal rules
Glass edge      rgba(255,255,255,0.11)
Gold edge       rgba(250,205,104,0.32)
Code            #0A0A0A / #D4D4D4
Never: amber, green, red, blue, or any second hue.  Radius: 0.  Type: Bebas / Syne / DM Sans / JetBrains Mono.
```

### 9.2 Short design summary

> Build as if designing a black anodised rack unit. The page is Studio Black `#080808` with a faint 36px engineering grid and two soft gold radial glows (7% and 4%). Content sits in smoked-glass panels — `rgba(13,13,13,0.78)`, 1px `#343434` border, `blur(18px) saturate(115%)`, `0 18px 48px rgba(0,0,0,0.28)` plus a 1px white inset top bevel. Corners are perfectly square. Type is four families in fixed roles: Bebas Neue for the 44px wordmark only, Syne 700 for component titles, DM Sans for prose, and JetBrains Mono for every label, button, and number — microlabels uppercase at 12px with `0.12em` tracking; values at 16–24px with `tabular-nums`. Exactly one hue exists: gold `#FACD68`, reserved for the mark, the active state, the primary action, and confirmed measurements; `#C9A03E` is its press state. Text runs `#E8E8E8` → `#A6A6A6` → `#686868`. Motion is a 180ms control response and a 420ms surface lift on `cubic-bezier(0.16,1,0.3,1)`, gated to fine pointers and disabled under reduced motion. Density is high but rhythm is strict: 16px between panels, 10–16px inside them. The voice is technical, calm, second person, and never promotional — it measures, it does not sell.

### 9.3 Example prompt — hero / header band

> Design the top of a page for XYP3RN MASTERING, a browser audio mastering studio. Full-bleed Studio Black `#080808` with a subtle 36px square grid at 2% white masked to fade out by 70% height, and a soft gold radial glow (`rgba(250,205,104,0.07)`) at 12%/8%. At the very top, a slim chrome bar (12px mono, 8px vertical padding): translucent black `rgba(0,0,0,0.68)` with `blur(18px)`, a 1px solid `#FACD68` bottom border, 12px uppercase JetBrains Mono at `0.12em` — left `XYP3RN TECH · MASTERING` in `#686868`, right a 6px gold dot with the live status `Engine: ready` in gold, and a far-right tagline `Where Music Shapes Technology` in `#686868`. Below it, a wordmark lockup aligned to a 1440px container with 32px side gutters: the gold interlocking-X SVG mark at 44px, then `XYP3RN` in Bebas Neue 44px, uppercase, `0.025em` tracking, `#FACD68`, sitting flush on the same baseline as `MASTERING` in Bebas Neue 28px, `#E8E8E8`, nudged up 4px. No rounded corners, no drop shadow on text, no second colour. Everything breathes: 24px above the lockup, 12px below. Do not add a navigation menu, a gradient hero image, or a subheading in Syne.

### 9.4 Example prompt — card / panel

> Design a settings panel called **CHAIN** for a mastering console. Container: `rgba(13,13,13,0.78)` fill over `#080808`, `backdrop-filter: blur(18px) saturate(115%)`, 1px `#343434` border, zero radius, `overflow: hidden`, shadow `0 18px 48px rgba(0,0,0,0.28)` with `inset 0 1px 0 rgba(255,255,255,0.04)`, and a diagonal sheen from `rgba(255,255,255,0.04)` to transparent at 32%. Header row: 10px vertical padding, 16px horizontal, `border-bottom: 1px solid #282828`; title `CHAIN` in 12px uppercase JetBrains Mono, `0.12em` tracking, `#FACD68`; right-aligned aside `In signal order` in 12px uppercase mono `#686868`. Body: 16px padding. Inside, a two-column masonry of module cards, 12px apart: each card is `rgba(17,17,17,0.64)`, 1px `#C9A03E` when active, `p-4`; card header is the module name in Syne 700 14px `#E8E8E8` beside a pressed gold toggle labelled `ON` (12px mono uppercase, black text on `#FACD68`); below it a stack of 12px-gap sliders — 4px `#222222` track, gold fill, 14px square thumb with a 2px `#080808` keyline, label on the left in 12px DM Sans `#A6A6A6`, value on the right in 12px mono `tabular-nums` `#E8E8E8` with the unit in `#686868`. On hover (fine pointers only) lift the card 2px and warm the border. Under 640px: one column, 44px-tall controls. No rounded corners, no second accent, no icon buttons without a mono label.

### 9.5 Example prompt — navigation

> Design navigation for a single-page professional audio tool. There is no menu, no tabs, and no icon set — the navigation is a status chrome bar plus a wordmark. The bar is slim — 12px mono with 8px vertical padding, full width, `rgba(0,0,0,0.68)` with `blur(18px) saturate(115%)`, separated from the page by a 1px solid gold `#FACD68` bottom edge — the only full-width gold hairline in the product. Inside, three zones at 16px/32px gutters: left, the product breadcrumb `XYP3RN TECH · MASTERING` in 12px uppercase JetBrains Mono at `0.12em` in `#686868`; centre-right, a live engine status as a 6px gold dot and the words `Engine: ready` in gold mono with `aria-live="polite"`; far right, the brand line `Where Music Shapes Technology` in `#686868`, hidden below 768px. Beneath the bar, the lockup: gold mark at 44px, `XYP3RN` in Bebas 44px gold, `MASTERING` in Bebas 28px `#E8E8E8`, aligned to a 1440px container with 32px gutters. If additional destinations are needed, place them in the chrome bar as 12px uppercase mono text separated by 1px `#282828` dividers, with the current page in gold and a 2px gold underline; never add a second bar, a hamburger, or a nav icon. Hover states tint text to gold at 180ms; nothing moves.

### 9.6 Example prompt — primary button

> Design the primary button for XYP3RN MASTERING. Label `RENDER MASTER` in JetBrains Mono, 12px, weight 700, uppercase, `0.12em` letter-spacing, colour `#080808` on a solid `#FACD68` fill. Zero border-radius, no border, 20px horizontal and 10px vertical padding, 44px minimum height on mobile and auto height from 640px. Shadow `0 8px 24px rgba(250,205,104,0.14)` plus `inset 0 1px 0 rgba(255,255,255,0.35)` for a machined specular top edge. Hover (fine pointers only): fill shifts to `#C9A03E`, the button lifts 2px, shadow deepens to `0 12px 30px rgba(250,205,104,0.22)` — 180ms on `cubic-bezier(0.16,1,0.3,1)`. Press: return to 0 with `scale(0.985)`. Focus-visible: 2px solid `#FACD68` outline at 2px offset. Disabled: fill `#111111`, text `#686868`, `cursor: not-allowed`, no lift. While working, the label becomes `RENDERING…` and the control stays disabled. The secondary button beside it is identical in type and geometry but `rgba(20,20,20,0.72)` fill, 1px `#343434` border, `#E8E8E8` text, turning gold text with a `rgba(250,205,104,0.32)` border on hover. Only one gold primary button may exist per view.

### 9.7 Iteration checklist

Run every new screen or component through this list before shipping.

- [ ] **One hue.** Is gold `#FACD68` the only chromatic colour on the screen? Is `#C9A03E` used only for press/active?
- [ ] **No amber.** Any orange-brown between `#C9A03E` and `#E0A030` is a brand violation (Records territory).
- [ ] **Radius = 0.** Except a 6px dot, nothing is rounded.
- [ ] **Four families, correct roles.** Bebas only in the wordmark; Syne only for titles; DM Sans for prose; mono for labels, buttons, and numbers.
- [ ] **Mono uppercase with `0.12em`** on every label, button, toggle, chrome string, and unit.
- [ ] **Numbers are mono + `tabular-nums`**, use `−` not `-`, carry a unit, and show `—` when missing.
- [ ] **Text hierarchy is three steps**, nothing at `#FFFFFF` unless it is a deliberate emphasis.
- [ ] **`#686868` never carries required information alone.**
- [ ] **Hairline first.** Did you add a container where a 1px `#282828` rule would have done?
- [ ] **16px between panels, ≤16px inside.**
- [ ] **The bevel is present** on every raised surface (`inset 0 1px 0` white at 3–7%).
- [ ] **Hover lift only on fine pointers**; press always settles to `scale(0.985)`.
- [ ] **Reduced motion** collapses animation, and every video has a poster fallback.
- [ ] **44px touch targets below 640px**, compact heights above.
- [ ] **Focus-visible is a 2px gold ring** at 2px offset, never removed.
- [ ] **States are desaturation plus a word**, never a new colour.
- [ ] **Copy is second person, has no exclamation marks, and states reasons rather than praise.**
- [ ] **The automatic features say what they did and let the user overrule them.**

---

## 10. Optional appendices

### Appendix A — Interaction patterns

| Pattern | Behavior | Evidence |
| --- | --- | --- |
| **Load** | Drop a WAV on the dropzone or click to browse (`.wav` and MIME variants). Drag-over tints border gold and fills `#2A1E00`. While loading: `opacity-60`, `pointer-events-none`, status streams to the chrome bar. | `SourcePanel.tsx` |
| **Progressive disclosure by state** | The Monitor and Output panels appear only once a file is loaded; the intro paragraph appears only *before*. Every result block is inserted with `xr-reveal`. | `Studio.tsx` |
| **Live editing** | Sliders update the audio graph on change with no submit. The state is the truth; rendered results are invalidated automatically when settings change (`settingsKey` comparison), so the report on screen always matches what was measured. | `Studio.tsx` |
| **Bypass** | A two-state toggle per module. Bypassing keeps values, removes the module's border accent, greys its slider fill, and downgrades its title to `ash`. | `ChainRack.tsx` |
| **Mode parameters** | Integer 0/1 parameters render as a pair of toggles with human labels (`Peak`/`Hybrid`, `Sample`/`True peak`), not as a slider. | `ChainRack.tsx` |
| **A/B compare** | `Master`/`Source` toggle plus an independent `Match LUFS` toggle that gain-matches the source to the master so comparison is level-fair. The active path's meters replace the other's. | `Transport.tsx` |
| **Seek** | Click or drag the waveform; `ArrowLeft`/`ArrowRight` seek ±5s; `Home` returns to zero. The canvas is `role="slider"` with `aria-valuemin/max/now` in seconds. | `Waveform.tsx` |
| **Render** | One primary action, disabled until a source exists. While rendering: label becomes `Rendering…`, the orb appears, `<progress>` fills, and the percentage sits in the orb caption. On completion, the report replaces the progress block with a reveal. | `OutputPanel.tsx` |
| **Auto** | Choose an intention, optionally override intensity, press `Suggest a master`. The proposal writes into the chain, produces a rendered file, and appends a numbered, plain-language notes list. Nothing is hidden: every control remains editable afterwards. | `AutoPanel.tsx` |
| **Warnings** | Rendered as `▸` + sentence; pre-existing issues are suffixed `(in source)`. Warnings never block the render. | `OutputPanel.tsx` |
| **Errors** | `role="alert"` block, gold-dim border, gold-glow fill, `cloud` text, plus the chrome status flips to `Engine: error`. | `Studio.tsx` |
| **Status announcement** | The chrome status element is `role="status" aria-live="polite"`; it narrates load, readiness, render, and error without stealing focus. | `Header.tsx` |
| **Export** | The download is a bordered block (`.xr-button`) with `download` and a generated filename `${base}_XYP3RN_${tag}_${format}.wav`, e.g. `mix_XYP3RN_-14LUFS_pcm24.wav`. A native `<audio controls>` preview sits above it. | `Studio.tsx`, `OutputPanel.tsx` |
| **Keyboard** | Everything is a native control or a focusable element with a visible gold ring. The waveform is the only canvas-based widget and it implements the slider role manually. | all components |

### Appendix B — Content and messaging patterns

**Voice [O].** Technical, calm, second person, plainly spoken. It reports and advises; it never celebrates. Evidence drawn verbatim from the UI:

- "EQ, dynamics, width, clip and true-peak limiting, measured to BS.1770. Local processing. No audio leaves the machine."
- "Suggests — never decides. You keep the final call."
- "Dense sources cap at 35%. Uses the target and ceiling below."
- "Limiter working past 4 dB. Back off input or target."
- "Stereo phase risk. Check mono."
- "Looks already mastered. Go light."

**Rules [O]**

1. **No exclamation marks.** None exist in the product.
2. **No first person plural.** The product never says "we".
3. **Imperatives are short and physical:** *Back off input or target. Check mono. Go light.*
4. **Every warning states a cause and, where possible, a remedy.**
5. **Reasons are given before confidence.** Explanations carry `reason` and `confidence` fields and both surface in the UI.
6. **Automatic actions are described in the first person of the *user's* intent,** not the machine's cleverness: intentions read `Transparent — touch it lightly`, `Balanced — even, controlled`, `Loud — more density`, `Warm — fuller low end`, `Bright — more air`.
7. **Eyebrow/dash pattern for option labels:** `Value — human gloss` (`−14 LUFS · streaming`, `Off — ceiling only`, `Transparent — touch it lightly`). Note both separators are in use: an em dash for the gloss, a middle dot for the qualifier.

**Headline patterns [O]**

| Level | Pattern | Example |
| --- | --- | --- |
| Wordmark | `XYP3RN` gold + `MASTERING` cloud, Bebas, tight | — |
| Brand line | Sentence case, no punctuation | `Where Music Shapes Technology` |
| Chrome label | `BRAND · PRODUCT` uppercase mono | `XYP3RN TECH · MASTERING` |
| Panel title | One uppercase mono word | `SOURCE`, `MONITOR`, `CHAIN`, `AUTO`, `OUTPUT` |
| Section aside | Lowercase mono qualifier | `In signal order`, `Local · deterministic` |
| Footer | `Brand · promise · promise` | `XYP3RN Tech · Local processing · No audio leaves the machine` |

**CTA language [O]**

| Action | Label |
| --- | --- |
| Load | `Drop a WAV or browse` |
| Suggest | `Suggest a master` → `Working…` |
| Render | `Render master` → `Rendering…` |
| Export | `Download WAV` |
| Transport | `Play` / `Pause` |
| Presets | `Natural` `Warm` `Punchy` |
| On/Off | `On` / `Off` (never a checkbox for a processor) |

**[R]** Keep CTAs as *verb + object* with no urgency words. `Render master`, not `Master it now`. `Download WAV`, not `Get your free master`.

**Trust signals [O]** — the product's credibility is factual, not social:

- "Local processing. No audio leaves the machine." (repeated in intro, footer, and as the technical basis of the static export)
- "Local · deterministic" on the Auto panel
- "measured to BS.1770", `−23 LUFS · broadcast (R128)`, true-peak validation at 16× oversampling
- "Suggests — never decides. You keep the final call."
- A visible report: integrated LUFS, true peak dBTP, range LU, output gain, target status (`achieved` / `limited`), plus a reason string
- Warnings annotated `(in source)` so the tool never takes blame or credit falsely
- 319 parity and standards tests referenced in the README — internal proof, not marketing copy

**[R]** No testimonials, no logos, no star ratings. If social proof is ever required, express it as a measured claim ("renders validated against BS.1770") rather than a quotation.

### Appendix C — Observed pages or source materials

| Source | Type | Design evidence extracted |
| --- | --- | --- |
| `README.md` | Document | Brand rule: mark gold `#FACD68` on Studio Black `#080808`, never below 24 px; product promise |
| `tailwind.config.ts` | Config | 17 palette values with role comments, 4 font stacks, `tracking-label: 0.12em`, the amber exclusion note |
| `app/globals.css` | CSS | Glass fills, elevation, motion curves and durations, `.xr-*` component library, focus, selection, grid and glow atmosphere, reduced-motion override |
| `app/layout.tsx` | Config | Font pairing and loading, `theme-color #080808`, `color-scheme: dark`, metadata copy |
| `app/page.tsx` | Page | Single-route product: the Studio is the whole application |
| `app/icon.svg` | Asset | Favicon construction: 3890² square, `#080808` field, mark translated `(515, 574)` — ≈13% clear space on the left, ≈15% on top |
| `public/brand/xyp3rn-mark.svg` | Asset | Mark exported standalone on transparent background (web use only, with the black rule applied by the container) |
| `components/brand/XyperMark.tsx` | Component | Single-path even-odd mark, gold fill hard-coded, `Math.max(24, size)` minimum-size enforcement |
| `components/studio/Header.tsx` | Component | Chrome bar, status dot, tagline, wordmark lockup geometry |
| `components/studio/ui.tsx` | Component | Panel, Readout, Slider, Toggle anatomy |
| `components/studio/SourcePanel.tsx` | Component | Dropzone, profile grid, flag list |
| `components/studio/Transport.tsx` | Component | A/B and loudness-match pattern, meter row |
| `components/studio/Waveform.tsx` | Component | Dual-trace canvas treatment, seek affordances |
| `components/studio/ChainRack.tsx` | Component | Module card, mode toggles, multi-column rack |
| `components/studio/AutoPanel.tsx` | Component | Intentions, presets, numbered notes |
| `components/studio/OutputPanel.tsx` | Component | Targets, ceilings, formats, report, warnings, render orb, export |
| `components/studio/format.ts` | Utility | Typographic minus, em dash, unit and time formatting |
| `lib/dsp/schema.ts` | Data | Module and parameter vocabulary (Input Trim, Tone EQ, Glue Compressor, Stereo Width, Soft Ceiling Clip, Space, Echo, Brickwall Limiter) |
| `lib/auto/types.ts` | Data | Intention and style vocabulary, confidence model |
| `e2e/studio.e2e.test.ts` | Test | Canonical viewport 1440×1000, interaction contracts |

**Pages not present:** no marketing site, landing page, pricing, docs, account, or settings screen. There is exactly one screen. All other surfaces are **Not specified** and must be derived from the rules here.

### Appendix D — Gaps, conflicts, and open questions

These are unresolved in the source. They are recorded rather than guessed.

| # | Item | Status |
| --- | --- | --- |
| 1 | **Card border value conflict.** `ui.tsx` comments "Card Border `#222222`", but `line-card` is `#343434` and `line` is `#282828`. `#222222` appears only as `--slider-track-color` in CSS. | **Conflict.** Recommended source of truth: `#343434` (the config is the enforcement point); update the stale comment. |
| 2 | **Line heights.** No component declares a line height; Tailwind defaults apply. | **Not specified** as a design decision. Recommended: keep defaults; they are already tuned for 12px/14px UI text. |
| 3 | **Breakpoints.** Not declared in config; Tailwind defaults are in use, and `xl` (1280px) is unused. | **Not specified.** Recommended: leave as-is and treat `lg` + `2xl` as the real layout hinges. |
| 4 | **`white` `#FFFFFF`.** Declared "high-contrast emphasis only" but used zero times. | **Unused token.** Either delete or reserve; do not let it creep into body copy. |
| 5 | **`--xr-ease-soft`.** Declared, never referenced. | **Unused token.** |
| 6 | **`muted` contrast.** 3.49:1 on panel — fails AA for normal text at 12px. | **Accessibility risk.** See §2.6 for the recommended usage restriction. |
| 7 | **No error/validation colour language.** Errors reuse the gold family. | **Deliberate**, but untested against a destructive action. See §2.5 recommendation. |
| 8 | **No iconography system.** The UI uses text glyphs `▸`, `✕`, `+`, `·`, `—`, `∞`, `−`. | **Not specified.** Recommended: keep glyph-only; any icon set would need a matching hairline weight that does not currently exist. |
| 9 | **Brand Guidelines referenced but absent.** `layout.tsx` cites "ch. 02"; `tailwind.config.ts` cites "Color Palette 2026". | **Missing source.** Rules quoted above are the only surviving fragments. |
| 10 | **No light theme, no print, no email styles.** | **Not specified.** Out of scope for a dark-only instrument UI. |
| 11 | **Loudness scale of the gold accent.** No occluder or max-area rule is written down, though practice keeps gold under ~5% of the viewport. | **Inferred convention.** Recommended: codify "gold ≤5% of visible pixels; never a gold field larger than a button". |
| 12 | **Radius exception.** The only curve is a decorative 6px status dot. | **Observed.** Recommended: treat as a permitted exception, not a precedent. |

---

*End of design system. Companion tokens: [`design-tokens.css`](./design-tokens.css).*
