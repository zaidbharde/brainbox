import { CPUState, Registers } from '@/types/cpu';
import { ProgramOutput } from '@/emulator/cpu';
import { ExecutionSnapshot, ReplaySession, SavedSnapshot, TraceEntry } from '@/lab/types';

const REPLAY_VERSION = '1.0.0';
const DEFAULT_MEMORY_SIZE = 4096;
const REGISTER_NAMES: Array<keyof Registers> = ['AX', 'BX', 'CX', 'DX', 'CS', 'DS', 'ES', 'SS', 'SI', 'DI', 'SP', 'BP', 'IP', 'FLAGS'];

function asNumber(value: unknown, fallback: number = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asString(value: unknown, fallback: string = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asBoolean(value: unknown, fallback: boolean = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeNumberArray(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => asNumber(item, NaN))
      .filter((item) => !Number.isNaN(item))
      .map((item) => item & 0xFFFF);
  }
  return [];
}

function normalizeOutput(output: unknown): ProgramOutput[] {
  if (!Array.isArray(output)) {
    return [];
  }
  return output
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return null;
      }
      const typed = item as Partial<ProgramOutput>;
      const type = typed.type === 'char' ? 'char' : typed.type === 'number' ? 'number' : null;
      if (!type) {
        return null;
      }
      return {
        type,
        value: asNumber(typed.value, 0) & 0xFFFF,
      } satisfies ProgramOutput;
    })
    .filter((item): item is ProgramOutput => item !== null);
}

function normalizeMemory(memory: unknown): Uint8Array {
  if (memory instanceof Uint8Array) {
    return new Uint8Array(memory);
  }

  if (Array.isArray(memory)) {
    return Uint8Array.from(memory.map((item) => asNumber(item, 0) & 0xFF));
  }

  if (memory && typeof memory === 'object') {
    const objectMemory = memory as Record<string, unknown>;
    const indexes = Object.keys(objectMemory)
      .map((key) => (/^\d+$/.test(key) ? parseInt(key, 10) : NaN))
      .filter((key) => !Number.isNaN(key))
      .sort((a, b) => a - b);
    if (indexes.length > 0) {
      const size = Math.max(DEFAULT_MEMORY_SIZE, indexes[indexes.length - 1] + 1);
      const result = new Uint8Array(size);
      for (const index of indexes) {
        result[index] = asNumber(objectMemory[index.toString()], 0) & 0xFF;
      }
      return result;
    }
  }

  return new Uint8Array(DEFAULT_MEMORY_SIZE);
}

function normalizeRegisters(registers: unknown): Registers {
  const objectRegisters = registers && typeof registers === 'object'
    ? registers as Partial<Record<keyof Registers, unknown>>
    : {};
  const normalized = {} as Registers;
  for (const registerName of REGISTER_NAMES) {
    normalized[registerName] = asNumber(objectRegisters[registerName], 0) & 0xFFFF;
  }
  return normalized;
}

function normalizeState(state: unknown): CPUState {
  const objectState = state && typeof state === 'object'
    ? state as Partial<CPUState>
    : {};
  const rawError = objectState.error;
  return {
    registers: normalizeRegisters(objectState.registers),
    memory: normalizeMemory(objectState.memory),
    halted: asBoolean(objectState.halted, false),
    error: rawError === null ? null : typeof rawError === 'string' ? rawError : null,
  };
}

function normalizePerf(perf: unknown): ExecutionSnapshot['perf'] {
  const objectPerf = perf && typeof perf === 'object'
    ? perf as Partial<ExecutionSnapshot['perf']>
    : {};
  return {
    instructionsExecuted: asNumber(objectPerf.instructionsExecuted, 0),
    totalCycles: asNumber(objectPerf.totalCycles, 0),
    elapsedMs: asNumber(objectPerf.elapsedMs, 0),
    simulatedLoad: asNumber(objectPerf.simulatedLoad, 0),
    startedAtMs: objectPerf.startedAtMs === null ? null : asNullableNumber(objectPerf.startedAtMs),
    lastStepAtMs: objectPerf.lastStepAtMs === null ? null : asNullableNumber(objectPerf.lastStepAtMs),
  };
}

