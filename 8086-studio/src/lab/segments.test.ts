/**
 * Which segment a memory view draws, and which views may show a step's writes.
 *
 * The panel itself is markup over these, so this is where the arithmetic is
 * tested: the base a segment register names, and the rule that decides whether a
 * write at offset 0100h happened in the segment on screen or in some other one.
 *
 * `DebugSession.memoryIn` -- the reason any of this exists -- is tested from the
 * outside in `src/lab/execution-engine.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { COM_DATA_START, SEGMENT_NAMES, dataSegmentStart, runningSegment, segmentBaseFor, segmentNamedBy } from '@/lab/segments';
import { createInitialState } from '@/emulator/cpu';
import type { Registers } from '@/types/cpu';

/** A register file, with only the segment registers filled in. */
function withSegments(values: Partial<Registers>): Registers {
  return { ...createInitialState().registers, ...values };
}

describe('SEGMENT_NAMES', () => {
  it('is the four segment registers, in documentation order', () => {
    // The order is the one a manual uses -- code, data, extra, stack -- so the
    // panel's buttons read in that order rather than alphabetically.
    expect([...SEGMENT_NAMES]).toEqual(['CS', 'DS', 'ES', 'SS']);
  });
});

describe('segmentBaseFor', () => {
  it('shifts the register left by four, which is how a physical address is formed', () => {
    const registers = withSegments({ CS: 0x1000, DS: 0x2000, ES: 0x3000, SS: 0x4000 });
    expect(segmentBaseFor('CS', registers)).toBe(0x10000);
    expect(segmentBaseFor('DS', registers)).toBe(0x20000);
    expect(segmentBaseFor('ES', registers)).toBe(0x30000);
    expect(segmentBaseFor('SS', registers)).toBe(0x40000);
  });

  it('masks to 16 bits first, because a segment register is 16 bits wide', () => {
    // A register that somehow holds 21 bits must not produce a 21-bit base: the
    // machine forms addresses from 16-bit registers, so the high bits are not
    // part of the address.
    expect(segmentBaseFor('CS', withSegments({ CS: 0x12345 }))).toBe(0x23450);
  });

  it('puts the last segment of the address space at the top of it', () => {
    // F000:0010 is 100000h, the 17th byte of the megabyte. The panels read a
    // 64 KB window from there, which is the case `memoryIn` has to wrap.
    expect(segmentBaseFor('CS', withSegments({ CS: 0xf000 }))).toBe(0xf0000);
  });
});

describe('segmentNamedBy', () => {
  it('returns null when every segment register holds the same value', () => {
    // This is the .COM case and it has to come out as "any of them", because a
    // .COM program has one segment: the stack, the data and the code are all the
    // same 64 KB, so a write is visible in every view of it.
    const registers = withSegments({ CS: 0, DS: 0, ES: 0, SS: 0 });
    expect(segmentNamedBy(registers, 0)).toBeNull();

    const at0100 = withSegments({ CS: 0x100, DS: 0x100, ES: 0x100, SS: 0x100 });
    expect(segmentNamedBy(at0100, 0x1000)).toBeNull();
  });

  it('names the one segment a program separated out', () => {
    // CS, DS and SS differ and ES follows DS, so a write is only known to be in
    // the code segment.
    const registers = withSegments({ CS: 0, DS: 0x1000, ES: 0x1000, SS: 0x2000 });
    expect(segmentNamedBy(registers, 0)).toBe('CS');
  });

  it('names the first match, so a duplicated segment is decided the same way twice', () => {
    // DS and ES equal, CS and SS different: the write is in the data segment, and
    // the answer must not depend on which of DS or ES the filter happened to
    // reach first.
    const registers = withSegments({ CS: 0, DS: 0x2000, ES: 0x2000, SS: 0x3000 });
    expect(segmentNamedBy(registers, segmentBaseFor('DS', registers))).toBe('DS');
  });

  it('returns null for a base no segment names, rather than guessing', () => {
    // Better an unmarked view than one marked against the wrong 64 KB. The panel
    // reaches here only if a caller passes something other than CS's base, which
    // is why the return type admits it.
    const registers = withSegments({ CS: 0, DS: 0x1000, ES: 0x1000, SS: 0x1000 });
    expect(segmentNamedBy(registers, 0xdead0)).toBeNull();
  });
});

describe('runningSegment', () => {
  it('says a .COM program is one segment, on either engine', () => {
    // The legacy has DS and ES pinned at 0100h and SS as a real register, so its
    // register file does not always agree with itself -- which is why this is
    // about the *new* engine's layout and the shared panel code has to cope.
    for (const registers of [
      withSegments({ CS: 0, DS: 0, ES: 0, SS: 0 }),
      withSegments({ CS: 0x100, DS: 0x100, ES: 0x100, SS: 0x100 }),
    ]) {
      expect(runningSegment(registers), 'one segment').toEqual({ name: null, isEverywhere: true });
    }
  });

  it('names the code segment for a program that separated its segments', () => {
    const registers = withSegments({ CS: 0x1000, DS: 0x2000, ES: 0x2000, SS: 0x3000 });
    expect(runningSegment(registers)).toEqual({ name: 'CS', isEverywhere: false });
  });

  it('stays one segment when a program loads CS over the other three', () => {
    // Loading a segment register does not move the program, so the four
    // registers are equal again and the diagnostics are offsets in a segment
    // every view is showing. A `MOV CS, AX` in the middle of a step must not make
    // the memory panel stop marking writes.
    const registers = withSegments({ CS: 0x1000, DS: 0x1000, ES: 0x1000, SS: 0x1000 });
    expect(runningSegment(registers).isEverywhere).toBe(true);
  });
});

describe('dataSegmentStart', () => {
  const oneSegment = withSegments({ CS: 0, DS: 0, ES: 0, SS: 0 });
  const separate = withSegments({ CS: 0, DS: 0x1000, ES: 0x1000, SS: 0x2000 });

  it('is 0100h for a .COM program, on both engines', () => {
    // A .COM file is one segment loaded at 0100h, so its data follows its code
    // from there. This is the offset the Data view has always used, and for the
    // lab's most common program it must not move.
    expect(dataSegmentStart('legacy', oneSegment)).toBe(COM_DATA_START);
    expect(dataSegmentStart('v2', oneSegment)).toBe(COM_DATA_START);
  });

  it('is 0100h on the legacy whatever the registers hold', () => {
    // The legacy's memory is one flat image and its assembler writes data
    // symbols to offset 0100h of it. DS and ES are pinned at 0100h and are not
    // real segment registers, so a register file that looks like a two-segment
    // program must not move the view off the only place its data is.
    expect(dataSegmentStart('legacy', separate)).toBe(COM_DATA_START);
  });

  it('is zero for a program that declared its own segments on the new engine', () => {
    // `values DW 0BEEFh` inside a DATA SEGMENT is the first two bytes of that
    // segment. A view anchored at 0100h into a two-byte segment shows the empty
    // part of it and none of the data, which is the view this replaces.
    expect(dataSegmentStart('v2', separate)).toBe(0);
  });

  it('is 0100h for a v2 program whose segments happen to share a base', () => {
    // The decision is about how many segments the program has, not about whether
    // the values happen to differ in this run. A program that declared segments
    // and then loaded CS over DS has one segment's worth of addresses again, and
    // the data is wherever 0100h is.
    const loaded = withSegments({ CS: 0x1000, DS: 0x1000, ES: 0x1000, SS: 0x1000 });
    expect(dataSegmentStart('v2', loaded)).toBe(COM_DATA_START);
  });
});
