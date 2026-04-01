import { AssembledProgram, CompilerError, Instruction } from '../types/cpu';

const MEMORY_SIZE = 4096;
const DATA_BASE = 0x0100;

const VALID_OPCODES = new Set([
  'MOV', 'ADD', 'ADC', 'SUB', 'SBB', 'MUL', 'DIV', 'MOD', 'NEG',
  'AND', 'OR', 'XOR', 'NOT', 'SHL', 'SAL', 'SHR', 'SAR',
  'CMP', 'JMP', 'JE', 'JZ', 'JNE', 'JNZ',
  'JL', 'JG', 'JLE', 'JGE', 'JNGE', 'JNLE', 'JNG', 'JNL',
  'JC', 'JNC', 'JB', 'JNB', 'JAE', 'JNAE',
  'JS', 'JNS', 'JO', 'JNO',
  'INC', 'DEC', 'PUSH', 'POP',
  'CALL', 'RET', 'INT', 'IRET',
  'IN', 'OUTP', 'LEA',
  'HLT', 'NOP', 'OUT', 'OUTC',
  'CLC', 'STC', 'CMC'
]);

const WORD_REGISTERS = new Set(['AX', 'BX', 'CX', 'DX', 'CS', 'DS', 'ES', 'SS', 'SI', 'DI', 'SP', 'BP']);
const BYTE_REGISTERS = new Set(['AL', 'AH', 'BL', 'BH', 'CL', 'CH', 'DL', 'DH']);

const IGNORED_DIRECTIVE_RE = /^(?:ASSUME|\.MODEL|\.STACK|\.DATA|\.CODE|END|DOSSEG|TITLE|NAME|INCLUDE)\b/i;

type SourceLine = {
  lineNumber: number;
  text: string;
};

type MacroDefinition = {
  params: string[];
  body: SourceLine[];
};

type DataSymbol = {
  address: number;
  size: 1 | 2;
};

function stripInlineComment(text: string): string {
  let inQuote = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"') {
      inQuote = !inQuote;
    }
    if (ch === ';' && !inQuote) {
      return text.slice(0, i);
    }
  }
  return text;
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function splitOperands(input: string): string[] {
  const parts: string[] = [];
  let current = '';
  let bracketDepth = 0;
  let quote = false;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (ch === '"') {
      quote = !quote;
      current += ch;
      continue;
    }
    if (!quote) {
      if (ch === '[') {
        bracketDepth += 1;
      } else if (ch === ']') {
        bracketDepth = Math.max(0, bracketDepth - 1);
      } else if (ch === ',' && bracketDepth === 0) {
        parts.push(current.trim());
        current = '';
        continue;
      }
    }
    current += ch;
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts;
}

function parseImmediate(operand: string): number | null {
  const trimmed = operand.trim();
  if (!trimmed) return null;

  const sign = trimmed.startsWith('-') ? -1 : 1;
  const normalized = trimmed.replace(/^[+-]/, '');

  if (/^\d+$/.test(normalized)) {
    return sign * Number.parseInt(normalized, 10);
  }
  if (/^0x[0-9A-F]+$/i.test(normalized)) {
    return sign * Number.parseInt(normalized.slice(2), 16);
  }
  if (/^[0-9A-F]+H$/i.test(normalized)) {
    return sign * Number.parseInt(normalized.slice(0, -1), 16);
  }
  if (/^0b[01]+$/i.test(normalized)) {
    return sign * Number.parseInt(normalized.slice(2), 2);
  }
  if (/^[01]+B$/i.test(normalized)) {
    return sign * Number.parseInt(normalized.slice(0, -1), 2);
  }

  return null;
}

function formatHex(value: number): string {
  return `${(value & 0xFFFF).toString(16).toUpperCase()}h`;
}

function isWordRegister(operand: string): boolean {
  return WORD_REGISTERS.has(operand.trim().toUpperCase());
}

function isByteRegister(operand: string): boolean {
  return BYTE_REGISTERS.has(operand.trim().toUpperCase());
}

function isAnyRegister(operand: string): boolean {
  const upper = operand.trim().toUpperCase();
  return WORD_REGISTERS.has(upper) || BYTE_REGISTERS.has(upper);
}

function isValidMemoryOperand(operand: string): boolean {
  const trimmed = operand.trim();
  const match = trimmed.match(/^(?:(BYTE|WORD)\s+PTR\s+)?\[(.+)\]$/i);
  if (!match) {
    return false;
  }

  const inner = match[2].replace(/\s+/g, '');
  if (!inner) {
    return false;
  }

  if (isAnyRegister(inner)) {
    return true;
  }

  const regMatch = inner.match(/^([A-Za-z]{2})([+-].+)?$/);
  if (regMatch && isAnyRegister(regMatch[1])) {
    return regMatch[2] ? parseImmediate(regMatch[2]) !== null : true;
  }

  return parseImmediate(inner) !== null;
}

