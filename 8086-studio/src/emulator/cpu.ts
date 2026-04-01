// Virtual 8086 CPU Emulator - Complete Implementation
import { CPUState, Registers, Flags, Instruction, AssembledProgram } from '../types/cpu';

const MEMORY_SIZE = 4096;
const STACK_START = 4094; // Top of stack
const IO_PORT_BASE = 0x0300;
const IO_PORT_COUNT = 128;
const DATA_SEGMENT_BASE = 0x0100;

export function createInitialState(initialMemory?: Uint8Array): CPUState {
  const memory = new Uint8Array(MEMORY_SIZE);
  if (initialMemory) {
    memory.set(initialMemory.slice(0, MEMORY_SIZE));
  }
  return {
    registers: {
      AX: 0,
      BX: 0,
      CX: 0,
      DX: 0,
      CS: 0,
      DS: DATA_SEGMENT_BASE,
      ES: DATA_SEGMENT_BASE,
      SS: 0,
      SI: 0,
      DI: 0,
      SP: STACK_START,
      BP: 0,
      IP: 0,
      FLAGS: 0,
    },
    memory,
    halted: false,
    error: null,
  };
}

// Flag bit positions (Intel 8086 style)
const FLAG_CF = 0x0001;  // Carry Flag
const FLAG_PF = 0x0004;  // Parity Flag
const FLAG_AF = 0x0010;  // Auxiliary Carry Flag
const FLAG_ZF = 0x0040;  // Zero Flag
const FLAG_SF = 0x0080;  // Sign Flag
const FLAG_OF = 0x0800;  // Overflow Flag

const WORD_MASK = 0xFFFF;
const BYTE_MASK = 0xFF;
const WORD_REGISTERS = ['AX', 'BX', 'CX', 'DX', 'CS', 'DS', 'ES', 'SS', 'SI', 'DI', 'SP', 'BP'] as const;
const BYTE_REGISTER_MAP = {
  AL: { word: 'AX', part: 'low' },
  AH: { word: 'AX', part: 'high' },
  BL: { word: 'BX', part: 'low' },
  BH: { word: 'BX', part: 'high' },
  CL: { word: 'CX', part: 'low' },
  CH: { word: 'CX', part: 'high' },
  DL: { word: 'DX', part: 'low' },
  DH: { word: 'DX', part: 'high' },
} as const;

type WordRegisterName = typeof WORD_REGISTERS[number];
type RegisterOperand =
  | { width: 16; register: WordRegisterName }
  | { width: 8; register: WordRegisterName; part: 'low' | 'high' };
type MemoryOperand = { address: number; width: 8 | 16 };

function mask16(value: number): number {
  return value & WORD_MASK;
}

function mask8(value: number): number {
  return value & BYTE_MASK;
}

function hasEvenParity(byteValue: number): boolean {
  let parity = byteValue & 0xFF;
  parity ^= parity >> 4;
  parity ^= parity >> 2;
  parity ^= parity >> 1;
  return (parity & 1) === 0;
}

function baseResultFlags(result16: number): number {
  let flags = 0;
  const res = result16 & WORD_MASK;

  if (res === 0) {
    flags |= FLAG_ZF;
  }
  if ((res & 0x8000) !== 0) {
    flags |= FLAG_SF;
  }
  if (hasEvenParity(res & 0xFF)) {
    flags |= FLAG_PF;
  }

  return flags;
}

function setFlagsAdd(a: number, b: number, result: number): number {
  const res16 = mask16(result);
  let flags = baseResultFlags(res16);

  if (result > WORD_MASK) {
    flags |= FLAG_CF;
  }
  if (((a ^ b ^ res16) & 0x10) !== 0) {
    flags |= FLAG_AF;
  }

  const signA = (a & 0x8000) !== 0;
  const signB = (b & 0x8000) !== 0;
  const signR = (res16 & 0x8000) !== 0;
  if (signA === signB && signR !== signA) {
    flags |= FLAG_OF;
  }

  return flags;
}

function setFlagsSub(a: number, b: number, result: number): number {
  const res16 = mask16(result);
  let flags = baseResultFlags(res16);

  if ((a & WORD_MASK) < (b & WORD_MASK)) {
    flags |= FLAG_CF;
  }
  if (((a ^ b ^ res16) & 0x10) !== 0) {
    flags |= FLAG_AF;
  }

  const signA = (a & 0x8000) !== 0;
  const signB = (b & 0x8000) !== 0;
  const signR = (res16 & 0x8000) !== 0;
  if (signA !== signB && signR !== signA) {
    flags |= FLAG_OF;
  }

  return flags;
}

function setFlagsLogic(result16: number): number {
  return baseResultFlags(result16);
}

function setFlagsShift(result16: number, carry: boolean, overflow: boolean | null, previousFlags: number): number {
  let flags = baseResultFlags(result16);

  if (carry) {
    flags |= FLAG_CF;
  }
  if (overflow === true) {
    flags |= FLAG_OF;
  } else if (overflow === null && (previousFlags & FLAG_OF)) {
    flags |= FLAG_OF;
  }

  return flags;
}

export function getFlags(flags: number): Flags {
  return {
    CF: (flags & FLAG_CF) !== 0,
    PF: (flags & FLAG_PF) !== 0,
    AF: (flags & FLAG_AF) !== 0,
    ZF: (flags & FLAG_ZF) !== 0,
    SF: (flags & FLAG_SF) !== 0,
    OF: (flags & FLAG_OF) !== 0,
  };
}

export function setFlags(a: number, b: number, result: number, isSubtraction: boolean = false): number {
  return isSubtraction ? setFlagsSub(a, b, result) : setFlagsAdd(a, b, result);
}

