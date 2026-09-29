/**
 * The one place that knows which engine the lab is running.
 *
 * The lab grew up around the legacy emulator and reads its shapes throughout:
 * `CPUState` with a nested register object, an `AssembledProgram` with a parsed
 * instruction list, and `StepDiagnostics` describing a single step. Rather than
 * teaching every panel about the new engine, the new engine is presented in those
 * same shapes, and this module is where the choice between the two is made.
 *
 * Both implementations below are the same to a caller: assemble some source, get
 * a session, step it, read state. `App.tsx` picks one from the URL and hands the
 * session to the views that already exist.
 */

import { createInitialState as createLegacyState } from '@/emulator/cpu';
import { assemble as assembleLegacy } from '@/emulator/assembler';
import { executeStepWithDiagnostics } from '@/lab/debugger';
import { buildSourceMapEntries, findSourceLineForInstruction } from '@/lab/source-map';
import { V2Session } from '@/lab/engine-v2';
import type { AssembledProgram, CPUState } from '@/types/cpu';
import type { SourceMapEntry, StepDiagnostics } from '@/lab/types';

/** Which engine the lab is running. The URL parameter's only accepted value. */
export type EngineId = 'legacy' | 'v2';

export const DEFAULT_ENGINE: EngineId = 'legacy';

/**
 * A program that has been assembled and can be stepped.
 *
 * Deliberately narrow: the lab already owns stepping *back* through its snapshot
 * list, so re-running or rewinding is not something an engine has to support.
 */
export interface DebugSession {
  /** The engine's current state, in the lab's shape. */
  readonly state: CPUState;
  /** Assemble problems, empty if the program is runnable. */
  readonly diagnostics: readonly { line: number; message: string }[];
  /** Execute one instruction and report what changed. */
  step(stepNumber: number, stepStartedAtMs: number): StepDiagnostics;
  /** The source line the program is stopped on, or null if it cannot be said. */
  sourceLineAt(ip: number): number | null;
  /** True once the program has finished, however it finished. */
  isFinished(): boolean;
}

export interface CreateSessionResult {
  session: DebugSession | null;
  diagnostics: readonly { line: number; message: string }[];
}

/**
 * Assemble and prepare a program on the chosen engine.
 *
 * A session is null when the program did not assemble, because there is nothing
 * to step; the diagnostics are returned either way so the editor can show them.
 */
export function createSession(engine: EngineId, source: string): CreateSessionResult {
  return engine === 'v2' ? createV2Session(source) : createLegacySession(source);
}

/**
 * Read the engine choice out of a query string.
 *
 * Anything unrecognised falls back to the legacy engine rather than guessing.
 * The lab has always behaved this way and a mistyped parameter should not
 * silently change which instructions run.
 */
export function engineFromQuery(search: string): EngineId {
  const value = new URLSearchParams(search).get('engine');
  return value === 'v2' ? 'v2' : DEFAULT_ENGINE;
}

/** The query string for an engine choice, leaving the rest of the URL alone. */
export function withEngineInQuery(search: string, engine: EngineId): string {
  const params = new URLSearchParams(search);
  if (engine === 'v2') params.set('engine', 'v2');
  else params.delete('engine');
  const query = params.toString();
  return query.length > 0 ? `?${query}` : '';
}

// ------------------------------------------------------------- legacy engine

/**
 * The legacy engine, stepped through its own debugger.
 *
 * This is the behaviour the lab had before, unchanged: it still assembles to a
 * parsed instruction list and still treats IP as an index into it. Keeping it as
 * a session rather than leaving it inline is what lets both engines sit behind
 * the same interface, and it is the default so nothing changes for anyone who
 * does not ask for the new one.
 */
class LegacySession implements DebugSession {
  readonly diagnostics: readonly { line: number; message: string }[];

  private readonly program: AssembledProgram;
  private readonly sourceMap: SourceMapEntry[];
  private current: CPUState;

  constructor(program: AssembledProgram) {
    this.program = program;
    this.diagnostics = program.errors
      .filter((error) => error.type === 'error')
      .map((error) => ({ line: error.line, message: error.message }));
    this.sourceMap = buildSourceMapEntries(program);
    this.current = createLegacyState(program.initialMemory);
  }

  get state(): CPUState {
    return this.current;
  }

  step(stepNumber: number, stepStartedAtMs: number): StepDiagnostics {
    // The legacy debugger steps by instruction index, because that is what the
    // legacy state records as IP. An index past the end of the parsed list means
    // the program ran off the end of its own instructions, which is reported
    // rather than thrown, matching what `runProgram` does for a whole run.
    const index = this.current.registers.IP;
    const instruction = this.program.instructions[index];
    if (instruction === undefined) {
      this.current = { ...this.current, halted: true, error: 'IP out of bounds' };
      return finishedDiagnostics(this.current, index, stepNumber, stepStartedAtMs);
    }

    // `executeStepWithDiagnostics` executes the instruction and measures the
    // difference, so the state advances exactly once per press.
    const diagnostics = executeStepWithDiagnostics({
      state: this.current,
      instruction,
      labels: this.program.labels,
      stepNumber,
      stepStartedAtMs,
    });
    this.current = diagnostics.nextState;
    return diagnostics;
  }

  sourceLineAt(ip: number): number | null {
    return findSourceLineForInstruction(this.sourceMap, ip);
  }

  isFinished(): boolean {
    return this.current.halted;
  }
}

/**
 * Diagnostics for a step that could not happen, because the program is over.
 *
 * The lab expects a trace entry every press so the panel does not have to grow a
 * "nothing to show" case, so one is written saying plainly that the program
 * finished rather than inventing an instruction to blame.
 */
function finishedDiagnostics(
  state: CPUState,
  address: number,
  stepNumber: number,
  stepStartedAtMs: number,
): StepDiagnostics {
  return {
    nextState: state,
    output: [],
    changedRegisters: [],
    changedFlags: [],
    changedMemoryWords: [],
    memoryReads: [],
    memoryWrites: [],
    cycles: 0,
    traceEntry: {
      step: stepNumber,
      instructionAddress: address,
      instructionText: state.error ?? 'program finished',
      ipBefore: address,
      ipAfter: address,
      changedRegisters: [],
      changedFlags: [],
      changedMemoryWords: [],
      memoryReads: [],
      memoryWrites: [],
      output: [],
      cycles: 0,
      timestampMs: stepStartedAtMs,
    },
  };
}

function createLegacySession(source: string): CreateSessionResult {
  const program = assembleLegacy(source);
  const errors = program.errors.filter((error) => error.type === 'error');
  if (errors.length > 0) {
    return { session: null, diagnostics: errors.map((error) => ({ line: error.line, message: error.message })) };
  }
  const session = new LegacySession(program);
  return { session, diagnostics: session.diagnostics };
}

// ---------------------------------------------------------------- new engine

function createV2Session(source: string): CreateSessionResult {
  const { session, assembly } = V2Session.create(source);
  return { session, diagnostics: assembly.diagnostics };
}