function isValidImmediate(operand: string): boolean {
  return parseImmediate(operand) !== null;
}

function parseStringLiteral(raw: string): number[] | null {
  const text = raw.trim();
  if (!text.startsWith('"') || !text.endsWith('"')) {
    return null;
  }

  const inner = text.slice(1, -1);
  const bytes: number[] = [];
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i];
    if (ch === '\\' && i + 1 < inner.length) {
      const next = inner[i + 1];
      if (next === 'n') {
        bytes.push(10);
        i += 1;
        continue;
      }
      if (next === 'r') {
        bytes.push(13);
        i += 1;
        continue;
      }
      if (next === 't') {
        bytes.push(9);
        i += 1;
        continue;
      }
      bytes.push(next.charCodeAt(0) & 0xFF);
      i += 1;
      continue;
    }
    bytes.push(ch.charCodeAt(0) & 0xFF);
  }
  return bytes;
}

function parseDataValues(kind: 'DB' | 'DW', raw: string, lineNumber: number, errors: CompilerError[]): number[] {
  const values: number[] = [];
  for (const part of splitOperands(raw)) {
    if (part === '?') {
      values.push(kind === 'DB' ? 0 : 0, ...(kind === 'DW' ? [0] : []));
      continue;
    }

    const stringBytes = parseStringLiteral(part);
    if (stringBytes) {
      if (kind === 'DW') {
        errors.push({ line: lineNumber, message: 'DW string initializers are not supported.', type: 'error' });
        continue;
      }
      values.push(...stringBytes);
      continue;
    }

    const numeric = parseImmediate(part);
    if (numeric === null) {
      errors.push({ line: lineNumber, message: `Invalid data initializer: ${part}`, type: 'error' });
      continue;
    }

    if (kind === 'DB') {
      values.push(numeric & 0xFF);
    } else {
      values.push(numeric & 0xFF, (numeric >> 8) & 0xFF);
    }
  }

  return values;
}

function expandMacros(lines: SourceLine[], errors: CompilerError[]): SourceLine[] {
  const macros = new Map<string, MacroDefinition>();
  const withoutDefinitions: SourceLine[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const sourceLine = lines[i];
    const clean = normalizeWhitespace(stripInlineComment(sourceLine.text));
    const macroStart = clean.match(/^([A-Za-z_]\w*)\s+MACRO(?:\s+(.*))?$/i);
    if (!macroStart) {
      withoutDefinitions.push(sourceLine);
      continue;
    }

    const name = macroStart[1].toUpperCase();
    const params = (macroStart[2] || '')
      .split(',')
      .map((param) => param.trim())
      .filter(Boolean);
    const body: SourceLine[] = [];
    let foundEnd = false;

    for (i += 1; i < lines.length; i += 1) {
      const bodyLine = lines[i];
      const bodyClean = normalizeWhitespace(stripInlineComment(bodyLine.text));
      if (/^ENDM\b/i.test(bodyClean)) {
        foundEnd = true;
        break;
      }
      body.push(bodyLine);
    }

    if (!foundEnd) {
      errors.push({ line: sourceLine.lineNumber, message: `Macro ${name} is missing ENDM.`, type: 'error' });
      break;
    }

    macros.set(name, { params, body });
  }

  const expanded: SourceLine[] = [];
  for (const sourceLine of withoutDefinitions) {
    const clean = normalizeWhitespace(stripInlineComment(sourceLine.text));
    const firstToken = clean.match(/^([A-Za-z_]\w*)\b/);
    const macro = firstToken ? macros.get(firstToken[1].toUpperCase()) : null;
    if (!macro) {
      expanded.push(sourceLine);
      continue;
    }

    const argSection = clean.slice(firstToken![0].length).trim();
    const args = argSection ? splitOperands(argSection) : [];
    if (args.length !== macro.params.length) {
      errors.push({
        line: sourceLine.lineNumber,
        message: `Macro ${firstToken![1]} expects ${macro.params.length} argument(s), got ${args.length}.`,
        type: 'error',
      });
      continue;
    }

    for (const bodyLine of macro.body) {
      let expandedText = bodyLine.text;
      macro.params.forEach((param, index) => {
        const re = new RegExp(`\\b${param}\\b`, 'gi');
        expandedText = expandedText.replace(re, args[index]);
      });
      expanded.push({ lineNumber: sourceLine.lineNumber, text: expandedText });
    }
  }

  return expanded;
}

