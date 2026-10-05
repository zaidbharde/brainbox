/**
 * engine/assembler/operands.ts — operand parsing.
 *
 * Turns an operand token sequence into one of:
 *   - a register (8-bit, 16-bit, segment, implied like AX/DX/CL/1)
 *   - a memory reference, i.e. a ModRM r/m operand with a segment override and
 *     an explicit size
 *   - an immediate constant
 *   - a branch target (a label, or a constant)
 *
 * Size inference follows MASM: a memory operand is a WORD unless the source
 * says BYTE, the register it pairs with is 8-bit, or the destination is known
 * to be 8-bit. Because the size cannot always be decided from a memory operand
 * alone, `parseOperand` reports the size it inferred *and* whether that size
 * was certain, so the encoder can ask for clarification instead of guessing.
 */

import { isReg16, isReg8, isSegmentReg, REG8, REG16 } from "../isa/registers";
import type { MemAddress } from "../isa/modrm";
import { ExpressionParser, type SymbolResolver } from "./expression";
import type { Token } from "./lexer";
import { DiagnosticBag } from "./diagnostics";

export type Operand =
  | { kind: "reg8"; code: number; name: string; line: number; column: number }
  | { kind: "reg16"; code: number; name: string; line: number; column: number }
  | { kind: "sreg"; code: number; name: string; line: number; column: number }
  | { kind: "implied"; name: "ax" | "dx" | "cl" | "one" | "three"; line: number; column: number }
  | {
      kind: "mem";
      address: MemAddress;
      /** Explicit size from BYTE/WORD PTR, or undefined if inferred. */
      size?: 8 | 16;
      /** True when the size came from the source rather than being guessed. */
      sizeExplicit: boolean;
      /** For LEA: the size of the *register* result, not the memory access. */
      line: number;
      column: number;
    }
  | { kind: "imm"; value: number; resolved: boolean; line: number; column: number; text: string }
  | {
      kind: "target";
      value: number;
      resolved: boolean;
      line: number;
      column: number;
      text: string;
      /** `SHORT`/`NEAR` from the source. Without it the encoder takes the
       *  narrowest form that reaches. */
      distance?: "short" | "near";
    };

const IMPLIED = new Map<string, "ax" | "dx" | "cl" | "one" | "three">([
  ["AX", "ax"],
  ["DX", "dx"],
  ["CL", "cl"],
  ["1", "one"],
  ["3", "three"],
]);

const ADDRESS_REGISTERS = new Set(["BX", "BP", "SI", "DI"]);


export interface ParsedOperands {
  operands: Operand[];
  /** Token index after the last consumed operand. */
  end: number;
}

export function parseOperands(
  tokens: readonly Token[],
  start: number,
  symbols: SymbolResolver,
  diagnostics: DiagnosticBag,
  opts: { mnemonic: string },
): ParsedOperands {
  const parser = new ExpressionParser(tokens, symbols, diagnostics, start);
  const operands: Operand[] = [];

  if (parser.atEnd()) return { operands, end: start };

  for (;;) {
    const operand = parseOneOperand(parser, tokens, diagnostics, opts.mnemonic);
    if (operand) operands.push(operand);
    const token = parser.peek();
    if (token?.kind === "punct" && token.text === ",") {
      parser.position++;
      continue;
    }
    break;
  }
  return { operands, end: parser.position };
}

