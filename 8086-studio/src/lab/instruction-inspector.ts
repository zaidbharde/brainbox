import { parseImmediate, parseRegister } from '@/emulator/cpu';
import { Instruction } from '@/types/cpu';
import { InstructionInspectorData, TraceEntry } from '@/lab/types';

interface OpcodeDescriptor {
  category: string;
  summary: string;
  educationalNote: string;
  registerReads: string[];
  registerWrites: string[];
  flagBehavior: string;
}

const OPCODE_DESCRIPTORS: Record<string, OpcodeDescriptor> = {
  MOV: {
    category: 'Data Movement',
    summary: 'Moves data from source operand into destination operand.',
    educationalNote: 'MOV is foundational: it changes data placement without arithmetic side effects.',
    registerReads: ['source register (if used)'],
    registerWrites: ['destination register (if used)'],
    flagBehavior: 'Flags are not modified.',
  },
  ADD: {
    category: 'Arithmetic',
    summary: 'Adds source to destination and stores result in destination.',
    educationalNote: 'ADD demonstrates carry propagation and signed overflow behavior.',
    registerReads: ['destination register', 'source register/immediate'],
    registerWrites: ['destination register'],
    flagBehavior: 'Updates CF, PF, AF, ZF, SF, OF.',
  },
  SUB: {
    category: 'Arithmetic',
    summary: 'Subtracts source from destination and stores result.',
    educationalNote: 'SUB is ideal for understanding borrow semantics (CF) vs signed overflow (OF).',
    registerReads: ['destination register', 'source register/immediate'],
    registerWrites: ['destination register'],
    flagBehavior: 'Updates CF, PF, AF, ZF, SF, OF.',
  },
  CMP: {
    category: 'Control Support',
    summary: 'Performs subtraction for flags only; destination is unchanged.',
    educationalNote: 'CMP decouples decision logic from data writes; jumps consume the resulting flags.',
    registerReads: ['destination register', 'source register/immediate'],
    registerWrites: ['none'],
    flagBehavior: 'Updates CF, PF, AF, ZF, SF, OF.',
  },
  JMP: {
    category: 'Control Flow',
    summary: 'Unconditionally transfers execution to target address/label.',
    educationalNote: 'JMP rewires instruction stream directly by replacing IP.',
    registerReads: ['target operand/label'],
    registerWrites: ['IP'],
    flagBehavior: 'Flags are not modified.',
  },
  JE: {
    category: 'Control Flow',
    summary: 'Jumps when zero flag is set.',
    educationalNote: 'JE/JZ usually follows CMP to branch on equality.',
    registerReads: ['ZF'],
    registerWrites: ['IP (if branch taken)'],
    flagBehavior: 'Flags are not modified.',
  },
  JNE: {
    category: 'Control Flow',
    summary: 'Jumps when zero flag is clear.',
    educationalNote: 'JNE/JNZ models inequality branches.',
    registerReads: ['ZF'],
    registerWrites: ['IP (if branch taken)'],
    flagBehavior: 'Flags are not modified.',
  },
  INC: {
    category: 'Arithmetic',
    summary: 'Increments destination operand by one.',
    educationalNote: 'INC is special because CF is preserved while other arithmetic flags update.',
    registerReads: ['destination register'],
    registerWrites: ['destination register'],
    flagBehavior: 'Updates PF, AF, ZF, SF, OF. CF unchanged.',
  },
  DEC: {
    category: 'Arithmetic',
    summary: 'Decrements destination operand by one.',
    educationalNote: 'DEC mirrors INC with CF preservation.',
    registerReads: ['destination register'],
    registerWrites: ['destination register'],
    flagBehavior: 'Updates PF, AF, ZF, SF, OF. CF unchanged.',
  },
  PUSH: {
    category: 'Stack',
    summary: 'Pushes operand to stack and decrements SP.',
    educationalNote: 'PUSH writes memory and stack pointer atomically from programmer perspective.',
    registerReads: ['source register/memory', 'SP'],
    registerWrites: ['SP', 'stack memory'],
    flagBehavior: 'Flags are not modified.',
  },
  POP: {
    category: 'Stack',
    summary: 'Pops value from stack and increments SP.',
    educationalNote: 'POP reads memory at SP, writes destination, then advances stack pointer.',
    registerReads: ['SP', 'stack memory'],
    registerWrites: ['destination register/memory', 'SP'],
    flagBehavior: 'Flags are not modified.',
  },
  CALL: {
    category: 'Control Flow',
    summary: 'Stores return address on stack and jumps to subroutine target.',
    educationalNote: 'CALL creates stack frame context for procedural control flow.',
    registerReads: ['IP', 'SP', 'target'],
    registerWrites: ['IP', 'SP', 'stack memory'],
    flagBehavior: 'Flags are not modified.',
  },
  RET: {
    category: 'Control Flow',
    summary: 'Returns from subroutine by restoring IP from stack.',
    educationalNote: 'RET is the inverse of CALL and consumes the return address.',
    registerReads: ['SP', 'stack memory'],
    registerWrites: ['IP', 'SP'],
    flagBehavior: 'Flags are not modified.',
  },
  INT: {
    category: 'Interrupt',
    summary: 'Software interrupt transfer to vector handler.',
    educationalNote: 'INT saves execution context and redirects control to ISR.',
    registerReads: ['IP', 'FLAGS', 'SP', 'interrupt vector'],
    registerWrites: ['IP', 'SP', 'stack memory'],
    flagBehavior: 'FLAGS are preserved on stack.',
  },
  IRET: {
    category: 'Interrupt',
    summary: 'Return from interrupt by restoring IP and FLAGS.',
    educationalNote: 'IRET safely resumes interrupted control flow.',
    registerReads: ['SP', 'stack memory'],
    registerWrites: ['IP', 'FLAGS', 'SP'],
    flagBehavior: 'FLAGS restored from stack.',
  },
  IN: {
    category: 'I/O',
    summary: 'Reads value from memory-mapped port into register.',
    educationalNote: 'IN models external device reads through port addresses.',
    registerReads: ['port operand'],
    registerWrites: ['destination register'],
    flagBehavior: 'Flags are not modified.',
  },
  OUTP: {
    category: 'I/O',
    summary: 'Writes register value to memory-mapped port.',
    educationalNote: 'OUTP models device output updates via port writes.',
    registerReads: ['source register', 'port operand'],
    registerWrites: ['I/O port memory'],
    flagBehavior: 'Flags are not modified.',
  },
  HLT: {
    category: 'Control',
    summary: 'Halts processor execution.',
    educationalNote: 'HLT marks terminal state in this virtual CPU lab.',
    registerReads: ['none'],
    registerWrites: ['halted state'],
    flagBehavior: 'Flags are not modified.',
  },
};

