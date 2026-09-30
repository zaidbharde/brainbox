/**
 * lab/golden-legacy-trace.ts — a per-step trace of the legacy engine.
 *
 * The point of this file is to be diffable against a trace produced by *other*
 * code, so the output is canonical by construction: every field is a number or a
 * string in a fixed order, memory is hashed rather than dumped, and nothing
 * timestamped, environment-dependent or address-of-dependent is included. Two
 * checkouts that agree produce the same bytes; that is the whole contract.
 *
 * Where the golden came from: 0ebd74e, the commit before the debug view was
 * moved onto `DebugSession`. The legacy engine underneath has not changed since
 * that commit -- `src/emulator` and `src/types` are byte-for-byte identical -- so
 * anything this trace would disagree about is a change in the debug *layer*, not
 * in the emulator, which is the part a refactor like that can quietly break.
 */

import { compile, SAMPLE_PROGRAMS_BY_LANGUAGE } from '@/compiler/compiler';
import type { FrontendLanguage } from '@/compiler/transpiler';
import { createSession } from '@/lab/execution-engine';
import { ASSEMBLY_DEMOS } from '@/lab/demos';
import type { ProgramOutput } from '@/emulator/cpu';
import type { CPUState } from '@/types/cpu';

/**
 * Enough steps to finish every shipped program, with room over.
 *
 * A cap and not "until halted": a program that loops forever must not hang the
 * test run, and a cap makes the truncated case a fixed shape -- the trace simply
 * stops, and a golden recorded with a shorter limit will not match this one.
 */
export const TRACE_STEP_LIMIT = 2000;

/**
 * Every register, in a fixed order.
 *
 * All fourteen, not the nine the panel shows, because the ones a person cannot
 * see are the ones a change is most likely to reach: `SS` and `SP` after a
 * `PUSH`, the segments after a `LOAD`. Fixed order so a diff names the register
 * that moved rather than reporting two changed lines.
 */
const REGISTER_ORDER = [
  'AX', 'BX', 'CX', 'DX', 'SI', 'DI', 'BP', 'SP',
  'CS', 'DS', 'ES', 'SS', 'IP', 'FLAGS',
] as const;

/**
 * A short digest of the whole memory image, FNV-1a.
 *
 * A golden trace exists to catch a change nobody intended, and the legacy's flat
 * 4 KB image is where those hide: a stack write, a data write and a code patch
 * all land in one array. Hashing all of it catches a change anywhere; dumping
 * 4 KB per step would produce a diff nobody reads, which is the same as not
 * having one. The length is mixed in too, so a trace that quietly stopped
 * covering the whole image cannot match one that did not.
 *
 * Written out rather than imported so the two checkouts cannot disagree about a
 * hash implementation, and because the arithmetic is part of what is being
 * pinned.
 */
export function memoryDigest(memory: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < memory.length; i += 1) {
    hash ^= memory[i];
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${memory.length.toString(16)}:${hash.toString(16).padStart(8, '0')}`;
}

/** Registers as `NAME=value`, so a diff reads as `AX=0001` became `AX=0002`. */
export function registersOf(registers: CPUState['registers']): string {
  return REGISTER_ORDER
    .map((name) => `${name}=${(registers[name] as number).toString(16).padStart(4, '0')}`)
    .join(' ');
}

/** Everything printed so far, so a diff shows the text a program produced. */
export function outputOf(output: readonly ProgramOutput[]): string {
  return output
    .map((entry) => (entry.type === 'char' ? String.fromCharCode(entry.value) : String(entry.value)))
    .join('');
}

/** One step, as one line, in the shape the golden file holds. */
function stepRecord(
  stepNumber: number,
  state: CPUState,
  memory: Uint8Array,
  output: readonly ProgramOutput[],
): string {
  return [
    `#${stepNumber}`,
    `reg ${registersOf(state.registers)}`,
    `mem ${memoryDigest(memory)}`,
    `out ${JSON.stringify(outputOf(output))}`,
    `halted ${state.halted ? 1 : 0}`,
    `error ${JSON.stringify(state.error ?? null)}`,
  ].join(' | ');
}

/**
 * Every program the lab ships: the hand-written assembly demos, and each
 * frontend language's samples run through the compiler.
 *
 * The compiler half is not redundancy. A frontend sample is not assembly, so the
 * trace has to go through `compile` to reach anything -- which is the path the
 * old Debug button took, and the one the debug view is being compared against.
 * It also means the codegen is covered, and a change to it is a change to what
 * the debugger is being asked to run.
 */
function tracePrograms(): { name: string; source: string }[] {
  const programs: { name: string; source: string }[] = ASSEMBLY_DEMOS.map((demo) => ({
    name: `asm:${demo.id}`,
    source: demo.source,
  }));
  for (const [language, samples] of Object.entries(SAMPLE_PROGRAMS_BY_LANGUAGE)) {
    for (const [name, source] of Object.entries(samples)) {
      const compiled = compile(source, language as FrontendLanguage);
      if (!compiled.success) {
        const errors = compiled.errors
          .filter((error) => error.type === 'error')
          .map((error) => `line ${error.line}: ${error.message}`)
          .join('; ');
        throw new Error(`${language}:${name} did not compile: ${errors}`);
      }
      programs.push({ name: `${language}:${name}`, source: compiled.assembly });
    }
  }
  return programs;
}

/**
 * Trace every shipped program on the legacy engine, one entry per program.
 *
 * Each entry is the initial state, one line per step, and a closing line with the
 * final halted state and error. The step goes through `DebugSession` -- which is
 * the path the current debug view takes, and the thing being checked.
 */
export function buildLegacyTrace(): Record<string, string[]> {
  const traces: Record<string, string[]> = {};

  for (const { name, source } of tracePrograms()) {
    const { session } = createSession('legacy', source);
    if (session === null) throw new Error(`${name}: the legacy session refused to assemble it`);

    const records: string[] = [
      `init | reg ${registersOf(session.state.registers)} | mem ${memoryDigest(session.state.memory)}`,
    ];
    const output: ProgramOutput[] = [];

    for (let step = 1; step <= TRACE_STEP_LIMIT && !session.isFinished(); step += 1) {
      const diagnostics = session.step(step, 0);
      output.push(...diagnostics.output);
      records.push(stepRecord(step, diagnostics.nextState, session.state.memory, output));
    }

    records.push(
      `end | halted ${session.state.halted ? 1 : 0} | error ${JSON.stringify(session.state.error ?? null)}`,
    );
    traces[name] = records;
  }

  return traces;
}

/** How the golden file is written, so it is stable in git. */
export function serializeTrace(trace: Record<string, string[]>): string {
  return `${JSON.stringify(trace, null, 2)}\n`;
}