function preprocess(source: string): {
  codeLines: SourceLine[];
  dataSymbols: Map<string, DataSymbol>;
  initialMemory: Uint8Array;
  errors: CompilerError[];
} {
  const errors: CompilerError[] = [];
  const lines: SourceLine[] = source.split('\n').map((text, index) => ({ lineNumber: index + 1, text }));
  const expanded = expandMacros(lines, errors);
  const codeLines: SourceLine[] = [];
  const dataSymbols = new Map<string, DataSymbol>();
  const initialMemory = new Uint8Array(MEMORY_SIZE);
  let nextDataAddress = DATA_BASE;

  for (const sourceLine of expanded) {
    const stripped = stripInlineComment(sourceLine.text).trim();
    if (!stripped) {
      continue;
    }

    if (IGNORED_DIRECTIVE_RE.test(stripped)) {
      continue;
    }

    const segmentStart = stripped.match(/^([A-Za-z_]\w*)\s+SEGMENT\b/i);
    if (segmentStart) {
      continue;
    }

    const procStart = stripped.match(/^([A-Za-z_]\w*)\s+PROC\b/i);
    if (procStart) {
      codeLines.push({ lineNumber: sourceLine.lineNumber, text: `${procStart[1]}:` });
      continue;
    }

    if (/^(?:[A-Za-z_]\w*\s+)?(?:ENDS|ENDP)\b/i.test(stripped)) {
      continue;
    }

    const dataDecl = stripped.match(/^([A-Za-z_]\w*)\s+(DB|DW)\s+(.+)$/i);
    if (dataDecl) {
      const name = dataDecl[1].toUpperCase();
      const kind = dataDecl[2].toUpperCase() as 'DB' | 'DW';
      const size = kind === 'DB' ? 1 : 2;

      if (dataSymbols.has(name)) {
        errors.push({ line: sourceLine.lineNumber, message: `Duplicate data symbol: ${name}`, type: 'error' });
        continue;
      }

      if (kind === 'DW' && nextDataAddress % 2 !== 0) {
        nextDataAddress += 1;
      }

      const bytes = parseDataValues(kind, dataDecl[3], sourceLine.lineNumber, errors);
      if (nextDataAddress + bytes.length > MEMORY_SIZE) {
        errors.push({ line: sourceLine.lineNumber, message: `Data symbol ${name} exceeds available memory.`, type: 'error' });
        continue;
      }

      dataSymbols.set(name, { address: nextDataAddress, size });
      for (let i = 0; i < bytes.length; i += 1) {
        initialMemory[nextDataAddress + i] = bytes[i];
      }
      nextDataAddress += Math.max(size, bytes.length);
      continue;
    }

    codeLines.push({ lineNumber: sourceLine.lineNumber, text: stripped });
  }

  return { codeLines, dataSymbols, initialMemory, errors };
}

function replaceDataSymbolInMemoryExpr(expr: string, dataSymbols: Map<string, DataSymbol>): string {
  return expr.replace(/\b([A-Za-z_]\w*)\b/g, (full, symbol) => {
    const match = dataSymbols.get(symbol.toUpperCase());
    return match ? formatHex(match.address) : full;
  });
}

function normalizeOperand(
  opcode: string,
  operand: string,
  operandIndex: number,
  dataSymbols: Map<string, DataSymbol>,
  codeLabels: Map<string, number>
): string {
  let text = operand.trim();
  const upper = text.toUpperCase();

  if (upper === 'DATA' || upper === '@DATA') {
    return formatHex(DATA_BASE);
  }
  if (upper === 'CODE') {
    return '0';
  }
  if (upper === 'STACK') {
    return formatHex(MEMORY_SIZE - 2);
  }

  const offsetMatch = text.match(/^OFFSET\s+([A-Za-z_]\w*)$/i);
  if (offsetMatch) {
    const name = offsetMatch[1].toUpperCase();
    const dataSymbol = dataSymbols.get(name);
    if (dataSymbol) {
      return formatHex(dataSymbol.address);
    }
    if (codeLabels.has(name)) {
      return String(codeLabels.get(name));
    }
  }

  const memMatch = text.match(/^(?:(BYTE|WORD)\s+PTR\s+)?\[(.+)\]$/i);
  if (memMatch) {
    const ptr = memMatch[1] ? `${memMatch[1].toUpperCase()} PTR ` : '';
    const rewritten = replaceDataSymbolInMemoryExpr(memMatch[2], dataSymbols);
    return `${ptr}[${rewritten}]`;
  }

  const jumpLike = /^(?:J|CALL|INT|RET|IRET|HLT|NOP|CLC|STC|CMC)/.test(opcode);

  const dataSymbol = dataSymbols.get(upper);
  if (dataSymbol) {
    if (opcode === 'LEA' || (opcode === 'MOV' && operandIndex === 1 && isWordRegister(text))) {
      return formatHex(dataSymbol.address);
    }
    const ptr = dataSymbol.size === 1 ? 'BYTE PTR' : 'WORD PTR';
    return `${ptr} [${formatHex(dataSymbol.address)}]`;
  }

  if (!jumpLike && codeLabels.has(upper)) {
    return String(codeLabels.get(upper));
  }

  return text;
}

