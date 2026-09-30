/**
 * The flags panel's reading of the FLAGS word.
 *
 * The panel is a debugger's answer to "what is in FLAGS", and the answer is not a
 * list of nine booleans: it is sixteen bit positions, nine of which have names
 * and seven of which do not. Three of the unnamed ones matter to a person
 * learning the machine -- bit 1 always reads 1 on an 8086, and the reserved bits
 * are why `PUSHFD` output has holes in it -- so the panel draws the word and the
 * named flags together rather than showing a list that silently omits seven bits.
 *
 * `describeFlags` is exported and tested here so the bit arithmetic can be
 * checked without a DOM, following the same rule as `parseRegisterInput` in
 * `RegisterDisplay.tsx`: the component is markup over one pure function, and the
 * function is where the part that can be wrong lives.
 */

import { describe, expect, it } from 'vitest';
import { describeFlags, namedFlags } from '@/components/FlagsPanel';

describe('describeFlags', () => {
  it('names the nine flags at the bits the 8086 puts them at', () => {
    // Positions, not a guess: CF is bit 0, AF is bit 4, OF is bit 11. The 8086
    // has no bit 1 flag and no bit 12+ flags, and getting a position wrong here
    // would mislabel every flag in the panel.
    const names = new Map(describeFlags(0).map((row) => [row.index, row.name]));
    expect(names.get(0)).toBe('CF');
    expect(names.get(2)).toBe('PF');
    expect(names.get(4)).toBe('AF');
    expect(names.get(6)).toBe('ZF');
    expect(names.get(7)).toBe('SF');
    expect(names.get(8)).toBe('TF');
    expect(names.get(9)).toBe('IF');
    expect(names.get(10)).toBe('DF');
    expect(names.get(11)).toBe('OF');
  });

  it('leaves the seven unassigned bits unnamed', () => {
    // Bits 1, 3, 5 and 12-15. Naming them would be inventing flags; leaving them
    // in as blank positions is what makes the word's shape visible.
    const named = new Set(describeFlags(0).filter((row) => row.name !== null).map((row) => row.index));
    for (const index of [1, 3, 5, 12, 13, 14, 15]) {
      expect(named.has(index), `bit ${index} must not be named`).toBe(false);
    }
    expect(named.size).toBe(9);
  });

  it('marks bit 1 as fixed, because the 8086 always reads it as one', () => {
    // The only bit with a defined value the processor never computes. POPF writes
    // a 1 into it whatever the byte said, and PUSHF always pushes a 1, so a
    // program reading FLAGS and testing every bit will see this one set.
    const rows = describeFlags(0);
    const bit1 = rows.find((row) => row.index === 1)!;
    expect(bit1.fixed).toBe(true);
    expect(bit1.name).toBeNull();
    for (const row of rows.filter((r) => r.index !== 1)) {
      expect(row.fixed, `bit ${row.index}`).toBe(false);
    }
  });

  it('reads each bit of the word, so the panel shows what the machine holds', () => {
    const rows = new Map(describeFlags(0x0f25).map((row) => [row.index, row.value]));
    // 0x0F25 = 0000 1111 0010 0101
    for (const [index, expected] of [
      [0, true], [2, true], [5, true], [8, true], [9, true], [10, true], [11, true],
      [1, false], [3, false], [4, false], [6, false], [7, false],
      [12, false], [13, false], [14, false], [15, false],
    ] as const) {
      expect(rows.get(index), `bit ${index} of 0F25h`).toBe(expected);
    }
  });

  it('reports a changed bit by comparing two words, not by guessing', () => {
    // The panel marks what the last instruction changed, which is the only reason
    // a person watches a flag at all. The comparison is against the whole word, so
    // a flag that flipped off is marked as well as one that flipped on.
    const before = describeFlags(0x0000, 0x0040);
    expect(before.find((row) => row.index === 6)!.changed).toBe(true);
    expect(before.find((row) => row.index === 7)!.changed).toBe(false);

    const cleared = describeFlags(0x0040, 0x0000);
    expect(cleared.find((row) => row.index === 6)!.changed).toBe(true);
  });

  it('marks nothing changed when there is no previous word', () => {
    // The first step of a program has nothing to compare against, and claiming
    // every flag changed would be a lie.
    for (const row of describeFlags(0x0242)) {
      expect(row.changed, `bit ${row.index}`).toBe(false);
    }
  });

  it('shows sixteen positions, most significant first', () => {
    // A flags word is read as one number, so the panel is a number: 15 down to 0.
    // Drawn the other way round it looks like a list of unrelated flags.
    const rows = describeFlags(0);
    expect(rows).toHaveLength(16);
    expect(rows.map((row) => row.index)).toEqual([...Array(16).keys()].reverse());
  });
});

describe('namedFlags', () => {
  it('is the nine flags as a map, for the parts of the panel that want names only', () => {
    // The register panel's compact view wants the names without the bit
    // positions, and re-deriving them from the word would be a second place for
    // the bit arithmetic to be wrong.
    const flags = namedFlags(0x0f25);
    expect(Object.keys(flags).sort()).toEqual(['AF', 'CF', 'DF', 'IF', 'OF', 'PF', 'SF', 'TF', 'ZF']);
    expect(flags.CF).toBe(true);
    expect(flags.ZF).toBe(false);
    expect(flags.IF).toBe(true);
    expect(flags.DF).toBe(true);
  });

  it('reads a cleared word as all false, which is not what a stopped program holds', () => {
    // A .COM program starts with the interrupt flag set, so an all-false word only
    // appears if a program cleared everything. Worth pinning so the panel cannot
    // be quietly defaulting to "set".
    const flags = namedFlags(0);
    expect(Object.values(flags).every((value) => value === false)).toBe(true);
  });
});
