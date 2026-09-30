/**
 * engine/assembler/lexer.ts — MASM-flavoured tokenizer.
 *
 * Produces tokens with 1-based line and column so the parser and the editor
 * can point at an exact character. Comment handling (`;` and `//`) happens
 * here so downstream code never has to think about them.
 *
 * Number syntax accepted (matching the existing BrainBox examples):
 *   1234            decimal
 *   0FFh / 0ffH     hex
 *   0xFF / 0XFF     hex
 *   1010b / 1010B   binary
 *   1_000           decimal with digit separators
 *   'A'             character literal
 *   $               location counter, produced as kind "dollar"
 *   ?               uninitialised, produced as kind "question"
 */

import { DiagnosticBag } from "./diagnostics";

export type TokenKind =
  | "ident"
  | "number"
  | "string"
  | "char"
  | "punct"
  | "dollar"
  | "question"
  | "newline"
  | "eof";

export interface Token {
  readonly kind: TokenKind;
  /** Raw source text. */
  readonly text: string;
  /** Numeric value for `number`, character code for `char`. */
  readonly value: number;
  /** Decoded contents for `string`. */
  readonly string?: string;
  /** 1-based line. */
  readonly line: number;
  /** 1-based column. */
  readonly column: number;
  /** True when a literal carried a trailing sign. */
  readonly negative: boolean;
}

const PUNCTUATORS = [
  "<<",
  ">>",
  "[",
  "]",
  "(",
  ")",
  ",",
  ":",
  "+",
  "-",
  "*",
  "/",
  "&",
  "|",
  "^",
  "~",
  "=",
];

/** Words that are not instructions but are legal in an operand list. */
export const RESERVED = new Set([
  "BYTE",
  "WORD",
  "PTR",
  "OFFSET",
  "SEG",
  "SHORT",
  "NEAR",
  "FAR",
  "MASM",
  "LOW",
  "HIGH",
]);

// `?` is deliberately excluded: it is the DUP filler token, and letting it
// start an identifier would shadow the `question` branch in `tokenize`.
function isIdentStart(ch: string): boolean {
  return /[A-Za-z_.@]/.test(ch);
}

function isIdentPart(ch: string): boolean {
  return /[A-Za-z0-9_.@]/.test(ch);
}

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

function isHexDigit(ch: string): boolean {
  return /[0-9A-Fa-f]/.test(ch);
}

/**
 * Try to read a number starting at `i`. Returns the token text and value, or
 * null when the characters do not form a numeric literal.
 */
