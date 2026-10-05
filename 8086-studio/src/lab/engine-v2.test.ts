/**
 * The adapter is the seam where two very different engines are made to look like
 * one, so these tests care less about the 8086 (which the CPU's own tests already
 * cover thoroughly) and more about the translation itself: that stepping produces
 * the shapes the lab consumes, and that nothing is lost or invented on the way.
 */

import { describe, it, expect } from 'vitest';
import { V2Session, assembleV2, buildV2SourceMap, findV2SourceLine, programReadsInput } from '@/lab/engine-v2';
import type { V2SourceMapEntry } from '@/lab/engine-v2';

/** Assemble and step, failing loudly if the program did not even assemble. */
function session(source: string): V2Session {
  const { session: created, assembly } = V2Session.create(source);
  if (created === null) throw new Error(`assembly failed: ${JSON.stringify(assembly.diagnostics)}`);
  return created;
}

/** The flags word, for comparing against the legacy's. */
function flagsOf(state: { registers: { FLAGS: number } }): number {
  return state.registers.FLAGS;
}

describe('V2Session', () => {
  it('reports state in the lab shape, with a flat memory the views can index', () => {
    const s = session('MOV AX, 1234h\nHLT\n');
    const state = s.state;

    expect(state.registers.IP).toBe(0x100);
    // 64 KB: one segment, so the lab's SP-relative and 0100h views both work.
    expect(state.memory).toBeInstanceOf(Uint8Array);
    expect(state.memory.length).toBe(0x10000);
    // The code is really there, at the entry point the lab has always used.
    expect(state.memory[0x100]).toBe(0xb8);
    expect(state.halted).toBe(false);
    expect(state.error).toBeNull();
  });

  it('starts at the first instruction, not the load address, for data-first programs', () => {
    // Four bytes of data, then code. Entry must land on the MOV, at 104h.
    const s = session('DB 1, 2, 3, 4\nMOV AX, 5\nHLT\n');

    expect(s.entryIp).toBe(0x104);
    s.step(1, 0);
    expect(s.state.registers.AX).toBe(5);
  });

  it('steps one instruction and reports what changed', () => {
    const s = session('MOV AX, 1234h\nHLT\n');
    const diagnostics = s.step(1, 0);

    expect(diagnostics.nextState.registers.AX).toBe(0x1234);
    expect(diagnostics.changedRegisters).toContain('AX');
    expect(diagnostics.changedRegisters).toContain('IP');
    expect(diagnostics.traceEntry.instructionAddress).toBe(0x100);
    expect(diagnostics.traceEntry.ipAfter).toBe(0x103);
    expect(diagnostics.traceEntry.instructionText).toBe('MOV AX, 1234h');
  });

  it('names the flags that flipped, and only those', () => {
    const s = session('MOV AX, 0\nADD AX, 0\nHLT\n');
    const first = s.step(1, 0);
    // MOV sets no flags, so nothing should be reported as changed.
    expect(first.changedFlags).toEqual([]);

    const add = s.step(2, 0);
    // Adding zero to zero gives zero: ZF because it is zero, PF because a zero
    // byte has even parity, and neither CF, AF, SF nor OF because nothing was
    // carried, borrowed or made negative.
    expect(add.changedFlags).toEqual(['PF', 'ZF']);
  });

  it('produces the correct 8-bit sign flag the legacy gets wrong', () => {
    // 7Fh + 1 = 80h, an 8-bit result that is negative. The legacy computes SF
    // from the full 16-bit result, where 128 is positive, so it clears SF here.
    const s = session('MOV AL, 7Fh\nADD AL, 1\nHLT\n');
    s.step(1, 0);
    s.step(2, 0);

    const flags = flagsOf(s.state);
    expect(s.state.registers.AX & 0xff).toBe(0x80);
    expect((flags >> 7) & 1).toBe(1);
    // And the 16-bit result really was positive, which is the legacy's mistake.
    expect((flags >> 15) & 1).toBe(0);
  });

  it('reports the memory words an instruction touched', () => {
    // MOV [0100h], BX writes two bytes, which is one word.
    const s = session('MOV BX, 1234h\nMOV [0100h], BX\nHLT\n');
    s.step(1, 0);
    const write = s.step(2, 0);

    expect(write.changedMemoryWords).toEqual([0x100]);
    expect(write.memoryWrites).toEqual([0x100]);
    // The first operand is a register, so nothing was read from memory.
    expect(write.memoryReads).toEqual([]);

    // And the value really landed where the panel says it did.
    const memory = s.state.memory;
    expect(memory[0x100] | (memory[0x101] << 8)).toBe(0x1234);
  });

  it('resolves a computed address the way the instruction really used it', () => {
    // The address depends on BX at the moment it runs, so this cannot be worked
    // out from the operand text alone.
    const s = session('MOV BX, 0200h\nMOV WORD [BX], 0ABCDh\nHLT\n');
    s.step(1, 0);
    const write = s.step(2, 0);

    expect(write.memoryWrites).toEqual([0x200]);
    const memory = s.state.memory;
    expect(memory[0x200] | (memory[0x201] << 8)).toBe(0xabcd);
  });

  it('reports stack accesses for PUSH and does not report a fetch as a read', () => {
    const s = session('PUSH AX\nHLT\n');
    const push = s.step(1, 0);

    // PUSH decrements SP first, then stores, so the word lands at FFFCh. It
    // reads no memory at all, and must not report its own bytes as data.
    expect(push.memoryWrites).toEqual([0xfffc]);
    expect(push.memoryReads).toEqual([]);
  });

  it('reports only what each step printed, not the whole run so far', () => {
    const s = session('MOV DX, msg\nMOV AH, 09h\nINT 21h\nHLT\nmsg DB "Hi$"\n');
    s.step(1, 0);
    s.step(2, 0);
    const interrupt = s.step(3, 0);

    expect(interrupt.output).toEqual([{ type: 'char', value: 72 }, { type: 'char', value: 105 }]);

    // The text really is the string DX was pointing at, and the '$' was not
    // printed: the engine stopped at the terminator rather than running on.
    const memory = s.state.memory;
    const start = s.state.registers.DX;
    expect(String.fromCharCode(memory[start], memory[start + 1], memory[start + 2])).toBe('Hi$');

    // The step after must not report the same text again: output is per step,
    // and a panel that appended both would show every string once per remaining
    // step of the program.
    expect(s.step(4, 0).output).toEqual([]);
  });

  it('halts with a message rather than throwing on an undecodable instruction', () => {
    // 60h is PUSHA on an 80186 and unassigned on an 8086, so a data-only
    // program built from it has nothing to execute. The step must report that,
    // not throw or run on. (06h used to be used here, on the belief that it was
    // unassigned too; it is `PUSH ES`, so it is a real instruction to run.)
    const s = session('DB 60h\n');
    const diagnostics = s.step(1, 0);

    expect(diagnostics.nextState.halted).toBe(true);
    expect(diagnostics.nextState.error).toBeTruthy();
  });

  it('refreshes the memory view from the engine, so edits to it cannot corrupt a run', () => {
    // Worth pinning: the views hold this array between renders, so it is a
    // stable object rather than a fresh copy each read. It is the engine's memory
    // only as a mirror, and every step rewrites it from the real thing.
    const s = session('MOV AX, 1234h\nHLT\n');
    s.step(1, 0);

    s.state.memory[0x100] = 0x90;
    s.step(2, 0);

    expect(s.state.memory[0x100]).toBe(0xb8);
  });

  it('maps an address back to the source line it came from', () => {
    const s = session('MOV AX, 1\nMOV BX, 2\nMOV CX, 3\nHLT\n');

    // MOV AX,1 is 3 bytes at 100h; MOV BX,2 at 103h; MOV CX,3 at 106h.
    expect(s.sourceLineAt(0x100)).toBe(1);
    expect(s.sourceLineAt(0x103)).toBe(2);
    expect(s.sourceLineAt(0x106)).toBe(3);
    expect(s.sourceLineAt(0x2000)).toBeNull();
  });

  it('reports assembly errors instead of running anything', () => {
    const { session: created, assembly } = V2Session.create('MOV AX, undefined_label\n');
    expect(created).toBeNull();
    expect(assembly.diagnostics.length).toBeGreaterThan(0);
    expect(assembly.diagnostics[0].line).toBe(1);
  });
});

