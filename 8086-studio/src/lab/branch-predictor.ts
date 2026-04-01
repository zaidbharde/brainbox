import { BranchPredictorMode, BranchPredictorStats, TraceEntry } from '@/lab/types';

interface PredictorState {
  oneBit: Map<number, boolean>;
  twoBit: Map<number, number>;
}

const CONDITIONAL_BRANCHES = new Set([
  'JE', 'JZ', 'JNE', 'JNZ', 'JL', 'JNGE', 'JG', 'JNLE',
  'JLE', 'JNG', 'JGE', 'JNL', 'JC', 'JB', 'JNAE',
  'JNC', 'JAE', 'JNB', 'JS', 'JNS', 'JO', 'JNO',
]);

function extractOpcode(instructionText: string): string {
  return instructionText.trim().split(/\s+/)[0]?.toUpperCase() ?? 'UNK';
}

function isConditionalBranch(opcode: string): boolean {
  return CONDITIONAL_BRANCHES.has(opcode);
}

function branchWasTaken(entry: TraceEntry): boolean {
  return entry.ipAfter !== entry.ipBefore + 1;
}

function predictTaken(mode: BranchPredictorMode, state: PredictorState, entry: TraceEntry): boolean {
  switch (mode) {
    case 'always_taken':
      return true;
    case 'always_not_taken':
      return false;
    case 'one_bit':
      return state.oneBit.get(entry.instructionAddress) ?? false;
    case 'two_bit':
      return (state.twoBit.get(entry.instructionAddress) ?? 1) >= 2;
    default:
      return false;
  }
}

function updateState(mode: BranchPredictorMode, state: PredictorState, entry: TraceEntry, taken: boolean): void {
  if (mode === 'one_bit') {
    state.oneBit.set(entry.instructionAddress, taken);
    return;
  }
  if (mode === 'two_bit') {
    const current = state.twoBit.get(entry.instructionAddress) ?? 1;
    const next = taken ? Math.min(3, current + 1) : Math.max(0, current - 1);
    state.twoBit.set(entry.instructionAddress, next);
  }
}

export function analyzeBranchPrediction(trace: TraceEntry[], mode: BranchPredictorMode): BranchPredictorStats {
  const state: PredictorState = {
    oneBit: new Map(),
    twoBit: new Map(),
  };

  let evaluatedBranches = 0;
  let correctPredictions = 0;
  let incorrectPredictions = 0;
  const byOpcodeMap = new Map<string, { total: number; correct: number }>();

  for (const entry of trace) {
    const opcode = extractOpcode(entry.instructionText);
    if (!isConditionalBranch(opcode)) {
      continue;
    }

    evaluatedBranches++;
    const taken = branchWasTaken(entry);
    const predictedTaken = predictTaken(mode, state, entry);
    const correct = predictedTaken === taken;
    if (correct) {
      correctPredictions++;
    } else {
      incorrectPredictions++;
    }

    const bucket = byOpcodeMap.get(opcode) ?? { total: 0, correct: 0 };
    bucket.total += 1;
    if (correct) {
      bucket.correct += 1;
    }
    byOpcodeMap.set(opcode, bucket);

    updateState(mode, state, entry, taken);
  }

  const accuracy = evaluatedBranches === 0
    ? 0
    : Math.round((correctPredictions / evaluatedBranches) * 1000) / 10;

  const byOpcode = Array.from(byOpcodeMap.entries())
    .map(([opcode, values]) => ({
      opcode,
      total: values.total,
      correct: values.correct,
      accuracy: values.total === 0 ? 0 : Math.round((values.correct / values.total) * 1000) / 10,
    }))
    .sort((a, b) => b.total - a.total);

  return {
    mode,
    evaluatedBranches,
    correctPredictions,
    incorrectPredictions,
    accuracy,
    byOpcode,
  };
}
