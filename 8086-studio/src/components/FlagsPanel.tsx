/**
 * components/FlagsPanel.tsx — the FLAGS word, drawn as a word.
 *
 * A flags panel that shows nine named booleans is a list, and a list hides the
 * shape of what it is reading. The 8086 FLAGS word is sixteen bits, nine named
 * and seven not: bit 1 always reads back as 1 and the rest are unassigned. Both
 * engines keep FLAGS as a plain 16-bit number, so this panel reads the same word
 * on either one and needs to know nothing about which engine produced it.
 *
 * The bit arithmetic lives in `describeFlags`/`namedFlags` below, which are
 * exported and tested in `flags-panel.test.ts`; this file is markup over them.
 */

import { motion } from 'framer-motion';
import { cn } from '@/utils/cn';

/** One row of the word: a bit position, the flag that owns it, and its value. */
export interface FlagRow {
  /** Bit position, 0 = least significant. */
  index: number;
  /** The flag at this position, or null for a bit the 8086 does not assign. */
  name: string | null;
  value: boolean;
  /**
   * True only for bit 1. The 8086 reads it as 1 and a POPF writes 1 into it no
   * matter what the byte said, so it is the one bit with a value the processor
   * never computes.
   */
  fixed: boolean;
  /** Set when the bit differs from the word this one was compared against. */
  changed: boolean;
}

/** The full names for the 8086 flag set, in the order a datasheet lists them. */
const FLAG_NAMES = ['CF', 'PF', 'AF', 'ZF', 'SF', 'TF', 'IF', 'DF', 'OF'] as const;

/** Bit position for each named flag, straight from the 8086 FLAGS layout. */
const FLAG_POSITION: Record<(typeof FLAG_NAMES)[number], number> = {
  CF: 0,
  PF: 2,
  AF: 4,
  ZF: 6,
  SF: 7,
  TF: 8,
  IF: 9,
  DF: 10,
  OF: 11,
};

const NAME_AT_POSITION = new Map<number, string>(
  FLAG_NAMES.map((name) => [FLAG_POSITION[name], name] as const),
);

export type NamedFlags = Record<(typeof FLAG_NAMES)[number], boolean>;

/**
 * The word as sixteen rows, most significant bit first.
 *
 * `previous` is the word this one follows — the state before the last
 * instruction — and is what makes a changed bit worth looking at. Pass none for
 * the first step of a program, where nothing has been compared against anything.
 */
export function describeFlags(flags: number, previous?: number): FlagRow[] {
  const rows: FlagRow[] = [];
  for (let index = 15; index >= 0; index -= 1) {
    rows.push({
      index,
      name: NAME_AT_POSITION.get(index) ?? null,
      value: (flags & (1 << index)) !== 0,
      fixed: index === 1,
      changed: previous !== undefined && (flags & (1 << index)) !== (previous & (1 << index)),
    });
  }
  return rows;
}

/** Just the nine named flags, for callers that want names without positions. */
export function namedFlags(flags: number): NamedFlags {
  const out = {} as NamedFlags;
  for (const name of FLAG_NAMES) {
    out[name] = (flags & (1 << FLAG_POSITION[name])) !== 0;
  }
  return out;
}

interface FlagsPanelProps {
  flags: number;
  /** The word this one follows, so changed bits can be marked. */
  previousFlags?: number;
  className?: string;
}

export function FlagsPanel({ flags, previousFlags, className }: FlagsPanelProps) {
  const rows = describeFlags(flags, previousFlags);

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex flex-wrap gap-1">
        {rows.map((row) => (
          <FlagBit key={row.index} row={row} />
        ))}
      </div>
      <p className="text-xs text-gray-500 leading-relaxed">
        {`Bit 1 reads as 1 on the 8086 and is written as 1; the other unassigned bits (3, 5, 12-15) are what `}
        <code className="font-mono text-gray-400">PUSHF</code>
        {' shows as holes.'}
      </p>
    </div>
  );
}

function FlagBit({ row }: { row: FlagRow }) {
  const tooltip = row.fixed
    ? 'Bit 1: reserved, always reads as 1'
    : row.name
      ? `Bit ${row.index}: ${row.name}`
      : `Bit ${row.index}: unassigned on the 8086`;

  return (
    <motion.div
      initial={false}
      animate={{
        backgroundColor: row.value ? 'rgba(47, 191, 113, 0.2)' : 'rgba(19, 32, 30, 1)',
        borderColor: row.changed
          ? 'rgba(240, 180, 91, 0.7)'
          : row.value
            ? 'rgba(47, 191, 113, 0.35)'
            : 'rgba(31, 43, 41, 1)',
      }}
      title={tooltip}
      aria-label={tooltip}
      className={cn(
        'w-9 h-11 rounded-md text-center border transition-all duration-300',
        row.value ? 'text-[#5de6a0]' : 'text-gray-600',
        row.changed && 'ring-1 ring-[#f0b45b]/40',
        !row.name && 'border-dashed'
      )}
    >
      <div className="text-[10px] leading-none pt-1.5 font-sans">
        {row.name ?? (row.fixed ? '·' : '')}
      </div>
      <div className="font-mono text-xs font-bold leading-tight">{row.value ? '1' : '0'}</div>
      <div className="text-[9px] text-gray-600 leading-none pb-1">{row.index}</div>
    </motion.div>
  );
}
