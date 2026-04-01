// High-Level Language Lexer
import { Token, CompilerError } from '../types/cpu';

const KEYWORDS = [
  'program', 'end', 'if', 'else', 'while', 'for', 'print', 'input', 'var', 'then', 'do', 'to', 'step', 'and', 'or', 'not', 'true', 'false'
];

const OPERATORS = [
  '==', '!=', '<=', '>=', '<', '>', '=', '+', '-', '*', '/', '%', '(', ')', ','
];

export function tokenize(source: string): { tokens: Token[]; errors: CompilerError[] } {
  const tokens: Token[] = [];
  const errors: CompilerError[] = [];
  const lines = source.split('\n');
  
  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum];
    let col = 0;
    
    while (col < line.length) {
      // Skip whitespace
      if (/\s/.test(line[col])) {
        col++;
        continue;
      }
      
      // Skip comments (using ; or // or #)
      if (line[col] === ';' || line[col] === '#' || (line[col] === '/' && line[col + 1] === '/')) {
        break;
      }
      
      // Check for operators (multi-char first)
      let matchedOp: string | null = null;
      for (const op of OPERATORS) {
        if (line.substring(col, col + op.length) === op) {
          if (!matchedOp || op.length > matchedOp.length) {
            matchedOp = op;
          }
        }
      }
      
      if (matchedOp) {
        tokens.push({
          type: 'OPERATOR',
          value: matchedOp,
          line: lineNum + 1,
          column: col + 1
        });
        col += matchedOp.length;
        continue;
      }
      
      // Check for numbers
      if (/\d/.test(line[col])) {
        let numStr = '';
        const startCol = col;
        while (col < line.length && /[\dxXa-fA-FbB]/.test(line[col])) {
          numStr += line[col];
          col++;
        }
        // Handle hex suffix 'h'
        if (col < line.length && line[col].toLowerCase() === 'h') {
          numStr += line[col];
          col++;
        }
        tokens.push({
          type: 'NUMBER',
          value: numStr,
          line: lineNum + 1,
          column: startCol + 1
        });
        continue;
      }
      
      // Check for identifiers and keywords
      if (/[a-zA-Z_]/.test(line[col])) {
        let ident = '';
        const startCol = col;
        while (col < line.length && /[a-zA-Z0-9_]/.test(line[col])) {
          ident += line[col];
          col++;
        }
        
        const isKeyword = KEYWORDS.includes(ident.toLowerCase());
        tokens.push({
          type: isKeyword ? 'KEYWORD' : 'IDENTIFIER',
          value: ident.toLowerCase(),
          line: lineNum + 1,
          column: startCol + 1
        });
        continue;
      }
      
      // Check for strings
      if (line[col] === '"' || line[col] === "'") {
        const quote = line[col];
        let str = '';
        const startCol = col;
        col++; // Skip opening quote
        
        while (col < line.length && line[col] !== quote) {
          // Handle escape sequences
          if (line[col] === '\\' && col + 1 < line.length) {
            col++;
            switch (line[col]) {
              case 'n': str += '\n'; break;
              case 't': str += '\t'; break;
              case '\\': str += '\\'; break;
              case '"': str += '"'; break;
              case "'": str += "'"; break;
              default: str += line[col];
            }
          } else {
            str += line[col];
          }
          col++;
        }
        
        if (col >= line.length) {
          errors.push({
            line: lineNum + 1,
            message: 'Unterminated string literal',
            type: 'error'
          });
        } else {
          col++; // Skip closing quote
        }
        
        tokens.push({
          type: 'STRING',
          value: str,
          line: lineNum + 1,
          column: startCol + 1
        });
        continue;
      }
      
      // Unknown character
      errors.push({
        line: lineNum + 1,
        message: `Unexpected character: '${line[col]}'`,
        type: 'error'
      });
      col++;
    }
    
    // Add newline token at end of each line (except empty lines)
    if (tokens.length > 0 && tokens[tokens.length - 1].type !== 'NEWLINE') {
      tokens.push({
        type: 'NEWLINE',
        value: '\n',
        line: lineNum + 1,
        column: line.length + 1
      });
    }
  }
  
  tokens.push({
    type: 'EOF',
    value: '',
    line: lines.length,
    column: 0
  });
  
  return { tokens, errors };
}

export function formatTokens(tokens: Token[]): string {
  return tokens
    .filter(t => t.type !== 'NEWLINE' && t.type !== 'EOF')
    .map(t => `[${t.type}:${t.value}]`)
    .join(' ');
}