function readNumber(src: string, i: number, line: number, col: number): { token: Token; next: number } | null {
  const start = i;

  // 0x / 0X prefixed hex
  if (src[i] === "0" && (src[i + 1] === "x" || src[i + 1] === "X")) {
    let j = i + 2;
    let digits = "";
    while (j < src.length && (isHexDigit(src[j]) || src[j] === "_")) {
      if (src[j] !== "_") digits += src[j];
      j++;
    }
    if (digits.length > 0) {
      return {
        token: {
          kind: "number",
          text: src.slice(start, j),
          value: parseInt(digits, 16),
          line,
          column: col,
          negative: false,
        },
        next: j,
      };
    }
  }

  // Binary: only when the digits before the suffix are all 0/1, so that 0Bh
  // stays hex and 10 stays decimal.
  if (src[i] === "0" && (src[i + 1] === "b" || src[i + 1] === "B")) {
    let j = i + 2;
    let digits = "";
    while (j < src.length && (src[j] === "0" || src[j] === "1" || src[j] === "_")) {
      if (src[j] !== "_") digits += src[j];
      j++;
    }
    if (digits.length > 0) {
      return {
        token: {
          kind: "number",
          text: src.slice(start, j),
          value: parseInt(digits, 2),
          line,
          column: col,
          negative: false,
        },
        next: j,
      };
    }
  }

  // Collect the leading decimal digits, since a number must start with one.
  // A literal may not start with a hex letter, which is what keeps the register
  // `AH` from being read as the hex number 10.
  let j = i;
  while (j < src.length && (isDigit(src[j]) || src[j] === "_")) j++;
  if (j === i) return null;

  // A hex literal is a run of hex digits closed by `h`. The run may include
  // A-F characters after the leading digit, which is how `0FFh` and `0Bh` are
  // written. Without the `h` the run is *not* hex: MASM would read `10AB` as
  // the number 10 followed by the identifier AB, so that is what happens here.
  let hexEnd = j;
  while (hexEnd < src.length && (isHexDigit(src[hexEnd]) || src[hexEnd] === "_")) hexEnd++;
  if (hexEnd < src.length && (src[hexEnd] === "h" || src[hexEnd] === "H")) {
    const digits = src.slice(i, hexEnd).replace(/_/g, "");
    return {
      token: {
        kind: "number",
        text: src.slice(start, hexEnd + 1),
        value: parseInt(digits, 16),
        line,
        column: col,
        negative: false,
      },
      next: hexEnd + 1,
    };
  }

  // Binary suffix: 1010b. Only when the digits are all 0/1, so that 1012b stays
  // a decimal with a stray suffix rather than silently becoming a binary.
  const digits = src.slice(i, j).replace(/_/g, "");
  if (j < src.length && (src[j] === "b" || src[j] === "B") && /^[01]+$/.test(digits)) {
    return {
      token: {
        kind: "number",
        text: src.slice(start, j + 1),
        value: parseInt(digits, 2),
        line,
        column: col,
        negative: false,
      },
      next: j + 1,
    };
  }

  return {
    token: {
      kind: "number",
      text: src.slice(start, j),
      value: parseInt(digits, 10),
      line,
      column: col,
      negative: false,
    },
    next: j,
  };
}

