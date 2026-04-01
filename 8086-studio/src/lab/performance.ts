import { Instruction } from '@/types/cpu';
import { PerformanceMetrics } from '@/lab/types';

const OPCODE_CYCLES: Record<string, number> = {
  MOV: 2,
  ADD: 3,
  ADC: 3,
  SUB: 3,
  SBB: 3,
  MUL: 12,
  DIV: 18,
  MOD: 10,
  NEG: 3,
  INC: 2,
  DEC: 2,
  CMP: 3,
  AND: 2,
  OR: 2,
  XOR: 2,
  NOT: 2,
  SHL: 4,
  SAL: 4,
  SHR: 4,
  SAR: 4,
  PUSH: 4,
  POP: 5,
  CALL: 7,
  RET: 8,
  INT: 14,
  IRET: 16,
  IN: 8,
  OUTP: 8,
  JMP: 4,
  JE: 4,
  JZ: 4,
  JNE: 4,
  JNZ: 4,
  JL: 4,
  JNGE: 4,
  JG: 4,
  JNLE: 4,
  JLE: 4,
  JNG: 4,
  JGE: 4,
  JNL: 4,
  JC: 4,
  JB: 4,
  JNAE: 4,
  JNC: 4,
  JAE: 4,
  JNB: 4,
  JS: 4,
  JNS: 4,
  JO: 4,
  JNO: 4,
  CLC: 2,
  STC: 2,
  CMC: 2,
  OUT: 5,
  OUTC: 5,
  NOP: 1,
  HLT: 1,
};

const DEFAULT_CYCLES = 3;

export function estimateInstructionCycles(instruction: Instruction): number {
  const opcode = instruction.opcode.toUpperCase();
  return OPCODE_CYCLES[opcode] ?? DEFAULT_CYCLES;
}

export function createInitialPerformanceMetrics(): PerformanceMetrics {
  return {
    instructionsExecuted: 0,
    totalCycles: 0,
    elapsedMs: 0,
    simulatedLoad: 0,
    startedAtMs: null,
    lastStepAtMs: null,
  };
}

export function updatePerformanceMetrics(
  previous: PerformanceMetrics,
  cycles: number,
  changedSignals: number,
  nowMs: number
): PerformanceMetrics {
  const startedAtMs = previous.startedAtMs ?? nowMs;
  const instructionsExecuted = previous.instructionsExecuted + 1;
  const totalCycles = previous.totalCycles + cycles;
  const elapsedMs = Math.max(0, nowMs - startedAtMs);

  // Educational load model: blend cycle pressure with state churn.
  const cyclePressure = Math.min(100, Math.round((cycles / 18) * 100));
  const churnPressure = Math.min(100, changedSignals * 12);
  const rawLoad = Math.min(100, Math.round(cyclePressure * 0.7 + churnPressure * 0.3));
  const simulatedLoad = Math.round(previous.simulatedLoad * 0.65 + rawLoad * 0.35);

  return {
    instructionsExecuted,
    totalCycles,
    elapsedMs,
    simulatedLoad,
    startedAtMs,
    lastStepAtMs: nowMs,
  };
}
