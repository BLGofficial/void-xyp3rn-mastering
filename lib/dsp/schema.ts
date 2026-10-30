// Processor catalogue and chain-state validation. The state JSON format is kept
// wire-compatible with the reference engine so chain files move between them.

export type ProcessorId = 'trim' | 'eq' | 'dynamics' | 'width' | 'clip' | 'reverb' | 'echo' | 'limit';
export type Quality = 'standard' | 'studio';

export interface ParamDef {
  label: string;
  min: number;
  max: number;
  default: number;
  step: number;
  unit: string;
}

export interface ProcessorDef {
  name: string;
  parameters: Record<string, ParamDef>;
}

export interface ProcessorState {
  id: ProcessorId;
  instanceId: string;
  moduleVersion?: string;
  version: 1;
  bypassed: boolean;
  parameters: Record<string, number>;
}

export interface LoudnessTarget {
  targetLufs: number;
  correctionDb: number;
}

export interface ChainState {
  schemaVersion: 1 | 2 | 3;
  engineVersion?: string;
  quality?: Quality;
  outputCeilingDbtp?: number | null;
  loudnessTarget?: LoudnessTarget;
  processors: ProcessorState[];
}

/** State-format version written into chain files (compatibility marker, not our release version). */
export const STATE_ENGINE_VERSION = '0.11.0-dev.1';
const ACCEPTED_V3_ENGINES = [STATE_ENGINE_VERSION, '0.9.0-dev.1', '0.10.0-dev.1'];
const ENGINE_PATTERN = /^0\.(?:[3459]|10|11)\.0(?:-dev\.\d+)?$/;
const INSTANCE_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
export const MAX_PROCESSORS = 32;

const p = (label: string, min: number, max: number, value: number, step: number, unit = ''): ParamDef =>
  ({ label, min, max, default: value, step, unit });

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

export const DEFINITIONS: Readonly<Record<ProcessorId, ProcessorDef>> = deepFreeze({
  trim: { name: 'Input Trim', parameters: { gainDb: p('Gain', -24, 24, 0, 0.1, 'dB') } },
  eq: {
    name: 'Tone EQ',
    parameters: {
      lowDb: p('Low shelf', -12, 12, 0, 0.1, 'dB'), lowHz: p('Low shelf corner', 30, 500, 120, 1, 'Hz'),
      midDb: p('Bell', -12, 12, 0, 0.1, 'dB'), midHz: p('Bell centre', 100, 12000, 1000, 1, 'Hz'),
      midQ: p('Bell Q', 0.3, 6, 1, 0.1),
      highDb: p('High shelf', -12, 12, 0, 0.1, 'dB'), highHz: p('High shelf corner', 1000, 18000, 8000, 1, 'Hz'),
    },
  },
  dynamics: {
    name: 'Glue Compressor',
    parameters: {
      thresholdDb: p('Threshold', -60, 0, -18, 0.1, 'dBFS'), ratio: p('Ratio', 1, 10, 2, 0.1),
      kneeDb: p('Knee', 0, 12, 6, 0.1, 'dB'), attackMs: p('Attack', 0.1, 100, 20, 0.1, 'ms'),
      releaseMs: p('Release', 10, 1000, 150, 1, 'ms'), makeupDb: p('Makeup', -12, 12, 0, 0.1, 'dB'),
      adaptive: p('Detector (0 peak, 1 hybrid program-dependent)', 0, 1, 0, 1),
      maxReductionDb: p('Reduction cap (hybrid only)', 0, 24, 24, 0.1, 'dB'),
    },
  },
  width: { name: 'Stereo Width', parameters: { amount: p('Side gain (1 = unchanged)', 0, 2, 1, 0.01) } },
  clip: {
    name: 'Soft Ceiling Clip',
    parameters: { driveDb: p('Drive', 0, 18, 0, 0.1, 'dB'), ceilingDb: p('Ceiling', -18, 0, -1, 0.1, 'dBFS') },
  },
  reverb: {
    name: 'Space',
    parameters: { amount: p('Send', 0, 0.2, 0, 0.01), decay: p('Decay', 0.2, 4, 1.4, 0.1, 's'), preDelayMs: p('Pre-delay', 0, 100, 20, 1, 'ms') },
  },
  echo: {
    name: 'Echo',
    parameters: { amount: p('Send', 0, 0.25, 0, 0.01), timeMs: p('Time', 50, 1000, 250, 1, 'ms'), feedback: p('Feedback', 0, 0.65, 0.25, 0.01) },
  },
  limit: {
    name: 'Brickwall Limiter',
    parameters: {
      ceilingDb: p('Ceiling', -12, -0.1, -1, 0.1, 'dB'), releaseMs: p('Release', 10, 1000, 100, 1, 'ms'),
      truePeak: p('Detector (0 sample, 1 true-peak 4x)', 0, 1, 0, 1),
    },
  },
});