function validateInstruction(opcode: string, operands: string[], line: number): CompilerError | null {
  switch (opcode) {
    case 'MOV':
    case 'LEA': {
      if (operands.length !== 2) {
        return { line, message: `${opcode} requires 2 operands`, type: 'error' };
      }
      const dest = operands[0];
      const src = operands[1];
      const destIsReg = isAnyRegister(dest);
      const destIsMem = isValidMemoryOperand(dest);
      const srcIsReg = isAnyRegister(src);
      const srcIsMem = isValidMemoryOperand(src);
      const srcIsImm = isValidImmediate(src);

      if (!destIsReg && !destIsMem) {
        return { line, message: `Invalid destination operand: ${dest}`, type: 'error' };
      }
      if (!srcIsReg && !srcIsMem && !srcIsImm) {
        return { line, message: `Invalid source operand: ${src}`, type: 'error' };
      }
      if (destIsMem && srcIsMem) {
        return { line, message: `${opcode} does not support memory to memory`, type: 'error' };
      }
      return null;
    }

    case 'ADD':
    case 'ADC':
    case 'SUB':
    case 'SBB':
    case 'CMP':
    case 'AND':
    case 'OR':
    case 'XOR':
      if (operands.length !== 2) {
        return { line, message: `${opcode} requires 2 operands`, type: 'error' };
      }
      if (!isAnyRegister(operands[0]) && !isValidMemoryOperand(operands[0])) {
        return { line, message: `Invalid destination operand: ${operands[0]}`, type: 'error' };
      }
      if (!isAnyRegister(operands[1]) && !isValidImmediate(operands[1]) && !isValidMemoryOperand(operands[1])) {
        return { line, message: `Invalid source operand: ${operands[1]}`, type: 'error' };
      }
      return null;

    case 'MUL':
    case 'DIV':
    case 'MOD':
    case 'INC':
    case 'DEC':
    case 'NEG':
    case 'NOT':
    case 'OUT':
    case 'OUTC':
    case 'PUSH':
    case 'POP':
      if (operands.length !== 1) {
        return { line, message: `${opcode} requires 1 operand`, type: 'error' };
      }
      if (!isAnyRegister(operands[0]) && !isValidImmediate(operands[0]) && !isValidMemoryOperand(operands[0])) {
        return { line, message: `Invalid operand: ${operands[0]}`, type: 'error' };
      }
      return null;

    case 'SHL':
    case 'SAL':
    case 'SHR':
    case 'SAR':
      if (operands.length < 1 || operands.length > 2) {
        return { line, message: `${opcode} requires 1 or 2 operands`, type: 'error' };
      }
      if (!isAnyRegister(operands[0]) && !isValidMemoryOperand(operands[0])) {
        return { line, message: `Invalid destination operand: ${operands[0]}`, type: 'error' };
      }
      if (operands.length === 2 && !isAnyRegister(operands[1]) && !isValidImmediate(operands[1])) {
        return { line, message: `Invalid shift count: ${operands[1]}`, type: 'error' };
      }
      return null;

    case 'CALL':
    case 'JMP':
    case 'JE':
    case 'JZ':
    case 'JNE':
    case 'JNZ':
    case 'JL':
    case 'JG':
    case 'JLE':
    case 'JGE':
    case 'JNGE':
    case 'JNLE':
    case 'JNG':
    case 'JNL':
    case 'JC':
    case 'JNC':
    case 'JB':
    case 'JNB':
    case 'JAE':
    case 'JNAE':
    case 'JS':
    case 'JNS':
    case 'JO':
    case 'JNO':
      if (operands.length !== 1) {
        return { line, message: `${opcode} requires 1 operand`, type: 'error' };
      }
      return null;

    case 'INT':
      if (operands.length !== 1) {
        return { line, message: 'INT requires 1 operand', type: 'error' };
      }
      if (!isValidImmediate(operands[0]) && !/^\w+$/.test(operands[0])) {
        return { line, message: `Invalid interrupt vector: ${operands[0]}`, type: 'error' };
      }
      return null;

    case 'IN':
      if (operands.length !== 2) {
        return { line, message: 'IN requires 2 operands', type: 'error' };
      }
      if (!isAnyRegister(operands[0])) {
        return { line, message: `Invalid destination register: ${operands[0]}`, type: 'error' };
      }
      if (!isValidImmediate(operands[1])) {
        return { line, message: `Invalid input port: ${operands[1]}`, type: 'error' };
      }
      return null;

    case 'OUTP':
      if (operands.length !== 2) {
        return { line, message: 'OUTP requires 2 operands', type: 'error' };
      }
      if (!isValidImmediate(operands[0])) {
        return { line, message: `Invalid output port: ${operands[0]}`, type: 'error' };
      }
      if (!isAnyRegister(operands[1])) {
        return { line, message: `Invalid source register: ${operands[1]}`, type: 'error' };
      }
      return null;

    case 'RET':
    case 'IRET':
    case 'HLT':
    case 'NOP':
    case 'CLC':
    case 'STC':
    case 'CMC':
      if (operands.length !== 0) {
        return { line, message: `${opcode} takes no operands`, type: 'error' };
      }
      return null;

    default:
      return null;
  }
}