export function parseRegister(operand: string): keyof Registers | null {
  const upper = operand.toUpperCase().trim();
  if ((WORD_REGISTERS as readonly string[]).includes(upper)) {
    return upper as keyof Registers;
  }
  return null;
}

function parseRegisterOperand(operand: string): RegisterOperand | null {
  const upper = operand.toUpperCase().trim();
  if ((WORD_REGISTERS as readonly string[]).includes(upper)) {
    return { width: 16, register: upper as WordRegisterName };
  }

  const alias = BYTE_REGISTER_MAP[upper as keyof typeof BYTE_REGISTER_MAP];
  if (!alias) {
    return null;
  }

  return {
    width: 8,
    register: alias.word,
    part: alias.part,
  };
}

export function parseImmediate(operand: string): number | null {
  const trimmed = operand.trim();
  if (!trimmed) return null;

  const sign = trimmed.startsWith('-') ? -1 : 1;
  const normalized = trimmed.replace(/^[+-]/, '');

  // Decimal number
  if (/^\d+$/.test(normalized)) {
    return sign * parseInt(normalized, 10);
  }

  // Hex with 0x prefix
  if (/^0x[0-9A-Fa-f]+$/i.test(normalized)) {
    return sign * parseInt(normalized.slice(2), 16);
  }

  // Hex with h suffix
  if (/^[0-9A-Fa-f]+h$/i.test(normalized)) {
    return sign * parseInt(normalized.slice(0, -1), 16);
  }

  // Binary with 0b prefix
  if (/^0b[01]+$/i.test(normalized)) {
    return sign * parseInt(normalized.slice(2), 2);
  }

  return null;
}

function parseMemoryOperand(operand: string, registers: Registers): MemoryOperand | null {
  const trimmed = operand.trim();
  const match = trimmed.match(/^(?:(BYTE|WORD)\s+PTR\s+)?\[(.+)\]$/i);
  if (!match) return null;

  const width = match[1]?.toUpperCase() === 'BYTE' ? 8 : 16;
  const inner = match[2].replace(/\s+/g, '');
  if (!inner) return null;

  // Register or register +/- offset
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
    return { address: mask16(registers[reg] + offset), width };
  }

  // Direct address
  const imm = parseImmediate(inner);
  if (imm === null) return null;
  return { address: mask16(imm), width };
}

function readByte(state: CPUState, address: number): number {
  if (address < 0 || address >= state.memory.length) {
    throw new Error(`Memory read out of bounds: 0x${address.toString(16).toUpperCase()}`);
  }
  return state.memory[address];
}

function readWord(state: CPUState, address: number): number {
  if (address < 0 || address + 1 >= state.memory.length) {
    throw new Error(`Memory read out of bounds: 0x${address.toString(16).toUpperCase()}`);
  }
  return state.memory[address] | (state.memory[address + 1] << 8);
}

function writeByte(state: CPUState, address: number, value: number): void {
  if (address < 0 || address >= state.memory.length) {
    throw new Error(`Memory write out of bounds: 0x${address.toString(16).toUpperCase()}`);
  }
  state.memory[address] = mask8(value);
}

function writeWord(state: CPUState, address: number, value: number): void {
  if (address < 0 || address + 1 >= state.memory.length) {
    throw new Error(`Memory write out of bounds: 0x${address.toString(16).toUpperCase()}`);
  }
  const val = mask16(value);
  state.memory[address] = val & 0xFF;
  state.memory[address + 1] = (val >> 8) & 0xFF;
}

function readRegisterValue(register: RegisterOperand, registers: Registers): number {
  const wordValue = registers[register.register];
  if (register.width === 16) {
    return wordValue;
  }
  return register.part === 'low' ? (wordValue & BYTE_MASK) : ((wordValue >> 8) & BYTE_MASK);
}

function writeRegisterValue(register: RegisterOperand, registers: Registers, value: number): void {
  if (register.width === 16) {
    registers[register.register] = mask16(value);
    return;
  }

  const wordValue = registers[register.register];
  if (register.part === 'low') {
    registers[register.register] = (wordValue & 0xFF00) | mask8(value);
  } else {
    registers[register.register] = ((mask8(value) << 8) | (wordValue & BYTE_MASK)) & WORD_MASK;
  }
}

function readMemoryValue(state: CPUState, memory: MemoryOperand): number {
  return memory.width === 8 ? readByte(state, memory.address) : readWord(state, memory.address);
}

function writeMemoryValue(state: CPUState, memory: MemoryOperand, value: number): void {
  if (memory.width === 8) {
    writeByte(state, memory.address, value);
  } else {
    writeWord(state, memory.address, value);
  }
}

function resolveJumpTarget(
  targetOperand: string,
  labels: Map<string, number>,
  _state: CPUState
): number {
  const normalized = targetOperand.trim().toUpperCase();
  const labelAddress = labels.get(normalized);
  if (labelAddress !== undefined) {
    return labelAddress;
  }

  const immediate = parseImmediate(targetOperand);
  if (immediate !== null) {
    return immediate;
  }

  throw new Error(`Unknown jump/call target: ${targetOperand}`);
}

function resolveInterruptTarget(
  vectorOperand: string,
  labels: Map<string, number>,
  state: CPUState
): number {
  const immediate = parseImmediate(vectorOperand);
  if (immediate === null) {
    return resolveJumpTarget(vectorOperand, labels, state);
  }

  const vector = immediate & 0xFF;
  const vectorLabelCandidates = [
    `ISR_${vector}`,
    `INT_${vector}`,
    `ISR${vector}`,
    `INT${vector}`,
  ];
  for (const candidate of vectorLabelCandidates) {
    const target = labels.get(candidate);
    if (target !== undefined) {
      return target;
    }
  }

  const tableAddress = vector * 2;
  const mappedAddress = readWord(state, tableAddress);
  return mappedAddress;
}

