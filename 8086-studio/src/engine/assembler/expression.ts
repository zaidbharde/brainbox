/**
 * engine/assembler/expression.ts — MASM constant-expression evaluator.
 *
 * Grammar (lowest precedence first):
 *   expr   := term (('+' | '-' | '|' | '~') term)*
 *   term   := factor (('*' | '/' | '&' | '<<' | '>>') factor)*
 *   factor := ('+' | '-' | '~' | '<' | '>') factor | primary
 *   primary:= number | char | string | '$' | '?' | ident | ident '(' expr ')' | '(' expr ')'
 *
 * Evaluation is *partial*: a reference to a symbol that pass 1 has not seen
 * yet yields `resolved: false` instead of an error. That is what makes a
 * two-pass assembler possible — pass 1 discovers the forward reference, sizes
 * the statement from what it does know, and pass 2 re-evaluates for real.
 */

import type { Token } from "./lexer";
import { DiagnosticBag } from "./diagnostics";

export interface ExprValue {
  /** Result in the parser's working width, or exact when requested. */
  value: number;
  /** Exact value while preserveExact mode is active. */
  exact?: bigint;
  /** False when an undefined symbol was referenced. */
  resolved: boolean;
  /** True when the expression reads the location counter. */
  usesLocationCounter: boolean;
}

export interface SymbolResolver {
  /** Current value of `$` for the statement being evaluated. */
  locationCounter(): number;
  /** Value of a named symbol, or undefined if not yet known. */
  lookup(name: string): number | undefined;
  /** True when the name is a known symbol, even if its value is not yet known. */
  isKnown?(name: string): boolean;
  /** True when the name is a memory variable rather than a constant. */
  isVariable?(name: string): boolean;
}

/**
 * Truncate to the parser's working width. 8086 arithmetic is 16-bit, so this is
 * 0xffff almost everywhere; `DD` widens it to 32 bits so a dword constant is not
 * cut in half.
 */
const truncate = (value: number, mask: number): number => value & mask;

const unresolved: ExprValue = { value: 0, resolved: false, usesLocationCounter: false };

/** Parse a constant expression, stopping at any token not consumed. */
export class ExpressionParser {
  private pos = 0;

  constructor(
    private readonly tokens: readonly Token[],
    private readonly symbols: SymbolResolver,
    private readonly diagnostics: DiagnosticBag,
    startAt = 0,
    /** Working width of the expression: 16 for addresses, 32 for `DD`. */
    private readonly mask = 0xffff,
    /** True when callers need the exact arithmetic result instead of truncation. */
    private readonly preserveExact = false,
  ) {
    this.pos = startAt;
  }

  private resolved(value: number, usesLocationCounter = false): ExprValue {
    if (!this.preserveExact) {
      return { value: truncate(value, this.mask), resolved: true, usesLocationCounter };
    }
    return { value, exact: BigInt(value), resolved: true, usesLocationCounter };
  }

  get position(): number {
    return this.pos;
  }

  set position(value: number) {
    this.pos = value;
  }

  peek(offset = 0): Token | undefined {
    return this.tokens[this.pos + offset];
  }

  next(): Token {
    return this.tokens[Math.min(this.pos, this.tokens.length - 1)];
  }

  atEnd(): boolean {
    return this.tokens[this.pos]?.kind === "eof";
  }

  /** Parse a full expression. */
  parse(): ExprValue {
    return this.parseExpr();
  }

  private parseExpr(): ExprValue {
    let left = this.parseTerm();
    for (;;) {
      const token = this.peek();
      if (!token || token.kind !== "punct") break;
      if (token.text === "+") {
        this.pos++;
        const right = this.parseTerm();
        left = this.preserveExact
          ? combineExact(left, right, (a, b) => a + b, token, this.diagnostics)
          : combine(left, right, (a, b) => a + b, this.mask, this.preserveExact);
      } else if (token.text === "-") {
        this.pos++;
        const right = this.parseTerm();
        left = this.preserveExact
          ? combineExact(left, right, (a, b) => a - b, token, this.diagnostics)
          : combine(left, right, (a, b) => a - b, this.mask, this.preserveExact);
      } else if (token.text === "|") {
        this.pos++;
        const right = this.parseTerm();
        left = this.preserveExact
          ? combineExact(left, right, (a, b) => a | b, token, this.diagnostics)
          : combine(left, right, (a, b) => a | b, this.mask, this.preserveExact);
      } else if (token.text === "~") {
        this.pos++;
        const right = this.parseTerm();
        // ~x is x XOR 0xFFFF, i.e. a bitwise complement within 16 bits.
        left = this.preserveExact
          ? exactUnary(right, (a) => ~a, token, this.diagnostics)
          : combine(left, right, (a) => ~a, this.mask, this.preserveExact);
      } else {
        break;
      }
    }
    return left;
  }

