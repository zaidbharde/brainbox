import { ProgramOutput } from '@/emulator/cpu';
import { CPUState } from '@/types/cpu';

export interface AssertionResult {
  line: number;
  expression: string;
  passed: boolean;
  message: string;
}

function parseHexOrDec(token: string): number | null {
  const trimmed = token.trim();
  if (/^0x[0-9A-Fa-f]+$/.test(trimmed)) return parseInt(trimmed.slice(2), 16);
  if (/^[0-9A-Fa-f]+h$/i.test(trimmed)) return parseInt(trimmed.slice(0, -1), 16);
  if (/^\d+$/.test(trimmed)) return parseInt(trimmed, 10);
  return null;
}

function readWord(memory: Uint8Array, address: number): number {
  return memory[address] | (memory[address + 1] << 8);
}

export function runTestbenchAssertions(
  script: string,
  finalState: CPUState,
  output: ProgramOutput[]
): AssertionResult[] {
  const results: AssertionResult[] = [];
  const lines = script.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw || raw.startsWith('#') || raw.startsWith(';')) {
      continue;
    }

    const lineNo = i + 1;
    const tokens = raw.split(/\s+/);
    const kind = tokens[0]?.toUpperCase();

    if (kind === 'REG' && tokens.length >= 4 && tokens[2] === '=') {
      const reg = tokens[1].toUpperCase();
      const expected = parseHexOrDec(tokens[3]);
      const actual = (finalState.registers as unknown as Record<string, number>)[reg];
      const passed = expected !== null && typeof actual === 'number' && (actual & 0xFFFF) === (expected & 0xFFFF);
      results.push({
        line: lineNo,
        expression: raw,
        passed,
        message: passed ? 'OK' : `Expected ${reg}=${tokens[3]}, got ${actual?.toString(16).toUpperCase() ?? 'N/A'}`,
      });
      continue;
    }

    if (kind === 'MEM' && tokens.length >= 4 && tokens[2] === '=') {
      const addrToken = tokens[1].replace(/^\[|\]$/g, '');
      const address = parseHexOrDec(addrToken);
      const expected = parseHexOrDec(tokens[3]);
      let passed = false;
      let message = 'Invalid memory assertion';
      if (address !== null && expected !== null && address >= 0 && address + 1 < finalState.memory.length) {
        const actual = readWord(finalState.memory, address);
        passed = (actual & 0xFFFF) === (expected & 0xFFFF);
        message = passed
          ? 'OK'
          : `Expected MEM[${addrToken}]=${tokens[3]}, got ${actual.toString(16).toUpperCase()}`;
      }
      results.push({
        line: lineNo,
        expression: raw,
        passed,
        message,
      });
      continue;
    }

    if (kind === 'OUT' && tokens.length >= 2) {
      const expected = parseHexOrDec(tokens[1]);
      const outputs = output.filter((item) => item.type === 'number').map((item) => item.value & 0xFFFF);
      const passed = expected !== null && outputs.includes(expected & 0xFFFF);
      results.push({
        line: lineNo,
        expression: raw,
        passed,
        message: passed ? 'OK' : `Expected output to contain ${tokens[1]}`,
      });
      continue;
    }

    if (kind === 'HALTED' && tokens.length >= 2) {
      const expected = tokens[1].toLowerCase() === 'true';
      const passed = finalState.halted === expected;
      results.push({
        line: lineNo,
        expression: raw,
        passed,
        message: passed ? 'OK' : `Expected halted=${expected}, got ${finalState.halted}`,
      });
      continue;
    }

    results.push({
      line: lineNo,
      expression: raw,
      passed: false,
      message: 'Unsupported assertion syntax',
    });
  }

  return results;
}
