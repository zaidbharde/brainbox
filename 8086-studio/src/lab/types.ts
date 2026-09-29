import { ProgramOutput } from '@/emulator/cpu';
import { CPUState, Instruction, Registers } from '@/types/cpu';

export type PipelineStage = 'idle' | 'fetch' | 'decode' | 'execute';

export interface PipelineState {
  stage: PipelineStage;
  instructionIndex: number | null;
  tick: number;
}

export interface PerformanceMetrics {
  instructionsExecuted: number;
  totalCycles: number;
  elapsedMs: number;
  simulatedLoad: number;
  startedAtMs: number | null;
  lastStepAtMs: number | null;
}

export interface TraceEntry {
  step: number;
  instructionAddress: number;
  instructionText: string;
  ipBefore: number;
  ipAfter: number;
  changedRegisters: (keyof Registers)[];
  changedFlags: Array<'CF' | 'PF' | 'AF' | 'ZF' | 'SF' | 'OF'>;
  changedMemoryWords: number[];
  memoryReads: number[];
  memoryWrites: number[];
  output: ProgramOutput[];
  cycles: number;
  timestampMs: number;
}

/**
 * One instruction, in the shape the debugger needs to show it.
 *
 * The two engines hold instructions in incompatible ways: the legacy has a
 * parsed list and treats IP as an index into it, the new engine has bytes in
 * memory and decodes them on demand. The view layer must not have to know which
 * it is looking at, so both reduce to this.
 *
 * The `byteLength`, `flags`, `reads` and `writes` fields are the reason this type
 * exists. The legacy's parsed instruction records none of them, and it is
 * reported as unstated rather than guessed from the mnemonic -- a value derived
 * from the name of an instruction is a value that can be wrong, and the whole
 * reason the new engine has these is that it knows them. The new engine fills
 * them in from the decode, where they come from the table rather than from
 * parsing a string.
 */
export interface InstructionView {
  /** Address this instruction starts at. */
  readonly address: number;
  /** Source line this came from, or null when the engine cannot say. */
  readonly sourceLine: number | null;
  /** Intel-syntax text, e.g. `MOV AX, [BX+SI]`. */
  readonly text: string;
  /**
   * The mnemonic on its own, and the operands as separate strings.
   *
   * The lab's panels and its symbolic hints have always wanted the instruction
   * broken up rather than as one line, and they are the same fields the legacy
   * program carried. Splitting `text` would be the shortcut, but a string
   * literal may contain a comma, and `text` is a rendering, not a parse.
   */
  readonly opcode: string;
  readonly operands: string[];
  /** Bytes the instruction occupies, or null when the engine does not record it. */
  readonly byteLength: number | null;
  /** Flags this instruction reads or writes, e.g. `["ZF", "CF"]`. */
  readonly flags: readonly string[];
  /** Registers this instruction reads, e.g. `["BX", "SI"]`. */
  readonly reads: readonly string[];
  /** Registers this instruction writes, e.g. `["AX"]`. */
  readonly writes: readonly string[];
  /**
   * True for `CALL`.
   *
   * Step Over needs this to decide whether to run to the matching `RET`, and it
   * asks the engine rather than string-matching a mnemonic, because "is this a
   * call" is a property of the encoding.
   */
  readonly isCall: boolean;
  /**
   * True for `RET` and `RETF`.
   *
   * Step Over counts call depth with this. It is a separate flag from `isCall`
   * rather than a second test on the same mnemonic because the far forms matter
   * here: a far call pushes an extra word, and a step-over that counted one and
   * not the other would run off the end of the subroutine it meant to land after.
   */
  readonly isReturn: boolean;
}

export interface StepDiagnostics {
  nextState: CPUState;
  output: ProgramOutput[];
  changedRegisters: (keyof Registers)[];
  changedFlags: Array<'CF' | 'PF' | 'AF' | 'ZF' | 'SF' | 'OF'>;
  changedMemoryWords: number[];
  memoryReads: number[];
  memoryWrites: number[];
  cycles: number;
  traceEntry: TraceEntry;
}

export interface DemoProgram {
  id: string;
  title: string;
  description: string;
  source: string;
}

export interface ExecutionSnapshot {
  state: CPUState;
  output: ProgramOutput[];
  traceLength: number;
  perf: PerformanceMetrics;
  createdAtMs: number;
}

export interface SavedSnapshot {
  id: string;
  label: string;
  createdAtMs: number;
  step: number;
  state: CPUState;
  output: ProgramOutput[];
  traceLength: number;
  perf: PerformanceMetrics;
}