function normalizeTraceEntry(entry: unknown): TraceEntry | null {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  const objectEntry = entry as Partial<TraceEntry>;
  const changedRegisters = Array.isArray(objectEntry.changedRegisters)
    ? objectEntry.changedRegisters.filter((registerName): registerName is TraceEntry['changedRegisters'][number] => (
      typeof registerName === 'string' && REGISTER_NAMES.includes(registerName as keyof Registers)
    ))
    : [];
  const changedFlags = Array.isArray(objectEntry.changedFlags)
    ? objectEntry.changedFlags.filter((flag): flag is TraceEntry['changedFlags'][number] => (
      flag === 'CF' || flag === 'PF' || flag === 'AF' || flag === 'ZF' || flag === 'SF' || flag === 'OF'
    ))
    : [];
  return {
    step: asNumber(objectEntry.step, 0),
    instructionAddress: asNumber(objectEntry.instructionAddress, 0),
    instructionText: asString(objectEntry.instructionText, 'NOP'),
    ipBefore: asNumber(objectEntry.ipBefore, 0),
    ipAfter: asNumber(objectEntry.ipAfter, 0),
    changedRegisters,
    changedFlags,
    changedMemoryWords: normalizeNumberArray(objectEntry.changedMemoryWords),
    memoryReads: normalizeNumberArray(objectEntry.memoryReads),
    memoryWrites: normalizeNumberArray(objectEntry.memoryWrites),
    output: normalizeOutput(objectEntry.output),
    cycles: asNumber(objectEntry.cycles, 0),
    timestampMs: asNumber(objectEntry.timestampMs, Date.now()),
  };
}

function normalizeSnapshot(snapshot: unknown): ExecutionSnapshot | null {
  if (!snapshot || typeof snapshot !== 'object') {
    return null;
  }
  const objectSnapshot = snapshot as Partial<ExecutionSnapshot>;
  return {
    state: normalizeState(objectSnapshot.state),
    output: normalizeOutput(objectSnapshot.output),
    traceLength: asNumber(objectSnapshot.traceLength, 0),
    perf: normalizePerf(objectSnapshot.perf),
    createdAtMs: asNumber(objectSnapshot.createdAtMs, Date.now()),
  };
}

function normalizeSavedSnapshot(snapshot: unknown): SavedSnapshot | null {
  if (!snapshot || typeof snapshot !== 'object') {
    return null;
  }
  const objectSnapshot = snapshot as Partial<SavedSnapshot>;
  return {
    id: asString(objectSnapshot.id, `snap-${Date.now()}`),
    label: asString(objectSnapshot.label, 'Imported snapshot'),
    createdAtMs: asNumber(objectSnapshot.createdAtMs, Date.now()),
    step: asNumber(objectSnapshot.step, 0),
    state: normalizeState(objectSnapshot.state),
    output: normalizeOutput(objectSnapshot.output),
    traceLength: asNumber(objectSnapshot.traceLength, 0),
    perf: normalizePerf(objectSnapshot.perf),
  };
}

export function createReplaySession(payload: Omit<ReplaySession, 'version' | 'createdAtMs'>): ReplaySession {
  return {
    version: REPLAY_VERSION,
    createdAtMs: Date.now(),
    ...payload,
  };
}

export function serializeReplaySession(session: ReplaySession): string {
  return JSON.stringify(session, null, 2);
}

export function parseReplaySession(json: string): ReplaySession {
  const parsed = JSON.parse(json) as Partial<ReplaySession>;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid replay payload');
  }
  if (!Array.isArray(parsed.trace) || !Array.isArray(parsed.snapshots)) {
    throw new Error('Replay missing trace/snapshots');
  }
  if (!Array.isArray(parsed.breakpoints)) {
    throw new Error('Replay missing breakpoints');
  }
  const trace = parsed.trace
    .map((entry) => normalizeTraceEntry(entry))
    .filter((entry): entry is TraceEntry => entry !== null);
  const snapshots = parsed.snapshots
    .map((snapshot) => normalizeSnapshot(snapshot))
    .filter((snapshot): snapshot is ExecutionSnapshot => snapshot !== null);
  const savedSnapshots = Array.isArray(parsed.savedSnapshots)
    ? parsed.savedSnapshots
      .map((snapshot) => normalizeSavedSnapshot(snapshot))
      .filter((snapshot): snapshot is SavedSnapshot => snapshot !== null)
    : [];
  return {
    version: typeof parsed.version === 'string' ? parsed.version : REPLAY_VERSION,
    createdAtMs: typeof parsed.createdAtMs === 'number' ? parsed.createdAtMs : Date.now(),
    trace,
    snapshots,
    savedSnapshots,
    breakpoints: normalizeNumberArray(parsed.breakpoints),
    sourceCode: typeof parsed.sourceCode === 'string' ? parsed.sourceCode : '',
    asmCode: typeof parsed.asmCode === 'string' ? parsed.asmCode : '',
  };
}
