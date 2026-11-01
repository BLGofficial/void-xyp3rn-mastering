# XYP3RN MASTERING

Browser mastering studio for WAV, FLAC and MP3 sources. EQ, dynamics, width, clip and true-peak limiting, loudness-targeted to BS.1770.
Local processing. No audio leaves the machine.

## Run

```sh
npm ci
npm run dev        # builds browser assets (worklet, MP3 worker, LAME copy), starts Next on :3000
npm run build      # static export to out/ (no server ships)
npm run serve      # serve out/ on :3000
```

Node >= 22. The lockfile was resolved with npm 11 (npm 10.9 crashes resolving vitest's optional peers); `npm ci` on npm 10 works.

## Test

```sh
npm run oracle:fetch   # pinned reference engine for parity tests (gitignored, never committed)
npm test               # 528 parity + standards tests: lib/dsp, lib/meter, lib/engine, lib/auto, lib/export, lib/import
npm run e2e            # build + Playwright: import, preview, render, auto, WAV/FLAC/MP3 import, WAV/MP3 export re-measured, ZIP report
npm run typecheck
```

## Layout

| Path | What |
| --- | --- |
| `lib/dsp` | Realtime/offline processing chain (trim, EQ, compressor, width, clip, reverb, echo, limiter) |
| `lib/meter` | BS.1770 / EBU R128 loudness, LRA, true peak, 16x export peak validation |
| `lib/engine` | WAV I/O, track analysis, offline render, safety policy, loudness-target loop |
| `lib/auto` | Deterministic automatic master proposals with source-aware safety |
| `lib/import` | Source sniffing and FLAC STREAMINFO / MP3 frame-header parsing (native rate, no resampling) |
| `lib/export` | Decoded-peak-checked MP3 policy, mastering report model, PDF and ZIP writers |
| `audio/` | Engine Web Worker, AudioWorklet chain processor, player, MP3 encoder worker, export flow |
| `components/`, `app/` | Next.js 14 studio UI (XYP3RN Tech palette and type) |
| `test/`, `e2e/` | Parity/standards suites, end-to-end smoke test |

## Notes

- Static export (`output: 'export'`): Next 14 is end-of-life and has unpatched server-side advisories; with no Next server at runtime those paths don't exist in production.
- WAV is parsed by the engine itself (bit-exact). FLAC and MP3 are decoded by the browser (`decodeAudioData`) at the rate read from their headers, so FLAC stays sample-exact and nothing is resampled.
- MP3 encoding uses [LAME](https://lame.sourceforge.io) via [lamejs](https://github.com/zhuker/lamejs) 1.2.1 (LGPL-3.0), shipped unmodified as a separate file at `/vendor/lamejs/lame.min.js` and loaded at runtime by the encoder worker; replace that file to relink.
- Brand: mark is gold `#FACD68` on Studio Black `#080808` only, never below 24 px.

## Design

Tokens, components and copy rules live in [`docs/design-system.md`](docs/design-system.md);
framework-free values in [`docs/design-tokens.css`](docs/design-tokens.css); a rendered
reference in [`docs/styleguide.html`](docs/styleguide.html). All three are extracted from
`tailwind.config.ts` and `app/globals.css` and cite the file each value comes from.

The reference is a static file with no build step — open it directly, or serve the folder:

```sh
python3 -m http.server 8080 --directory docs
```
