import { getFlags, parseImmediate, parseRegister } from '@/emulator/cpu';
import { CPUState } from '@/types/cpu';
import { WatchExpression, WatchValue } from '@/lab/types';

function readWord(memory: Uint8Array, address: number): number {
  if (address < 0 || address + 1 >= memory.length) {
    throw new Error(`Memory out of bounds at ${address.toString(16).toUpperCase()}`);
  }
  return memory[address] | (memory[address + 1] << 8);
}

function parseMemoryExpression(expression: string, state: CPUState): number | null {
  const trimmed = expression.trim();
  const match = trimmed.match(/^\[(.+)\]$/);
  if (!match) return null;

  const inner = match[1].replace(/\s+/g, '');
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
    return readWord(state.memory, (state.registers[reg] + offset) & 0xFFFF);
  }

  const imm = parseImmediate(inner);
  if (imm === null) return null;
  return readWord(state.memory, imm & 0xFFFF);
}

function evaluateExpression(expression: string, state: CPUState): number {
  const trimmed = expression.trim();
  if (!trimmed) {
    throw new Error('Expression is empty');
  }

  const reg = parseRegister(trimmed);
  if (reg) {
    return state.registers[reg];
  }

  const flags = getFlags(state.registers.FLAGS);
  if (trimmed in flags) {
    return flags[trimmed as keyof typeof flags] ? 1 : 0;
  }

  const memValue = parseMemoryExpression(trimmed, state);
  if (memValue !== null) {
    return memValue;
  }

  const imm = parseImmediate(trimmed);
  if (imm !== null) {
    return imm & 0xFFFF;
  }

  throw new Error('Unsupported watch expression');
}

function toHex(value: number): string {
  return (value & 0xFFFF).toString(16).toUpperCase().padStart(4, '0');
}

export function evaluateWatchExpressions(
  watches: WatchExpression[],
  state: CPUState,
  previousState: CPUState | null
): WatchValue[] {
  return watches.map((watch) => {
    try {
      const value = evaluateExpression(watch.expression, state);
      const prev = previousState ? evaluateExpression(watch.expression, previousState) : value;
      return {
        id: watch.id,
        expression: watch.expression,
        ok: true,
        value,
        hexValue: toHex(value),
        changed: value !== prev,
      };
    } catch (error) {
      return {
        id: watch.id,
        expression: watch.expression,
        ok: false,
        value: null,
        hexValue: '----',
        changed: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });
}
