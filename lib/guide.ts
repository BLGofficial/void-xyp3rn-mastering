// Control guide: what every studio control does and why. One source of truth for
// the guide drawer and the inline hints. Each key is bound to exactly one real
// control (or control group) through `aria-describedby`; e2e fails on drift.

import { DEFINITIONS, type ProcessorId } from './dsp';

export interface GuideEntry {
  /** Stable key; the DOM hint carries it as `data-guide`. */
  key: string;
  label: string;
  text: string;
}

export interface GuideSection {
  title: string;
  intro?: string;
  entries: GuideEntry[];
}

/** Per-parameter text for every module in `DEFINITIONS`. A unit test enforces full coverage. */
export const PARAM_TEXT: Readonly<Record<ProcessorId, Readonly<Record<string, string>>>> = {
  trim: {
    gainDb: 'Level into the rest of the chain. Raising it drives the compressor, clipper and limiter harder.',
  },
  eq: {
    lowDb: 'Broad bass shelf. Boost for weight, cut to clear excess low end; listen for masking.',
    lowHz: 'Where the low shelf turns over. Higher settings reach further into the low mids.',
    midDb: 'Boost or cut around the bell centre. Broad, subtle cuts usually clear congestion best.',
    midHz: 'Centre frequency of the bell.',
    midQ: 'Bandwidth: higher Q is narrower. Broad shapes are easier to judge on a full mix.',
    highDb: 'Broad treble shelf. Boost for air, cut to soften brightness; more top also lifts hiss and harshness.',
    highHz: 'Where the high shelf turns over.',
  },
  dynamics: {
    thresholdDb: 'Level above which compression starts. Lower thresholds act on more of the track.',
    ratio: 'How hard levels above the threshold are pulled down. High ratios flatten transients.',
    kneeDb: 'How gradually compression engages around the threshold. A wider knee is gentler.',
    attackMs: 'How fast the compressor reacts. Fast attack catches peaks but can blunt drum impact.',
    releaseMs: 'How fast gain reduction recovers. Too fast can distort; too slow kills movement.',
    makeupDb: 'Gain after compression. Match loudness before deciding whether compression helped.',
    adaptive: 'Peak keeps the classic peak detector. Hybrid links peak and RMS detection with program-dependent release; judge it level-matched.',
    maxReductionDb: 'Upper bound on gain reduction in Hybrid mode, so contrast loss stays capped. Ignored in Peak mode.',
  },
  width: {
    amount: 'Side level: 1 leaves width unchanged, 0 is mono, above 1 widens. Wider weakens mono compatibility; watch correlation.',
  },
  clip: {
    driveDb: 'Push level into the clipper for soft peak shaping. Too much drive is audible distortion.',
    ceilingDb: 'Sample-peak ceiling of the clipper. Sample peaks are not true peaks; the limiter and output ceiling handle those.',
  },
  reverb: {
    amount: 'Parallel whole-mix reverb return, capped at 20%. Zero keeps the mix dry.',
    decay: 'Reverb decay in seconds. Longer adds space but can blur rhythm.',
    preDelayMs: 'Gap before the reverb starts. A short gap keeps the initial attack clear.',
  },
  echo: {
    amount: 'Parallel whole-mix echo return, capped at 25%. Zero keeps the mix dry.',
    timeMs: 'Time between repeats, on both stereo channels.',
    feedback: 'Level fed back into the echo. More feedback means more repeats; capped at 65% for stability.',
  },
  limit: {
    ceilingDb: 'Highest level the limiter lets through. The output true-peak ceiling is checked separately after rendering.',
    releaseMs: 'How fast limiting recovers. Too fast can distort; too slow pumps and dulls.',
    truePeak: 'Sample watches sample peaks. True peak predicts intersample peaks with 4x interpolation and adds a short compensated lookahead. Switching rebuilds the live preview.',
  },
};

/** Guide key for a module parameter. */
export const paramKey = (id: ProcessorId, param: string) => `${id}.${param}`;

const MODULE_ORDER: ProcessorId[] = ['trim', 'eq', 'dynamics', 'width', 'reverb', 'echo', 'clip', 'limit'];

const moduleSections: GuideSection[] = MODULE_ORDER.map(id => ({
  title: DEFINITIONS[id].name,
  ...(id === 'reverb' || id === 'echo' ? { intro: 'Optional send. Add it from the Chain panel.' } : {}),
  entries: Object.entries(DEFINITIONS[id].parameters).map(([param, def]) => ({
    key: paramKey(id, param),
    label: def.label.replace(/ \(.*\)$/, ''),
    text: PARAM_TEXT[id][param]!,
  })),
}));

