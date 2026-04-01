import { CPUState, Instruction } from '@/types/cpu';

function parseInstructionText(instruction: Instruction | null | undefined): { opcode: string; operands: string[] } | null {
  if (!instruction) {
    return null;
  }
  return {
    opcode: instruction.opcode.toUpperCase(),
    operands: instruction.operands.map((item) => item.trim()),
  };
}

export function buildSymbolicHints(
  instruction: Instruction | null | undefined,
  state: CPUState
): string[] {
  const parsed = parseInstructionText(instruction);
  if (!parsed) {
    return [];
  }

  const { opcode, operands } = parsed;
  const hints: string[] = [];

  if (opcode === 'CMP' && operands.length === 2) {
    hints.push(`Branch constraints now depend on relation ${operands[0]} ? ${operands[1]}.`);
    hints.push('For JE/JZ next, equality condition is required (left == right).');
    hints.push('For JL/JG branches, signed comparison uses SF and OF relation.');
  }

  if (opcode.startsWith('J')) {
    hints.push('This is a control predicate. Branch is taken when its flag condition is true.');
    hints.push(`Current FLAGS raw value: ${state.registers.FLAGS.toString(16).toUpperCase().padStart(4, '0')}.`);
  }

  if (opcode === 'ADD' || opcode === 'SUB' || opcode === 'ADC' || opcode === 'SBB') {
    hints.push('Track both unsigned carry/borrow (CF) and signed overflow (OF).');
  }

  if (opcode === 'CALL') {
    hints.push('CALL pushes return address on stack before jumping to callee.');
  }

  if (opcode === 'RET') {
    hints.push('RET pops return address from stack into IP.');
  }

  if (opcode === 'INT') {
    hints.push('INT saves FLAGS and return IP, then transfers control to interrupt vector handler.');
  }

  if (opcode === 'IRET') {
    hints.push('IRET restores return IP and FLAGS, resuming interrupted flow.');
  }

  return hints;
}
