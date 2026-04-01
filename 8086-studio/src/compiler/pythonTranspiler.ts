import { CompilerError } from '../types/cpu';
import { TranspileResult } from './transpiler';

type BlockKind = 'if' | 'while' | 'for';

interface BlockFrame {
  kind: BlockKind;
  indent: number;
  forUpdate?: string;
}

export function transpilePythonToHighLevel(source: string): TranspileResult {
  const errors: CompilerError[] = [];
  const output: string[] = [];
  const lines = source.split('\n');
  const stack: BlockFrame[] = [];

  const closeTopBlock = (): void => {
    const frame = stack.pop();
    if (!frame) {
      return;
    }
    if (frame.kind === 'for' && frame.forUpdate) {
      output.push(frame.forUpdate);
    }
    output.push('end');
  };

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const rawLine = lines[i];
    const stripped = stripPythonComment(rawLine).trimEnd();
    if (!stripped.trim()) {
      continue;
    }

    const indent = countIndent(rawLine);
    const line = stripped.trim();
    const isElif = /^elif\b/.test(line);
    const isElse = /^else\s*:?\s*$/.test(line);

    // Dedent into the correct block before handling this line.
    const dedentComparator = isElif || isElse
      ? (frame: BlockFrame) => indent < frame.indent
      : (frame: BlockFrame) => indent <= frame.indent;
    while (stack.length > 0 && dedentComparator(stack[stack.length - 1])) {
      closeTopBlock();
    }

    const ifMatch = line.match(/^if\s+(.+)\s*:\s*$/);
    if (ifMatch) {
      output.push(`if ${normalizeExpression(ifMatch[1])}`);
      stack.push({ kind: 'if', indent });
      continue;
    }

    const elifMatch = line.match(/^elif\s+(.+)\s*:\s*$/);
    if (elifMatch) {
      const top = stack[stack.length - 1];
      if (!top || top.kind !== 'if' || top.indent !== indent) {
        errors.push({
          line: lineNo,
          message: "Found 'elif' without a matching 'if' block",
          type: 'error',
        });
        continue;
      }
      output.push('else');
      output.push(`if ${normalizeExpression(elifMatch[1])}`);
      stack.push({ kind: 'if', indent });
      continue;
    }

    if (isElse) {
      const top = stack[stack.length - 1];
      if (!top || top.kind !== 'if' || top.indent !== indent) {
        errors.push({
          line: lineNo,
          message: "Found 'else' without a matching 'if' block",
          type: 'error',
        });
        continue;
      }
      output.push('else');
      continue;
    }

    const whileMatch = line.match(/^while\s+(.+)\s*:\s*$/);
    if (whileMatch) {
      output.push(`while ${normalizeExpression(whileMatch[1])}`);
      stack.push({ kind: 'while', indent });
      continue;
    }

    const forMatch = line.match(/^for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+range\s*\((.*)\)\s*:\s*$/);
    if (forMatch) {
      const loopVar = forMatch[1];
      const rangeArgs = splitTopLevelArgs(forMatch[2]);
      if (rangeArgs.length < 1 || rangeArgs.length > 3) {
        errors.push({
          line: lineNo,
          message: `Unsupported range() form in Python for-loop: "${line}"`,
          type: 'error',
        });
        continue;
      }

      const start = rangeArgs.length === 1 ? '0' : normalizeExpression(rangeArgs[0]);
      const stop = normalizeExpression(rangeArgs.length === 1 ? rangeArgs[0] : rangeArgs[1]);
      const stepRaw = normalizeExpression(rangeArgs.length === 3 ? rangeArgs[2] : '1');
      const numericStep = parseNumericStep(stepRaw);
      const isNegativeStep = numericStep !== null ? numericStep < 0 : /^-\s*\d+$/.test(stepRaw);
      const stepAbs = numericStep !== null && numericStep < 0
        ? Math.abs(numericStep).toString()
        : stepRaw;
      const conditionOperator = isNegativeStep ? '>' : '<';
      const updateExpr = isNegativeStep
        ? `${loopVar} = ${loopVar} - ${stepAbs}`
        : `${loopVar} = ${loopVar} + ${stepRaw}`;

      output.push(`${loopVar} = ${start}`);
      output.push(`while ${loopVar} ${conditionOperator} ${stop}`);
      stack.push({ kind: 'for', indent, forUpdate: updateExpr });
      continue;
    }

    const simpleStatement = transpilePythonStatement(line, lineNo, errors);
    if (simpleStatement) {
      output.push(simpleStatement);
      continue;
    }

    errors.push({
      line: lineNo,
      message: `Unsupported Python syntax: "${line}"`,
      type: 'error',
    });
  }

  while (stack.length > 0) {
    closeTopBlock();
  }

  return { output: output.join('\n'), errors };
}