function getPortAddress(portValue: number): number {
  const port = portValue & 0xFF;
  if (port >= IO_PORT_COUNT) {
    throw new Error(`Invalid I/O port: ${port}`);
  }
  return IO_PORT_BASE + port * 2;
}

function resolveValue(state: CPUState, operand: string): number {
  const reg = parseRegisterOperand(operand);
  if (reg) {
    return readRegisterValue(reg, state.registers);
  }
  const memOperand = parseMemoryOperand(operand, state.registers);
  if (memOperand !== null) {
    return readMemoryValue(state, memOperand);
  }
  const imm = parseImmediate(operand);
  if (imm !== null) {
    return imm;
  }
  throw new Error(`Invalid operand: ${operand}`);
}

export function executeInstruction(
  state: CPUState,
  instruction: Instruction,
  labels: Map<string, number>
): CPUState {
  // Deep copy state
  const newState: CPUState = {
    registers: { ...state.registers },
    memory: new Uint8Array(state.memory),
    halted: state.halted,
    error: state.error,
  };
  
  const { opcode, operands } = instruction;
  
  try {
    switch (opcode.toUpperCase()) {
      case 'MOV': {
        const destReg = parseRegisterOperand(operands[0]);
        const destMem = parseMemoryOperand(operands[0], newState.registers);
        const srcReg = parseRegisterOperand(operands[1]);
        const srcMem = parseMemoryOperand(operands[1], newState.registers);
        const srcImm = srcReg || srcMem !== null ? null : parseImmediate(operands[1]);

        if (!destReg && destMem === null) {
          throw new Error(`Invalid destination: ${operands[0]}`);
        }
        if (!srcReg && srcMem === null && srcImm === null) {
          throw new Error(`Invalid source: ${operands[1]}`);
        }
        if (destMem !== null && srcMem !== null) {
          throw new Error('Memory to memory MOV is not supported');
        }

        let value: number;
        if (srcReg) {
          value = readRegisterValue(srcReg, newState.registers);
        } else if (srcMem !== null) {
          value = readMemoryValue(newState, srcMem);
        } else {
          value = srcImm as number;
        }

        if (destReg) {
          writeRegisterValue(destReg, newState.registers, value);
        } else if (destMem !== null) {
          writeMemoryValue(newState, destMem, value);
        }
        newState.registers.IP++;
        break;
      }
      
      case 'ADD': {
        const destReg = parseRegisterOperand(operands[0]);
        const destMem = parseMemoryOperand(operands[0], newState.registers);
        if (!destReg && !destMem) throw new Error(`Invalid destination: ${operands[0]}`);
        
        const value = resolveValue(newState, operands[1]);
        const width = destReg?.width ?? destMem!.width;
        const a = destReg ? readRegisterValue(destReg, newState.registers) : readMemoryValue(newState, destMem!);
        const mask = width === 8 ? BYTE_MASK : WORD_MASK;
        const b = value & mask;
        const result = a + b;
        if (destReg) {
          writeRegisterValue(destReg, newState.registers, result);
        } else {
          writeMemoryValue(newState, destMem!, result);
        }
        newState.registers.FLAGS = setFlagsAdd(a, b, width === 8 ? mask8(result) : result);
        newState.registers.IP++;
        break;
      }

      case 'ADC': {
        const destReg = parseRegisterOperand(operands[0]);
        const destMem = parseMemoryOperand(operands[0], newState.registers);
        if (!destReg && !destMem) throw new Error(`Invalid destination: ${operands[0]}`);

        const value = resolveValue(newState, operands[1]);
        const carry = (newState.registers.FLAGS & FLAG_CF) ? 1 : 0;
        const width = destReg?.width ?? destMem!.width;
        const mask = width === 8 ? BYTE_MASK : WORD_MASK;
        const a = destReg ? readRegisterValue(destReg, newState.registers) : readMemoryValue(newState, destMem!);
        const b = (value & mask) + carry;
        const result = a + b;
        if (destReg) {
          writeRegisterValue(destReg, newState.registers, result);
        } else {
          writeMemoryValue(newState, destMem!, result);
        }
        newState.registers.FLAGS = setFlagsAdd(a, b, width === 8 ? mask8(result) : result);
        newState.registers.IP++;
        break;
      }
      
      case 'SUB': {
        const destReg = parseRegisterOperand(operands[0]);
        const destMem = parseMemoryOperand(operands[0], newState.registers);
        if (!destReg && !destMem) throw new Error(`Invalid destination: ${operands[0]}`);
        
        const value = resolveValue(newState, operands[1]);
        const width = destReg?.width ?? destMem!.width;
        const mask = width === 8 ? BYTE_MASK : WORD_MASK;
        const a = destReg ? readRegisterValue(destReg, newState.registers) : readMemoryValue(newState, destMem!);
        const b = value & mask;
        const result = a - b;
        if (destReg) {
          writeRegisterValue(destReg, newState.registers, result);
        } else {
          writeMemoryValue(newState, destMem!, result);
        }
        newState.registers.FLAGS = setFlagsSub(a, b, width === 8 ? mask8(result) : result);
        newState.registers.IP++;
        break;
      }

      case 'SBB': {
        const destReg = parseRegisterOperand(operands[0]);
        const destMem = parseMemoryOperand(operands[0], newState.registers);
        if (!destReg && !destMem) throw new Error(`Invalid destination: ${operands[0]}`);

        const value = resolveValue(newState, operands[1]);
        const borrow = (newState.registers.FLAGS & FLAG_CF) ? 1 : 0;
        const width = destReg?.width ?? destMem!.width;
        const mask = width === 8 ? BYTE_MASK : WORD_MASK;
        const a = destReg ? readRegisterValue(destReg, newState.registers) : readMemoryValue(newState, destMem!);
        const b = (value & mask) + borrow;
        const result = a - b;
        if (destReg) {
          writeRegisterValue(destReg, newState.registers, result);
        } else {
          writeMemoryValue(newState, destMem!, result);
        }
        newState.registers.FLAGS = setFlagsSub(a, b, width === 8 ? mask8(result) : result);
        newState.registers.IP++;
        break;
      }
      
      case 'MUL': {
        const regOperand = parseRegisterOperand(operands[0]);
        const memOperand = parseMemoryOperand(operands[0], newState.registers);
        const width = regOperand?.width ?? memOperand?.width ?? 16;
        const value = resolveValue(newState, operands[0]) & (width === 8 ? BYTE_MASK : WORD_MASK);
        let upper = 0;

        if (width === 8) {
          const result = (readRegisterValue({ width: 8, register: 'AX', part: 'low' }, newState.registers) & BYTE_MASK) * value;
          writeRegisterValue({ width: 16, register: 'AX' }, newState.registers, result);
          upper = (result >> 8) & BYTE_MASK;
        } else {
          const result = (newState.registers.AX & WORD_MASK) * value;
          newState.registers.AX = result & WORD_MASK;
          newState.registers.DX = (result >>> 16) & WORD_MASK;
          upper = newState.registers.DX;
        }

        let flags = newState.registers.FLAGS & ~(FLAG_CF | FLAG_OF);
        if (upper !== 0) {
          flags |= FLAG_CF | FLAG_OF;
        }
        newState.registers.FLAGS = flags;
        newState.registers.IP++;
        break;
      }
      
      case 'DIV': {
        const regOperand = parseRegisterOperand(operands[0]);
        const memOperand = parseMemoryOperand(operands[0], newState.registers);
        const width = regOperand?.width ?? memOperand?.width ?? 16;
        const divisor = resolveValue(newState, operands[0]) & (width === 8 ? BYTE_MASK : WORD_MASK);
        if (divisor === 0) {
          throw new Error('Division by zero');
        }

        if (width === 8) {
          const dividend = newState.registers.AX & WORD_MASK;
          const quotient = Math.floor(dividend / divisor);
          const remainder = dividend % divisor;
          if (quotient > BYTE_MASK) {
            throw new Error('Division overflow');
          }
          writeRegisterValue({ width: 8, register: 'AX', part: 'low' }, newState.registers, quotient);
          writeRegisterValue({ width: 8, register: 'AX', part: 'high' }, newState.registers, remainder);
        } else {
          const dividend = (((newState.registers.DX & WORD_MASK) << 16) | (newState.registers.AX & WORD_MASK)) >>> 0;
          const quotient = Math.floor(dividend / divisor);
          const remainder = dividend % divisor;
          if (quotient > WORD_MASK) {
            throw new Error('Division overflow');
          }
          newState.registers.AX = quotient & WORD_MASK;
          newState.registers.DX = remainder & WORD_MASK;
        }
        newState.registers.IP++;
        break;
      }
      
      case 'MOD': {
        const regOperand = parseRegisterOperand(operands[0]);
        const memOperand = parseMemoryOperand(operands[0], newState.registers);
        const width = regOperand?.width ?? memOperand?.width ?? 16;
        const divisor = resolveValue(newState, operands[0]) & (width === 8 ? BYTE_MASK : WORD_MASK);
        if (divisor === 0) {
          throw new Error('Division by zero');
        }

        if (width === 8) {
          const dividend = readRegisterValue({ width: 8, register: 'AX', part: 'low' }, newState.registers) & BYTE_MASK;
          writeRegisterValue({ width: 8, register: 'AX', part: 'low' }, newState.registers, dividend % divisor);
        } else {
          const dividend = newState.registers.AX & WORD_MASK;
          newState.registers.AX = dividend % divisor;
        }
        newState.registers.IP++;
        break;
      }
      
      case 'NEG': {
        const destReg = parseRegisterOperand(operands[0]);
        const destMem = parseMemoryOperand(operands[0], newState.registers);
        if (!destReg && !destMem) throw new Error(`Invalid destination: ${operands[0]}`);

        const width = destReg?.width ?? destMem!.width;
        const val = destReg ? readRegisterValue(destReg, newState.registers) : readMemoryValue(newState, destMem!);
        const result = -val;
        if (destReg) {
          writeRegisterValue(destReg, newState.registers, result);
        } else {
          writeMemoryValue(newState, destMem!, result);
        }
        newState.registers.FLAGS = setFlagsSub(0, val, width === 8 ? mask8(result) : result);
        newState.registers.IP++;
        break;
      }
      
      case 'AND': {
        const destReg = parseRegisterOperand(operands[0]);
        const destMem = parseMemoryOperand(operands[0], newState.registers);
        if (!destReg && !destMem) throw new Error(`Invalid destination: ${operands[0]}`);
        
        const value = resolveValue(newState, operands[1]);
        const width = destReg?.width ?? destMem!.width;
        const mask = width === 8 ? BYTE_MASK : WORD_MASK;
        const current = destReg ? readRegisterValue(destReg, newState.registers) : readMemoryValue(newState, destMem!);
        const result = (current & value) & mask;
        if (destReg) {
          writeRegisterValue(destReg, newState.registers, result);
        } else {
          writeMemoryValue(newState, destMem!, result);
        }
        newState.registers.FLAGS = setFlagsLogic(result);
        newState.registers.IP++;
        break;
      }
      
      case 'OR': {
        const destReg = parseRegisterOperand(operands[0]);
        const destMem = parseMemoryOperand(operands[0], newState.registers);
        if (!destReg && !destMem) throw new Error(`Invalid destination: ${operands[0]}`);
        
        const value = resolveValue(newState, operands[1]);
        const width = destReg?.width ?? destMem!.width;
        const mask = width === 8 ? BYTE_MASK : WORD_MASK;
        const current = destReg ? readRegisterValue(destReg, newState.registers) : readMemoryValue(newState, destMem!);
        const result = (current | value) & mask;
        if (destReg) {
          writeRegisterValue(destReg, newState.registers, result);
        } else {
          writeMemoryValue(newState, destMem!, result);
        }
        newState.registers.FLAGS = setFlagsLogic(result);
        newState.registers.IP++;
        break;
      }
      
      case 'XOR': {
        const destReg = parseRegisterOperand(operands[0]);
        const destMem = parseMemoryOperand(operands[0], newState.registers);
        if (!destReg && !destMem) throw new Error(`Invalid destination: ${operands[0]}`);
        
        const value = resolveValue(newState, operands[1]);
        const width = destReg?.width ?? destMem!.width;
        const mask = width === 8 ? BYTE_MASK : WORD_MASK;
        const current = destReg ? readRegisterValue(destReg, newState.registers) : readMemoryValue(newState, destMem!);
        const result = (current ^ value) & mask;
        if (destReg) {
          writeRegisterValue(destReg, newState.registers, result);
        } else {
          writeMemoryValue(newState, destMem!, result);
        }
        newState.registers.FLAGS = setFlagsLogic(result);
        newState.registers.IP++;
        break;
      }
      
      case 'NOT': {
        const destReg = parseRegisterOperand(operands[0]);
        const destMem = parseMemoryOperand(operands[0], newState.registers);
        if (!destReg && !destMem) throw new Error(`Invalid destination: ${operands[0]}`);

        const width = destReg?.width ?? destMem!.width;
        const mask = width === 8 ? BYTE_MASK : WORD_MASK;
        const current = destReg ? readRegisterValue(destReg, newState.registers) : readMemoryValue(newState, destMem!);
        const result = (~current) & mask;
        if (destReg) {
          writeRegisterValue(destReg, newState.registers, result);
        } else {
          writeMemoryValue(newState, destMem!, result);
        }
        newState.registers.IP++;
        break;
      }
      
      case 'SHL':
      case 'SAL': {
        const destReg = parseRegisterOperand(operands[0]);
        const destMem = parseMemoryOperand(operands[0], newState.registers);
        if (!destReg && !destMem) throw new Error(`Invalid destination: ${operands[0]}`);
        
        let count = 1;
        if (operands.length > 1) {
          const srcReg = parseRegisterOperand(operands[1]);
          if (srcReg) {
            count = readRegisterValue(srcReg, newState.registers) & 0x1F;
          } else {
            const imm = parseImmediate(operands[1]);
            if (imm !== null) count = imm & 0x1F;
          }
        }

        count &= 0x1F;
        if (count === 0) {
          newState.registers.IP++;
          break;
        }

        const width = destReg?.width ?? destMem!.width;
        const maxBits = width === 8 ? 8 : 16;
        const mask = width === 8 ? BYTE_MASK : WORD_MASK;
        const signBit = width === 8 ? 0x80 : 0x8000;
        const value = destReg ? readRegisterValue(destReg, newState.registers) : readMemoryValue(newState, destMem!);
        const shift = Math.min(count, maxBits);
        const carry = ((value >> (maxBits - shift)) & 1) !== 0;
        const result = (value << shift) & mask;
        const overflow = count === 1 ? (((result ^ value) & signBit) !== 0) : null;
        if (destReg) {
          writeRegisterValue(destReg, newState.registers, result);
        } else {
          writeMemoryValue(newState, destMem!, result);
        }
        newState.registers.FLAGS = setFlagsShift(result, carry, overflow, newState.registers.FLAGS);
        newState.registers.IP++;
        break;
      }
      
      case 'SHR': {
        const destReg = parseRegisterOperand(operands[0]);
        const destMem = parseMemoryOperand(operands[0], newState.registers);
        if (!destReg && !destMem) throw new Error(`Invalid destination: ${operands[0]}`);
        
        let count = 1;
        if (operands.length > 1) {
          const srcReg = parseRegisterOperand(operands[1]);
          if (srcReg) {
            count = readRegisterValue(srcReg, newState.registers) & 0x1F;
          } else {
            const imm = parseImmediate(operands[1]);
            if (imm !== null) count = imm & 0x1F;
          }
        }

        count &= 0x1F;
        if (count === 0) {
          newState.registers.IP++;
          break;
        }

        const width = destReg?.width ?? destMem!.width;
        const maxBits = width === 8 ? 8 : 16;
        const value = destReg ? readRegisterValue(destReg, newState.registers) : readMemoryValue(newState, destMem!);
        const shift = Math.min(count, maxBits);
        const carry = ((value >> (shift - 1)) & 1) !== 0;
        const result = width === 8 ? ((value >>> shift) & BYTE_MASK) : ((value >>> shift) & WORD_MASK);
        const overflow = count === 1 ? ((value & (width === 8 ? 0x80 : 0x8000)) !== 0) : null;
        if (destReg) {
          writeRegisterValue(destReg, newState.registers, result);
        } else {
          writeMemoryValue(newState, destMem!, result);
        }
        newState.registers.FLAGS = setFlagsShift(result, carry, overflow, newState.registers.FLAGS);
        newState.registers.IP++;
        break;
      }

      case 'SAR': {
        const destReg = parseRegisterOperand(operands[0]);
        const destMem = parseMemoryOperand(operands[0], newState.registers);
        if (!destReg && !destMem) throw new Error(`Invalid destination: ${operands[0]}`);

        let count = 1;
        if (operands.length > 1) {
          const srcReg = parseRegisterOperand(operands[1]);
          if (srcReg) {
            count = readRegisterValue(srcReg, newState.registers) & 0x1F;
          } else {
            const imm = parseImmediate(operands[1]);
            if (imm !== null) count = imm & 0x1F;
          }
        }

        count &= 0x1F;
        if (count === 0) {
          newState.registers.IP++;
          break;
        }

        const width = destReg?.width ?? destMem!.width;
        const maxBits = width === 8 ? 8 : 16;
        const signBit = width === 8 ? 0x80 : 0x8000;
        const mask = width === 8 ? BYTE_MASK : WORD_MASK;
        const value = destReg ? readRegisterValue(destReg, newState.registers) : readMemoryValue(newState, destMem!);
        const signed = (value & signBit) ? (value | ~mask) : value;
        const shift = Math.min(count, maxBits);
        const carry = ((value >> (shift - 1)) & 1) !== 0;
        const result = (signed >> shift) & mask;
        const overflow = count === 1 ? false : null;
        if (destReg) {
          writeRegisterValue(destReg, newState.registers, result);
        } else {
          writeMemoryValue(newState, destMem!, result);
        }
        newState.registers.FLAGS = setFlagsShift(result, carry, overflow, newState.registers.FLAGS);
        newState.registers.IP++;
        break;
      }
      
      case 'CMP': {
        const destReg = parseRegisterOperand(operands[0]);
        const destMem = parseMemoryOperand(operands[0], newState.registers);
        if (!destReg && !destMem) throw new Error(`Invalid destination: ${operands[0]}`);
        
        const value = resolveValue(newState, operands[1]);
        const width = destReg?.width ?? destMem!.width;
        const mask = width === 8 ? BYTE_MASK : WORD_MASK;
        const a = destReg ? readRegisterValue(destReg, newState.registers) : readMemoryValue(newState, destMem!);
        const b = value & mask;
        const result = a - b;
        newState.registers.FLAGS = setFlagsSub(a, b, width === 8 ? mask8(result) : result);
        newState.registers.IP++;
        break;
      }
      
      case 'INC': {
        const destReg = parseRegisterOperand(operands[0]);
        const destMem = parseMemoryOperand(operands[0], newState.registers);
        if (!destReg && !destMem) throw new Error(`Invalid destination: ${operands[0]}`);
        
        const width = destReg?.width ?? destMem!.width;
        const a = destReg ? readRegisterValue(destReg, newState.registers) : readMemoryValue(newState, destMem!);
        const result = a + 1;
        if (destReg) {
          writeRegisterValue(destReg, newState.registers, result);
        } else {
          writeMemoryValue(newState, destMem!, result);
        }
        // INC doesn't affect CF
        const oldCF = newState.registers.FLAGS & FLAG_CF;
        const normalizedResult = width === 8 ? mask8(result) : result;
        newState.registers.FLAGS = (setFlagsAdd(a, 1, normalizedResult) & ~FLAG_CF) | oldCF;
        newState.registers.IP++;
        break;
      }
      
      case 'DEC': {
        const destReg = parseRegisterOperand(operands[0]);
        const destMem = parseMemoryOperand(operands[0], newState.registers);
        if (!destReg && !destMem) throw new Error(`Invalid destination: ${operands[0]}`);
        
        const width = destReg?.width ?? destMem!.width;
        const a = destReg ? readRegisterValue(destReg, newState.registers) : readMemoryValue(newState, destMem!);
        const result = a - 1;
        if (destReg) {
          writeRegisterValue(destReg, newState.registers, result);
        } else {
          writeMemoryValue(newState, destMem!, result);
        }
        // DEC doesn't affect CF
        const oldCF = newState.registers.FLAGS & FLAG_CF;
        const normalizedResult = width === 8 ? mask8(result) : result;
        newState.registers.FLAGS = (setFlagsSub(a, 1, normalizedResult) & ~FLAG_CF) | oldCF;
        newState.registers.IP++;
        break;
      }
      
      case 'PUSH': {
        const srcReg = parseRegisterOperand(operands[0]);
        const srcMem = parseMemoryOperand(operands[0], newState.registers);
        if (!srcReg && srcMem === null) throw new Error(`Invalid source: ${operands[0]}`);

        const value = srcReg ? readRegisterValue(srcReg, newState.registers) : readMemoryValue(newState, srcMem as MemoryOperand);
        const nextSp = newState.registers.SP - 2;
        if (nextSp < 0) throw new Error('Stack overflow');
        newState.registers.SP = nextSp;
        writeWord(newState, nextSp, value);
        newState.registers.IP++;
        break;
      }
      
      case 'POP': {
        const destReg = parseRegisterOperand(operands[0]);
        const destMem = parseMemoryOperand(operands[0], newState.registers);
        if (!destReg && destMem === null) throw new Error(`Invalid destination: ${operands[0]}`);

        const sp = newState.registers.SP;
        if (sp < 0 || sp + 1 >= newState.memory.length) {
          throw new Error('Stack underflow');
        }
        const val = readWord(newState, sp);
        if (destReg) {
          writeRegisterValue(destReg, newState.registers, val);
        } else if (destMem !== null) {
          writeMemoryValue(newState, destMem, val);
        }
        newState.registers.SP += 2;
        newState.registers.IP++;
        break;
      }

      case 'CALL': {
        const target = resolveJumpTarget(operands[0], labels, newState);
        const nextSp = newState.registers.SP - 2;
        if (nextSp < 0) throw new Error('Stack overflow');
        writeWord(newState, nextSp, newState.registers.IP + 1);
        newState.registers.SP = nextSp;
        newState.registers.IP = target;
        break;
      }

      case 'RET': {
        const sp = newState.registers.SP;
        if (sp < 0 || sp + 1 >= newState.memory.length) {
          throw new Error('Stack underflow');
        }
        const returnAddress = readWord(newState, sp);
        newState.registers.SP = sp + 2;
        newState.registers.IP = returnAddress;
        break;
      }

      case 'INT': {
        if (operands.length < 1) {
          throw new Error('INT requires vector operand');
        }

        const vector = parseImmediate(operands[0]);
        if (vector === 0x03 || vector === 0x20) {
          newState.halted = true;
          newState.registers.IP += 1;
          break;
        }

        if (vector === 0x21) {
          const ah = readRegisterValue({ width: 8, register: 'AX', part: 'high' }, newState.registers);
          if (ah === 0x4C) {
            newState.halted = true;
            newState.registers.IP += 1;
            break;
          }
          if (ah === 0x02 || ah === 0x09) {
            newState.registers.IP += 1;
            break;
          }
        }

        const target = resolveInterruptTarget(operands[0], labels, newState);

        const pushSp1 = newState.registers.SP - 2;
        const pushSp2 = pushSp1 - 2;
        if (pushSp2 < 0) throw new Error('Stack overflow during INT');

        // Save FLAGS then return IP for IRET.
        writeWord(newState, pushSp1, newState.registers.FLAGS);
        writeWord(newState, pushSp2, newState.registers.IP + 1);
        newState.registers.SP = pushSp2;
        newState.registers.IP = target;
        break;
      }

      case 'IRET': {
        const sp = newState.registers.SP;
        if (sp < 0 || sp + 3 >= newState.memory.length) {
          throw new Error('Stack underflow during IRET');
        }
        const returnIp = readWord(newState, sp);
        const restoredFlags = readWord(newState, sp + 2);
        newState.registers.SP = sp + 4;
        newState.registers.IP = returnIp;
        newState.registers.FLAGS = restoredFlags;
        break;
      }

      case 'IN': {
        const dest = parseRegisterOperand(operands[0]);
        if (!dest) throw new Error(`Invalid destination register: ${operands[0]}`);
        const portValue = parseImmediate(operands[1]);
        if (portValue === null) throw new Error(`Invalid input port: ${operands[1]}`);
        const portAddress = getPortAddress(portValue);
        writeRegisterValue(dest, newState.registers, readWord(newState, portAddress));
        newState.registers.IP++;
        break;
      }

      case 'OUTP': {
        const portValue = parseImmediate(operands[0]);
        if (portValue === null) throw new Error(`Invalid output port: ${operands[0]}`);
        const src = parseRegisterOperand(operands[1]);
        if (!src) throw new Error(`Invalid source register: ${operands[1]}`);
        const portAddress = getPortAddress(portValue);
        writeWord(newState, portAddress, readRegisterValue(src, newState.registers));
        newState.registers.IP++;
        break;
      }
      
      case 'JMP': {
        newState.registers.IP = resolveJumpTarget(operands[0], labels, newState);
        break;
      }
      
      case 'JE':
      case 'JZ': {
        const flags = getFlags(newState.registers.FLAGS);
        if (flags.ZF) {
          const label = operands[0].trim().toUpperCase();
          const addr = labels.get(label);
          if (addr === undefined) throw new Error(`Unknown label: ${label}`);
          newState.registers.IP = addr;
        } else {
          newState.registers.IP++;
        }
        break;
      }
      
      case 'JNE':
      case 'JNZ': {
        const flags = getFlags(newState.registers.FLAGS);
        if (!flags.ZF) {
          const label = operands[0].trim().toUpperCase();
          const addr = labels.get(label);
          if (addr === undefined) throw new Error(`Unknown label: ${label}`);
          newState.registers.IP = addr;
        } else {
          newState.registers.IP++;
        }
        break;
      }
      
      case 'JL':
      case 'JNGE': {
        const flags = getFlags(newState.registers.FLAGS);
        // SF != OF
        if (flags.SF !== flags.OF) {
          const label = operands[0].trim().toUpperCase();
          const addr = labels.get(label);
          if (addr === undefined) throw new Error(`Unknown label: ${label}`);
          newState.registers.IP = addr;
        } else {
          newState.registers.IP++;
        }
        break;
      }
      
      case 'JG':
      case 'JNLE': {
        const flags = getFlags(newState.registers.FLAGS);
        // ZF = 0 and SF = OF
        if (!flags.ZF && flags.SF === flags.OF) {
          const label = operands[0].trim().toUpperCase();
          const addr = labels.get(label);
          if (addr === undefined) throw new Error(`Unknown label: ${label}`);
          newState.registers.IP = addr;
        } else {
          newState.registers.IP++;
        }
        break;
      }
      
      case 'JLE':
      case 'JNG': {
        const flags = getFlags(newState.registers.FLAGS);
        // ZF = 1 or SF != OF
        if (flags.ZF || flags.SF !== flags.OF) {
          const label = operands[0].trim().toUpperCase();
          const addr = labels.get(label);
          if (addr === undefined) throw new Error(`Unknown label: ${label}`);
          newState.registers.IP = addr;
        } else {
          newState.registers.IP++;
        }
        break;
      }
      
      case 'JGE':
      case 'JNL': {
        const flags = getFlags(newState.registers.FLAGS);
        // SF = OF
        if (flags.SF === flags.OF) {
          const label = operands[0].trim().toUpperCase();
          const addr = labels.get(label);
          if (addr === undefined) throw new Error(`Unknown label: ${label}`);
          newState.registers.IP = addr;
        } else {
          newState.registers.IP++;
        }
        break;
      }
      
      case 'JC':
      case 'JB':
      case 'JNAE': {
        const flags = getFlags(newState.registers.FLAGS);
        if (flags.CF) {
          const label = operands[0].trim().toUpperCase();
          const addr = labels.get(label);
          if (addr === undefined) throw new Error(`Unknown label: ${label}`);
          newState.registers.IP = addr;
        } else {
          newState.registers.IP++;
        }
        break;
      }
      
      case 'JNC':
      case 'JAE':
      case 'JNB': {
        const flags = getFlags(newState.registers.FLAGS);
        if (!flags.CF) {
          const label = operands[0].trim().toUpperCase();
          const addr = labels.get(label);
          if (addr === undefined) throw new Error(`Unknown label: ${label}`);
          newState.registers.IP = addr;
        } else {
          newState.registers.IP++;
        }
        break;
      }
      
      case 'JS': {
        const flags = getFlags(newState.registers.FLAGS);
        if (flags.SF) {
          const label = operands[0].trim().toUpperCase();
          const addr = labels.get(label);
          if (addr === undefined) throw new Error(`Unknown label: ${label}`);
          newState.registers.IP = addr;
        } else {
          newState.registers.IP++;
        }
        break;
      }
      
      case 'JNS': {
        const flags = getFlags(newState.registers.FLAGS);
        if (!flags.SF) {
          const label = operands[0].trim().toUpperCase();
          const addr = labels.get(label);
          if (addr === undefined) throw new Error(`Unknown label: ${label}`);
          newState.registers.IP = addr;
        } else {
          newState.registers.IP++;
        }
        break;
      }
      
      case 'JO': {
        const flags = getFlags(newState.registers.FLAGS);
        if (flags.OF) {
          const label = operands[0].trim().toUpperCase();
          const addr = labels.get(label);
          if (addr === undefined) throw new Error(`Unknown label: ${label}`);
          newState.registers.IP = addr;
        } else {
          newState.registers.IP++;
        }
        break;
      }
      
      case 'JNO': {
        const flags = getFlags(newState.registers.FLAGS);
        if (!flags.OF) {
          const label = operands[0].trim().toUpperCase();
          const addr = labels.get(label);
          if (addr === undefined) throw new Error(`Unknown label: ${label}`);
          newState.registers.IP = addr;
        } else {
          newState.registers.IP++;
        }
        break;
      }
      
      case 'HLT': {
        newState.halted = true;
        break;
      }
      
      case 'NOP': {
        newState.registers.IP++;
        break;
      }
      
      case 'OUT': {
        // Virtual output instruction - stores value for display
        // The actual output is handled by the caller
        newState.registers.IP++;
        break;
      }
      
      case 'OUTC': {
        // Virtual output character instruction
        newState.registers.IP++;
        break;
      }
      
      case 'CLC': {
        newState.registers.FLAGS &= ~FLAG_CF;
        newState.registers.IP++;
        break;
      }
      
      case 'STC': {
        newState.registers.FLAGS |= FLAG_CF;
        newState.registers.IP++;
        break;
      }
      
      case 'CMC': {
        newState.registers.FLAGS ^= FLAG_CF;
        newState.registers.IP++;
        break;
      }
      
      default:
        throw new Error(`Unknown instruction: ${opcode}`);
    }
  } catch (e) {
    newState.error = e instanceof Error ? e.message : 'Unknown error';
    newState.halted = true;
  }
  
  return newState;
}

