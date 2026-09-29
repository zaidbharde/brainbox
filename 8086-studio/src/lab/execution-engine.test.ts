/**
 * The engine switch is only worth having if the two engines are genuinely
 * interchangeable from the caller's side. These tests check that from the outside:
 * that both answer the same interface, that they agree about the programs they
 * both support, and that choosing an engine is decided in one place.
 *
 * The flag divergence is deliberate and tested in the engine's own conformance
 * suite, so it is not re-litigated here. Nor are the two differences recorded in
 * `where the engines genuinely differ` below: those are real, they are known, and
 * pretending otherwise would be the actual defect.
 */

import { describe, it, expect } from 'vitest';
import {
  createSession,
  engineFromQuery,
  withEngineInQuery,
  type EngineId,
} from '@/lab/execution-engine';
import type { DebugSession } from '@/lab/execution-engine';

/** Assemble and step, failing loudly if the program did not assemble. */
function session(engine: EngineId, source: string): DebugSession {
  const { session: created, diagnostics } = createSession(engine, source);
  if (created === null) throw new Error(`assembly failed: ${JSON.stringify(diagnostics)}`);
  return created;
}

/** Step to completion and return the session, for reading the final state. */
function runToEnd(engine: EngineId, source: string, limit = 500): DebugSession {
  const s = session(engine, source);
  for (let i = 1; i <= limit && !s.isFinished(); i++) s.step(i, 0);
  return s;
}

/** Every character printed by a program, in order. */
function printed(engine: EngineId, source: string, limit = 20): string {
  const s = session(engine, source);
  const out: string[] = [];
  for (let i = 1; i <= limit && !s.isFinished(); i++) {
    for (const entry of s.step(i, 0).output) {
      out.push(entry.type === 'char' ? String.fromCharCode(entry.value) : String(entry.value));
    }
  }
  return out.join('');
}

const ENGINES: EngineId[] = ['legacy', 'v2'];
const PRINT_PROGRAM = ['MOV DX, msg', 'MOV AH, 09h', 'INT 21h', 'HLT', 'msg DB "Ok$"'].join('\n');

describe('engineFromQuery', () => {
  it('selects the new engine only for engine=v2', () => {
    expect(engineFromQuery('?engine=v2')).toBe('v2');
  });

  it('falls back to the legacy engine for anything else', () => {
    // Including a value that merely looks right: the lab has always run the
    // legacy engine, so an unrecognised parameter must not change what executes.
    expect(engineFromQuery('')).toBe('legacy');
    expect(engineFromQuery('?engine=legacy')).toBe('legacy');
    expect(engineFromQuery('?engine=V2')).toBe('legacy');
    expect(engineFromQuery('?engine=2')).toBe('legacy');
    expect(engineFromQuery('?engine=')).toBe('legacy');
    expect(engineFromQuery('?other=engine%3Dv2')).toBe('legacy');
  });

  it('round-trips through withEngineInQuery', () => {
    for (const engine of ENGINES) {
      expect(engineFromQuery(withEngineInQuery('', engine))).toBe(engine);
    }
  });

  it('keeps other parameters, and leaves no stray ? behind', () => {
    expect(withEngineInQuery('', 'v2')).toBe('?engine=v2');
    expect(withEngineInQuery('?engine=v2', 'legacy')).toBe('');
    expect(withEngineInQuery('?tab=code', 'v2')).toBe('?tab=code&engine=v2');
    expect(engineFromQuery(withEngineInQuery('?engine=v2', 'legacy'))).toBe('legacy');
  });
});

describe('createSession', () => {
  it('returns no session and the diagnostics when the source does not assemble', () => {
    for (const engine of ENGINES) {
      const { session: created, diagnostics } = createSession(engine, 'MOV AX, no_such_label\n');
      expect(created).toBeNull();
      expect(diagnostics.length).toBeGreaterThan(0);
      expect(diagnostics[0].line).toBe(1);
    }
  });

  it('accepts a program on either engine', () => {
    for (const engine of ENGINES) {
      const { session: created, diagnostics } = createSession(engine, 'MOV AX, 1\nHLT\n');
      expect(created).not.toBeNull();
      expect(diagnostics).toEqual([]);
    }
  });
});

describe.each(ENGINES)('%s session', (engine) => {
  it('reports state in the lab shape', () => {
    const state = session(engine, 'MOV AX, 1234h\nHLT\n').state;

    expect(state.halted).toBe(false);
    expect(state.memory).toBeInstanceOf(Uint8Array);
    // Every register the panels read is present and a 16-bit number.
    for (const name of ['AX', 'BX', 'CX', 'DX', 'SP', 'BP', 'SI', 'DI', 'IP', 'FLAGS'] as const) {
      expect(typeof state.registers[name]).toBe('number');
      expect(state.registers[name]).toBeLessThan(0x10000);
    }
  });

  it('stops when the program halts', () => {
    const s = runToEnd(engine, 'MOV AX, 1\nHLT\n');
    expect(s.isFinished()).toBe(true);
    expect(s.state.halted).toBe(true);
  });

  it('advances exactly one instruction per step', () => {
    const s = session(engine, 'MOV AX, 1\nMOV BX, 2\nMOV CX, 3\nHLT\n');

    s.step(1, 0);
    expect(s.state.registers.AX).toBe(1);
    expect(s.state.registers.BX).toBe(0);
    s.step(2, 0);
    expect(s.state.registers.BX).toBe(2);
    expect(s.state.registers.CX).toBe(0);
  });

  it('reports the memory a step touched as word addresses', () => {
    const s = session(engine, 'MOV BX, 1234h\nMOV [0200h], BX\nHLT\n');
    s.step(1, 0);
    const write = s.step(2, 0);

    expect(write.changedMemoryWords).toEqual([0x200]);
    expect(write.memoryWrites).toEqual([0x200]);
    const memory = s.state.memory;
    expect(memory[0x200] | (memory[0x201] << 8)).toBe(0x1234);
  });

  it('runs a print-string program to completion without erroring', () => {
    const s = runToEnd(engine, PRINT_PROGRAM);
    expect(s.state.halted).toBe(true);
    expect(s.state.error).toBeFalsy();
  });
});

