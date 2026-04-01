import { HazardStats, TraceEntry } from '@/lab/types';

const CONDITIONAL_BRANCHES = new Set([
  'JE', 'JZ', 'JNE', 'JNZ', 'JL', 'JNGE', 'JG', 'JNLE',
  'JLE', 'JNG', 'JGE', 'JNL', 'JC', 'JB', 'JNAE',
  'JNC', 'JAE', 'JNB', 'JS', 'JNS', 'JO', 'JNO',
]);

const BRANCH_OPS = new Set([...Array.from(CONDITIONAL_BRANCHES), 'JMP', 'CALL', 'RET', 'IRET']);

function extractOpcode(instructionText: string): string {
  return instructionText.trim().split(/\s+/)[0]?.toUpperCase() ?? 'UNK';
}

function extractRegisters(instructionText: string): string[] {
  return (instructionText.match(/\b(AX|BX|CX|DX|SI|DI|SP|BP|IP|FLAGS)\b/gi) ?? [])
    .map((token) => token.toUpperCase());
}

export function analyzePipelineHazards(trace: TraceEntry[]): HazardStats {
  if (trace.length === 0) {
    return {
      dataHazards: 0,
      controlHazards: 0,
      structuralHazards: 0,
      simulatedStalls: 0,
    };
  }

  let dataHazards = 0;
  let controlHazards = 0;
  let structuralHazards = 0;
  let simulatedStalls = 0;

  const recentWrites = new Set<string>();

  for (let i = 0; i < trace.length; i++) {
    const entry = trace[i];
    const opcode = extractOpcode(entry.instructionText);
    const regs = extractRegisters(entry.instructionText);

    const hasDataHazard = regs.some((registerName) => recentWrites.has(registerName));
    if (hasDataHazard) {
      dataHazards++;
      simulatedStalls += 1;
    }

    if (CONDITIONAL_BRANCHES.has(opcode)) {
      const taken = entry.ipAfter !== entry.ipBefore + 1;
      controlHazards++;
      if (taken) {
        simulatedStalls += 1;
      }
    }

    // Structural hazard approximation: multi-cycle heavy ops competing for ALU.
    if (entry.cycles >= 10) {
      structuralHazards++;
      simulatedStalls += 1;
    }

    recentWrites.clear();
    for (const changed of entry.changedRegisters) {
      if (changed !== 'IP' && changed !== 'FLAGS') {
        recentWrites.add(changed);
      }
    }
    if (BRANCH_OPS.has(opcode)) {
      recentWrites.add('IP');
    }
  }

  return {
    dataHazards,
    controlHazards,
    structuralHazards,
    simulatedStalls,
  };
}