export interface ProgramOutput {
  type: 'number' | 'char';
  value: number;
}

function captureProgramOutput(state: CPUState, instruction: Instruction): ProgramOutput[] {
  const opcode = instruction.opcode.toUpperCase();
  const operand = instruction.operands[0] ?? '';
  const register = parseRegisterOperand(operand);

  if ((opcode === 'OUT' || opcode === 'OUTC') && register) {
    const value = readRegisterValue(register, state.registers);
    return [{ type: opcode === 'OUT' ? 'number' : 'char', value }];
  }

  if (opcode === 'INT') {
    const vector = parseImmediate(instruction.operands[0] ?? '');
    if (vector === 0x21) {
      const ah = readRegisterValue({ width: 8, register: 'AX', part: 'high' }, state.registers);
      if (ah === 0x02) {
        const dl = readRegisterValue({ width: 8, register: 'DX', part: 'low' }, state.registers);
        return [{ type: 'char', value: dl }];
      }
      if (ah === 0x09) {
        const outputs: ProgramOutput[] = [];
        let address = state.registers.DX & WORD_MASK;
        while (address >= 0 && address < state.memory.length) {
          const value = state.memory[address];
          if (value === 0x24) {
            break;
          }
          outputs.push({ type: 'char', value });
          address += 1;
        }
        return outputs;
      }
    }
  }

  return [];
}