const IDS = Object.keys(DEFINITIONS) as ProcessorId[];
/** Modules whose v1.1.0 added parameters; older files are migrated with these defaults. */
const LEGACY_ADDITIONS: Partial<Record<ProcessorId, Record<string, number>>> = {
  dynamics: { adaptive: 0, maxReductionDb: 24 },
  limit: { truePeak: 0 },
};
const MODE_SWITCHES = new Set(['adaptive', 'truePeak']);
const PROCESSOR_FIELDS = new Set(['id', 'instanceId', 'moduleVersion', 'version', 'bypassed', 'parameters']);
const V3_FIELDS = new Set(['schemaVersion', 'engineVersion', 'processors', 'quality', 'outputCeilingDbtp', 'loudnessTarget']);
const LEGACY_FIELDS = new Set(['schemaVersion', 'engineVersion', 'processors']);

export const moduleVersion = (id: ProcessorId): string => (id in LEGACY_ADDITIONS ? '1.1.0' : '1.0.0');
const isId = (id: unknown): id is ProcessorId => typeof id === 'string' && Object.hasOwn(DEFINITIONS, id);
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object';
const inRange = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const fail = (message: string): never => {
  throw new Error(message);
};

/**
 * Build one processor state populated with parameter defaults.
 * @param id Processor kind.
 * @param instanceId Unique slot id within a chain (`[a-zA-Z0-9_-]{1,64}`).
 * @param bypassed Initial bypass flag.
 */
export function createState(id: ProcessorId, instanceId: string, bypassed = true): ProcessorState {
  if (!isId(id)) fail('Unknown module.');
  const parameters = Object.fromEntries(Object.entries(DEFINITIONS[id].parameters).map(([k, d]) => [k, d.default]));
  return { id, instanceId, moduleVersion: moduleVersion(id), version: 1, bypassed, parameters };
}

/**
 * Default mastering chain: trim, eq, dynamics, width, clip, limit (dynamics/clip/limit bypassed).
 * @returns A fresh schema-v3 chain state.
 */
export function defaultState(): ChainState {
  const ids = IDS.filter(id => id !== 'reverb' && id !== 'echo');
  return {
    schemaVersion: 3, engineVersion: STATE_ENGINE_VERSION, quality: 'standard', outputCeilingDbtp: null,
    processors: ids.map((id, i) => createState(id, `slot-${i + 1}`, id === 'dynamics' || id === 'clip' || id === 'limit')),
  };
}

function validateLoudnessTarget(t: unknown): LoudnessTarget {
  if (!isRecord(t) || Object.keys(t).length !== 2 || !inRange(t.targetLufs, -24, -8) || !inRange(t.correctionDb, -60, 24)) {
    fail('Invalid final loudness target.');
  }
  const { targetLufs, correctionDb } = t as unknown as LoudnessTarget;
  return { targetLufs, correctionDb };
}

