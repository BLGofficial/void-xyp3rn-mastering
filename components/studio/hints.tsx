'use client';

import { createContext, useContext, useId } from 'react';
import { guideEntry, type GuideEntry } from '@/lib/guide';

/** Whether inline hints print under the controls. Off, they stay as screen-reader descriptions. */
const HintsContext = createContext(false);
export const HintsProvider = HintsContext.Provider;

export interface HintRef { id: string; entry: GuideEntry }

/**
 * Bind a control to its guide entry. Spread `id` into the control's `aria-describedby`
 * and render `<Hint hint={…} />` where the text should print.
 */
export function useHint(key: string): HintRef {
  return { id: `hint-${useId().replace(/:/g, '')}`, entry: guideEntry(key) };
}

/**
 * The hint text. Always in the DOM so `aria-describedby` resolves (accessible names
 * read hidden referenced nodes); visible only with hints on and the control present.
 */
export function Hint({ hint, show = true, className = 'mt-1' }: { hint: HintRef; show?: boolean; /** Spacing; replaces the default `mt-1`. */ className?: string }) {
  const on = useContext(HintsContext);
  return (
    <p id={hint.id} data-guide={hint.entry.key} hidden={!(on && show)} className={`border-l border-gold-dim/50 pl-2 text-xs leading-snug text-ash ${className}`}>
      {hint.entry.text}
    </p>
  );
}

