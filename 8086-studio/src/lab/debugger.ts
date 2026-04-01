import { executeInstruction, getFlags, parseImmediate, parseRegister, ProgramOutput } from '@/emulator/cpu';
import { CPUState, Instruction, Registers } from '@/types/cpu';
import { estimateInstructionCycles } from '@/lab/performance';
import { ExecuteStepParams, StepDiagnostics } from '@/lab/types';

const FLAG_NAMES: Array<'CF' | 'PF' | 'AF' | 'ZF' | 'SF' | 'OF'> = ['CF', 'PF', 'AF', 'ZF', 'SF', 'OF'];
const REGISTER_NAMES: (keyof Registers)[] = ['AX', 'BX', 'CX', 'DX', 'CS', 'DS', 'ES', 'SS', 'SI', 'DI', 'SP', 'BP', 'IP', 'FLAGS'];
const MAX_MEMORY_WORD_CHANGES = 24;
const MEMORY_SIZE = 4096;

function captureInstructionOutput(state: CPUState, instruction: Instruction): ProgramOutput[] {
  const opcode = instruction.opcode.toUpperCase();
  if (opcode !== 'OUT' && opcode !== 'OUTC') {
    return [];
  }

  const target = instruction.operands[0] ?? '';
  const register = parseRegister(target);
  if (register) {
    if (opcode === 'OUT') {
      return [{ type: 'number', value: state.registers[register] }];
    }

    return [{ type: 'char', value: state.registers[register] & 0xff }];
  }

  const upper = target.trim().toUpperCase();
  if (opcode === 'OUT' || opcode === 'OUTC') {
    const byteMap: Record<string, { word: keyof Registers; shift: number }> = {
      AL: { word: 'AX', shift: 0 },
      AH: { word: 'AX', shift: 8 },
      BL: { word: 'BX', shift: 0 },
      BH: { word: 'BX', shift: 8 },
      CL: { word: 'CX', shift: 0 },
      CH: { word: 'CX', shift: 8 },
      DL: { word: 'DX', shift: 0 },
      DH: { word: 'DX', shift: 8 },
    };
    const byteRegister = byteMap[upper];
    if (byteRegister) {
      const value = (state.registers[byteRegister.word] >> byteRegister.shift) & 0xff;
      return [{ type: opcode === 'OUT' ? 'number' : 'char', value }];
    }
  }

  return [];
}

function diffRegisters(previous: Registers, next: Registers): (keyof Registers)[] {
  return REGISTER_NAMES.filter((registerName) => previous[registerName] !== next[registerName]);
}

function diffFlags(previousFlagsValue: number, nextFlagsValue: number): Array<'CF' | 'PF' | 'AF' | 'ZF' | 'SF' | 'OF'> {
  const previousFlags = getFlags(previousFlagsValue);
  const nextFlags = getFlags(nextFlagsValue);
  return FLAG_NAMES.filter((flagName) => previousFlags[flagName] !== nextFlags[flagName]);
}

function diffMemoryWords(previousMemory: Uint8Array, nextMemory: Uint8Array): number[] {
  const changedWords: number[] = [];
  const seen = new Set<number>();

  for (let i = 0; i < previousMemory.length; i++) {
    if (previousMemory[i] === nextMemory[i]) {
      continue;
    }
    const wordAddress = i & ~1;
    if (seen.has(wordAddress)) {
      continue;
    }
    seen.add(wordAddress);
    changedWords.push(wordAddress);

    if (changedWords.length >= MAX_MEMORY_WORD_CHANGES) {
      break;
    }
  }

  return changedWords.sort((a, b) => a - b);
}

function formatInstruction(instruction: Instruction): string {
  const operands = instruction.operands.join(', ');
  return operands ? `${instruction.opcode} ${operands}` : instruction.opcode;
}

function parseMemoryOperand(operand: string, registers: Registers): number | null {
  const trimmed = operand.trim();
  const match = trimmed.match(/^(?:(?:BYTE|WORD)\s+PTR\s+)?\[(.+)\]$/i);
  if (!match) return null;

  const inner = match[1].replace(/\s+/g, '');
  if (!inner) return null;

  const regMatch = inner.match(/^([A-Za-z]{2})([+-].+)?$/);
  if (regMatch) {
    const reg = parseRegister(regMatch[1]);
    if (!reg) return null;
    let offset = 0;
    if (regMatch[2]) {
      const parsed = parseImmediate(regMatch[2]);
      if (parsed === null) return null;
      offset = parsed;
    }
    return (registers[reg] + offset) & 0xFFFF;
  }

  const imm = parseImmediate(inner);
  if (imm === null) return null;
  return imm & 0xFFFF;
}

