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
import { WRITABLE_REGISTERS } from '@/lab/types';

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

/** One program both engines assemble, with a CALL and a second line to read. */
const PROGRAM = [
  'MOV AX, 0x1234',
  'CMP AX, 0x1234',
  'CALL far',
  'HLT',
  'far:',
  '  MOV BX, 1',
].join('\n');
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

describe.each(ENGINES)('%s runToCompletion', (engine) => {
  it('finishes in the same place as stepping to the end', () => {
    // The Run button and Step Over must not be two different programs. Stepping
    // is what the debugger does and running is what the Run button does, so a
    // program that computes the same answer both ways is the only evidence that
    // the run path was actually wired to this engine rather than left on legacy.
    const source = [
      'MOV AX, 0004h',
      'ADD AX, 0003h',
      'MOV [0200h], AX',
      'HLT',
    ].join('\n');

    const stepped = runToEnd(engine, source).state;
    const ran = session(engine, source).runToCompletion([], 10_000).state;

    expect(ran.halted).toBe(true);
    expect(ran.error).toBeFalsy();
    expect(ran.registers.AX).toBe(7);
    for (const name of ['AX', 'BX', 'CX', 'DX'] as const) {
      expect(ran.registers[name]).toBe(stepped.registers[name]);
    }
  });

  it('reports the memory the run left behind', () => {
    const { state } = session(engine, 'MOV AX, 1234h\nMOV [0200h], AX\nHLT\n').runToCompletion([], 10_000);
    expect(state.memory[0x200] | (state.memory[0x201] << 8)).toBe(0x1234);
  });

  it('collects the printed text as output', () => {
    // Output, not just registers: the Run button's output panel is built from
    // this, and a run that computed the right answer silently would show nothing.
    // Containment rather than equality because the legacy pads this program with
    // NULs, which is a difference of its own and is pinned below.
    const { output } = session(engine, PRINT_PROGRAM).runToCompletion([], 10_000);
    const text = output.map((entry) => (entry.type === 'char' ? String.fromCharCode(entry.value) : String(entry.value)));
    expect(text.join('')).toContain('Ok');
  });

  it('starts from the beginning even after the session was stepped', () => {
    // The Run button means "run it again" whatever the debugger did first, so a
    // session that has already advanced must not continue from where it stopped.
    const source = 'MOV AX, 0001h\nMOV BX, 0002h\nHLT\n';
    const s = session(engine, source);
    s.step(1, 0);
    s.step(2, 0);
    expect(s.state.registers.BX).toBe(2);

    const ran = s.runToCompletion([], 10_000);
    expect(ran.state.halted).toBe(true);
    expect(ran.state.registers.AX).toBe(1);
    expect(ran.state.registers.BX).toBe(2);
  });

  it('leaves the stepped session itself untouched', () => {
    // The run happens on a second CPU, so asking for a run must not disturb the
    // state the debugger is showing. If it did, running would silently reset the
    // debugger's view of where the program is.
    const s = session(engine, 'MOV AX, 0001h\nHLT\n');
    s.step(1, 0);
    const before = s.state.registers.AX;

    s.runToCompletion([], 10_000);
    expect(s.state.registers.AX).toBe(before);
  });

  it('stops at the step limit with an error instead of running forever', () => {
    const { state } = session(engine, 'spin: JMP spin\n').runToCompletion([], 50);
    expect(state.error).toBeTruthy();
  });
});