export const GUIDE: readonly GuideSection[] = [
  {
    title: 'Source',
    entries: [
      { key: 'file', label: 'Import', text: 'Load a WAV, FLAC or MP3. It is decoded and measured in this browser; the audio is never uploaded. MP3 is lossy: master from WAV or FLAC when you have it.' },
    ],
  },
  {
    title: 'Monitor',
    entries: [
      { key: 'seek', label: 'Waveform', text: 'Click, or use the arrow keys (5 s) and Home, to move the playhead. Gold is the master, grey the source.' },
      { key: 'play', label: 'Play / Pause', text: 'Hear the live chain from the playhead. Live preview is not the checked offline render; Render master is what exports.' },
      { key: 'ab', label: 'Source / Master', text: 'Switch between the untouched source and the live chain without moving the playhead.' },
      { key: 'match', label: 'Match LUFS', text: 'Bring the source to the master’s loudness so A/B compares tone and dynamics, not volume. Audition only; exports are unaffected.' },
    ],
  },
  {
    title: 'Chain',
    intro: 'Modules run top to bottom in signal order. The order is fixed: EQ sits before the compressor, so EQ changes what triggers compression.',
    entries: [
      { key: 'bypass', label: 'On / Off', text: 'Skip a module and keep its settings. Every other module stays active.' },
      { key: 'add', label: '+ Space / + Echo', text: 'Add a parallel send. It goes in before the clipper and limiter, so its tail is peak-controlled too. Adding or removing one rebuilds the live preview.' },
      { key: 'remove', label: 'Remove', text: 'Take a send out of the chain. Core modules can be bypassed but not removed.' },
      { key: 'quality', label: 'Clip quality', text: '4x Studio oversamples the clipper to cut aliasing. It costs render time and cannot restore detail the source lacks.' },
    ],
  },
  ...moduleSections,
  {
    title: 'Auto',
    intro: 'Local and deterministic: the same source and settings give the same proposal. Every move lands in the chain and stays editable.',
    entries: [
      { key: 'preset', label: 'Natural / Warm / Punchy', text: 'One-click styles at 50% intensity. Natural is restrained, Warm softens the top, Punchy shapes tone and dynamics. Each replaces the chain; Undo auto brings it back.' },
      { key: 'intention', label: 'Intention', text: 'Direction for Suggest a master: Transparent, Balanced, Loud, Warm or Bright. Picking one resets Intensity to that direction’s default.' },
      { key: 'intensity', label: 'Intensity', text: 'How much processing Auto may apply. More is not better on an already limited mix; dense sources are capped at 35%.' },
      { key: 'auto-run', label: 'Suggest a master', text: 'Measure dynamics and spectrum, propose a chain, render it locally and check peaks before it replaces the chain. Uses the target and ceiling from Output.' },
      { key: 'auto-undo', label: 'Undo auto', text: 'Restore the chain and ceiling from before the last Auto or preset.' },
    ],
  },
  {
    title: 'Output',
    entries: [
      { key: 'target', label: 'Loudness target', text: 'Integrated loudness the render aims for (BS.1770). Off keeps the chain’s level and only enforces the ceiling. If the ceiling blocks the target, the result reads LIMITED.' },
      { key: 'ceiling', label: 'True-peak ceiling', text: 'Highest true peak the rendered master may reach. Leave headroom for playback and lossy encoding.' },
      { key: 'format', label: 'Format', text: 'WAV stays uncompressed at the source sample rate; MP3 is smaller and lossy, and is decoded and re-checked against the ceiling after encoding. More bits do not invent detail.' },
      { key: 'dither', label: 'TPDF dither', text: 'Very low-level noise added when reducing to 16- or 24-bit PCM, trading quantisation distortion for a smooth noise floor. Not used for 32-bit float or MP3.' },
      { key: 'render', label: 'Render master', text: 'Run your chain offline at full quality, then measure the result and hold the ceiling. Your settings are used as set.' },
      { key: 'cancel', label: 'Cancel', text: 'Stop the running analysis, render or export (Esc during a render). The previous master and chain are kept.' },
      { key: 'prepare', label: 'Prepare file', text: 'Encode the selected format from the current render, without rendering again.' },
      { key: 'download', label: 'Download + PDF report', text: 'Save the audio, followed by a PDF of every effect and measurement behind it.' },
      { key: 'bundle', label: 'Download ZIP', text: 'The same audio and PDF report in one ZIP.' },
    ],
  },
];

const BY_KEY = new Map(GUIDE.flatMap(s => s.entries).map(e => [e.key, e]));

/**
 * Look up a guide entry.
 * @throws Error on an unknown key, so a typo fails at render instead of shipping a blank hint.
 */
export function guideEntry(key: string): GuideEntry {
  const entry = BY_KEY.get(key);
  if (!entry) throw new Error(`Unknown control guide key: ${key}`);
  return entry;
}

/** Every guide key, in guide order. */
export const GUIDE_KEYS: readonly string[] = [...BY_KEY.keys()];
