import { getFlags, ProgramOutput } from '@/emulator/cpu';
import { CPUState, Registers } from '@/types/cpu';
import {
  ExecutionSnapshot,
  PerformanceMetrics,
  SavedSnapshot,
  SnapshotComparison,
} from '@/lab/types';

const REGISTER_NAMES: (keyof Registers)[] = ['AX', 'BX', 'CX', 'DX', 'CS', 'DS', 'ES', 'SS', 'SI', 'DI', 'SP', 'BP', 'IP', 'FLAGS'];
const FLAG_NAMES: Array<'CF' | 'PF' | 'AF' | 'ZF' | 'SF' | 'OF'> = ['CF', 'PF', 'AF', 'ZF', 'SF', 'OF'];

function cloneOutput(output: ProgramOutput[]): ProgramOutput[] {
  return output.map((item) => ({ ...item }));
}

export function cloneCPUState(state: CPUState): CPUState {
  return {
    registers: { ...state.registers },
    memory: new Uint8Array(state.memory),
    halted: state.halted,
    error: state.error,
  };
}

export function clonePerformanceMetrics(metrics: PerformanceMetrics): PerformanceMetrics {
  return { ...metrics };
}

export function createExecutionSnapshot(
  state: CPUState,
  output: ProgramOutput[],
  traceLength: number,
  perf: PerformanceMetrics,
  createdAtMs: number = Date.now()
): ExecutionSnapshot {
  return {
    state: cloneCPUState(state),
    output: cloneOutput(output),
    traceLength,
    perf: clonePerformanceMetrics(perf),
    createdAtMs,
  };
}

export function restoreExecutionSnapshot(snapshot: ExecutionSnapshot): ExecutionSnapshot {
  return createExecutionSnapshot(
    snapshot.state,
    snapshot.output,
    snapshot.traceLength,
    snapshot.perf,
    snapshot.createdAtMs
  );
}

export function createSavedSnapshot(
  label: string,
  step: number,
  base: ExecutionSnapshot
): SavedSnapshot {
  const cleanLabel = label.trim() || `Snapshot ${step}`;
  return {
    id: `snap-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    label: cleanLabel,
    createdAtMs: Date.now(),
    step,
    state: cloneCPUState(base.state),
    output: cloneOutput(base.output),
    traceLength: base.traceLength,
    perf: clonePerformanceMetrics(base.perf),
  };
}

export function compareCPUStates(before: CPUState, after: CPUState, sampleLimit: number = 32): SnapshotComparison {
  const registerDiffs = REGISTER_NAMES
    .filter((registerName) => before.registers[registerName] !== after.registers[registerName])
    .map((registerName) => ({
      register: registerName,
      before: before.registers[registerName],
      after: after.registers[registerName],
    }));

  const beforeFlags = getFlags(before.registers.FLAGS);
  const afterFlags = getFlags(after.registers.FLAGS);
  const flagDiffs = FLAG_NAMES
    .filter((flagName) => beforeFlags[flagName] !== afterFlags[flagName])
    .map((flagName) => ({
      flag: flagName,
      before: beforeFlags[flagName],
      after: afterFlags[flagName],
    }));

  const memoryDiffSample: number[] = [];
  const seen = new Set<number>();
  let memoryDiffCount = 0;

  for (let i = 0; i < before.memory.length; i++) {
    if (before.memory[i] === after.memory[i]) {
      continue;
    }
    const address = i & ~1;
    if (seen.has(address)) {
      continue;
    }
    seen.add(address);
    memoryDiffCount++;
    if (memoryDiffSample.length < sampleLimit) {
      memoryDiffSample.push(address);
    }
  }

  return {
    registerDiffs,
    flagDiffs,
    memoryDiffCount,
    memoryDiffSample: memoryDiffSample.sort((a, b) => a - b),
  };
}
