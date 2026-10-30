# XYP3RN MASTERING

Browser mastering studio. EQ, dynamics, width, clip and true-peak limiting, loudness-targeted to BS.1770.
Local processing. No audio leaves the machine.

## Run

```sh
npm ci
npm run dev        # bundles the AudioWorklet, starts Next on :3000
npm run build      # static export to out/ (no server ships)
npm run serve      # serve out/ on :3000
```

Node >= 22. The lockfile was resolved with npm 11 (npm 10.9 crashes resolving vitest's optional peers); `npm ci` on npm 10 works.

## Test

```sh
npm run oracle:fetch   # pinned reference engine for parity tests (gitignored, never committed)
npm test               # 319 parity + standards tests: lib/dsp, lib/meter, lib/engine
npm run e2e            # build + Playwright: import, live preview, -14 LUFS render, export, re-measure
npm run typecheck
```

## Layout

| Path | What |
| --- | --- |
| `lib/dsp` | Realtime/offline processing chain (trim, EQ, compressor, width, clip, reverb, echo, limiter) |
| `lib/meter` | BS.1770 / EBU R128 loudness, LRA, true peak, 16x export peak validation |
| `lib/engine` | WAV I/O, track analysis, offline render, safety policy, loudness-target loop |
| `audio/` | Engine Web Worker, AudioWorklet chain processor, player |
| `components/`, `app/` | Next.js 14 studio UI (XYP3RN Tech palette and type) |
| `test/`, `e2e/` | Parity/standards suites, end-to-end smoke test |

## Notes

- Static export (`output: 'export'`): Next 14 is end-of-life and has unpatched server-side advisories; with no Next server at runtime those paths don't exist in production.
- Brand: mark is gold `#FACD68` on Studio Black `#080808` only, never below 24 px.