function validateProcessor(raw: unknown, index: number, schemaVersion: number, seen: Set<string>): ProcessorState {
  if (!isRecord(raw) || !isId(raw.id) || raw.version !== 1 || typeof raw.bypassed !== 'boolean' || !isRecord(raw.parameters)) {
    fail('Invalid processor state.');
  }
  const proc = raw as Record<string, unknown> & { id: ProcessorId; bypassed: boolean; parameters: Record<string, unknown> };
  if (Object.keys(proc).some(k => !PROCESSOR_FIELDS.has(k))) fail('Unexpected module field.');

  const current = moduleVersion(proc.id);
  const legacy = proc.id in LEGACY_ADDITIONS && (proc.moduleVersion === '1.0.0' || (schemaVersion === 1 && proc.moduleVersion === undefined));
  if ((schemaVersion >= 2 || proc.moduleVersion !== undefined) && proc.moduleVersion !== current && !legacy) fail('Incompatible module version.');

  const instanceId = proc.instanceId === undefined && schemaVersion === 1 ? `slot-${index + 1}` : proc.instanceId;
  if (typeof instanceId !== 'string' || !INSTANCE_PATTERN.test(instanceId) || seen.has(instanceId)) fail('Invalid or duplicate module instance.');
  seen.add(instanceId as string);

  const schema = DEFINITIONS[proc.id].parameters;
  const input = legacy ? { ...LEGACY_ADDITIONS[proc.id], ...proc.parameters } : proc.parameters;
  if (Object.keys(input).length !== Object.keys(schema).length) fail('Invalid processor parameters.');
  const parameters: Record<string, number> = {};
  for (const [key, def] of Object.entries(schema)) {
    const value = input[key];
    if (MODE_SWITCHES.has(key) && !Number.isInteger(value)) fail('Invalid processor mode.');
    if (!inRange(value, def.min, def.max)) fail(`Invalid ${proc.id} ${key}.`);
    parameters[key] = value as number;
  }
  return { id: proc.id, instanceId: instanceId as string, moduleVersion: current, version: 1, bypassed: proc.bypassed, parameters };
}

/**
 * Validate and normalize a chain state. Migrates schema v1/v2 files and pre-1.1.0 dynamics/limit modules.
 * @throws On unknown modules, out-of-range parameters, duplicate instances or unexpected fields.
 */
export function validateState(state: unknown): ChainState {
  if (!isRecord(state) || ![1, 2, 3].includes(state.schemaVersion as number) || !Array.isArray(state.processors) || state.processors.length > MAX_PROCESSORS) {
    fail('Unsupported processing graph state.');
  }
  const s = state as Record<string, unknown> & { schemaVersion: 1 | 2 | 3; processors: unknown[] };
  const v3 = s.schemaVersion === 3;
  const loudnessTarget = s.loudnessTarget === undefined ? undefined : validateLoudnessTarget(s.loudnessTarget);
  const allowed = v3 ? V3_FIELDS : LEGACY_FIELDS;
  if (Object.keys(s).some(k => !allowed.has(k))) fail('Unexpected graph field.');
  if (s.engineVersion !== undefined && !(typeof s.engineVersion === 'string' && ENGINE_PATTERN.test(s.engineVersion))) fail('Incompatible engine version.');
  if (s.schemaVersion === 2 && s.engineVersion !== '0.5.0-dev.1') fail('Incompatible engine version.');
  if (v3 && (!ACCEPTED_V3_ENGINES.includes(s.engineVersion as string) || (s.quality !== 'standard' && s.quality !== 'studio') ||
    (s.outputCeilingDbtp !== null && !inRange(s.outputCeilingDbtp, -12, -0.1)))) fail('Invalid studio quality settings.');

  const seen = new Set<string>();
  const processors = s.processors.map((raw, i) => validateProcessor(raw, i, s.schemaVersion, seen));
  return {
    schemaVersion: 3,
    engineVersion: STATE_ENGINE_VERSION,
    quality: v3 ? (s.quality as Quality) : 'standard',
    outputCeilingDbtp: v3 ? (s.outputCeilingDbtp as number | null) : null,
    ...(loudnessTarget ? { loudnessTarget } : {}),
    processors,
  };
}

/** Seconds of reverb/delay tail to render after the source ends, capped at 8. */
export function tailSeconds(state: ChainState): number {
  let seconds = 0;
  for (const { id, bypassed, parameters: q } of state.processors) {
    if (bypassed || !(q.amount! > 0)) continue;
    if (id === 'reverb') seconds += q.preDelayMs! / 1000 + q.decay! * 1.5;
    // Repeats until feedback^n falls below -80 dB.
    if (id === 'echo') seconds += (q.timeMs! / 1000) * (q.feedback! > 0 ? Math.ceil(Math.log(0.0001) / Math.log(q.feedback!)) : 1);
  }
  return Math.min(8, seconds);
}