  private parseTerm(): ExprValue {
    let left = this.parseFactor();
    for (;;) {
      const token = this.peek();
      if (!token || token.kind !== "punct") break;
      if (token.text === "*") {
        this.pos++;
        const right = this.parseFactor();
        left = this.preserveExact
          ? combineExact(left, right, (a, b) => a * b, token, this.diagnostics)
          : combine(left, right, (a, b) => a * b, this.mask, this.preserveExact);
      } else if (token.text === "/") {
        this.pos++;
        const right = this.parseFactor();
        if (right.resolved && right.value === 0) {
          this.diagnostics.error(token.line, token.column, "division by zero in expression");
          left = unresolved;
        } else {
          left = this.preserveExact
            ? combineExact(left, right, (a, b) => a / b, token, this.diagnostics)
            : combine(left, right, (a, b) => (a / b) | 0, this.mask, this.preserveExact);
        }
      } else if (token.text === "&") {
        this.pos++;
        const right = this.parseFactor();
        left = this.preserveExact
          ? combineExact(left, right, (a, b) => a & b, token, this.diagnostics)
          : combine(left, right, (a, b) => a & b, this.mask, this.preserveExact);
      } else if (token.text === "<<") {
        this.pos++;
        const right = this.parseFactor();
        left = this.preserveExact
          ? combineExact(left, right, (a, b) => a << (b & 15n), token, this.diagnostics)
          : combine(left, right, (a, b) => a << (b & 15), this.mask, this.preserveExact);
      } else if (token.text === ">>") {
        this.pos++;
        const right = this.parseFactor();
        left = this.preserveExact
          ? combineExact(left, right, (a, b) => a >> (b & 15n), token, this.diagnostics)
          : combine(left, right, (a, b) => a >>> (b & 15), this.mask, this.preserveExact);
      } else {
        break;
      }
    }
    return left;
  }

  private parseFactor(): ExprValue {
    const token = this.peek();
    if (!token) return unresolved;

    if (token.kind === "punct") {
      if (token.text === "(") {
        this.pos++;
        const inner = this.parseExpr();
        const close = this.peek();
        if (close?.kind === "punct" && close.text === ")") {
          this.pos++;
        } else {
          this.diagnostics.error(token.line, token.column, "expected ')'");
        }
        return inner;
      }
      if (token.text === "-") {
        this.pos++;
        const operand = this.parseFactor();
        return this.preserveExact
          ? exactUnary(operand, (a) => -a, token, this.diagnostics)
          : combine(operand, operand, (a) => -a, this.mask, this.preserveExact);
      }
      if (token.text === "+") {
        this.pos++;
        return this.parseFactor();
      }
      if (token.text === "~") {
        this.pos++;
        const operand = this.parseFactor();
        return this.preserveExact
          ? exactUnary(operand, (a) => ~a, token, this.diagnostics)
          : combine(operand, operand, (a) => ~a, this.mask, this.preserveExact);
      }
      if (token.text === "<") {
        // LOW x
        this.pos++;
        const operand = this.parseFactor();
        return this.preserveExact
          ? exactUnary(operand, (a) => a & 0xffn, token, this.diagnostics)
          : combine(operand, operand, (a) => a & 0xff, this.mask, this.preserveExact);
      }
      if (token.text === ">") {
        // HIGH x
        this.pos++;
        const operand = this.parseFactor();
        return this.preserveExact
          ? exactUnary(operand, (a) => (a >> 8n) & 0xffn, token, this.diagnostics)
          : combine(operand, operand, (a) => (a >> 8) & 0xff, this.mask, this.preserveExact);
      }
    }

    if (token.kind === "number") {
      this.pos++;
      if (this.preserveExact && !Number.isSafeInteger(token.value)) {
        this.diagnostics.error(
          token.line,
          token.column,
          `expression value ${token.text} exceeds the evaluator's exact integer range`,
        );
        return unresolved;
      }
      return this.resolved(token.value);
    }

    if (token.kind === "char") {
      this.pos++;
      return this.resolved(token.value);
    }

    if (token.kind === "dollar") {
      this.pos++;
      return this.resolved(this.symbols.locationCounter(), true);
    }

    if (token.kind === "string") {
      // A quoted run longer than one character is text, not a value, so it has no
      // number to stand for. Saying so beats letting the statement parser go on
      // to report the pieces of it as undefined symbols, which is what this used
      // to produce for `MOV AX, 'Hello'`.
      this.diagnostics.error(
        token.line,
        token.column,
        `a string of ${token.string?.length ?? 0} characters is not a value; store it with DB, or quote a single character for its code`,
      );
      this.pos++;
      return unresolved;
    }

    if (token.kind === "question") {
      // `?` on its own is only legal as a DUP filler; as an expression it is 0.
      this.pos++;
      return this.resolved(0);
    }

    if (token.kind === "ident") {
      return this.parseIdent();
    }

    this.diagnostics.error(token.line, token.column, `unexpected ${JSON.stringify(token.text)} in expression`);
    this.pos++;
    return unresolved;
  }

