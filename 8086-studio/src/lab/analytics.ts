import { ExecutionAnalytics, TraceEntry } from '@/lab/types';

function extractOpcode(instructionText: string): string {
  const [opcode] = instructionText.trim().split(/\s+/);
  return (opcode || 'UNK').toUpperCase();
}

export function buildExecutionAnalytics(trace: TraceEntry[]): ExecutionAnalytics {
  if (trace.length === 0) {
    return {
      totalSteps: 0,
      totalCycles: 0,
      averageCycles: 0,
      maxCycles: 0,
      minCycles: 0,
      instructionFrequency: [],
      timeline: [],
    };
  }

  const frequencyMap = new Map<string, { count: number; cycles: number }>();
  const timeline: ExecutionAnalytics['timeline'] = [];

  let cumulativeCycles = 0;
  let maxCycles = Number.NEGATIVE_INFINITY;
  let minCycles = Number.POSITIVE_INFINITY;

  for (const entry of trace) {
    const opcode = extractOpcode(entry.instructionText);
    const current = frequencyMap.get(opcode) ?? { count: 0, cycles: 0 };
    current.count += 1;
    current.cycles += entry.cycles;
    frequencyMap.set(opcode, current);

    cumulativeCycles += entry.cycles;
    maxCycles = Math.max(maxCycles, entry.cycles);
    minCycles = Math.min(minCycles, entry.cycles);
    timeline.push({
      step: entry.step,
      opcode,
      cycles: entry.cycles,
      cumulativeCycles,
      changedSignals: entry.changedRegisters.length + entry.changedFlags.length + entry.changedMemoryWords.length,
    });
  }

  const totalSteps = trace.length;
  const totalCycles = cumulativeCycles;
  const averageCycles = totalCycles / totalSteps;

  const instructionFrequency = Array.from(frequencyMap.entries())
    .map(([opcode, value]) => ({
      opcode,
      count: value.count,
      cycles: value.cycles,
      percentage: Math.round((value.count / totalSteps) * 1000) / 10,
    }))
    .sort((a, b) => b.count - a.count);

  return {
    totalSteps,
    totalCycles,
    averageCycles,
    maxCycles: Number.isFinite(maxCycles) ? maxCycles : 0,
    minCycles: Number.isFinite(minCycles) ? minCycles : 0,
    instructionFrequency,
    timeline,
  };
}