function normalizeAddress(address: number): number {
  if (address < 0) {
    return 0;
  }
  if (address >= MEMORY_SIZE) {
    return MEMORY_SIZE - 1;
  }
  return address & ~1;
}

function pushUnique(list: number[], address: number | null): void {
  if (address === null) {
    return;
  }
  const normalized = normalizeAddress(address);
  if (!list.includes(normalized)) {
    list.push(normalized);
  }
}

function detectMemoryAccesses(state: CPUState, instruction: Instruction): { reads: number[]; writes: number[] } {
  const opcode = instruction.opcode.toUpperCase();
  const operands = instruction.operands;
  const reads: number[] = [];
  const writes: number[] = [];

  const mem0 = operands[0] ? parseMemoryOperand(operands[0], state.registers) : null;
  const mem1 = operands[1] ? parseMemoryOperand(operands[1], state.registers) : null;

  switch (opcode) {
    case 'MOV':
      pushUnique(reads, mem1);
      pushUnique(writes, mem0);
      break;
    case 'ADD':
    case 'ADC':
    case 'SUB':
    case 'SBB':
    case 'CMP':
    case 'AND':
    case 'OR':
    case 'XOR':
    case 'MUL':
    case 'DIV':
    case 'MOD':
      pushUnique(reads, mem1 ?? mem0);
      break;
    case 'PUSH':
      pushUnique(reads, mem0);
      pushUnique(writes, state.registers.SP - 2);
      break;
    case 'POP':
      pushUnique(reads, state.registers.SP);
      pushUnique(writes, mem0);
      break;
    case 'CALL':
      pushUnique(writes, state.registers.SP - 2);
      break;
    case 'RET':
      pushUnique(reads, state.registers.SP);
      break;
    case 'INT':
      pushUnique(writes, state.registers.SP - 2);
      pushUnique(writes, state.registers.SP - 4);
      break;
    case 'IRET':
      pushUnique(reads, state.registers.SP);
      pushUnique(reads, state.registers.SP + 2);
      break;
    case 'IN':
      if (operands.length > 1) {
        const port = parseImmediate(operands[1]) ?? 0;
        pushUnique(reads, 0x0300 + (port & 0xFF) * 2);
      }
      break;
    case 'OUTP':
      if (operands.length > 0) {
        const port = parseImmediate(operands[0]) ?? 0;
        pushUnique(writes, 0x0300 + (port & 0xFF) * 2);
      }
      break;
    default:
      pushUnique(reads, mem0);
      pushUnique(reads, mem1);
      break;
  }

  return {
    reads: reads.sort((a, b) => a - b),
    writes: writes.sort((a, b) => a - b),
  };
}

export function executeStepWithDiagnostics({
  state,
  instruction,
  labels,
  stepNumber,
  stepStartedAtMs,
}: ExecuteStepParams): StepDiagnostics {
  const memoryAccesses = detectMemoryAccesses(state, instruction);
  const output = captureInstructionOutput(state, instruction);
  const nextState = executeInstruction(state, instruction, labels);
  const changedRegisters = diffRegisters(state.registers, nextState.registers);
  const changedFlags = diffFlags(state.registers.FLAGS, nextState.registers.FLAGS);
  const changedMemoryWords = diffMemoryWords(state.memory, nextState.memory);
  const cycles = estimateInstructionCycles(instruction);

  return {
    nextState,
    output,
    changedRegisters,
    changedFlags,
    changedMemoryWords,
    memoryReads: memoryAccesses.reads,
    memoryWrites: memoryAccesses.writes,
    cycles,
    traceEntry: {
      step: stepNumber,
      instructionAddress: state.registers.IP,
      instructionText: formatInstruction(instruction),
      ipBefore: state.registers.IP,
      ipAfter: nextState.registers.IP,
      changedRegisters,
      changedFlags,
      changedMemoryWords,
      memoryReads: memoryAccesses.reads,
      memoryWrites: memoryAccesses.writes,
      output,
      cycles,
      timestampMs: stepStartedAtMs,
    },
  };
}