function parseOneOperand(
  parser: ExpressionParser,
  tokens: readonly Token[],
  diagnostics: DiagnosticBag,
  mnemonic: string,
): Operand | undefined {
  let size: 8 | 16 | undefined;
  let sizeExplicit = false;
  let segment: MemAddress["segment"];
  let distance: "short" | "near" | undefined;

  // BYTE / WORD PTR, and SHORT / NEAR on a branch target
  for (;;) {
    const token = parser.peek();
    if (!token || token.kind !== "ident") break;
    const upper = token.text.toUpperCase();
    if (upper === "SHORT" || upper === "NEAR") {
      distance = upper === "SHORT" ? "short" : "near";
      parser.position++;
      continue;
    }
    if (upper === "BYTE" || upper === "WORD") {
      size = upper === "BYTE" ? 8 : 16;
      sizeExplicit = true;
      parser.position++;
      // Optional PTR.
      const next = parser.peek();
      if (next?.kind === "ident" && next.text.toUpperCase() === "PTR") parser.position++;
      continue;
    }
    if (upper === "PTR") {
      parser.position++;
      continue;
    }
    break;
  }

  let token = parser.peek();
  if (!token) return undefined;

  // Segment override. MASM 6 writes `ES:[BX]` and MASM 5 also accepts
  // `ES [BX]`, so the colon between the segment and the bracket is optional.
  if (token.kind === "ident" && isSegmentReg(token.text)) {
    const next = parser.peek(1);
    const afterColon = next?.kind === "punct" && next.text === ":" ? parser.peek(2) : next;
    if (afterColon?.kind === "punct" && afterColon.text === "[") {
      segment = token.text.toUpperCase() as MemAddress["segment"];
      parser.position += next?.kind === "punct" && next.text === ":" ? 2 : 1;
      token = parser.peek();
    }
  }

  if (!token) return undefined;

  // Memory operand
  if (token.kind === "punct" && token.text === "[") {
    return parseMemory(parser, diagnostics, size, sizeExplicit, segment);
  }

  // Plain register
  if (token.kind === "ident") {
    const upper = token.text.toUpperCase();
    const { line, column } = token;
    if (isReg8(upper)) {
      parser.position++;
      return { kind: "reg8", code: REG8.indexOf(upper as (typeof REG8)[number]), name: upper, line, column };
    }
    if (isReg16(upper)) {
      parser.position++;
      return { kind: "reg16", code: REG16.indexOf(upper as (typeof REG16)[number]), name: upper, line, column };
    }
    if (isSegmentReg(upper)) {
      parser.position++;
      return { kind: "sreg", code: ["ES", "CS", "SS", "DS"].indexOf(upper), name: upper, line, column };
    }
    const implied = IMPLIED.get(upper);
    if (implied) {
      parser.position++;
      return { kind: "implied", name: implied, line, column };
    }

    // `LEA r16, name` is MASM's spelling for "the address of name". In LEA's
    // memory-operand slot a bare name is the *direct address* rather than the
    // contents, which is exactly what `OFFSET name` and `[name]` mean, so all
    // three spellings have to reach the same encoding.
    //
    // Without this, `LEA DX, msg` -- the ordinary way to address a string held in
    // a `.DATA` segment -- parsed to an immediate and was then refused, because
    // LEA's source has to be memory: `findCandidates` rejects any non-`mem`
    // operand so that `LEA AX, BX` cannot be encoded as the register-direct form
    // that computes nothing. The strictness is right and is kept; what was
    // missing was the reading of a bare label as an address.
    //
    // Reached only after the register names above have all returned, so any
    // identifier arriving here is a name rather than a register. That matters:
    // `LEA AX, BX` still falls through to the immediate path below and is still
    // refused, which is the behaviour that must not regress.
    if (mnemonic === "LEA") {
      const start = token.text.toUpperCase() === "OFFSET" ? parser.position + 1 : parser.position;
      const before = parser.position;
      parser.position = start;
      const inner = parser.parse();
      if (parser.position > start) {
        return {
          kind: "mem",
          // No base and no index is the direct-address form, which ModR/M can
          // only express as mod=00, rm=110 with a full 16-bit displacement. It
          // is the same address `[name]` would have produced.
          address: { disp: inner.value },
          // The access is through the register, and LEA is word-wide.
          size: 16,
          sizeExplicit: false,
          line,
          column,
        };
      }
      parser.position = before;
    }
  }

  // `OFFSET name` is the address of the name rather than its contents, and
  // `SEG name` is the paragraph its segment was loaded at. Both wrap the
  // expression that follows, so they are consumed here rather than being
  // mistaken for an unknown symbol.
  if (token.kind === "ident") {
    const upper = token.text.toUpperCase();
    if (upper === "OFFSET" || upper === "SEG") {
      const { line, column } = token;
      parser.position++;
      const start = parser.position;
      const inner = parser.parse();
      if (parser.position === start) {
        diagnostics.error(line, column, `${upper} needs a name`);
        return undefined;
      }
      const text = sourceText(tokens, start, parser.position);
      return {
        kind: "imm",
        // SEG yields the load paragraph. Layout is not fixed during a pass, and
        // every Phase 1 program is either one flat segment or .COM-style, where
        // the segment value is zero for the purposes of an address operand.
        value: upper === "SEG" ? 0 : inner.value,
        resolved: inner.resolved,
        line,
        column,
        text,
      };
    }
  }

  // Immediate or branch target
  const before = parser.position;
  const result = parser.parse();
  const after = parser.position;
  if (after === before) {
    parser.position++;
    return undefined;
  }
  const first = tokens[before];
  if (!first) return undefined;

  const isBranch = isBranchMnemonic(mnemonic);
  if (isBranch) {
    return {
      kind: "target",
      value: result.value,
      resolved: result.resolved,
      line: first.line,
      column: first.column,
      text: sourceText(tokens, before, after),
      ...(distance === undefined ? {} : { distance }),
    };
  }
  return {
    kind: "imm",
    value: result.value,
    resolved: result.resolved,
    line: first.line,
    column: first.column,
    text: sourceText(tokens, before, after),
  };
}