export function assemble(source: string): AssembledProgram {
  const { codeLines, dataSymbols, initialMemory, errors } = preprocess(source);
  const instructions: Instruction[] = [];
  const labels = new Map<string, number>();

  let instrIndex = 0;
  for (const sourceLine of codeLines) {
    let line = normalizeWhitespace(sourceLine.text);
    if (!line) {
      continue;
    }

    const labelMatch = line.match(/^([A-Za-z_]\w*):(.*)$/);
    if (labelMatch) {
      const labelName = labelMatch[1].toUpperCase();
      if (labels.has(labelName)) {
        errors.push({ line: sourceLine.lineNumber, message: `Duplicate label: ${labelName}`, type: 'error' });
      } else {
        labels.set(labelName, instrIndex);
      }
      line = normalizeWhitespace(labelMatch[2] || '');
      if (!line) {
        continue;
      }
    }

    instrIndex += 1;
  }

  instrIndex = 0;
  for (const sourceLine of codeLines) {
    let line = normalizeWhitespace(sourceLine.text);
    if (!line) {
      continue;
    }

    const labelMatch = line.match(/^([A-Za-z_]\w*):(.*)$/);
    if (labelMatch) {
      line = normalizeWhitespace(labelMatch[2] || '');
      if (!line) {
        continue;
      }
    }

    const parts = line.split(/\s+/);
    let opcode = (parts[0] || '').toUpperCase();
    if (!VALID_OPCODES.has(opcode)) {
      errors.push({ line: sourceLine.lineNumber, message: `Unknown instruction: ${opcode}`, type: 'error' });
      instrIndex += 1;
      continue;
    }

    const operandStr = line.slice(parts[0].length).trim();
    let operands = operandStr ? splitOperands(operandStr) : [];

    if (opcode === 'LEA') {
      opcode = 'MOV';
      operands = operands.map((operand, index) => normalizeOperand('LEA', operand, index, dataSymbols, labels));
    } else {
      operands = operands.map((operand, index) => normalizeOperand(opcode, operand, index, dataSymbols, labels));
    }

    const validation = validateInstruction(opcode, operands, sourceLine.lineNumber);
    if (validation) {
      errors.push(validation);
    }

    instructions.push({
      opcode,
      operands,
      address: instrIndex,
      raw: operands.length > 0 ? `${opcode} ${operands.join(', ')}` : opcode,
    });

    instrIndex += 1;
  }

  if (instructions.length === 0 || instructions[instructions.length - 1].opcode !== 'HLT') {
    instructions.push({
      opcode: 'HLT',
      operands: [],
      address: instrIndex,
      raw: 'HLT (implicit)',
    });
  }

  return {
    bytecode: [],
    labels,
    initialMemory,
    instructions,
    errors,
  };
}

export function formatAssembly(instructions: Instruction[]): string {
  return instructions.map((instr, i) => {
    const addr = i.toString().padStart(4, '0');
    const operandStr = instr.operands.join(', ');
    return `${addr}: ${instr.opcode}${operandStr ? ` ${operandStr}` : ''}`;
  }).join('\n');
}
