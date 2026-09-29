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

import { createInitialState as createLegacyState, runProgram as runLegacyProgram } from '@/emulator/cpu';
import { assemble as assembleLegacy } from '@/emulator/assembler';
import { executeStepWithDiagnostics } from '@/lab/debugger';
import { buildSourceMapEntries, findSourceLineForInstruction } from '@/lab/source-map';
import { V2Session } from '@/lab/engine-v2';
import type { AssembledProgram, CPUState } from '@/types/cpu';
import type { ProgramOutput } from '@/emulator/cpu';
import type { InstructionView, SourceMapEntry, StepDiagnostics } from '@/lab/types';

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
  /**
   * Put the engine back to a state the lab already holds.
   *
   * The lab's timeline is a list of snapshots and it can seek backwards through
   * them, so a session that only moves forward is not enough: the Step after a
   * rewind has to execute from the rewound state, not from wherever the engine
   * last got to. Called once at the start of a stepping run rather than before
   * every step -- after that the engine and the lab's copy advance together, and
   * reloading the whole image on each instruction would be the expensive way to
   * express the same thing.
   */
  restore(state: CPUState): void;
  /** The source line the program is stopped on, or null if it cannot be said. */
  sourceLineAt(ip: number): number | null;
  /**
   * The instruction at an address, or null when the engine cannot say.
   *
   * This is the reason the debug view does not index into an instruction list
   * itself. The legacy's address is an index into a parsed list and the new
   * engine's is a byte offset in memory, so a view that indexes cannot work for
   * both; asking the engine for the instruction at an address is the only shape
   * that is honest about which one it has.
   */
  instructionAt(address: number): InstructionView | null;
  /**
   * Every address an instruction begins at, ascending.
   *
   * For the view's bounds questions: which addresses are steppable, and where a
   * breakpoint is legal. The legacy returns instruction indices, the new engine
   * returns byte offsets, and neither is meaningful to the other.
   */
  instructionAddresses(): readonly number[];
  /** True once the program has finished, however it finished. */
  isFinished(): boolean;
  /**
   * What to ask the user for, one entry per input the program reads, in the
   * order it reads them.
   *
   * The lab prompts for these before it runs anything, because `window.prompt`
   * cannot be called from inside an execution loop.
   *
   * The two engines answer this differently, and the interface is where that
   * becomes visible rather than a surprise at the prompt. The legacy returns one
   * entry per `IN`, naming the port: it has no DOS read services, so that is its
   * whole input model. The new engine returns none, because its input is a
   * character queue behind DOS read services, whose length the program decides at
   * run time, and the numbers this method carries would not reach its `IN`. Both
   * still *run* correctly with nothing supplied. See `docs/engine-v2-divergences.md`.
   */
  inputPrompts(): readonly string[];
  /**
   * Run the whole program from the start and report where it finished.
   *
   * From the start, not from wherever a session has been stepped to: the Run
   * button is a fresh run even after a debugging session, and reusing a stepped
   * session would silently continue from wherever the user stopped.
   *
   * `inputs` is whatever `inputPrompts` asked for, which the two engines spend
   * differently: the legacy writes each value into the port window its `IN` reads,
   * and the new engine appends each to the character queue its DOS read services
   * consume. Passing none is always valid on both.
   */
  runToCompletion(inputs: readonly number[], maxSteps: number): RunResult;
}

/** Where a whole-program run finished, in the lab's shapes. */
export interface RunResult {
  readonly state: CPUState;
  readonly output: readonly ProgramOutput[];
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

  restore(state: CPUState): void {
    this.current = state;
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

  /**
   * The instruction at an index, which is what an address is in this engine.
   *
   * Everything beyond the text is reported as unstated. The legacy parses
   * instructions into `{opcode, operands, address, raw}` and keeps no record of
   * how many bytes each one took, which flags it touched, or which registers it
   * read, so there is nothing here to answer those with. Filling them in would
   * mean a second, worse assembler kept in step with the real one by hand.
   */
  instructionAt(address: number): InstructionView | null {
    const instruction = this.program.instructions[address];
    if (instruction === undefined) return null;
    const opcode = instruction.opcode.toUpperCase();
    return {
      address,
      sourceLine: this.sourceLineAt(address),
      text: `${opcode} ${instruction.operands.join(', ')}`.trim(),
      opcode,
      operands: instruction.operands.map((operand) => operand.trim()),
      byteLength: null,
      flags: [],
      reads: [],
      writes: [],
      isCall: opcode === 'CALL',
      isReturn: opcode === 'RET' || opcode === 'RETF',
    };
  }

  instructionAddresses(): readonly number[] {
    return this.program.instructions.map((instruction) => instruction.address);
  }

  isFinished(): boolean {
    return this.current.halted;
  }

  inputPrompts(): readonly string[] {
    return this.program.instructions
      .filter((instruction) => instruction.opcode.toUpperCase() === 'IN')
      .map((instruction) => instruction.operands[1] ?? '?');
  }

  runToCompletion(inputs: readonly number[], maxSteps: number): RunResult {
    const { finalState, output } = runLegacyProgram(this.program, maxSteps, [...inputs]);
    return { state: finalState, output };
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