describe('buildV2SourceMap', () => {
  it('gives each statement a span ending where the next one begins', () => {
    const { assembly } = V2Session.create('MOV AX, 1\nMOV BX, 2\nHLT\n');
    const lines = assembly.sourceMap.map((entry) => entry.sourceLine);

    expect(lines).toEqual([1, 2, 3]);
    expect(assembly.sourceMap[0].instructionStart).toBe(0x100);
    expect(assembly.sourceMap[0].instructionEnd).toBe(0x102);
    expect(assembly.sourceMap[1].instructionStart).toBe(0x103);
  });

  it('stops the last statement at the end of the emitted segment', () => {
    // One byte of code at 100h, so that byte is all the last line claims. An
    // address past the program belongs to no line, rather than to the final line
    // of the file.
    const { assembly } = V2Session.create('HLT\n');
    expect(assembly.sourceMap[0].instructionStart).toBe(0x100);
    expect(assembly.sourceMap[0].instructionEnd).toBe(0x100);
  });

  it('keeps segments apart, so the same offset in two of them is not conflated', () => {
    const map = buildV2SourceMap([
      { line: 1, segment: 'CODE', offset: 0 },
      { line: 2, segment: 'CODE', offset: 2 },
      { line: 3, segment: 'DATA', offset: 0 },
    ]);

    expect(findV2SourceLine(map, 'CODE', 0)).toBe(1);
    expect(findV2SourceLine(map, 'CODE', 2)).toBe(2);
    expect(findV2SourceLine(map, 'DATA', 0)).toBe(3);
    expect(findV2SourceLine(map, 'CODE', 0)).not.toBe(3);
  });

  it('returns null for an address no statement covers', () => {
    const map: V2SourceMapEntry[] = [{ sourceLine: 1, segment: 'CODE', instructionStart: 0x100, instructionEnd: 0x102 }];
    expect(findV2SourceLine(map, 'CODE', 0x103)).toBeNull();
    expect(findV2SourceLine([], 'CODE', 0x100)).toBeNull();
  });
});