describe('the two engines agree where both are defined', () => {
  // 200h, not 100h: the new engine loads a .COM image at 100h, so code lives
  // there and storing to 100h would overwrite the program.
  const program = [
    'MOV AX, 0007h',
    'MOV BX, 0003h',
    'ADD AX, BX',
    'MOV [0200h], AX',
    'DEC CX',
    'MOV CL, 40h',
    'HLT',
  ].join('\n');

  it('computes the same registers', () => {
    const legacy = runToEnd('legacy', program).state;
    const v2 = runToEnd('v2', program).state;

    expect(v2.registers.AX).toBe(10);
    expect(v2.registers.BX).toBe(3);
    // CX starts at 0 in both engines, so DEC CX wraps it to FFFFh and MOV CL,
    // 40h then replaces the low byte: FF40h, not 3Fh.
    expect(v2.registers.CX).toBe(0xff40);
    for (const name of ['AX', 'BX', 'CX', 'DX', 'SI', 'DI'] as const) {
      expect(v2.registers[name]).toBe(legacy.registers[name]);
    }
  });

  it('stores data at the same address', () => {
    // `MOV [0200h], AX` is opcode A3, a direct memory offset rather than a
    // ModR/M form. The new engine used to drop that store and leave 0200h
    // empty, which is exactly the kind of difference this block exists to see.
    expect(runToEnd('v2', program).state.memory[0x200] | (runToEnd('v2', program).state.memory[0x201] << 8)).toBe(10);
    expect(
      runToEnd('legacy', program).state.memory[0x200] | (runToEnd('legacy', program).state.memory[0x201] << 8),
    ).toBe(10);
  });

  it('matches after a balanced PUSH and POP', () => {
    const source = 'MOV AX, 1234h\nPUSH AX\nPOP BX\nHLT\n';
    const legacy = runToEnd('legacy', source).state;
    const v2 = runToEnd('v2', source).state;

    expect(v2.registers.BX).toBe(0x1234);
    expect(v2.registers.BX).toBe(legacy.registers.BX);
  });

  it('takes the same number of steps to finish', () => {
    const stepsFor = (engine: EngineId): number => {
      const s = session(engine, program);
      let n = 0;
      while (!s.isFinished() && n < 500) {
        s.step(n + 1, 0);
        n++;
      }
      return n;
    };
    expect(stepsFor('v2')).toBe(stepsFor('legacy'));
  });
});

describe('where the engines genuinely differ', () => {
  // Each of these is a real difference in the two engines' models rather than a
  // defect in the adapter. They are pinned here so that a change to either engine
  // which quietly removes one of them is noticed, and so that nobody has to
  // rediscover them from the debugger.

  it('numbers IP differently: the legacy counts instructions, the new engine uses addresses', () => {
    const legacy = session('legacy', 'MOV AX, 1\nHLT\n');
    const v2 = session('v2', 'MOV AX, 1\nHLT\n');

    expect(legacy.state.registers.IP).toBe(0);
    expect(v2.state.registers.IP).toBe(0x100);
    // And the two step by different amounts, since their instructions differ.
    legacy.step(1, 0);
    v2.step(1, 0);
    expect(legacy.state.registers.IP).toBe(1);
    expect(v2.state.registers.IP).toBe(0x103);
  });

  it('sizes memory differently: 4 KB flat against a 64 KB segment', () => {
    expect(session('legacy', 'HLT\n').state.memory.length).toBe(4096);
    expect(session('v2', 'HLT\n').state.memory.length).toBe(0x10000);
  });

  it('reports printed text only on the new engine, which fixes a legacy gap', () => {
    // The legacy's step diagnostics know only about OUT and OUTC, so DOS print
    // string shows nothing in the output panel even though a whole-program run
    // collects it. The legacy is left alone deliberately, so this records the
    // difference instead of pretending the two match.
    expect(printed('v2', PRINT_PROGRAM)).toBe('Ok');
    expect(printed('legacy', PRINT_PROGRAM)).toBe('');
  });

  it('maps hand-written assembly to source lines only on the new engine', () => {
    // The legacy's source map is built from `_SRC_` labels emitted by the
    // structured compiler, so for assembly typed into the editor it is empty and
    // the editor highlights nothing. The new assembler reports every statement
    // as it emits it, so the same source is mapped with no preprocessing.
    const source = 'MOV AX, 1\nMOV BX, 2\nHLT\n';
    expect(session('v2', source).sourceLineAt(0x100)).toBe(1);
    expect(session('legacy', source).sourceLineAt(0)).toBeNull();
  });
});