export interface SnapshotComparison {
  registerDiffs: Array<{
    register: keyof Registers;
    before: number;
    after: number;
  }>;
  flagDiffs: Array<{
    flag: 'CF' | 'PF' | 'AF' | 'ZF' | 'SF' | 'OF';
    before: boolean;
    after: boolean;
  }>;
  memoryDiffCount: number;
  memoryDiffSample: number[];
}

export interface InstructionInspectorData {
  opcode: string;
  operands: string[];
  category: string;
  summary: string;
  educationalNote: string;
  registerReads: string[];
  registerWrites: string[];
  flagBehavior: string;
  virtualEncodingHex: string;
  virtualEncodingBinary: string;
  lastObservedEffects: {
    changedRegisters: (keyof Registers)[];
    changedFlags: Array<'CF' | 'PF' | 'AF' | 'ZF' | 'SF' | 'OF'>;
    changedMemoryWords: number[];
  } | null;
}

export interface ExecutionAnalytics {
  totalSteps: number;
  totalCycles: number;
  averageCycles: number;
  maxCycles: number;
  minCycles: number;
  instructionFrequency: Array<{
    opcode: string;
    count: number;
    cycles: number;
    percentage: number;
  }>;
  timeline: Array<{
    step: number;
    opcode: string;
    cycles: number;
    cumulativeCycles: number;
    changedSignals: number;
  }>;
}

export interface GuidedLearningContent {
  title: string;
  explanation: string;
  hints: string[];
  tutorialCheckpoint?: string;
  symbolicHints?: string[];
}

export interface WatchExpression {
  id: string;
  expression: string;
}

export interface WatchValue {
  id: string;
  expression: string;
  ok: boolean;
  value: number | null;
  hexValue: string;
  changed: boolean;
  error?: string;
}

export type WatchpointType = 'read' | 'write' | 'change';

export interface MemoryWatchpoint {
  id: string;
  label: string;
  address: number;
  size: number;
  type: WatchpointType;
  enabled: boolean;
}

export type BranchPredictorMode = 'always_taken' | 'always_not_taken' | 'one_bit' | 'two_bit';

export interface BranchPredictorStats {
  mode: BranchPredictorMode;
  evaluatedBranches: number;
  correctPredictions: number;
  incorrectPredictions: number;
  accuracy: number;
  byOpcode: Array<{
    opcode: string;
    total: number;
    correct: number;
    accuracy: number;
  }>;
}

export type CachePolicy = 'direct_mapped' | 'set_associative_2way';

export interface CacheConfig {
  policy: CachePolicy;
  lineCount: number;
  lineSizeBytes: number;
}

export interface CacheStats {
  accesses: number;
  hits: number;
  misses: number;
  hitRate: number;
  missesByType: {
    read: number;
    write: number;
  };
}

export interface HazardStats {
  dataHazards: number;
  controlHazards: number;
  structuralHazards: number;
  simulatedStalls: number;
}

export interface SourceMapEntry {
  sourceLine: number;
  instructionStart: number;
  instructionEnd: number;
}

/**
 * The parts of an instruction the panels read.
 *
 * Not `Instruction` and not `InstructionView`: the readers below need the
 * mnemonic and the operands and nothing else, and typing them on one of the two
 * concrete shapes is what would force the debug view to keep holding a legacy
 * program around just to satisfy a type. Whichever shape is handed over, these
 * are the fields that get used.
 */
export interface InstructionParts {
  readonly opcode: string;
  readonly operands: readonly string[];
}

/**
 * Every named 16-bit register, in the order the register panel shows them.
 *
 * One list, in a module with no engine imports, because both engines and the
 * panel have to agree on exactly which names exist. Two copies of this list
 * would drift, and the symptom would be a field that one engine accepts and the
 * other silently ignores.
 */
export const WRITABLE_REGISTERS = [
  'AX', 'BX', 'CX', 'DX', 'SI', 'DI', 'BP', 'SP', 'CS', 'DS', 'ES', 'SS', 'IP', 'FLAGS',
] as const;

export type WritableRegister = (typeof WRITABLE_REGISTERS)[number];

export interface ReplaySession {
  version: string;
  createdAtMs: number;
  trace: TraceEntry[];
  snapshots: ExecutionSnapshot[];
  savedSnapshots: SavedSnapshot[];
  breakpoints: number[];
  sourceCode: string;
  asmCode: string;
}

export interface ExecuteStepParams {
  state: CPUState;
  instruction: Instruction;
  labels: Map<string, number>;
  stepNumber: number;
  stepStartedAtMs: number;
}