export function runProgram(
  program: AssembledProgram,
  maxSteps: number = 10000,
  inputValues: number[] = []
): { finalState: CPUState; history: CPUState[]; output: ProgramOutput[] } {
  let state = createInitialState(program.initialMemory);
  const history: CPUState[] = [state];
  const output: ProgramOutput[] = [];
  let steps = 0;
  let inputIndex = 0;
  
  while (!state.halted && steps < maxSteps) {
    const ip = state.registers.IP;
    if (ip < 0 || ip >= program.instructions.length) {
      state = { ...state, halted: true, error: 'IP out of bounds' };
      history.push(state);
      break;
    }
    
    const instruction = program.instructions[ip];
    let preparedState = state;

    if (instruction.opcode.toUpperCase() === 'IN') {
      const portOperand = instruction.operands[1];
      const parsedPort = portOperand ? parseImmediate(portOperand) : null;
      if (parsedPort !== null && inputIndex < inputValues.length) {
        preparedState = {
          ...state,
          memory: new Uint8Array(state.memory),
        };
        writeWord(preparedState, getPortAddress(parsedPort), inputValues[inputIndex]);
        inputIndex++;
      }
    }
    
    // Check for OUT/OUTC instruction to capture output
    output.push(...captureProgramOutput(preparedState, instruction));
    
    state = executeInstruction(preparedState, instruction, program.labels);
    history.push(state);
    steps++;
  }
  
  if (steps >= maxSteps && !state.halted) {
    state = { ...state, error: 'Maximum steps exceeded (infinite loop?)', halted: true };
    history.push(state);
  }
  
  return { finalState: state, history, output };
}
