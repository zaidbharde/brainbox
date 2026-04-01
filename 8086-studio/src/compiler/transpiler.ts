import { CompilerError } from '../types/cpu';

export type FrontendLanguage = 'simple' | 'python' | 'javascript' | 'java' | 'c';
type BlockKind = 'if' | 'while' | 'for' | 'noop';

interface BlockFrame {
  kind: BlockKind;
  forUpdate?: string;
}

export interface TranspileResult {
  output: string;
  errors: CompilerError[];
}

export function detectFrontendLanguage(source: string): FrontendLanguage {
  const text = source.toLowerCase();
  if (/(system\.out\.print|public\s+class|public\s+static\s+void\s+main)/.test(text)) {
    return 'java';
  }
  if (/(console\.log|let\s+|const\s+|=>|function\s+\w+\s*\()/.test(text)) {
    return 'javascript';
  }
  if (/(#include|printf\s*\(|scanf\s*\(|int\s+main\s*\()/.test(text)) {
    return 'c';
  }
  if (
    /\bend\b/.test(text)
    || /\b(var|input|then|do)\b/.test(text)
    || /^\s*print\s+[^(\n]/m.test(text)
    || /^\s*(if|while)\s+[^:\n]+$/m.test(text)
  ) {
    return 'simple';
  }
  return 'python';
}

export function transpileToHighLevel(source: string, language: Exclude<FrontendLanguage, 'python' | 'simple'>): TranspileResult {
  const errors: CompilerError[] = [];
  const lines = stripBlockComments(source).split('\n');
  const output: string[] = [];
  const stack: BlockFrame[] = [];

  const closeTopBlock = (line: number, allowIfBoundary = false): void => {
    const frame = stack[stack.length - 1];
    if (!frame) {
      errors.push({ line, message: 'Unexpected closing brace', type: 'error' });
      return;
    }
    if (frame.kind === 'if' && allowIfBoundary) {
      return;
    }
    stack.pop();
    if (frame.kind === 'for') {
      if (frame.forUpdate) {
        output.push(frame.forUpdate);
      }
      output.push('end');
      return;
    }
    if (frame.kind === 'if' || frame.kind === 'while') {
      output.push('end');
    }
  };

  const pushFrameForControl = (hasOpenBrace: boolean, kind: BlockKind, forUpdate?: string): void => {
    if (hasOpenBrace) {
      stack.push({ kind, forUpdate });
      return;
    }
    if (kind === 'for') {
      if (forUpdate) {
        output.push(forUpdate);
      }
      output.push('end');
      return;
    }
    if (kind === 'if' || kind === 'while') {
      output.push('end');
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    let line = stripSingleLineComments(lines[i], language).trim();
    if (!line) continue;

    if (/^\}\s*else\b/i.test(line)) {
      closeTopBlock(lineNo, true);
      line = line.replace(/^\}\s*/, '');
    } else {
      while (line.startsWith('}')) {
        closeTopBlock(lineNo, false);
        line = line.slice(1).trimStart();
      }
    }

    if (!line) continue;

    if (line === '{') {
      stack.push({ kind: 'noop' });
      continue;
    }

    const hasOpenBrace = /\{\s*$/.test(line);
    if (hasOpenBrace) {
      line = line.replace(/\{\s*$/, '').trimEnd();
    }

    line = line.replace(/;\s*$/, '').trim();
    if (!line) {
      if (hasOpenBrace) {
        stack.push({ kind: 'noop' });
      }
      continue;
    }

    if (isSkippablePreamble(line)) {
      if (hasOpenBrace) {
        stack.push({ kind: 'noop' });
      }
      continue;
    }

    const elseIfMatch = line.match(/^else\s+if\s*\((.*)\)\s*(.*)$/i);
    if (elseIfMatch) {
      output.push('else');
      output.push(`if ${normalizeExpression(elseIfMatch[1])}`);
      const trailing = elseIfMatch[2]?.trim();
      if (hasOpenBrace) {
        stack.push({ kind: 'if' });
      } else if (trailing) {
        const inlineStmt = transpileSimpleStatement(trailing, lineNo, errors);
        if (inlineStmt) {
          output.push(inlineStmt);
        } else {
          errors.push({
            line: lineNo,
            message: `Unsupported ${language} inline statement: "${trailing}"`,
            type: 'error'
          });
        }
        output.push('end');
      } else {
        output.push('end');
      }
      continue;
    }

    const elseMatch = line.match(/^else\b/i);
    if (elseMatch) {
      output.push('else');
      if (!hasOpenBrace) {
        output.push('end');
      }
      continue;
    }

    const ifMatch = line.match(/^if\s*\((.*)\)\s*(.*)$/i);
    if (ifMatch) {
      output.push(`if ${normalizeExpression(ifMatch[1])}`);
      const trailing = ifMatch[2]?.trim();
      if (hasOpenBrace) {
        pushFrameForControl(true, 'if');
      } else if (trailing) {
        const inlineStmt = transpileSimpleStatement(trailing, lineNo, errors);
        if (inlineStmt) {
          output.push(inlineStmt);
        } else {
          errors.push({
            line: lineNo,
            message: `Unsupported ${language} inline statement: "${trailing}"`,
            type: 'error'
          });
        }
        output.push('end');
      } else {
        pushFrameForControl(false, 'if');
      }
      continue;
    }

    const whileMatch = line.match(/^while\s*\((.*)\)\s*(.*)$/i);
    if (whileMatch) {
      output.push(`while ${normalizeExpression(whileMatch[1])}`);
      const trailing = whileMatch[2]?.trim();
      if (hasOpenBrace) {
        pushFrameForControl(true, 'while');
      } else if (trailing) {
        const inlineStmt = transpileSimpleStatement(trailing, lineNo, errors);
        if (inlineStmt) {
          output.push(inlineStmt);
        } else {
          errors.push({
            line: lineNo,
            message: `Unsupported ${language} inline statement: "${trailing}"`,
            type: 'error'
          });
        }
        output.push('end');
      } else {
        pushFrameForControl(false, 'while');
      }
      continue;
    }

    const forMatch = line.match(/^for\s*\(([^;]*);([^;]*);(.*)\)\s*(.*)$/i);
    if (forMatch) {
      const initStmt = transpileSimpleStatement(forMatch[1], lineNo, errors);
      if (initStmt) {
        output.push(initStmt);
      }

      const condExpr = normalizeExpression(forMatch[2] || 'true');
      output.push(`while ${condExpr}`);

      const updateStmt = transpileForUpdate(forMatch[3].trim(), lineNo, errors, true);
      const updateStmtForFrame = updateStmt ?? undefined;
      const trailing = forMatch[4]?.trim();
      if (hasOpenBrace) {
        pushFrameForControl(true, 'for', updateStmtForFrame);
      } else if (trailing) {
        const inlineStmt = transpileSimpleStatement(trailing, lineNo, errors);
        if (inlineStmt) {
          output.push(inlineStmt);
        } else {
          errors.push({
            line: lineNo,
            message: `Unsupported ${language} inline statement: "${trailing}"`,
            type: 'error'
          });
        }
        if (updateStmt) {
          output.push(updateStmt);
        }
        output.push('end');
      } else {
        pushFrameForControl(false, 'for', updateStmtForFrame);
      }
      continue;
    }

    const stmt = transpileSimpleStatement(line, lineNo, errors);
    if (stmt) {
      output.push(stmt);
      if (hasOpenBrace) {
        stack.push({ kind: 'noop' });
      }
      continue;
    }
    if (isIgnorableStatement(line)) {
      continue;
    }

    errors.push({
      line: lineNo,
      message: `Unsupported ${language} syntax: "${line}"`,
      type: 'error'
    });
  }

  while (stack.length > 0) {
    const frame = stack.pop();
    if (!frame) break;
    if (frame.kind === 'for') {
      if (frame.forUpdate) output.push(frame.forUpdate);
      output.push('end');
    } else if (frame.kind === 'if' || frame.kind === 'while') {
      output.push('end');
    }
  }

  return { output: output.join('\n'), errors };
}

function transpileSimpleStatement(sourceLine: string, lineNo: number, errors: CompilerError[]): string | null {
  const line = sourceLine.trim().replace(/;\s*$/, '');
  if (!line) return null;

  const inputVar = transpileInput(line);
  if (inputVar) {
    return `input ${inputVar}`;
  }

  const printExpr = transpilePrint(line);
  if (printExpr !== null) {
    return `print ${normalizeExpression(printExpr)}`;
  }

  const varDeclMatch = line.match(
    /^(?:(?:unsigned|signed|const|static|extern|volatile)\s+)*(?:let|const|var|int|long|short|byte|float|double|char|boolean|string|size_t)\s+(.+)$/i
  );
  if (varDeclMatch) {
    const declarations = splitByComma(varDeclMatch[1]);
    const emitted: string[] = [];
    for (const declaration of declarations) {
      const part = declaration.trim();
      if (!part) continue;
      const [namePart, init] = splitOnce(part, '=');
      const name = normalizeDeclaredName(namePart);
      if (!name) {
        errors.push({ line: lineNo, message: `Invalid variable declaration: "${line}"`, type: 'error' });
        return null;
      }
      if (!init) {
        emitted.push(`var ${name}`);
      } else {
        emitted.push(`var ${name} = ${normalizeExpression(init)}`);
      }
    }
    return emitted.join('\n');
  }

  const update = transpileForUpdate(line, lineNo, errors, false);
  if (update) {
    return update;
  }

  const assignment = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
  if (assignment) {
    return `${assignment[1]} = ${normalizeExpression(assignment[2])}`;
  }

  if (isIgnorableStatement(line)) {
    return null;
  }

  return null;
}

function transpileForUpdate(
  update: string,
  lineNo: number,
  errors: CompilerError[],
  emitUnsupportedError: boolean
): string | null {
  const trimmed = update.trim().replace(/;\s*$/, '');
  if (!trimmed) return null;

  const preInc = trimmed.match(/^\+\+\s*([A-Za-z_][A-Za-z0-9_]*)$/);
  if (preInc) return `${preInc[1]} = ${preInc[1]} + 1`;

  const preDec = trimmed.match(/^--\s*([A-Za-z_][A-Za-z0-9_]*)$/);
  if (preDec) return `${preDec[1]} = ${preDec[1]} - 1`;

  const inc = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*\+\+$/);
  if (inc) return `${inc[1]} = ${inc[1]} + 1`;

  const dec = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*--$/);
  if (dec) return `${dec[1]} = ${dec[1]} - 1`;

  const compound = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*([+\-*/%])=\s*(.+)$/);
  if (compound) {
    return `${compound[1]} = ${compound[1]} ${compound[2]} ${normalizeExpression(compound[3])}`;
  }

  const assignment = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
  if (assignment) {
    return `${assignment[1]} = ${normalizeExpression(assignment[2])}`;
  }

  if (emitUnsupportedError) {
    errors.push({ line: lineNo, message: `Unsupported update expression: "${trimmed}"`, type: 'error' });
  }
  return null;
}

function transpilePrint(line: string): string | null {
  const java = line.match(/^System\.out\.(?:println|print)\s*\((.*)\)$/);
  if (java) return java[1].trim();

  const js = line.match(/^console\.log\s*\((.*)\)$/i);
  if (js) return js[1].trim();

  const c = line.match(/^printf\s*\((.*)\)$/i);
  if (c) {
    const args = splitArguments(c[1]);
    if (args.length === 0) return null;
    if (args.length === 1) return args[0];
    return args[1] ?? args[0];
  }

  return null;
}

function transpileInput(line: string): string | null {
  const scanf = line.match(/^scanf\s*\((.*)\)$/i);
  if (!scanf) return null;
  const args = splitArguments(scanf[1]);
  if (args.length < 2) return null;
  const rawVar = args[1].replace(/^&/, '').trim();
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(rawVar) ? rawVar : null;
}

function normalizeExpression(expr: string): string {
  return expr
    .replace(/\btrue\b/gi, 'true')
    .replace(/\bfalse\b/gi, 'false')
    .replace(/&&/g, ' and ')
    .replace(/\|\|/g, ' or ')
    .replace(/!=/g, ' != ')
    .replace(/==/g, ' == ')
    .replace(/<=/g, ' <= ')
    .replace(/>=/g, ' >= ')
    .replace(/(?<![=!<>])!(?![=])/g, ' not ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isSkippablePreamble(line: string): boolean {
  if (/^(#include|using\s+namespace|import\s+|package\s+|public\s+class|class\s+|public\s+static\s+void\s+main|function\s+\w+\s*\()/i.test(line)) {
    return true;
  }
  // C/C++ entry points and function signatures.
  if (/^(?:int|void|long|short|unsigned|signed)\s+main\s*\(/i.test(line) || /^main\s*\(/i.test(line)) {
    return true;
  }
  if (/^[A-Za-z_][\w\s\*]*\s+[A-Za-z_][A-Za-z0-9_]*\s*\([^;]*\)$/i.test(line) && !/\b(if|while|for|switch)\b/i.test(line)) {
    return true;
  }
  return false;
}

function stripBlockComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '');
}

function stripSingleLineComments(line: string, _language: Exclude<FrontendLanguage, 'python' | 'simple'>): string {
  if (/^\s*#/.test(line)) {
    return line;
  }
  const hashCommentsAllowed = false;
  const slash = line.indexOf('//');
  const hash = hashCommentsAllowed ? line.indexOf('#') : -1;
  const candidates = [slash, hash].filter((idx) => idx >= 0);
  if (candidates.length === 0) return line;
  const cutAt = Math.min(...candidates);
  return line.slice(0, cutAt);
}

function splitArguments(argsText: string): string[] {
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
    if (ch === '(') {
      depth++;
      current += ch;
      continue;
    }
    if (ch === ')') {
      depth = Math.max(0, depth - 1);
      current += ch;
      continue;
    }
    if (ch === ',' && depth === 0) {
      if (current.trim()) args.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }

  if (current.trim()) args.push(current.trim());
  return args;
}

function splitByComma(input: string): string[] {
  return splitArguments(input);
}

function splitOnce(input: string, separator: string): [string, string | null] {
  const idx = input.indexOf(separator);
  if (idx < 0) return [input, null];
  return [input.slice(0, idx), input.slice(idx + separator.length)];
}

function normalizeDeclaredName(raw: string): string | null {
  const match = raw.trim().match(/([A-Za-z_][A-Za-z0-9_]*)\s*$/);
  return match ? match[1] : null;
}

function isIgnorableStatement(line: string): boolean {
  return /^(return|break|continue)\b/i.test(line.trim());
}