function parseMemory(
  parser: ExpressionParser,
  diagnostics: DiagnosticBag,
  size: 8 | 16 | undefined,
  sizeExplicit: boolean,
  segment: MemAddress["segment"],
): Operand {
  const open = parser.next();
  const { line, column } = open;
  parser.position++;

  const address: MemAddress = {};
  if (segment) address.segment = segment;

  let sawRegister = false;
  let pendingSign = 1;
  let constantParts: number[] = [];
  let first = true;

  for (;;) {
    const token = parser.peek();
    if (!token) break;

    if (token.kind === "punct" && token.text === "]") {
      parser.position++;
      break;
    }

    if (token.kind === "punct" && (token.text === "+" || token.text === "-")) {
      if (first) {
        // A leading sign on a bare displacement, e.g. [-4].
        pendingSign = token.text === "-" ? -1 : 1;
        parser.position++;
        continue;
      }
      pendingSign = token.text === "-" ? -1 : 1;
      parser.position++;
      continue;
    }

    if (token.kind === "ident") {
      const upper = token.text.toUpperCase();
      if (ADDRESS_REGISTERS.has(upper)) {
        if (pendingSign < 0) {
          diagnostics.error(
            token.line,
            token.column,
            `a register cannot be subtracted in an 8086 effective address; write [BX-2] instead of [BX-SI]`,
          );
        } else if (address.base === undefined) {
          address.base = upper as MemAddress["base"];
        } else if (address.index === undefined) {
          address.index = upper as MemAddress["index"];
        } else {
          diagnostics.error(
            token.line,
            token.column,
            `an 8086 effective address uses at most two registers, but ${upper} is a third`,
          );
        }
        sawRegister = true;
        parser.position++;
        pendingSign = 1;
        first = false;
        continue;
      }

      if (isReg16(upper) || isReg8(upper) || isSegmentReg(upper)) {
        diagnostics.error(
          token.line,
          token.column,
          `${upper} cannot be used in an 8086 effective address; use BX, BP, SI, or DI`,
        );
        parser.position++;
        pendingSign = 1;
        first = false;
        continue;
      }

      // A symbol, possibly a far pointer expression.
      const before = parser.position;
      const result = parser.parse();
      if (result.usesLocationCounter) {
        diagnostics.error(token.line, token.column, "the location counter cannot be used inside a memory operand");
      } else if (!result.resolved) {
        diagnostics.error(token.line, token.column, `undefined symbol in memory operand`);
      } else {
        constantParts.push(pendingSign * result.value);
      }
      if (parser.position === before) parser.position++;
      first = false;
      continue;
    }

    // Anything else: a constant expression.
    const before = parser.position;
    const result = parser.parse();
    if (parser.position === before) {
      diagnostics.error(token.line, token.column, `unexpected ${JSON.stringify(token.text)} in memory operand`);
      parser.position++;
      break;
    }
    constantParts.push(pendingSign * result.value);
    pendingSign = 1;
    first = false;
  }

  if (constantParts.length > 0) {
    const total = constantParts.reduce((a, b) => a + b, 0) & 0xffff;
    // Preserve the sign of a negative displacement, e.g. [BX-2].
    address.disp = constantParts.some((v) => v < 0) || total > 0x7fff ? (total << 16) >> 16 : total;
  }

  // [BX+BX] is a single register on the 8086, not a two-register address.
  if (address.base !== undefined && address.base === address.index) {
    address.index = undefined;
  }

  if (!sawRegister && address.disp === undefined) {
    address.disp = 0;
  }

  return { kind: "mem", address, size, sizeExplicit, line, column };
}

/** Mnemonics whose single operand is a branch target rather than a constant. */
export function isBranchMnemonic(mnemonic: string): boolean {
  const upper = mnemonic.toUpperCase();
  return (
    upper === "JMP" ||
    upper === "CALL" ||
    upper === "LOOP" ||
    upper === "LOOPE" ||
    upper === "LOOPZ" ||
    upper === "LOOPNE" ||
    upper === "LOOPNZ" ||
    upper === "JCXZ" ||
    upper === "JECXZ" ||
    upper.startsWith("J")
  );
}

function sourceText(tokens: readonly Token[], from: number, to: number): string {
  return tokens
    .slice(from, to)
    .map((t) => t.text)
    .join("");
}
