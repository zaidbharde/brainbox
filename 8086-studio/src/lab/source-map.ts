import { AssembledProgram } from '@/types/cpu';
import { SourceMapEntry } from '@/lab/types';

const SOURCE_LABEL_REGEX = /^_SRC_(\d+)(?:_\d+)?$/;

export function buildSourceMapEntries(program: AssembledProgram): SourceMapEntry[] {
  const labels = Array.from(program.labels.entries())
    .map(([name, address]) => {
      const match = name.match(SOURCE_LABEL_REGEX);
      if (!match) {
        return null;
      }
      return {
        sourceLine: Number(match[1]),
        instructionStart: address,
      };
    })
    .filter((item): item is { sourceLine: number; instructionStart: number } => item !== null)
    .sort((a, b) => a.instructionStart - b.instructionStart);

  if (labels.length === 0) {
    return [];
  }

  return labels.map((label, index) => {
    const next = labels[index + 1];
    const end = next ? next.instructionStart - 1 : program.instructions.length - 1;
    return {
      sourceLine: label.sourceLine,
      instructionStart: label.instructionStart,
      instructionEnd: Math.max(label.instructionStart, end),
    };
  });
}

export function findSourceLineForInstruction(sourceMap: SourceMapEntry[], instructionAddress: number): number | null {
  for (const entry of sourceMap) {
    if (instructionAddress >= entry.instructionStart && instructionAddress <= entry.instructionEnd) {
      return entry.sourceLine;
    }
  }
  return null;
}

export function findInstructionForSourceLine(sourceMap: SourceMapEntry[], sourceLine: number): number | null {
  const match = sourceMap.find((entry) => entry.sourceLine === sourceLine);
  return match ? match.instructionStart : null;
}