  private parseIdent(): ExprValue {
    const token = this.next();
    const name = token.text.toUpperCase();
    this.pos++;

    if (this.peek()?.kind === "punct" && this.peek()!.text === "(") {
      // A macro invocation, e.g. MyMacro(1, 2). Macro expansion happens in the
      // statement parser, so this reports as unresolved and the caller retries
      // the statement in pass 2.
      this.pos++;
      if (!(this.peek()?.kind === "punct" && this.peek()!.text === ")")) {
        for (;;) {
          this.parseExpr();
          const sep = this.peek();
          if (sep?.kind === "punct" && sep.text === ",") {
            this.pos++;
            continue;
          }
          break;
        }
      }
      const close = this.peek();
      if (close?.kind === "punct" && close.text === ")") this.pos++;
      else this.diagnostics.error(token.line, token.column, `expected ')' after ${name}(`);
      return unresolved;
    }

    if (name === "LOW" || name === "HIGH") {
      const operand = this.parseFactor();
      return this.preserveExact
        ? exactUnary(
            operand,
            (a) => (name === "LOW" ? a & 0xffn : (a >> 8n) & 0xffn),
            token,
            this.diagnostics,
          )
        : combine(
            operand,
            operand,
            (a) => (name === "LOW" ? a & 0xff : (a >> 8) & 0xff),
            this.mask,
            this.preserveExact,
          );
    }

    const value = this.symbols.lookup(name);
    if (value === undefined) {
      if (this.symbols.isVariable?.(name)) {
        // A memory variable used in a constant expression: legal in MASM for
        // some directives, but not here.
        this.diagnostics.error(
          token.line,
          token.column,
          `${name} is a variable, not a constant; use OFFSET ${name}`,
        );
        return unresolved;
      }
      if (this.symbols.isKnown?.(name)) return unresolved;
      // Forward reference or a genuine typo: defer the verdict to pass 2, but
      // remember the position so pass 2 can report it precisely.
      unresolvedReferences.push({ name, line: token.line, column: token.column });
      return unresolved;
    }
    if (this.preserveExact && !Number.isSafeInteger(value)) {
      this.diagnostics.error(
        token.line,
        token.column,
        `expression value ${value} exceeds the evaluator's exact integer range`,
      );
      return unresolved;
    }
    return this.resolved(value);
  }
}

/**
 * References seen while evaluating an expression. The assembler clears this
 * between statements; in pass 2 anything still listed is a real undefined
 * symbol and gets a diagnostic.
 */
export const unresolvedReferences: Array<{ name: string; line: number; column: number }> = [];

export function clearUnresolvedReferences(): void {
  unresolvedReferences.length = 0;
}

function combine(
  a: ExprValue,
  b: ExprValue,
  fn: (x: number, y: number) => number,
  mask: number,
  preserveExact: boolean,
): ExprValue {
  if (!a.resolved || !b.resolved) {
    return {
      value: 0,
      resolved: false,
      usesLocationCounter: a.usesLocationCounter || b.usesLocationCounter,
    };
  }
  return {
    value: preserveExact ? fn(a.value, b.value) : fn(a.value, b.value) & mask,
    resolved: true,
    usesLocationCounter: a.usesLocationCounter || b.usesLocationCounter,
  };
}

function exactUnary(
  operand: ExprValue,
  fn: (value: bigint) => bigint,
  _token: Token,
  _diagnostics: DiagnosticBag,
): ExprValue {
  if (!operand.resolved) {
    return { value: 0, resolved: false, usesLocationCounter: operand.usesLocationCounter };
  }
  return {
    value: 0,
    exact: fn(operand.exact ?? BigInt(operand.value)),
    resolved: true,
    usesLocationCounter: operand.usesLocationCounter,
  };
}

function combineExact(
  a: ExprValue,
  b: ExprValue,
  fn: (x: bigint, y: bigint) => bigint,
  _token: Token,
  _diagnostics: DiagnosticBag,
): ExprValue {
  if (!a.resolved || !b.resolved) {
    return { value: 0, resolved: false, usesLocationCounter: a.usesLocationCounter || b.usesLocationCounter };
  }
  const left = a.exact ?? BigInt(a.value);
  const right = b.exact ?? BigInt(b.value);
  return {
    value: 0,
    exact: fn(left, right),
    resolved: true,
    usesLocationCounter: a.usesLocationCounter || b.usesLocationCounter,
  };
}