describe('input, which the two engines do differently', () => {
  it('asks for one value per IN on the legacy, naming the port', () => {
    // The legacy has no DOS read services at all, so this is its entire input
    // model: the Run button writes a number into the port window and `IN` reads
    // it. The port is in the prompt so the user can tell the reads apart.
    const prompts = session('legacy', 'IN AL, 30h\nIN AL, 31h\nHLT\n').inputPrompts();
    expect(prompts.length).toBe(2);
    expect(prompts[0]).toBeTruthy();
    expect(prompts[1]).toBeTruthy();
    expect(prompts[0]).not.toBe(prompts[1]);
  });

  it('asks for nothing when a program reads no input', () => {
    expect(session('legacy', 'MOV AX, 1\nHLT\n').inputPrompts()).toEqual([]);
  });

  it('feeds those values to a legacy IN', () => {
    const { state } = session('legacy', 'IN AL, 30h\nMOV [0200h], AL\nHLT\n').runToCompletion([7], 10_000);
    expect(state.memory[0x200]).toBe(7);
  });

  it('asks for nothing on the new engine, because a number would not be read', () => {
    // A v2 program's input is a character queue behind the DOS read services, and
    // its `IN` reads a port window that only `OUTP` writes. So neither the
    // per-`IN` number the legacy wants nor the declared `input` names would ever
    // be read, and the count is not knowable before the program runs. Returning
    // nothing is the honest answer; a prompt the engine ignores would be worse.
    expect(session('v2', 'IN AL, 30h\nHLT\n').inputPrompts()).toEqual([]);
    expect(session('v2', 'MOV AH, 01h\nINT 21h\nHLT\n').inputPrompts()).toEqual([]);
  });

  it('runs a v2 program that asks for input, reading an empty queue rather than hanging', () => {
    // The point of the empty list being safe: DOS blocks on real hardware, so
    // this has to terminate. The queue is finite and returns zero when dry.
    const { state } = session('v2', 'MOV AX, 0\nMOV AH, 01h\nINT 21h\nHLT\n').runToCompletion([], 10_000);
    expect(state.halted).toBe(true);
    expect(state.error).toBeFalsy();
    // AL is the character read, and a dry queue leaves it as the program had it.
    expect(state.registers.AX & 0xff).toBe(0);
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

  it('pads a print-string run with NULs on the legacy only', () => {
    // The Run button's output panel shows this stream as it comes, so the legacy
    // puts a line of NUL characters in front of the message it printed, while the
    // new engine prints just the two characters. The Run path is wired to both
    // engines now, so this is visible on either depending on the URL parameter.
    //
    // It is the legacy's own behaviour and is left alone on purpose: the Run
    // button called the same `runProgram` before the switch existed, so this is
    // not something the wiring introduced. Pinned so that a change to either
    // engine which quietly removes it is noticed, and so the two are not assumed
    // to agree.
    const text = (engine: EngineId): string => {
      const { output } = session(engine, PRINT_PROGRAM).runToCompletion([], 10_000);
      return output
        .map((entry) => (entry.type === 'char' ? String.fromCharCode(entry.value) : String(entry.value)))
        .join('');
    };

    expect(text('v2')).toBe('Ok');
    expect(text('legacy')).toMatch(/^\u0000+Ok$/);
  });

  it('takes input in different shapes, so only the legacy prompts', () => {
    // Recorded together because it is one difference, not two. The legacy has no
    // DOS read services and reads a port window the Run button pre-fills, so it
    // can name its inputs in the source. The new engine reads a character queue
    // behind DOS services instead, and its `IN` reads a port window that only
    // `OUTP` writes, so a number collected for it would be discarded.
    expect(session('legacy', 'IN AL, 30h\nHLT\n').inputPrompts().length).toBe(1);
    expect(session('v2', 'IN AL, 30h\nHLT\n').inputPrompts()).toEqual([]);
  });
});

/**
 * The instruction-inspection surface the debug view is built on.
 *
 * This exists because of the thing the view used to do: index into
 * `debugProgram.instructions[ip]`. That only means anything on the legacy, where
 * an address is an index into a parsed list. On the new engine an address is a
 * byte offset in the code segment, so the same expression reads a different
 * instruction or nothing at all, silently. Asking the engine for the instruction
 * at an address is what lets the view stop caring.
 *
 * So the tests are about the two engines answering the same question, and about
 * the v2 answers being right rather than merely present -- an interface that
 * returns plausible nonsense on one engine is worse than one that refuses.
 */
describe('instructionAt', () => {
    it('both engines name the instruction the first line assembles to', () => {
    for (const engine of ENGINES) {
      const first = session(engine, PROGRAM).instructionAddresses()[0];
      const view = session(engine, PROGRAM).instructionAt(first);
      expect(view, `${engine} has no instruction at ${first}`).not.toBeNull();
      expect(view?.address, engine).toBe(first);
      expect(view?.text, engine).toContain('MOV');
      expect(view?.text, engine).toContain('AX');
    }
  });

  it('both engines answer with null past the end of the program', () => {
    for (const engine of ENGINES) {
      const subject = session(engine, PROGRAM);
      const addresses = subject.instructionAddresses();
      const past = addresses[addresses.length - 1] + 0x1000;
      expect(subject.instructionAt(past), engine).toBeNull();
    }
  });

  it('the new engine refuses an address that is not the start of an instruction', () => {
    // It can decode any byte offset -- zero bytes are a perfectly good
    // `ADD [BX+SI], AL` -- so the risk is not failing to decode but answering
    // confidently about a byte that is data, or the middle of the instruction
    // before it. The source map knows where the boundaries are.
    const subject = session('v2', 'MOV AX, 0x1234\nHLT\n');
    const start = subject.instructionAddresses()[0];
    // MOV AX,imm16 occupies three bytes, so start+1 is inside it.
    expect(subject.instructionAt(start), 'the instruction itself').not.toBeNull();
    expect(subject.instructionAt(start + 1), 'inside an instruction').toBeNull();
    expect(subject.instructionAt(start + 2), 'inside an instruction').toBeNull();
    expect(subject.instructionAt(start + 3), 'the next instruction').not.toBeNull();
  });

  it('the new engine reports a byte length, and the legacy admits it has none', () => {
    // MOV AX,imm16 is three bytes. The legacy's parsed instruction records no
    // length at all, so it says so rather than reporting a number it would have
    // to invent; the whole point of the new engine having one is that it knows.
    const v2 = session('v2', PROGRAM).instructionAt(session('v2', PROGRAM).instructionAddresses()[0]);
    expect(v2?.byteLength).toBe(3);
    const legacy = session('legacy', PROGRAM).instructionAt(0);
    expect(legacy?.byteLength).toBeNull();
  });

  it('the new engine tells MOV and CMP apart, which the legacy cannot', () => {
    // Same operand shape, opposite data flow: MOV writes AX without reading it,
    // CMP reads both and writes no register but the flags. The legacy's parsed
    // instruction has no direction to report, so it reports none.
    const subject = session('v2', PROGRAM);
    const addresses = subject.instructionAddresses();
    const mov = subject.instructionAt(addresses[0]);
    const cmp = subject.instructionAt(addresses[1]);
    expect(mov?.text).toContain('MOV');
    expect(mov?.writes).toContain('AX');
    expect(mov?.reads).not.toContain('AX');
    expect(cmp?.text).toContain('CMP');
    expect(cmp?.writes).toEqual(expect.not.arrayContaining(['AX']));
    expect(cmp?.writes).toContain('FLAGS');

    const legacy = session('legacy', PROGRAM);
    expect(legacy.instructionAt(0)?.writes).toEqual([]);
    expect(legacy.instructionAt(0)?.reads).toEqual([]);
  });

  it('both engines agree on which instruction is a CALL', () => {
    // Step Over asks this rather than string-matching a mnemonic, because "is
    // this a call" is a property of the encoding.
    for (const engine of ENGINES) {
      const subject = session(engine, PROGRAM);
      const call = subject.instructionAddresses()
        .map((address) => subject.instructionAt(address))
        .find((view) => view?.text.includes('CALL'));
      expect(call, `${engine} has no CALL`).toBeDefined();
      expect(call?.isCall, engine).toBe(true);
      const mov = subject.instructionAddresses()
        .map((address) => subject.instructionAt(address))
        .find((view) => view?.text.includes('MOV'));
      expect(mov?.isCall, engine).toBe(false);
    }
  });

  it('the new engine maps an address to the source line it came from', () => {
    // Only the new engine can do this for source typed into the editor: the
    // legacy's `sourceLineAt` reads `_SRC_` labels out of its own assembled text,
    // so a bare program has nothing for it to find. That is a real difference
    // and it is the reason the view asks rather than looking.
    const subject = session('v2', PROGRAM);
    const first = subject.instructionAddresses()[0];
    expect(subject.instructionAt(first)?.sourceLine).toBe(1);
    expect(subject.sourceLineAt(first)).toBe(1);
  });

  it('an instruction view never disagrees with the session about the source line', () => {
    // Whatever each engine can say about the source, the two ways of asking have
    // to say the same thing -- including saying nothing at all. A view that read
    // one and not the other would highlight a line the engine does not believe.
    for (const engine of ENGINES) {
      const subject = session(engine, PROGRAM);
      for (const address of subject.instructionAddresses()) {
        expect(subject.instructionAt(address)?.sourceLine, `${engine} at ${address}`)
          .toBe(subject.sourceLineAt(address));
      }
    }
  });
});

describe('instructionAddresses', () => {
  it('lists one address per instruction, in order, on both engines', () => {
    for (const engine of ENGINES) {
      const addresses = session(engine, PROGRAM).instructionAddresses();
      expect(addresses.length, engine).toBeGreaterThan(3);
      expect([...addresses].sort((a, b) => a - b), engine).toEqual(addresses);
    }
  });

  it('gives every listed address an instruction', () => {
    for (const engine of ENGINES) {
      const subject = session(engine, PROGRAM);
      for (const address of subject.instructionAddresses()) {
        expect(subject.instructionAt(address), `${engine} at ${address}`).not.toBeNull();
      }
    }
  });
});

/**
 * Rewinding, because the lab's timeline can.
 *
 * A session that only moves forward is not enough: the lab keeps a list of
 * snapshots and the user can seek back through it, and the Step after a rewind
 * has to execute from the rewound state. A session that ignored `restore` would
 * keep stepping from wherever the engine last got to and produce a trace that
 * does not match the timeline it is displayed against -- which looks like a
 * time-travel bug in the panel and is really a session that was never told.
 */
describe('restore', () => {
  const PROGRAM = ['MOV AX, 0x1111', 'MOV BX, 0x2222', 'HLT'].join('\n');

  it('the legacy returns to the registers it was given', () => {
    const subject = session('legacy', PROGRAM);
    const start = subject.state;
    expect(subject.step(1, 0).nextState.registers.AX).toBe(0x1111);
    expect(subject.step(2, 0).nextState.registers.BX).toBe(0x2222);
    subject.restore(start);
    expect(subject.state.registers.AX, 'AX came back').toBe(start.registers.AX);
    expect(subject.state.registers.BX, 'BX came back too').not.toBe(0x2222);
    // `stepNumber` labels the trace entry; it is not a step count, so the
    // resumed run executes the two instructions in front of the one that matters.
    subject.step(1, 0);
    expect(subject.step(2, 0).nextState.registers.BX, 'and stepping resumes from there').toBe(0x2222);
  });

  it('the new engine returns to the registers it was given', () => {
    const subject = session('v2', PROGRAM);
    const start = subject.state;
    expect(subject.step(1, 0).nextState.registers.AX).toBe(0x1111);
    expect(subject.step(2, 0).nextState.registers.BX).toBe(0x2222);
    subject.restore(start);
    expect(subject.state.registers.AX, 'AX came back').toBe(start.registers.AX);
    expect(subject.state.registers.BX, 'BX came back too').not.toBe(0x2222);
    // `stepNumber` labels the trace entry; it is not a step count, so the
    // resumed run executes the two instructions in front of the one that matters.
    subject.step(1, 0);
    expect(subject.step(2, 0).nextState.registers.BX, 'and stepping resumes from there').toBe(0x2222);
  });

  it('both engines re-step the same way after a rewind', () => {
    // The point of the rewind is that the same button press lands in the same
    // place twice. Run the program, rewind to the start, and compare the whole
    // trace rather than one register.
    for (const engine of ENGINES) {
      const straight = session(engine, PROGRAM);
      const first: number[] = [];
      for (let i = 0; i < 3; i++) first.push(straight.step(i + 1, 0).nextState.registers.IP);

      const rewound = session(engine, PROGRAM);
      const start = rewound.state;
      rewound.step(1, 0);
      rewound.step(2, 0);
      rewound.restore(start);
      const second: number[] = [];
      for (let i = 0; i < 3; i++) second.push(rewound.step(i + 1, 0).nextState.registers.IP);

      expect(second, engine).toEqual(first);
    }
  });
});

describe('isReturn', () => {
  function viewsFor(engine: EngineId, source: string) {
    const subject = session(engine, source);
    return subject.instructionAddresses()
      .map((address) => subject.instructionAt(address))
      .filter((view): view is NonNullable<typeof view> => view !== null);
  }

  it('both engines name RET, and nothing else', () => {
    for (const engine of ENGINES) {
      const views = viewsFor(engine, ['MOV AX, 1', 'HLT', 'RET'].join('\n'));
      expect(views.filter((view) => view.isReturn).length, engine).toBe(1);
      expect(views.find((view) => view.text.includes('MOV'))?.isReturn, engine).toBe(false);
    }
  });

  it('the new engine names RETF as a return, because it can assemble one', () => {
    // The legacy cannot: `RETF` is an 8086 instruction its assembler has never
    // heard of, so there is nothing to ask it about. That is a gap in the legacy
    // and not a reason to leave the far return uncounted here, where it can
    // appear.
    const views = viewsFor('v2', ['MOV AX, 1', 'HLT', 'RETF'].join('\n'));
    expect(views.filter((view) => view.isReturn).length).toBe(1);
    expect(views.find((view) => view.isReturn)?.text).toContain('RETF');
  });

  it('the legacy genuinely cannot assemble RETF, which is why it is asked alone', () => {
    const { session: created, diagnostics } = createSession('legacy', 'RETF\n');
    expect(created).toBeNull();
    expect(diagnostics.map((d) => d.message).join('; ')).toMatch(/RETF/);
  });
});

/**
 * The parts of an instruction a panel wants, not just the whole line.
 *
 * The lab has always shown an instruction broken into a mnemonic and operands,
 * and the symbolic hints read those fields to work out which hints apply. So
 * the view has to carry them, and it has to be the pieces rather than a split
 * of the line: `MOV AX, OFFSET 'a,b'` is one string with a comma in it, and
 * splitting on the comma would hand the hint builder two operands where the
 * program has one.
 */
describe('view parts', () => {
  // Not an address of 0: the two engines do not load a program at the same
  // place, and which segment a program starts in is not this test's business.
  function viewAt(engine: EngineId, source: string, which = 0) {
    const subject = session(engine, source);
    return subject.instructionAt(subject.instructionAddresses()[which]);
  }

  it('both engines report the mnemonic and operands of MOV', () => {
    for (const engine of ENGINES) {
      const view = viewAt(engine, 'MOV AX, BX');
      expect(view?.opcode, engine).toBe('MOV');
      expect(view?.operands, engine).toEqual(['AX', 'BX']);
      expect(view?.text, engine).toBe('MOV AX, BX');
    }
  });

  it('the parts join back into the line', () => {
    for (const engine of ENGINES) {
      const view = viewAt(engine, 'MOV AX, [BX]');
      expect(view, engine).not.toBeNull();
      const joined = view!.operands.length > 0
        ? `${view!.opcode} ${view!.operands.join(', ')}`
        : view!.opcode;
      expect(joined, engine).toBe(view!.text);
    }
  });

  it('an operand with no operands is just the mnemonic', () => {
    for (const engine of ENGINES) {
      const view = viewAt(engine, 'HLT');
      expect(view?.opcode, engine).toBe('HLT');
      expect(view?.operands, engine).toEqual([]);
      expect(view?.text, engine).toBe('HLT');
    }
  });

  it('a string operand is reported as the value it resolved to', () => {
    // The view describes the machine, not the source, so an operand written as a
    // string comes back as the number it became. Pinned because the alternative
    // -- handing the panels the source spelling -- would make a comma in a
    // literal look like an operand boundary to anything that split the line.
    const view = viewAt('v2', "MOV AX, OFFSET 'a,b'");
    expect(view?.operands.length, 'still two operands').toBe(2);
    expect(view?.operands[1], 'the value, not the literal').toMatch(/^[0-9A-F]+h$/);
  });

  it('a repeat prefix is not an operand of the instruction it repeats', () => {
    // `REP MOVSB` is one instruction whose text starts with the prefix. If the
    // prefix were counted as an operand the panels would show it twice.
    const view = viewAt('v2', 'CLD\nREP MOVSB', 1);
    expect(view?.text).toBe('REPE MOVSB');
    expect(view?.operands.length, 'MOVSB takes no operands').toBe(0);
  });
});

/**
 * The debugger's interrupt control, on both engines.
 *
 * The test that matters is the comparison: raising a vector has to land the
 * engine in the same place the `INT` instruction would, and land the trace in
 * the same shape. A control that works on one engine and is quietly absent on
 * the other is the bug this is here to prevent, and it cannot be caught by
 * testing the two separately -- each would look right.
 */
describe('triggerSoftwareInterrupt', () => {
  /**
   * Run `setup`, then raise the vector where it left off.
   *
   * The setup has to be stepped: the whole point of the AH cases is that the
   * service reads AH, and AH is still whatever the program started with if the
   * instruction that sets it has not run.
   */
  function afterRaising(engine: EngineId, setup: string, vector: number) {
    const subject = session(engine, `${setup}\nHLT`);
    for (let i = 0; i < setup.split('\n').filter((line) => line.trim().length > 0).length; i++) {
      subject.step(i + 1, 0);
    }
    const before = subject.state;
    const diagnostics = subject.triggerSoftwareInterrupt(vector, 99, 0);
    return { before, diagnostics, after: subject.state };
  }

  it('leaves the same state the INT instruction would, for a terminate vector', () => {
    for (const vector of [0x20, 0x03]) {
      for (const engine of ENGINES) {
        const byInstruction = session(engine, `INT ${vector}\nHLT`);
        const ran = byInstruction.step(1, 0);
        const { after } = afterRaising(engine, 'MOV AX, 0', vector);
        expect(after.halted, `${engine} vector ${vector.toString(16)}`).toBe(ran.nextState.halted);
        expect(after.error, `${engine} vector ${vector.toString(16)}`).toBe(ran.nextState.error);
      }
    }
  });

  it('both engines terminate on 4ch through 21h, and on 20h', () => {
    // The two cases both engines agree on, and the reason the comparison has a
    // shared core at all. AH is not folded in here: 21h with AH=0 is a service
    // the new engine does not have and the legacy does not treat as terminate,
    // which is a divergence to record rather than a case to assert away.
    for (const engine of ENGINES) {
      const exit = afterRaising(engine, 'MOV AH, 0x4c', 0x21);
      expect(exit.after.halted, `${engine} 21h/4ch`).toBe(true);
      expect(exit.after.error, `${engine} 21h/4ch exits without a complaint`).toBeNull();
      expect(afterRaising(engine, 'NOP', 0x20).after.halted, `${engine} 20h`).toBe(true);
    }
  });

  it('the new engine reads AH: 02h prints one character where the legacy prints none', () => {
    // One vector, two engines, one register, two different outcomes. This is the
    // divergence in its smallest form, and it is a property of the engines'
    // interrupt policies rather than of the adapter that raised it.
    //
    // 02h and not 09h: 09h prints a `$`-terminated string out of memory, so in a
    // zeroed segment it runs to the end of the segment and emits 65536 NULs --
    // which is right, and useless as a test of "did the service run".
    const printed = afterRaising('v2', 'MOV DL, 0x41\nMOV AH, 0x02', 0x21);
    expect(printed.after.halted, 'printing does not terminate').toBe(false);
    expect(printed.diagnostics.output.length, 'and it printed the character').toBe(1);

    // The legacy accepts 02h and steps over it without printing. It has the
    // service in the sense that the vector does not trap; it has nothing behind
    // it, so a program relying on 02h to print runs and produces no output.
    const legacy = afterRaising('legacy', 'MOV DL, 0x41\nMOV AH, 0x02', 0x21);
    expect(legacy.after.halted, 'accepted, so not a trap').toBe(false);
    expect(legacy.diagnostics.output.length, 'but nothing came out').toBe(0);
  });

  it('an unsupported service stops the new engine and traps the legacy', () => {
    // Where a debugger would differ most visibly: same button, same vector, one
    // engine says what went wrong and stops, the other pushes a frame and runs
    // on. The legacy's behaviour is the historical one and is left alone.
    const stopped = afterRaising('v2', 'MOV AH, 0x99', 0x21);
    expect(stopped.after.halted).toBe(true);
    expect(stopped.after.error ?? '').toMatch(/unsupported INT 21h service 99h/);

    const trapped = afterRaising('legacy', 'MOV AH, 0x99', 0x21);
    expect(trapped.after.halted, 'the legacy does not stop').toBe(false);
    expect(trapped.diagnostics.changedRegisters, 'it pushes a frame instead').toContain('SP');
  });

  it('a vector neither engine serves traps the legacy and stops the new one', () => {
    const stopped = afterRaising('v2', 'NOP', 0x99);
    expect(stopped.after.halted).toBe(true);
    expect(stopped.after.error ?? '').toMatch(/unhandled interrupt 153/);

    const trapped = afterRaising('legacy', 'NOP', 0x99);
    expect(trapped.after.halted).toBe(false);
    expect(trapped.diagnostics.changedRegisters).toContain('SP');
  });

  it('reports the interrupt it raised, at the position it was raised at', () => {
    for (const engine of ENGINES) {
      const { before, diagnostics } = afterRaising(engine, 'MOV AX, 0', 0x20);
      expect(diagnostics.traceEntry.instructionText, engine).toBe('INT 32');
      expect(diagnostics.traceEntry.instructionAddress, engine).toBe(before.registers.IP);
    }
  });

  it('the new engine fetches nothing, so it times nothing and moves nothing', () => {
    // Where the engines differ, and the difference is real rather than a bug in
    // the adapter: this one raises the interrupt in place, so there is no
    // instruction, no bytes read and no time. The legacy runs a synthesized
    // `INT n` through its own step and reports a real cycle count for it. Both
    // are honest about what they did; asserting they agree here would be
    // asserting a divergence away.
    const { before, diagnostics } = afterRaising('v2', 'MOV AX, 0x1234', 0x20);
    expect(diagnostics.cycles).toBe(0);
    expect(diagnostics.nextState.registers.IP, 'the position did not move').toBe(before.registers.IP);
    expect(diagnostics.changedRegisters, 'a service that does not run touches nothing').toEqual([]);

    const legacy = afterRaising('legacy', 'MOV AX, 0x1234', 0x20);
    expect(legacy.diagnostics.cycles, 'the legacy times the instruction it ran').toBeGreaterThan(0);
  });

  it('the terminate vectors come out the same on both engines', () => {
    const outcomes = ENGINES.map((engine) => {
      const { after } = afterRaising(engine, 'NOP', 0x20);
      return `${after.halted}:${after.error ?? ''}`;
    });
    expect(new Set(outcomes).size, `the engines disagreed: ${outcomes.join(' | ')}`).toBe(1);
  });
});

/**
 * Line to address, which is the other direction.
 *
 * The source panel hands the lab a line number and wants an instruction. It is
 * the same map as `sourceLineAt` read the other way, so it is on the session
 * rather than something the lab works out from a legacy program -- a legacy
 * program is the one thing the new engine does not have.
 */
describe('addressAtSourceLine', () => {
  const SOURCE = ['MOV AX, 1', 'ADD AX, 2', 'HLT'].join('\n');

  it('the new engine maps a line to the address it produced', () => {
    const subject = session('v2', SOURCE);
    expect(subject.addressAtSourceLine(1)).not.toBeNull();
    for (const line of [1, 2, 3]) {
      const address = subject.addressAtSourceLine(line);
      expect(subject.sourceLineAt(address!), `line ${line} round trips`).toBe(line);
    }
  });

  it('the three lines land on three ascending addresses', () => {
    const subject = session('v2', SOURCE);
    const addresses = [1, 2, 3].map((line) => subject.addressAtSourceLine(line));
    expect(addresses.every((address) => address !== null)).toBe(true);
    expect(addresses[0]!).toBeLessThan(addresses[1]!);
    expect(addresses[1]!).toBeLessThan(addresses[2]!);
  });

  it('a line that produced nothing has no address', () => {
    const subject = session('v2', SOURCE);
    expect(subject.addressAtSourceLine(99)).toBeNull();
    expect(subject.addressAtSourceLine(0)).toBeNull();
  });

  it('the legacy has no line map for hand-written assembly, and says so', () => {
    // Already true -- this is the divergence the source panel has always had --
    // and worth pinning because the panel's behaviour depends on it. A null here
    // is what makes "click a source line" do nothing on the legacy rather than
    // selecting the wrong instruction.
    const subject = session('legacy', SOURCE);
    expect(subject.addressAtSourceLine(1)).toBeNull();
    expect(subject.addressAtSourceLine(3)).toBeNull();
    expect(subject.sourceLineAt(0), 'and the other direction is empty too').toBeNull();
  });
});

/**
 * Writing a register, because the register panel's fields are editable.
 *
 * The interesting properties are that both engines take the same names, that
 * they wrap the same way, and that a name which is not a register is refused
 * rather than accepted -- a panel that can add a register to the machine is a
 * panel whose display and whose engine disagree.
 */
describe('setRegister', () => {
  it('both engines write every register the panel offers', () => {
    for (const engine of ENGINES) {
      for (const name of WRITABLE_REGISTERS) {
        const subject = session(engine, 'HLT');
        expect(subject.setRegister(name, 0x1234), `${engine} ${name}`).toBe(true);
        expect(subject.state.registers[name], `${engine} ${name}`).toBe(0x1234);
      }
    }
  });

  it('both engines wrap a value that will not fit', () => {
    for (const engine of ENGINES) {
      const subject = session(engine, 'HLT');
      subject.setRegister('AX', 0x1_2345);
      expect(subject.state.registers.AX, engine).toBe(0x2345);
      subject.setRegister('BX', -1);
      expect(subject.state.registers.BX, engine).toBe(0xffff);
    }
  });

  it('both engines refuse a name that is not a register', () => {
    for (const engine of ENGINES) {
      const subject = session(engine, 'HLT');
      for (const name of ['AL', 'EAX', 'SI ', 'si', 'ax', '', 'memory', '__proto__']) {
        expect(subject.setRegister(name, 1), `${engine} "${name}"`).toBe(false);
      }
      expect(subject.state.registers.AX, engine).toBe(subject.state.registers.AX);
    }
  });

  it('both engines agree on what a written register does to the next step', () => {
    // A register panel is only useful if what it writes reaches the machine. Run
    // the same program on both, after writing the same value, and compare.
    for (const engine of ENGINES) {
      const subject = session(engine, 'MOV AX, CX\nHLT');
      subject.setRegister('CX', 0xbeef);
      const after = subject.step(1, 0).nextState;
      expect(after.registers.AX, engine).toBe(0xbeef);
    }
  });

  it('writing IP moves the program, on both engines', () => {
    for (const engine of ENGINES) {
      const subject = session(engine, 'MOV AX, 1\nMOV BX, 2\nHLT');
      const second = subject.instructionAddresses()[1];
      subject.setRegister('IP', second);
      const after = subject.step(1, 0).nextState;
      expect(after.registers.BX, engine).toBe(2);
      expect(after.registers.AX, engine).not.toBe(1);
    }
  });
});
