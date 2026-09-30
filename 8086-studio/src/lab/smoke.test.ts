/**
 * Two real programs, run the way the app runs them, on both engines.
 *
 * Everything else in the suite is either an instruction (`isa/`), a comparison
 * between two engines on a program written to isolate one thing, or a trace
 * pinned to a past revision. This file is the other thing: whole programs a
 * person would actually type, run end to end through `createSession`, checked for
 * the output they were supposed to produce.
 *
 * Two programs, because they fail in different ways. The hello world is
 * interrupt-driven with a `$`-terminated string, so it exercises the BIOS
 * services and the label arithmetic that finds the string -- and a mistake there
 * prints nothing at all rather than the wrong thing. The array sum declares a
 * `DATA SEGMENT` and finds it through `DS`, so it exercises where each engine
 * decides to put declared data, and it leaves its answer in a register where it
 * can be checked exactly.
 *
 * Both run through the session rather than a `Cpu` constructed by hand. The
 * session is the path the debugger and the Run button take, and it is the one
 * that has to assemble the program, lay out its segments and pick its entry
 * point; a hand-built `Cpu` skips all of that and would pass with a broken
 * layout.
 */

import { describe, expect, it } from 'vitest';
import { createSession, type EngineId } from '@/lab/execution-engine';
import type { ProgramOutput } from '@/emulator/cpu';
import type { Registers } from '@/types/cpu';

const ENGINES: EngineId[] = ['legacy', 'v2'];

/** INT 21h AH=09h: print a `$`-terminated string at DS:DX. */
const HELLO_WORLD = [
  '; The way a hello world is written for DOS.',
  'MOV DX, OFFSET message',
  'MOV AH, 09h',
  'INT 21h',
  'HLT',
  'message DB "Hello, 8086!$"',
].join('\n');

/**
 * Sum a declared array, leaving the total in AX.
 *
 * The array is in a `DATA SEGMENT` rather than inline after the code, because
 * that is the part worth testing: each engine decides where declared segments
 * land, and a program that finds its data by segment rather than by an absolute
 * address is the case where a disagreement about layout would show up.
 *
 * `MOV SI, OFFSET values` is the one way to get a label's address that both
 * assemblers accept. The bare label is not, and the disagreement there is worth
 * spelling out rather than working around silently: the legacy reads `MOV SI,
 * values` as a *load* of the word at that address, so SI ends up holding the
 * first element and the loop then walks off into whatever follows, summing to 0
 * with no diagnostic. The new assembler rejects the bare form outright. Neither
 * is a layout difference, and the data really is in the segment on both.
 *
 * `DEC CX` / `JNZ` rather than `LOOP`, because the new assembler has `LOOP` and
 * the legacy does not. The point of the test is the data, and a program the
 * legacy cannot assemble is not a comparison of anything.
 */
const ARRAY_SUM = [
  'DATA SEGMENT',
  'values DW 10, 20, 30, 40',
  'DATA ENDS',
  'CODE SEGMENT',
  'start:',
  '  XOR AX, AX',
  '  MOV SI, OFFSET values',
  '  MOV CX, 4',
  'next:',
  '  ADD AX, [SI]',
  '  ADD SI, 2',
  '  DEC CX',
  '  JNZ next',
  '  HLT',
  'CODE ENDS',
  'END start',
].join('\n');

/** 10 + 20 + 30 + 40. Wider than a byte, so a truncation anywhere would show. */
const ARRAY_SUM_TOTAL = 100;

/** 10 + 20 + 30 = 60, so a loop that stopped one pass short is not the same answer. */
const ARRAY_SUM_SHORT = 60;

/** Everything a program printed, as text, so a diff shows what a person saw. */
function runToCompletion(engine: EngineId, source: string, limit = 1000): {
  output: string;
  registers: Registers;
  error: string | null;
} {
  const { session, diagnostics } = createSession(engine, source);
  if (session === null) {
    throw new Error(`${engine}: assembly failed: ${JSON.stringify(diagnostics)}`);
  }
  const output: ProgramOutput[] = [];
  for (let step = 1; step <= limit && !session.isFinished(); step += 1) {
    output.push(...session.step(step, 0).output);
  }
  return {
    output: output
      .map((entry) => (entry.type === 'char' ? String.fromCharCode(entry.value) : String(entry.value)))
      .join(''),
    registers: session.state.registers,
    error: session.state.error,
  };
}

