/**
 * Which 64 KB a memory view should be drawing.
 *
 * The lab's memory panel used to index one array, `state.memory`, and that was
 * fine for as long as the only engine was the legacy one, whose memory *is* one
 * flat 4 KB image. The new engine has four segments, and its adapter puts a
 * single segment in that array -- the one the program is running in -- so a
 * Stack view indexing it with SP was reading the program's own bytes and a Data
 * view at 0100h was reading the code segment. The fix was to ask the engine for
 * a segment by name (`DebugSession.memoryIn`); these are the two things the
 * panels need on top of that.
 *
 * Both are pure functions over the register file so they can be tested without
 * a component tree. The panel is a view over them and the interesting part is
 * the arithmetic, not the markup.
 */

import type { SegmentName } from '@/lab/types';
import type { Registers } from '@/types/cpu';

/**
 * The four segment registers, in the order the panel's buttons are shown.
 *
 * Code, data, extra and stack: the order the 8086 documentation uses, so the
 * picker reads the way a manual's opcode map does rather than alphabetically.
 */
export const SEGMENT_NAMES: readonly SegmentName[] = ['CS', 'DS', 'ES', 'SS'];

/**
 * The physical address a segment register names.
 *
 * Shifted left by four, because that is how a segment and an offset form a real
 * address, and masked to 16 bits first because a segment register is 16 bits
 * wide -- `MOV CS, 0x12345` leaves `0x2345` in it and a base of `0x23450` would
 * be a 21-bit address the machine cannot form.
 *
 * Shown in the panel's caption because four segments can each have an offset
 * 0100h, and an offset on its own does not say which 64 KB is on screen.
 */
export function segmentBaseFor(segment: SegmentName, registers: Registers): number {
  return ((registers[segment] ?? 0) & 0xffff) << 4;
}

/**
 * The segment the step diagnostics are offsets in, or null when they could be in
 * any of them.
 *
 * `changedMemoryWords` and the trace's `instructionAddress` are offsets in the
 * segment the program is running in, because that is the one the debugger reads
 * to decide where it is. Highlighting those offsets inside a view of some other
 * segment would light up unrelated cells, and after a `PUSH` the stack view
 * would claim nothing had changed while showing the wrong bytes.
 *
 * Null is the case worth getting right: for a .COM program -- which is what the
 * lab is mostly built around -- all four registers hold the same value, so every
 * view is a view of the same memory and every view may be marked. Deciding that
 * from the register *values* rather than from the engine means a .COM program
 * behaves the same on both, and the legacy needs no special case at all.
 */
export function segmentNamedBy(registers: Registers, base: number): SegmentName | null {
  const matches = SEGMENT_NAMES.filter((name) => segmentBaseFor(name, registers) === base);
  return matches.length === SEGMENT_NAMES.length ? null : (matches[0] ?? null);
}

/**
 * The segment the diagnostics are offsets in, and whether that is every one of
 * them.
 *
 * Returned together because the panel asks both questions at once and answering
 * them separately would walk the register file twice per render for no reason.
 */
export function runningSegment(registers: Registers): { name: SegmentName | null; isEverywhere: boolean } {
  const name = segmentNamedBy(registers, segmentBaseFor('CS', registers));
  return { name, isEverywhere: name === null };
}

/**
 * Where a .COM program's data starts, which is 0100h on both engines.
 *
 * A .COM file is one segment loaded at the top of it, so its code begins at
 * offset 0100h and anything the program declares follows the code. This is the
 * offset the Data view has always used and the one the legacy's assembler
 * literally writes its data symbols to.
 */
export const COM_DATA_START = 0x0100;

/**
 * The offset the Data Segment view should start at.
 *
 * 0100h everywhere except a program that declared its own segments, and there it
 * is zero. The reason is that a declared data segment *begins* at its own offset
 * zero -- `values DW 0BEEFh` is the first two bytes of the segment -- so a view
 * anchored at 0100h would show the empty part of a two-byte segment and none of
 * the data. The legacy never gets the zero case: its memory is one flat image
 * with the data at 0100h whatever the registers hold, and moving the view would
 * take away the one place its data is visible.
 *
 * The rule is stated as "one segment or more than one" rather than as "the
 * engine", because a `.COM` program is one segment on both engines and a program
 * that declared segments is more than one on the one that can.
 */
export function dataSegmentStart(engine: 'legacy' | 'v2', registers: Registers): number {
  if (engine === 'legacy') return COM_DATA_START;
  return runningSegment(registers).isEverywhere ? COM_DATA_START : 0;
}
