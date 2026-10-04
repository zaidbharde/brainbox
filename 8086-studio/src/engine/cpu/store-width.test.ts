/**
 * How wide a store to memory is, on each engine.
 *
 * This file exists because of a bug found while writing the example library, not
 * because the width was ever suspected. `arrays-strings-reverse` copied a string
 * backwards and produced garbage, and the cause turned out to be that the legacy
 * writes *two* bytes for a store that never said how wide it was:
 *
 * ```asm
 * MOV BX, 0200h
 * MOV AL, 90
 * MOV [BX], AL          ; legacy: writes 5A 00, so 0201h becomes 0
 * MOV BYTE PTR [BX], AL ; both: writes 5A
 * ```
 *
 * The stray byte is a zero rather than garbage, which is why this survives so
 * long: an ascending copy loop gets every byte it copied right, because each
 * store's stray zero is overwritten by the next one. What it still gets wrong is
 * the single byte immediately past the end -- which in `arrays-strings-reverse` is
 * a character, and in a backward loop is data that has already been written.
 *
 * So there are two kinds of assertion here. The `BYTE PTR` tests are a
 * requirement: that spelling must store one byte on both engines, and if it ever
 * stops doing so something is badly wrong. The bare-store test pins the legacy's
 * current behaviour rather than endorsing it. The legacy is deliberately left
 * alone, so a change there should be noticed and discussed, not discovered later
 * inside somebody's corrupted buffer. `docs/engine-v2-divergences.md` has the
 * write-up.
 *
 * No segment directives appear here. The legacy rejects a bare `DATA`/`CODE` and
 * the new assembler wants an origin, and none of that is what this file is about,
 * so the memory under test is stamped in directly -- which also makes the
 * sentinel bytes unambiguous.
 */

import { describe, expect, it } from 'vitest';

import { assemble as legacyAssemble } from '../../emulator/assembler';
import { runProgram as legacyRun } from '../../emulator/cpu';
import { assemble } from '../assembler/assemble';
import { Cpu, createInitialState, type CpuState } from './cpu';
import { Memory } from '../memory';

const ORIGIN = 0x100;
const BUFFER = 0x200;
const SENTINEL = [255, 255, 255, 255];

/** Bytes to write into memory before running, and where. */
interface Seed {
  readonly address: number;
  readonly bytes: readonly number[];
}

/** What to read back after the run. */
interface Probe {
  readonly seed?: Seed;
  readonly address?: number;
  readonly length?: number;
}

/** `MOV BX, BUFFER`, `MOV AL, 90`, then whatever the store under test is. */
function storeProgram(store: string): string {
  return [`MOV BX, ${BUFFER.toString(16)}h`, 'MOV AL, 90', store, 'HLT'].join('\n');
}

function readLegacy(source: string, probe: Probe = {}): number[] {
  const program = legacyAssemble(source);
  const errors = program.errors.filter((error) => error.type === 'error');
  expect(errors.map((error) => error.message)).toEqual([]);

  const seed = probe.seed ?? { address: BUFFER, bytes: SENTINEL };
  for (let i = 0; i < seed.bytes.length; i++) {
    program.initialMemory[seed.address + i] = seed.bytes[i];
  }

  const { finalState } = legacyRun(program, 1000);
  const from = probe.address ?? BUFFER;
  return Array.from(finalState.memory.slice(from, from + (probe.length ?? 4)));
}

function readV2(source: string, probe: Probe = {}): number[] {
  const assembled = assemble(source, { origin: ORIGIN });
  expect(assembled.errors.map((d) => d.message)).toEqual([]);

  const memory = new Memory();
  memory.bytes.set(assembled.image, ORIGIN);
  const seed = probe.seed ?? { address: BUFFER, bytes: SENTINEL };
  for (let i = 0; i < seed.bytes.length; i++) {
    memory.bytes[seed.address + i] = seed.bytes[i];
  }

  const state: CpuState = {
    ...createInitialState(),
    IP: assembled.entry.ip,
    CS: 0,
    DS: 0,
    ES: 0,
    SS: 0,
    SP: 0x0ffe,
  };
  const cpu = new Cpu(memory, state);
  cpu.run(1000);

  const from = probe.address ?? BUFFER;
  return Array.from(memory.bytes.slice(from, from + (probe.length ?? 4)));
}

