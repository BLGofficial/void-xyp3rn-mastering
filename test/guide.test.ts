import { describe, expect, it } from 'vitest';
import { DEFINITIONS, type ProcessorId } from '../lib/dsp';
import { GUIDE, GUIDE_KEYS, guideEntry, PARAM_TEXT, paramKey } from '../lib/guide';

describe('control guide', () => {
  it('describes every parameter of every module, and nothing that does not exist', () => {
    for (const id of Object.keys(DEFINITIONS) as ProcessorId[]) {
      expect(Object.keys(PARAM_TEXT[id]).sort(), id).toEqual(Object.keys(DEFINITIONS[id].parameters).sort());
      for (const param of Object.keys(DEFINITIONS[id].parameters)) expect(GUIDE_KEYS).toContain(paramKey(id, param));
    }
    expect(Object.keys(PARAM_TEXT).sort()).toEqual(Object.keys(DEFINITIONS).sort());
  });

  it('has unique keys and complete entries', () => {
    const all = GUIDE.flatMap(s => s.entries);
    expect(new Set(all.map(e => e.key)).size).toBe(all.length);
    expect(GUIDE_KEYS).toHaveLength(all.length);
    for (const e of all) {
      expect(e.label.trim(), e.key).not.toBe('');
      // One or two sentences: the hint prints under the control.
      expect(e.text.length, e.key).toBeGreaterThan(20);
      expect(e.text.length, e.key).toBeLessThan(260);
      expect(e.text.trim().endsWith('.'), e.key).toBe(true);
    }
  });

  it('names modules by their studio names, not the reference plugin', () => {
    const titles = GUIDE.map(s => s.title);
    for (const def of Object.values(DEFINITIONS)) expect(titles).toContain(def.name);
    expect(JSON.stringify(GUIDE)).not.toMatch(/VOID/);
  });

  it('throws on an unknown key instead of rendering a blank hint', () => {
    expect(guideEntry('render').label).toBe('Render master');
    expect(() => guideEntry('nope')).toThrow(/Unknown control guide key: nope/);
  });
});