function transpilePythonStatement(line: string, lineNo: number, errors: CompilerError[]): string | null {
  if (/^(pass|break|continue|return)\b/.test(line)) {
    return null;
  }

  const inputMatch = line.match(
    /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:int\s*\(\s*)?(?:float\s*\(\s*)?input\s*\([^)]*\)\s*\)?\s*\)?\s*$/
  );
  if (inputMatch) {
    return `input ${inputMatch[1]}`;
  }

  const printCallMatch = line.match(/^print\s*\((.*)\)\s*$/);
  if (printCallMatch) {
    const args = splitTopLevelArgs(printCallMatch[1]);
    if (args.length !== 1) {
      errors.push({
        line: lineNo,
        message: 'Only single-argument print(...) is supported in Python mode.',
        type: 'error',
      });
      return null;
    }
    return `print ${normalizeExpression(args[0])}`;
  }

  const printLegacyMatch = line.match(/^print\s+(.+)$/);
  if (printLegacyMatch) {
    return `print ${normalizeExpression(printLegacyMatch[1])}`;
  }

  const augmentedMatch = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*([+\-*/%])=\s*(.+)$/);
  if (augmentedMatch) {
    return `${augmentedMatch[1]} = ${augmentedMatch[1]} ${augmentedMatch[2]} ${normalizeExpression(augmentedMatch[3])}`;
  }

  const assignmentMatch = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
  if (assignmentMatch) {
    return `${assignmentMatch[1]} = ${normalizeExpression(assignmentMatch[2])}`;
  }

  return null;
}

function normalizeExpression(expr: string): string {
  return expr
    .replace(/\bTrue\b/g, 'true')
    .replace(/\bFalse\b/g, 'false')
    .replace(/\band\b/g, ' and ')
    .replace(/\bor\b/g, ' or ')
    .replace(/\bnot\b/g, ' not ')
    .replace(/\/\/+/g, '/')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseNumericStep(step: string): number | null {
  if (/^-?\d+$/.test(step.trim())) {
    return Number(step.trim());
  }
  return null;
}

function countIndent(line: string): number {
  let count = 0;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === ' ') {
      count++;
      continue;
    }
    if (line[i] === '\t') {
      count += 4;
      continue;
    }
    break;
  }
  return count;
}

function stripPythonComment(line: string): string {
  let inSingle = false;
  let inDouble = false;
  let escaped = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (ch === '#' && !inSingle && !inDouble) {
      return line.slice(0, i);
    }
  }
  return line;
}

function splitTopLevelArgs(argsText: string): string[] {
  const args: string[] = [];
  let current = '';
  let depth = 0;
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < argsText.length; i++) {
    const ch = argsText[i];
    if (quote) {
      current += ch;
      if (ch === quote && argsText[i - 1] !== '\\') {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') {
      depth++;
      current += ch;
      continue;
    }
    if (ch === ')' || ch === ']' || ch === '}') {
      depth = Math.max(0, depth - 1);
      current += ch;
      continue;
    }
    if (ch === ',' && depth === 0) {
      if (current.trim()) {
        args.push(current.trim());
      }
      current = '';
      continue;
    }
    current += ch;
  }

  if (current.trim()) {
    args.push(current.trim());
  }

  return args;
}