const OPCODE_ORDER = [
  'MOV', 'ADD', 'ADC', 'SUB', 'SBB', 'MUL', 'DIV', 'MOD', 'NEG',
  'AND', 'OR', 'XOR', 'NOT', 'SHL', 'SAL', 'SHR', 'SAR',
  'CMP', 'JMP', 'JE', 'JZ', 'JNE', 'JNZ', 'JL', 'JG', 'JLE', 'JGE',
  'JC', 'JNC', 'JS', 'JNS', 'JO', 'JNO', 'INC', 'DEC', 'PUSH', 'POP',
  'CALL', 'RET', 'INT', 'IRET', 'IN', 'OUTP',
  'HLT', 'NOP', 'OUT', 'OUTC', 'CLC', 'STC', 'CMC',
];

const OPCODE_TO_BYTE: Record<string, number> = Object.fromEntries(
  OPCODE_ORDER.map((opcode, index) => [opcode, 0x40 + index])
);

const REGISTER_TO_BYTE: Record<string, number> = {
  AX: 0x10,
  BX: 0x11,
  CX: 0x12,
  DX: 0x13,
  SI: 0x14,
  DI: 0x15,
  SP: 0x16,
  BP: 0x17,
};

function toHex(value: number): string {
  return value.toString(16).toUpperCase().padStart(2, '0');
}

function toBin(value: number): string {
  return value.toString(2).padStart(8, '0');
}

function encodeOperandVirtual(operand: string): number {
  const trimmed = operand.trim();
  const register = parseRegister(trimmed);
  if (register) {
    return REGISTER_TO_BYTE[register] ?? 0x1F;
  }

  if (/^\[.*\]$/.test(trimmed)) {
    const hash = Array.from(trimmed).reduce((acc, ch) => acc + ch.charCodeAt(0), 0) & 0x1F;
    return 0x80 | hash;
  }

  const immediate = parseImmediate(trimmed);
  if (immediate !== null) {
    return immediate & 0xFF;
  }

  const labelHash = Array.from(trimmed).reduce((acc, ch) => acc + ch.charCodeAt(0), 0) & 0x3F;
  return 0x40 | labelHash;
}

function getDescriptor(opcode: string): OpcodeDescriptor {
  return OPCODE_DESCRIPTORS[opcode] ?? {
    category: 'General',
    summary: 'Executes virtual CPU operation.',
    educationalNote: 'Observe register and flag transitions to understand runtime behavior.',
    registerReads: ['depends on operands'],
    registerWrites: ['depends on opcode'],
    flagBehavior: 'Opcode dependent.',
  };
}

function getVirtualEncoding(opcode: string, operands: string[]): { hex: string; binary: string } {
  const opcodeByte = OPCODE_TO_BYTE[opcode] ?? 0x3F;
  const bytes = [opcodeByte, ...operands.map(encodeOperandVirtual)];
  return {
    hex: bytes.map(toHex).join(' '),
    binary: bytes.map(toBin).join(' '),
  };
}

export function buildInstructionInspectorData(
  instruction: Instruction | null | undefined,
  lastTraceEntry: TraceEntry | null
): InstructionInspectorData | null {
  if (!instruction) {
    return null;
  }

  const opcode = instruction.opcode.toUpperCase();
  const descriptor = getDescriptor(opcode);
  const encoding = getVirtualEncoding(opcode, instruction.operands);

  return {
    opcode,
    operands: instruction.operands,
    category: descriptor.category,
    summary: descriptor.summary,
    educationalNote: descriptor.educationalNote,
    registerReads: descriptor.registerReads,
    registerWrites: descriptor.registerWrites,
    flagBehavior: descriptor.flagBehavior,
    virtualEncodingHex: encoding.hex,
    virtualEncodingBinary: encoding.binary,
    lastObservedEffects: lastTraceEntry
      ? {
          changedRegisters: lastTraceEntry.changedRegisters,
          changedFlags: lastTraceEntry.changedFlags,
          changedMemoryWords: lastTraceEntry.changedMemoryWords,
        }
      : null,
  };
}