describe('a hello world, printed with INT 21h AH=09h', () => {
  it('prints the message on the legacy, which is the default engine', () => {
    // The legacy first and on its own, because a failure here is the failure
    // that matters: this is the engine every other statement of the lab's
    // behaviour is made against.
    const result = runToCompletion('legacy', HELLO_WORLD);
    expect(result.error).toBeNull();
    expect(result.output).toBe('Hello, 8086!');
  });

  it('prints the same message on the new engine', () => {
    const result = runToCompletion('v2', HELLO_WORLD);
    expect(result.error).toBeNull();
    expect(result.output).toBe('Hello, 8086!');
  });

  it('both engines print it identically, and neither leaves anything extra', () => {
    // AH=09h prints up to the `$` and nothing beyond it, so a trailing newline, a
    // stray byte or a mis-terminated string would all show up as a longer string
    // than the message. Compared as exact text for that reason, and compared
    // between engines as well, so one engine's extra byte cannot hide behind the
    // other's.
    const expected = 'Hello, 8086!';
    const legacy = runToCompletion('legacy', HELLO_WORLD);
    const v2 = runToCompletion('v2', HELLO_WORLD);
    expect(legacy.output).toBe(expected);
    expect(v2.output).toBe(expected);
  });
});

describe('an array sum, reading a declared data segment', () => {
  it('totals the array on the legacy, which is the default engine', () => {
    const result = runToCompletion('legacy', ARRAY_SUM);
    expect(result.error).toBeNull();
    expect(result.registers.AX).toBe(ARRAY_SUM_TOTAL);
  });

  it('totals the same array to the same total on the new engine', () => {
    // The interesting one. Each engine decides for itself where a declared
    // segment lands -- the legacy puts it at 0100h, the new engine packs the
    // segments -- so a program that finds its data through `DS` is exactly where
    // a disagreement about layout would surface. Written with `OFFSET`, the two
    // agree, which is the property worth having and worth keeping.
    const result = runToCompletion('v2', ARRAY_SUM);
    expect(result.error).toBeNull();
    expect(result.registers.AX).toBe(ARRAY_SUM_TOTAL);
  });

  it('reads every element, so a loop one pass short or long would be caught', () => {
    // The discriminating check, and the reason the total is 100 and not 60: run
    // the identical program with the count at three and it must land on the
    // partial sum. If both spellings gave the same answer, the test above would
    // be satisfied by a loop that stopped early or never ran, since 60 and 100
    // are both non-zero and neither is an error.
    const threeElements = ARRAY_SUM.replace('MOV CX, 4', 'MOV CX, 3');
    for (const engine of ENGINES) {
      expect(runToCompletion(engine, ARRAY_SUM).registers.AX, engine).toBe(ARRAY_SUM_TOTAL);
      expect(runToCompletion(engine, threeElements).registers.AX, engine).toBe(ARRAY_SUM_SHORT);
    }
  });

  it('the two engines reach the identical total from the identical source', () => {
    // Written last, and on purpose: it is the assertion the whole file exists
    // for, and it is only worth anything because the two assertions above it
    // already say what the answer is.
    const legacy = runToCompletion('legacy', ARRAY_SUM).registers.AX;
    const v2 = runToCompletion('v2', ARRAY_SUM).registers.AX;
    expect(legacy).toBe(v2);
    expect(legacy).toBe(ARRAY_SUM_TOTAL);
  });

  it('a bare label instead of OFFSET is not the same program on the two engines', () => {
    // The one place the sources genuinely disagree, pinned because it is silent.
    // The legacy reads `MOV SI, values` as a load of the word stored at that
    // address, so SI takes the value 10, the loop walks forward from there, and
    // the sum comes out 0 with no diagnostic anywhere. The new assembler rejects
    // the bare form instead of misreading it. Silently-wrong beats rejected when
    // deciding which to fix, and this is the note that says so.
    const bare = ARRAY_SUM.replace('MOV SI, OFFSET values', 'MOV SI, values');
    expect(runToCompletion('legacy', bare).registers.AX).toBe(0);
    expect(runToCompletion('legacy', bare).error).toBeNull();
  });
});

describe('output, from a step and from a whole run', () => {
  it('a step shows the DOS output a whole run shows', () => {
    for (const engine of ENGINES) {
      const whole = runToCompletion(engine, HELLO_WORLD);

      const { session, diagnostics } = createSession(engine, HELLO_WORLD);
      if (session === null) throw new Error(`${engine}: ${JSON.stringify(diagnostics)}`);
      const stepped: ProgramOutput[] = [];
      for (let step = 1; step <= 1000 && !session.isFinished(); step += 1) {
        stepped.push(...session.step(step, 0).output);
      }
      const asText = (entries: readonly ProgramOutput[]) =>
        entries.map((entry) => (entry.type === 'char' ? String.fromCharCode(entry.value) : String(entry.value))).join('');

      expect(asText(stepped), `${engine} stepped`).toBe(whole.output);
      expect(asText(stepped), `${engine} must not be empty`).not.toBe('');
    }
  });

  it('shows it for the single-character service too, not only the string one', () => {
    // AH=02h is the one a program uses to echo a keystroke, and it goes through a
    // different branch of the emulator's capture. Both branches are checked
    // because they were fixed together and could have been half-fixed.
    const echo = 'MOV DL, 5Ah\nMOV AH, 02h\nINT 21h\nHLT';
    for (const engine of ENGINES) {
      expect(runToCompletion(engine, echo).output, engine).toBe('Z');
    }
  });
});