describe('programReadsInput, which decides whether Run asks', () => {
  /** Whether this program would get the line prompt. */
  const readsInput = (source: string): boolean => programReadsInput(assembleV2(source));

  it('finds the DOS character and line reads', () => {
    expect(readsInput('MOV AH, 1\nINT 21h\nHLT')).toBe(true);
    expect(readsInput('MOV AH, 7\nINT 21h\nHLT')).toBe(true);
    expect(readsInput('MOV AH, 8\nINT 21h\nHLT')).toBe(true);
    expect(readsInput('MOV DX, 200h\nMOV AH, 0Ah\nINT 21h\nHLT')).toBe(true);
    // AX set as a whole counts too: the service is its high byte.
    expect(readsInput('MOV AX, 0100h\nINT 21h\nHLT')).toBe(true);
  });

  it('finds the BIOS keyboard reads, however AH was set', () => {
    expect(readsInput('MOV AH, 0\nINT 16h\nHLT')).toBe(true);
    expect(readsInput('XOR AH, AH\nINT 16h\nHLT')).toBe(true);
    expect(readsInput('MOV AH, 1\nINT 16h\nHLT')).toBe(true);
  });

  it('does not ask a program that only prints, exits or reads a port', () => {
    // INT 21h is how programs print and exit, so the vector on its own is not
    // a reason to prompt — only the read services are.
    expect(readsInput("MOV DX, msg\nMOV AH, 09h\nINT 21h\nmsg DB 'ok$'\nHLT")).toBe(false);
    expect(readsInput('MOV AX, 4C00h\nINT 21h')).toBe(false);
    expect(readsInput('IN AL, 30h\nHLT')).toBe(false);
  });

  it('asks when AH cannot be known, rather than miss a reader', () => {
    // The failure is asymmetric on purpose: one prompt for a program that will
    // not read is a dialog to dismiss, while not asking a program that will
    // reads zero again — the silent defect this whole mechanism exists to end.
    expect(readsInput('MOV AH, BL\nINT 21h\nHLT')).toBe(true);
  });

  it('follows branches and calls, so a read off the first path is still found', () => {
    expect(
      readsInput('CMP AX, 0\nJZ read\nMOV AX, 4C00h\nINT 21h\nread:\n  MOV AH, 1\n  INT 21h\n  HLT'),
    ).toBe(true);
    expect(
      readsInput('CALL reader\nMOV AX, 4C00h\nINT 21h\nreader:\n  MOV AH, 1\n  INT 21h\n  RET'),
    ).toBe(true);
  });

  it('stops where the program stops, so bytes after it are not code', () => {
    // The bytes of data are arbitrary; decoded as instructions they can be
    // exactly `MOV AH, 01h; INT 21h` — a read service the program never
    // calls. Stopping at the exit service and at HLT is what keeps that out.
    expect(readsInput('MOV AX, 4C00h\nINT 21h\nmsg DB 0B4h, 01h, 0CDh, 21h')).toBe(false);
    expect(readsInput('MOV AH, 09h\nINT 21h\nHLT\nmsg DB 0B4h, 01h, 0CDh, 21h')).toBe(false);
  });

  it('follows a jump over data instead of walking into it', () => {
    // The data is a read service in disguise; only the jump target's path is
    // real code, and it only prints.
    expect(readsInput('JMP run\nmsg DB 0B4h, 01h, 0CDh, 21h\nrun:\n  MOV AH, 09h\n  INT 21h\n  HLT')).toBe(
      false,
    );
  });

  it('starts where execution starts, not where the program was loaded', () => {
    // Data before the first instruction is the same disguise as data after
    // it. The entry point is the first instruction, so the walk begins past
    // it — begin at the load address instead and the program's own print call
    // would be reached with AH left over from the data.
    expect(readsInput('msg DB 0B4h, 01h, 0CDh, 21h\nMOV AH, 09h\nINT 21h\nHLT')).toBe(false);
  });
});