export function tokenize(source: string, diagnostics?: DiagnosticBag): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  let col = 1;

  const push = (token: Token) => tokens.push(token);

  const advance = (count: number) => {
    for (let k = 0; k < count; k++) {
      if (source[i] === "\n") {
        line++;
        col = 1;
      } else {
        col++;
      }
      i++;
    }
  };

  while (i < source.length) {
    const ch = source[i];

    // A newline is a real token, not skipped whitespace. Macro expansion copies
    // tokens from a definition into a call site, so the only surviving record
    // of where one statement ended and the next began is the newline itself.
    if (ch === "\n") {
      push({ kind: "newline", text: "\n", value: 0, line, column: col, negative: false });
      advance(1);
      continue;
    }

    // Whitespace
    if (ch === " " || ch === "\t" || ch === "\r") {
      advance(1);
      continue;
    }

    // Comments: `;` to end of line, and `//` to end of line.
    if (ch === ";" || (ch === "/" && source[i + 1] === "/")) {
      while (i < source.length && source[i] !== "\n") advance(1);
      continue;
    }

    const startLine = line;
    const startCol = col;

    // Block comment /* ... */
    if (ch === "/" && source[i + 1] === "*") {
      advance(2);
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) advance(1);
      if (i >= source.length) {
        diagnostics?.error(startLine, startCol, "unterminated block comment");
      } else {
        advance(2);
      }
      continue;
    }

    // Quoted literal. MASM accepts either quote character for text in a data
    // directive, and a single quote character on its own as a character value, so
    // which token this is depends on how much is between the quotes rather than
    // on which quote was used: `'A'` is a character and `'AB'` is a two-byte
    // string. Deciding it here rather than at the data directive is what keeps
    // `MOV AL, 'A'` a character and `DB 'AB'` the two bytes it looks like.
    //
    // The distinction is not cosmetic. Reading a multi-character run as a
    // character used to keep only the last byte, which turned `msg DB 'Hello'`
    // into a message of one `$` -- and a `$` is a DOS string terminator, so
    // `INT 21h` AH=09h printed nothing at all and the program still reported
    // success.
    if (ch === "'") {
      advance(1);
      let value = 0;
      let length = 0;
      let decoded = "";
      while (i < source.length && source[i] !== "'" && source[i] !== "\n") {
        if (source[i] === "\\") {
          advance(1);
          const esc = source[i];
          if (esc === "n") {
            value = 10;
            decoded += "\n";
          } else if (esc === "r") {
            value = 13;
            decoded += "\r";
          } else if (esc === "t") {
            value = 9;
            decoded += "\t";
          } else if (esc === "0") {
            value = 0;
            decoded += "\0";
          } else {
            value = esc ? esc.charCodeAt(0) : 0;
            decoded += esc ?? "";
          }
          advance(1);
        } else {
          value = source.charCodeAt(i);
          decoded += source[i];
          advance(1);
        }
        length++;
      }
      if (source[i] !== "'") {
        diagnostics?.error(startLine, startCol, "unterminated character literal");
        push({ kind: "char", text: "'", value: value & 0xff, line: startLine, column: startCol, negative: false });
        continue;
      }
      advance(1); // closing quote
      if (length !== 1) {
        if (length === 0) {
          diagnostics?.error(startLine, startCol, "a string literal cannot be empty");
        }
        push({
          kind: "string",
          text: `'${decoded}'`,
          value: value & 0xff,
          string: decoded,
          line: startLine,
          column: startCol,
          negative: false,
        });
        continue;
      }
      push({
        kind: "char",
        text: `'${String.fromCharCode(value)}'`,
        value: value & 0xff,
        line: startLine,
        column: startCol,
        negative: false,
      });
      continue;
    }

    // String literal
    if (ch === '"') {
      advance(1);
      let out = "";
      while (i < source.length && source[i] !== '"' && source[i] !== "\n") {
        if (source[i] === "\\") {
          advance(1);
          const esc = source[i];
          if (esc === "n") out += "\n";
          else if (esc === "r") out += "\r";
          else if (esc === "t") out += "\t";
          else if (esc === "0") out += "\0";
          else out += esc ?? "";
          advance(1);
        } else {
          out += source[i];
          advance(1);
        }
      }
      if (source[i] !== '"') {
        diagnostics?.error(startLine, startCol, "unterminated string literal");
      } else {
        advance(1);
      }
      push({
        kind: "string",
        text: `"${out}"`,
        value: 0,
        string: out,
        line: startLine,
        column: startCol,
        negative: false,
      });
      continue;
    }

    // Number
    if (isDigit(ch)) {
      const read = readNumber(source, i, startLine, startCol);
      if (read) {
        advance(read.next - i);
        push(read.token);
        continue;
      }
    }

    // Identifier / directive
    if (isIdentStart(ch)) {
      let j = i;
      while (j < source.length && isIdentPart(source[j])) j++;
      const text = source.slice(i, j);
      advance(j - i);
      push({
        kind: "ident",
        text,
        value: 0,
        line: startLine,
        column: startCol,
        negative: false,
      });
      continue;
    }

    if (ch === "$") {
      advance(1);
      push({ kind: "dollar", text: "$", value: 0, line: startLine, column: startCol, negative: false });
      continue;
    }

    if (ch === "?") {
      advance(1);
      push({ kind: "question", text: "?", value: 0, line: startLine, column: startCol, negative: false });
      continue;
    }

    // Punctuator
    const punct = PUNCTUATORS.find((p) => source.startsWith(p, i));
    if (punct) {
      advance(punct.length);
      push({
        kind: "punct",
        text: punct,
        value: 0,
        line: startLine,
        column: startCol,
        negative: false,
      });
      continue;
    }

    diagnostics?.error(startLine, startCol, `unexpected character ${JSON.stringify(ch)}`);
    advance(1);
  }

  push({ kind: "eof", text: "", value: 0, line, column: col, negative: false });
  return tokens;
}