const asText = (bytes: readonly number[]): string =>
  bytes.map((byte) => String.fromCharCode(byte)).join('');

describe('a store whose width is stated', () => {
  it('writes exactly one byte for BYTE PTR on the legacy', () => {
    expect(readLegacy(storeProgram('MOV BYTE PTR [BX], AL'))).toEqual([90, 255, 255, 255]);
  });

  it('writes exactly one byte for BYTE PTR on v2', () => {
    expect(readV2(storeProgram('MOV BYTE PTR [BX], AL'))).toEqual([90, 255, 255, 255]);
  });

  it('writes two bytes for WORD PTR, and touches nothing else', () => {
    // 0x1234 little-endian: 34 then 12. Both engines, because a word store is
    // 8086 and neither of them has an opinion about it.
    const source = [
      `MOV BX, ${BUFFER.toString(16)}h`,
      'MOV AX, 1234h',
      'MOV WORD PTR [BX], AX',
      'HLT',
    ].join('\n');
    expect(readLegacy(source)).toEqual([0x34, 0x12, 255, 255]);
    expect(readV2(source)).toEqual([0x34, 0x12, 255, 255]);
  });

  it('writes a byte immediate with BYTE PTR', () => {
    expect(readLegacy(storeProgram('MOV BYTE PTR [BX], 41h'))).toEqual([0x41, 255, 255, 255]);
    expect(readV2(storeProgram('MOV BYTE PTR [BX], 41h'))).toEqual([0x41, 255, 255, 255]);
  });
});

describe('a store whose width is not stated', () => {
  it('writes one byte on v2, which takes the width from the register', () => {
    expect(readV2(storeProgram('MOV [BX], AL'))).toEqual([90, 255, 255, 255]);
  });

  it('writes two bytes on the legacy, which defaults to word', () => {
    // Pinned, not endorsed. If this assertion starts failing, the legacy's store
    // width changed, and that is a behaviour change to the engine this project
    // keeps fixed -- it needs a decision, not a test update.
    expect(readLegacy(storeProgram('MOV [BX], AL'))).toEqual([90, 0, 255, 255]);
  });

  /**
   * `'abcdefgh'` where the loop reads from, eight bytes the loop overwrites, then
   * a sentinel past the end. One contiguous region, so the bytes past the buffer
   * are genuinely untouched by the seed.
   */
  const copySeed: Seed = {
    address: BUFFER - 8,
    bytes: [
      97, 98, 99, 100, 101, 102, 103, 104,
      0, 0, 0, 0, 0, 0, 0, 0,
      255, 255, 255, 255,
    ],
  };

  it('gets every copied byte right in a loop that walks forwards', () => {
    // The reason this went unnoticed for so long, written down as a test so the
    // explanation and the behaviour cannot drift apart.
    const source = [
      `MOV SI, ${(BUFFER - 8).toString(16)}h`,
      `MOV DI, ${BUFFER.toString(16)}h`,
      'MOV CX, 8',
      'CPY:',
      'MOV AL, [SI]',
      'MOV [DI], AL',
      'INC SI',
      'INC DI',
      'DEC CX',
      'CMP CX, 0',
      'JNE CPY',
      'HLT',
    ].join('\n');

    const probe: Probe = {
      seed: copySeed,
      address: BUFFER,
      length: 8,
    };

    // Eight characters copied, and on the legacy they are all correct: each
    // store's stray zero is overwritten by the next store's data.
    expect(asText(readLegacy(source, probe))).toBe('abcdefgh');
    expect(asText(readV2(source, probe))).toBe('abcdefgh');
  });

  it('zeroes the byte just past the end of a forward copy on the legacy', () => {
    const source = [
      `MOV SI, ${(BUFFER - 8).toString(16)}h`,
      `MOV DI, ${BUFFER.toString(16)}h`,
      'MOV CX, 8',
      'CPY:',
      'MOV AL, [SI]',
      'MOV [DI], AL',
      'INC SI',
      'INC DI',
      'DEC CX',
      'CMP CX, 0',
      'JNE CPY',
      'HLT',
    ].join('\n');

    const probe: Probe = {
      seed: copySeed,
      // The last byte copied, and the two bytes after it.
      address: BUFFER + 7,
      length: 3,
    };

    expect(readLegacy(source, probe)).toEqual([104, 0, 255]);
    expect(readV2(source, probe)).toEqual([104, 255, 255]);
  });
});