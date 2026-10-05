/**
 * engine/assembler/assemble.ts — the MASM-style assembler.
 *
 * `assemble(source)` runs two passes over the same line-oriented token stream:
 *
 *   Pass 1 lays out every statement, defines labels, and records which names were
 *   referenced before they were defined. Forward references are *not* errors.
 *   Pass 2 re-evaluates everything with a full symbol table, so short-branch
 *   relaxation and back-patched displacements come out right.
 *
 * Diagnostics are accumulated, not thrown, so one run reports every problem in
 * the file with a 1-based line and column.
 */

import { tokenize, RESERVED, type Token } from "./lexer";
import { DiagnosticBag, type Diagnostic } from "./diagnostics";
import { extractMacros, expandMacros } from "./macros";
import { SymbolTable, symbolKey, type Symbol } from "./symbols";
import { SegmentBuffer, type EntryPoint, type SegmentClass, type SegmentImage } from "./layout";
import { ExpressionParser, type SymbolResolver } from "./expression";
import { parseOperands, type Operand } from "./operands";
import { encode, selectEncoding, type EncodeRequest } from "./encoder";
import { INSTRUCTION_TABLE, JCC_ALIASES, LOOP_ALIASES, SHIFT_ALIASES, type InsnDef } from "../isa/table";

export interface AssembleOptions {
  /**
   * Segment offset the first byte of code is loaded at. The default matches a
   * .COM program, and is what makes `[0x0100]` from the compiler's code
   * generator land on the program's own variables.
   */
  origin?: number;
  /** Initial SP for the implicit COM layout. */
  initialSP?: number;
  /** Cap on collected diagnostics. */
  maxErrors?: number;
  /** Reserved for future use; passed through untouched. */
  includeListing?: boolean;
}

export interface ListingEntry {
  line: number;
  /** Segment offset of the statement, or undefined for a label-only line. */
  offset?: number;
  segment: string;
  bytes: number[];
  text: string;
}

export interface SourceLineEntry {
  line: number;
  segment: string;
  offset: number;
  bytes: number[];
}

export interface AssemblyResult {
  success: boolean;
  diagnostics: readonly Diagnostic[];
  errors: readonly Diagnostic[];
  warnings: readonly Diagnostic[];
  segments: SegmentImage[];
  entry: EntryPoint;
  symbols: SymbolTable;
  listing: ListingEntry[];
  /** Every emitted statement, for the debugger's source view. */
  sourceLines: SourceLineEntry[];
  /** Flat image of the code segment, indexed from offset 0. */
  image: Uint8Array;
}

interface Statement {
  line: number;
  column: number;
  tokens: Token[];
}

const DEFAULT_ORIGIN = 0x0100;
const DEFAULT_SP = 0xfffe;

/**
 * Round a segment base up to the next paragraph.
 *
 * A segment register is multiplied by 16 to form the high part of a physical
 * address, so a base that is not a multiple of 16 could not be held in a
 * segment register at all. Paragraph alignment is what makes the layout
 * loadable rather than merely arithmetic.
 */
function alignToParagraph(value: number): number {
  return (value + 0xf) & ~0xf;
}

const DATA_DIRECTIVE_SIZE: Record<string, 8 | 16 | 32> = { DB: 8, DW: 16, DD: 32 };

/** Directives that carry no operands we need to act on. */
const IGNORED_DIRECTIVES = new Set([
  "TITLE",
  "SUBTTL",
  "NAME",
  "PAGE",
  "COMMENT",
  "PUBLIC",
  "EXTRN",
  "EXTERN",
  "SAFE",
  "MASM",
]);

/** Directives we recognise but deliberately do not implement yet. */
const UNSUPPORTED_DIRECTIVES = new Set([
  "IF",
  "IFDEF",
  "IFNDEF",
  "ELSE",
  "ELSEIF",
  "ENDIF",
  "REPT",
  "WHILE",
  "ALIGN",
  "INCLUDE",
]);

const MNEMONICS = new Set(INSTRUCTION_TABLE.map((def) => def.mnem));
// Jcc, LOOP and shift aliases are legal mnemonics even though the table only
// lists one name per encoding.
for (const alias of Object.keys(JCC_ALIASES)) MNEMONICS.add(alias);
for (const alias of Object.keys(LOOP_ALIASES)) MNEMONICS.add(alias);
for (const alias of Object.keys(SHIFT_ALIASES)) MNEMONICS.add(alias);

export function assemble(source: string, options: AssembleOptions = {}): AssemblyResult {
  const diagnostics = new DiagnosticBag(options.maxErrors ?? 500);
  const origin = options.origin ?? DEFAULT_ORIGIN;
  const initialSP = options.initialSP ?? DEFAULT_SP;

  const tokens = tokenize(source, diagnostics);
  const { tokens: withoutMacros, macros } = extractMacros(tokens, diagnostics);
  const statements = expandMacros(withoutMacros, macros, diagnostics);
  const lines = groupLines(statements);

  const symbols = new SymbolTable();
  const buffers = new Map<string, SegmentBuffer>();
  const segmentOrder: string[] = [];
  const listing: ListingEntry[] = [];
  const sourceLines: SourceLineEntry[] = [];

  // A single implicit segment holds both code and data, which is what a .COM
  // program expects. Programs using SEGMENT get one buffer per name.
  // Where code starts depends on the shape of the program, and that has to be
  // decided before the first byte is laid out: a flat program loads at `origin`
  // so that direct `[0x0100]` references from the compiler's code generator land
  // on the program's own variables, while a program with real segments starts
  // at offset 0 of its code segment.
  const prescan = prescanLines(lines);
  const codeOrigin = prescan.hasModel ? 0 : origin;

  // The origin is part of the buffer rather than a one-off `seek`, so that
  // `image()` trims to the bytes actually emitted and `reset()` returns the
  // second pass to the same starting point.
  const comBuffer = new SegmentBuffer("_COM", "CODE", codeOrigin);
  buffers.set("_COM", comBuffer);
  segmentOrder.push("_COM");
  for (const name of prescan.presegments) {
    const buffer = new SegmentBuffer(name, classOfSegment(name));
    buffers.set(name, buffer);
    segmentOrder.push(name);
  }

  const context: PassContext = {
    diagnostics,
    symbols,
    buffers,
    segmentOrder,
    current: comBuffer,
    origin: codeOrigin,
    initialSP,
    listing,
    sourceLines,
    pass: 1,
    hasModel: prescan.hasModel,
    stackSize: undefined,
    usesSegmentDirective: prescan.usesSegmentDirective,
    presegments: prescan.presegments,
    entryLabel: undefined,
    codeSegmentName: "_COM",
    dataSegmentName: "_COM",
  };

  // `@DATA`, `@CODE` and `@STACK` have to be resolvable from the first token,
  // because `MOV AX, @DATA` is ordinary code rather than a directive. A real
  // load paragraph cannot be computed until every segment has been sized, so
  // they start at the flat program's zero and are corrected below if the layout
  // turns out to disagree.
  applySegmentGroupBases(symbols, { data: 0, code: 0, stack: 0 });

  // Passes are repeated until the addresses stop moving.
  //
  // A forward branch has to be *sized* before its target address is known, so
  // the first pass lays it out as the wide two-byte form. The next pass can see
  // the real distance and may shrink it to one byte — which moves every label
  // after it, which invalidates the distance it just used. A plain two-pass
  // assembler therefore lands on a stale layout unless nothing after a forward
  // branch refers to a label, so instead the loop runs until a pass produces
  // exactly the same addresses as the one before it. In practice that is three
  // passes: discover, then narrow, then confirm.
  //
  // Only the final pass's diagnostics are reported. Every earlier pass is a
  // guess, and showing the author each problem three times is worse than
  // useless.
  const limit = options.maxErrors ?? 500;
  let passDiagnostics = new DiagnosticBag(limit);

  const runPasses = (): void => {
    let previous: Map<string, number> | undefined;
    for (let pass = 1; pass <= MAX_PASSES; pass++) {
      if (pass > 1) {
        symbols.beginPass();
        for (const buffer of buffers.values()) buffer.reset();
        context.current = buffers.get("_COM") ?? comBuffer;
        context.listing.length = 0;
        context.sourceLines.length = 0;
        context.firstCodeOffset = undefined;
        context.firstFlatOffset = undefined;
      }
      context.pass = pass === 1 ? 1 : 2;
      passDiagnostics = new DiagnosticBag(limit);
      context.diagnostics = passDiagnostics;
      runPass(context, lines);

      const addresses = symbols.addresses();
      if (previous !== undefined && sameAddresses(previous, addresses)) break;
      previous = addresses;
    }
  };

  runPasses();

  let layout = resolveLayout(context);

  // The load paragraphs are the one set of values that cannot be known while the
  // code that reads them is being laid out, so the first pass has to guess. When
  // the guess was wrong, emit them properly and run once more.
  //
  // One more pass is provably enough: an instruction's *size* never depends on
  // the value of an immediate, so giving `MOV AX, @DATA` its real load address
  // cannot resize it or move any label. The layout the second run produces is
  // therefore the layout that produced its own bases.
  if (applySegmentGroupBases(symbols, {
    data: layout.entry.dataBase,
    code: layout.entry.codeBase,
    stack: layout.entry.stackBase,
  })) {
    runPasses();
    layout = resolveLayout(context);
  }

  for (const symbol of symbols.undefinedNames()) {
    diagnostics.error(symbol.line, symbol.column, `undefined symbol ${symbol.name}`);
  }
  const codeBuffer = buffers.get(layout.codeSegmentName);
  const reported = [...diagnostics.all, ...passDiagnostics.all];

  return {
    success: reported.every((d) => d.severity !== "error"),
    diagnostics: reported,
    errors: reported.filter((d) => d.severity === "error"),
    warnings: reported.filter((d) => d.severity === "warning"),
    segments: layout.segments,
    entry: layout.entry,
    symbols,
    listing,
    sourceLines,
    image: codeBuffer ? codeBuffer.image() : new Uint8Array(0),
  };
}

/** Enough passes to settle a chain of shortening branches, with slack. */
const MAX_PASSES = 8;

function sameAddresses(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [key, value] of a) {
    if (b.get(key) !== value) return false;
  }
  return true;
}

interface PassContext {
  diagnostics: DiagnosticBag;
  symbols: SymbolTable;
  buffers: Map<string, SegmentBuffer>;
  segmentOrder: string[];
  current: SegmentBuffer;
  origin: number;
  initialSP: number;
  listing: ListingEntry[];
  sourceLines: SourceLineEntry[];
  pass: 1 | 2;
  hasModel: boolean;
  /** Offset of the first instruction emitted, which becomes the entry IP. */
  firstCodeOffset?: number;
  /** Offset of the first thing emitted, for a program that is only data. */
  firstFlatOffset?: number;
  stackSize?: number;
  usesSegmentDirective: boolean;
  presegments: readonly string[];
  entryLabel?: string;
  codeSegmentName: string;
  dataSegmentName: string;
}

/**
 * Look at the statement stream before laying anything out, to learn which
 * segment form the program uses. The origin and the set of segments have to be
 * known in advance, and a symbol lookup cannot answer that question because the
 * symbols do not exist yet.
 */
function prescanLines(lines: readonly Statement[]): {
  hasModel: boolean;
  usesSegmentDirective: boolean;
  presegments: string[];
} {
  let hasModel = false;
  let usesSegmentDirective = false;
  const presegments: string[] = [];

  for (const statement of lines) {
    for (const token of statement.tokens) {
      if (token.kind !== "ident") continue;
      const word = token.text.toUpperCase();
      if (word === ".MODEL" || word === ".CODE" || word === ".DATA") hasModel = true;
      if (word !== "SEGMENT") continue;
      // `NAME SEGMENT` or `SEGMENT NAME`, with an optional class keyword.
      const after = statement.tokens[token === statement.tokens[0] ? 1 : 0];
      const name = after?.kind === "ident" ? after.text.toUpperCase() : undefined;
      if (!name) continue;
      usesSegmentDirective = true;
      if (!presegments.includes(name)) presegments.push(name);
    }
  }
  return { hasModel, usesSegmentDirective, presegments };
}

function classOfSegment(name: string): SegmentClass {
  const upper = name.toUpperCase();
  if (upper.includes("CODE")) return "CODE";
  if (upper.includes("STACK")) return "STACK";
  if (upper.includes("DATA")) return "DATA";
  return "UNKNOWN";
}

function groupLines(tokens: readonly Token[]): Statement[] {
  const lines: Statement[] = [];
  let current: Token[] = [];
  for (const token of tokens) {
    if (token.kind === "eof") break;
    if (token.kind === "newline") {
      if (current.length > 0) {
        lines.push({ line: current[0].line, column: current[0].column, tokens: current });
      }
      current = [];
      continue;
    }
    current.push(token);
  }
  if (current.length > 0) {
    lines.push({ line: current[0].line, column: current[0].column, tokens: current });
  }
  return lines;
}

function runPass(ctx: PassContext, lines: readonly Statement[]): void {
  for (const statement of lines) {
    try {
      runStatement(ctx, statement);
    } catch (cause) {
      // A range error means the segment overflowed; report it and keep going so
      // one bad statement does not hide the rest of the file.
      const message = cause instanceof RangeError ? cause.message : String(cause);
      ctx.diagnostics.error(statement.line, statement.column, message);
    }
  }
}

/** Words that read the identifier in front of them as a segment or label name. */
const TAKES_PRECEDING_NAME = new Set(["SEGMENT", "ENDS", "ENDP", "ASSUME", "END", ".MODEL", ".CODE", ".DATA"]);

/** Tokens that can legitimately follow a bare label. */
function startsStatement(token: Token): boolean {
  if (token.kind === "number" || token.kind === "char" || token.kind === "string") return true;
  if (token.text === "[" || token.text === "=") return true;
  if (token.kind !== "ident") return false;
  const upper = token.text.toUpperCase();
  if (TAKES_PRECEDING_NAME.has(upper)) return false;
  return true;
}

function namesPrecedingToken(token: Token): boolean {
  return token.kind === "ident" && TAKES_PRECEDING_NAME.has(token.text.toUpperCase());
}

/** True for the `EQU` / `=` token that turns a name into a constant. */
function isEquateForm(token: Token | undefined): boolean {
  if (token === undefined) return false;
  return token.text.toUpperCase() === "EQU" || (token.kind === "punct" && token.text === "=");
}

function runStatement(ctx: PassContext, statement: Statement): void {
  const { line, column } = statement;
  let { tokens } = statement;
  let i = 0;
  let label: string | undefined;

  // `name:` or `name PROC` introduce a label; MASM also allows a bare `name` in
  // the first column, which is how the legacy examples are written.
  // `CODE SEGMENT` and `CODE ENDS` put the segment name in front of the
  // directive. It is set aside and handed to the directive below, because
  // `switchSegment` wants the name as an argument. Doing it this way keeps the
  // optional class keyword that may follow (`CODE SEGMENT PARA 'CODE'`) in the
  // right place, and stops `CODE` from being read as a bare label.
  let leadingName: string | undefined;
  if (tokens[0]?.kind === "ident" && tokens[1]?.kind === "ident") {
    // `CODE SEGMENT` is a directive that carries a name. An *instruction* whose
    // first operand happens to be one of those words is not: `JMP end` is a jump
    // to a label called END, and treating it as "the name JMP, then the END
    // directive" swallows the whole instruction without a byte or a diagnostic.
    // A mnemonic in the first position settles it -- directives have no
    // mnemonic of their own.
    if (TAKES_PRECEDING_NAME.has(tokens[1].text.toUpperCase()) && !MNEMONICS.has(tokens[0].text.toUpperCase())) {
      leadingName = tokens[0].text;
      tokens = tokens.slice(1);
    } else if (tokens[1].text.toUpperCase() === "PROC") {
      // `name PROC` is a label definition, not a name-carrying directive.
      label = tokens[0].text;
      i = 1;
    }
  }

  if (label === undefined && tokens[0]?.kind === "ident") {
    const head = tokens[0].text.toUpperCase();
    const isDirective = isDirectiveWord(head);
    if (tokens[1]?.kind === "punct" && tokens[1].text === ":") {
      label = tokens[0].text;
      i = 2;
    } else if (
      !isDirective &&
      !MNEMONICS.has(head) &&
      !RESERVED.has(head) &&
      REPEAT_PREFIX[head] === undefined &&
      !isRegisterName(head)
    ) {
      // Bare label: only when something follows it, and it is not a macro name
      // that has already been expanded away.
      // The next token decides. An instruction, PROC, a data directive, `[` or
      // `=` all legitimately follow a bare label. A directive that *takes the
      // preceding name* — SEGMENT and ENDS most importantly — must not, or
      // `CODE SEGMENT` would define a label called CODE and then report that
      // SEGMENT has no name.
      const next = tokens[1];
      if (next !== undefined && startsStatement(next) && !namesPrecedingToken(next)) {
        label = tokens[0].text;
        i = 1;
      }
    }
  }

  const rest = tokens.slice(i);

  // `name EQU expr` / `name = expr` is an equate, not a label followed by an
  // instruction. It has to be handled before the label is defined, otherwise the
  // name is first recorded at the current address and the equate that follows is
  // rejected as a redefinition. EQU is also a directive word in its own right,
  // so the generic directive dispatch would misread it as a standalone statement.
  if (label !== undefined && isEquateForm(rest[0])) {
    // Equates are evaluated in the widest window for the reason data elements
    // are: `n EQU -1` has to reach `DB n` as -1 rather than as the 65535 that
    // 16-bit truncation would leave behind, and `n EQU 10000h` has to reach
    // `DW n` as 65536 so the range check can refuse it. A consumer that wants
    // a narrower value re-truncates on the way out (the expression evaluator
    // masks at its own working width), so instruction operands are unchanged.
    const value = evaluate(ctx, rest.slice(1), line, rest[1]?.column ?? column, SCALAR_WINDOW);
    ctx.symbols.define(
      { name: label, kind: "equate", value: value.value, line, column, defined: true },
      ctx.diagnostics,
    );
    return;
  }

  if (label !== undefined) {
    defineLabel(ctx, label, line, column);
  }

  // A label immediately followed by DB/DW/DD names a byte of storage rather than
  // an instruction, which changes how it may be used in a constant expression.
  if (label !== undefined && isDataDirective(rest[0]?.text.toUpperCase() ?? "")) {
    markAsVariable(ctx, label);
  }
  if (rest.length === 0) {
    if (label === undefined) ctx.diagnostics.error(line, column, "empty statement");
    return;
  }

  const head = rest[0].text.toUpperCase();
  const headToken = rest[0];

  // Ahead of everything else, including the directive and operand-kind checks:
  // `ENTER 8, 0` and `BOUND AX, 0100h` both divert before reaching the
  // "unknown instruction" fallback, and the person who typed them deserves to
  // be told the instruction is out of period rather than that `8` is not a
  // mnemonic.
  const not8086 = NOT_8086_MNEMONICS.get(head);
  if (not8086 !== undefined) {
    ctx.diagnostics.error(headToken.line, headToken.column, not8086);
    return;
  }

  if (headToken.kind === "ident" && isDirectiveWord(head)) {
    runDirective(ctx, statement, head, rest.slice(1), label !== undefined, leadingName);
    return;
  }

  if (rest[0].kind !== "ident") {
    ctx.diagnostics.error(line, rest[0].column, `expected a mnemonic, found ${JSON.stringify(rest[0].text)}`);
    return;
  }

  // A repeat prefix sits in front of the mnemonic rather than beside it, so it
  // has to be peeled off here. Without this, `REP MOVSW` silently assembles to
  // a bare MOVSW that moves exactly one word -- a program that assembles
  // cleanly and behaves wrongly, which is the worst failure mode there is.
  const repeatByte = REPEAT_PREFIX[head];
  const repeated = rest[1];
  if (repeatByte !== undefined && repeated?.kind === "ident") {
    const inner = repeated.text.toUpperCase();
    if (!REPEATABLE.has(inner)) {
      ctx.diagnostics.error(
        repeated.line,
        repeated.column,
        `${head} only applies to a string instruction, not ${inner}`,
      );
      return;
    }
    assembleInstruction(ctx, statement, inner, rest.slice(2), [repeatByte]);
    return;
  }

  if (MNEMONICS.has(head) || isExtensionMnemonic(head)) {
    assembleInstruction(ctx, statement, head, rest.slice(1));
    return;
  }

  if (UNSUPPORTED_DIRECTIVES.has(head)) {
    ctx.diagnostics.error(
      headToken.line,
      headToken.column,
      `${head} is not supported yet; the Phase 1 assembler covers ORG, DB/DW/DD, DUP, EQU, =, OFFSET, PTR, SEG, SEGMENT, ASSUME, PROC, .MODEL, .STACK, .DATA and .CODE`,
    );
    return;
  }

  ctx.diagnostics.error(headToken.line, headToken.column, `unknown instruction ${head}`);
}

/**
 * Mnemonics that exist, but only from the 80186 on. Without this they are
 * indistinguishable from a typo -- `PUSHA` would read as "unknown instruction
 * PUSHA" whether or not you meant it -- and someone porting 80286 code would have
 * no way to tell which of the two problems they had.
 *
 * The check is here rather than in the encoder because these are rejected at the
 * mnemonic, before any operand is parsed: `ENTER 8, 0` fails on the `8` if the
 * parser has never heard of `ENTER`. The encoder handles the cases that depend
 * on the operands, such as a shift count that is neither 1 nor CL.
 */
const NOT_8086_MNEMONICS: ReadonlyMap<string, string> = new Map([
  ["PUSHA", "PUSHA is an 80186 instruction; there is no 8086 equivalent"],
  ["POPA", "POPA is an 80186 instruction; there is no 8086 equivalent"],
  ["PUSHAW", "PUSHAW is an 80186 instruction; there is no 8086 equivalent"],
  ["POPAW", "POPAW is an 80186 instruction; there is no 8086 equivalent"],
  ["ENTER", "ENTER is an 80186 instruction; there is no 8086 equivalent"],
  ["LEAVE", "LEAVE is an 80186 instruction; there is no 8086 equivalent"],
  ["BOUND", "BOUND is an 80186 instruction; there is no 8086 equivalent"],
  ["ARPL", "ARPL is an 80186 instruction; there is no 8086 equivalent"],
  ["INSB", "INSB is an 80186 instruction; a 8086 has no string port I/O"],
  ["INSW", "INSW is an 80186 instruction; a 8086 has no string port I/O"],
  ["OUTSB", "OUTSB is an 80186 instruction; a 8086 has no string port I/O"],
  ["OUTSW", "OUTSW is an 80186 instruction; a 8086 has no string port I/O"],
  ["INS", "INS is an 80186 instruction; a 8086 has no string port I/O"],
  ["OUTS", "OUTS is an 80186 instruction; a 8086 has no string port I/O"],
]);

function defineLabel(ctx: PassContext, name: string, line: number, column: number): void {
  const existing = ctx.symbols.lookup(name);
  if (existing?.defined && existing.kind === "equate") {
    ctx.diagnostics.error(line, column, `${symbolKey(name)} is already defined as a constant`);
    return;
  }
  ctx.symbols.define(
    {
      name,
      kind: "label",
      value: ctx.current.counter,
      segment: ctx.current.name,
      line,
      column,
      defined: true,
    },
    ctx.diagnostics,
  );
}

function runDirective(
  ctx: PassContext,
  statement: Statement,
  name: string,
  args: readonly Token[],
  hadLabel: boolean,
  /** Name written in front of the directive, as in `CODE SEGMENT`. */
  leadingName?: string,
): void {
  const { line, column } = statement;
  const argColumn = args[0]?.column ?? column;

  if (IGNORED_DIRECTIVES.has(name)) return;

  if (UNSUPPORTED_DIRECTIVES.has(name)) {
    ctx.diagnostics.error(args[0]?.line ?? line, argColumn, `${name} is not supported yet`);
    return;
  }

  switch (name) {
    case "END": {
      if (args[0]?.kind === "ident") ctx.entryLabel = args[0].text;
      return;
    }
    case "PROC": {
      // The label was already defined by the caller; nothing more to lay out.
      return;
    }
    case "ENDP":
    case "ENDS":
    case "ASSUME": {
      if (name === "ASSUME") checkAssume(ctx, args, line, argColumn);
      return;
    }
    case "ORG": {
      const value = evaluate(ctx, args, line, argColumn);
      if (!value.resolved) {
        ctx.symbols.reference(firstName(args) ?? "", line, argColumn);
        return;
      }
      ctx.current.seek(value.value);
      return;
    }
    case "DB":
    case "DW":
    case "DD": {
      emitData(ctx, DATA_DIRECTIVE_SIZE[name], args, line, argColumn);
      return;
    }
    case "SEGMENT":
    case ".CODE":
    case ".DATA":
      if (hadLabel) {
        ctx.diagnostics.error(line, column, `${name} cannot follow a label on the same line`);
      }
      switchSegment(ctx, name, args, line, argColumn, leadingName);
      return;
    case ".MODEL": {
      if (hadLabel) {
        ctx.diagnostics.error(line, column, ".MODEL cannot follow a label on the same line");
      }
      ctx.hasModel = true;
      if (args[0]?.kind !== "ident") {
        ctx.diagnostics.error(line, argColumn, ".MODEL requires a memory model name, e.g. .MODEL small");
      }
      return;
    }
    case ".STACK": {
      const value = evaluate(ctx, args, line, argColumn);
      if (!value.resolved) return;
      ctx.stackSize = value.value;
      return;
    }
    case "EQU": {
      ctx.diagnostics.error(line, argColumn, "EQU must follow a name on the same line");
      return;
    }
    default:
      ctx.diagnostics.error(args[0]?.line ?? line, argColumn, `unknown directive ${name}`);
  }
}

function switchSegment(
  ctx: PassContext,
  name: string,
  args: readonly Token[],
  line: number,
  column: number,
  leadingName?: string,
): void {
  let segmentName: string;
  let cls: SegmentClass;

  if (name === "SEGMENT") {
    ctx.usesSegmentDirective = true;
    // The name sits either after the directive (`SEGMENT CODE`) or in front of
    // it (`CODE SEGMENT`); both spellings are in common use.
    const named = args.find((t) => t.kind === "ident" && t.text.toUpperCase() !== "SEGMENT") ?? undefined;
    const nameToken = leadingName !== undefined
      ? { kind: "ident" as const, text: leadingName }
      : named;
    if (nameToken === undefined) {
      ctx.diagnostics.error(line, column, "SEGMENT requires a name");
      return;
    }
    segmentName = nameToken.text.toUpperCase();
    const classArg = args[1]?.kind === "ident" ? args[1].text.toUpperCase() : "";
    cls = classArg.includes("CODE")
      ? "CODE"
      : classArg.includes("STACK")
        ? "STACK"
        : classArg.includes("DATA")
          ? "DATA"
          : "UNKNOWN";
    ctx.symbols.define(
      { name: segmentName, kind: "segment", value: 0, line, column, defined: true },
      ctx.diagnostics,
    );
  } else {
    // .CODE / .DATA
    segmentName = name === ".CODE" ? "_CODE" : "_DATA";
    cls = name === ".CODE" ? "CODE" : "DATA";
    if (name === ".CODE") {
      ctx.codeSegmentName = segmentName;
      ctx.hasModel = true;
    } else {
      ctx.dataSegmentName = segmentName;
      ctx.hasModel = true;
    }
  }

  let buffer = ctx.buffers.get(segmentName);
  if (!buffer) {
    buffer = new SegmentBuffer(segmentName, cls);
    ctx.buffers.set(segmentName, buffer);
    ctx.segmentOrder.push(segmentName);
  }
  ctx.current = buffer;
}

function checkAssume(ctx: PassContext, args: readonly Token[], line: number, column: number): void {
  // `ASSUME DS:DATA, CS:CODE` is documentation for MASM's type checker. The
  // engine assigns registers from the layout, so the directive is accepted
  // without acting on it, but unknown segment names are still a typo worth
  // reporting.
  for (let i = 0; i < args.length; i += 2) {
    const value = args[i + 1]?.text.toUpperCase();
    if (!value || value === "NOTHING" || value === "ERROR") continue;
    if (value === "DS" || value === "CS" || value === "ES" || value === "SS") continue;
    if (!ctx.symbols.has(value)) {
      ctx.diagnostics.error(
        args[i + 1]?.line ?? line,
        args[i + 1]?.column ?? column,
        `ASSUME names an unknown segment ${value}`,
      );
    }
  }
}

function emitData(
  ctx: PassContext,
  elementSize: 8 | 16 | 32,
  args: readonly Token[],
  line: number,
  column: number,
): void {
  // A flat program may be pure data; the first byte it emits is where it would
  // start if it were run.
  if (ctx.firstFlatOffset === undefined) ctx.firstFlatOffset = ctx.current.counter;

  let i = 0;
  while (i < args.length) {
    if (args[i].kind === "punct" && args[i].text === ",") {
      i++;
      continue;
    }

    // `count DUP (value)`. DUP is a word, not a punctuator, so it is found as
    // an identifier rather than through the punctuator table.
    let count: number | undefined;
    let countAt = { line, column };
    const afterCount = findWord(args, i, "DUP");
    if (args[i]?.kind === "ident" && args[i].text.toUpperCase() === "DUP") {
      ctx.diagnostics.error(args[i].line, args[i].column, "DUP must be preceded by a count");
      i++;
      continue;
    }
    if (afterCount >= 0) {
      // The count is a scalar too, so it is read in the widest window: at 16
      // bits `65536 DUP` folds to `0 DUP` and `-1 DUP` to 65535 copies, both
      // silently, and the range check below could never see either.
      countAt = { line: args[i].line, column: args[i].column };
      const countExpr = evaluate(ctx, args.slice(i, afterCount), line, args[i].column, SCALAR_WINDOW);
      count = countExpr.value;
      i = afterCount + 1;
    }

    // The value, either a parenthesised list or a single expression.
    const values: number[] = [];
    const startLine = args[i]?.line ?? line;
    const startColumn = args[i]?.column ?? column;
    if (args[i]?.kind === "punct" && args[i].text === "(") {
      const close = findPunct(args, i, ")");
      if (close < 0) {
        ctx.diagnostics.error(startLine, startColumn, "expected ')' to close the DUP list");
        break;
      }
      const inner = args.slice(i + 1, close);
      i = close + 1;
      for (const value of readDataElements(ctx, inner, elementSize, line, startColumn)) {
        values.push(value);
      }
    } else {
      const nextComma = findPunct(args, i, ",");
      const end = nextComma < 0 ? args.length : nextComma;
      const element = readDataElements(ctx, args.slice(i, end), elementSize, line, startColumn);
      if (element.length === 0) break;
      values.push(...element);
      i = end;
    }

    if (count === undefined) {
      for (const value of values) writeScalar(ctx, elementSize, value);
      continue;
    }
    if (count < 0 || count > 0x10000) {
      ctx.diagnostics.error(countAt.line, countAt.column, `DUP count ${count} is out of range`);
      continue;
    }
    for (let n = 0; n < count; n++) {
      for (const value of values) writeScalar(ctx, elementSize, value);
    }
  }
}

/** Split a comma-separated data list into scalar values of `elementSize` bits. */
function readDataElements(
  ctx: PassContext,
  args: readonly Token[],
  elementSize: 8 | 16 | 32,
  line: number,
  column: number,
): number[] {
  const out: number[] = [];
  // A flat program may be pure data; the first byte it emits is where it would
  // start if it were run.
  if (ctx.firstFlatOffset === undefined) ctx.firstFlatOffset = ctx.current.counter;

  let i = 0;
  while (i < args.length) {
    if (args[i].kind === "punct" && args[i].text === ",") {
      i++;
      continue;
    }
    const comma = findPunct(args, i, ",");
    const end = comma < 0 ? args.length : comma;

    const token = args[i];
    const elementLine = token?.line ?? line;
    const elementColumn = token?.column ?? column;
    if (token?.kind === "string" && elementSize === 8) {
      for (const ch of token.string ?? "") out.push(ch.charCodeAt(0) & 0xff);
    } else if (token?.kind === "question") {
      out.push(0);
    } else if (
      token?.kind === "ident" &&
      (token.text.toUpperCase() === "?" || token.text === "?")
    ) {
      out.push(0);
    } else {
      const elementTokens = args.slice(i, end);
      // A literal -- and a sign in front of one -- is judged on the value that
      // was written, before the evaluator sees it: the evaluator works in a
      // 32-bit window, so a wider literal (`DD 100000000h`) has already folded
      // to 0 and a negation past that window (`DD -2147483649`) has already
      // folded back into range by the time a check on the result could run.
      // Every other element is evaluated in that window and then judged, which
      // is what keeps `DB -1` -1 and `DW 10000h` 65536 at the moment the range
      // is measured.
      const written = writtenValue(elementTokens);
      if (written !== undefined && !fitsScalar(elementSize, written)) {
        ctx.diagnostics.error(elementLine, elementColumn, scalarRangeMessage(elementSize, written));
        // Zero stands in for the refused value so the directive still reserves
        // its byte(s) and every address after it stays where it was.
        out.push(0);
      } else {
        const value = evaluate(ctx, elementTokens, line, elementColumn, SCALAR_WINDOW);
        if (!value.resolved) {
          const name = firstName(elementTokens);
          if (name) ctx.symbols.reference(name, elementLine, elementColumn);
          out.push(0);
        } else if (!fitsScalar(elementSize, value.value)) {
          ctx.diagnostics.error(elementLine, elementColumn, scalarRangeMessage(elementSize, value.value));
          out.push(0);
        } else {
          out.push(value.value);
        }
      }
    }
    i = end + 1;
  }
  return out;
}

/**
 * What each data directive may hold.
 *
 * Literals are written unsigned here -- decimal, hex, binary or a character --
 * but an expression may negate one, and `DB -1` is the same byte as `DB 0FFh`
 * on both engines in this project. So every width accepts its signed range as
 * well as its unsigned one, and a value past either end does not fit the
 * storage the directive reserves: `DB 300`, `DB -129` and `DW 10000h` are
 * errors rather than whatever their low bits happen to spell.
 */
const SCALAR_RANGES: Record<8 | 16 | 32, { directive: string; datum: string; min: number; max: number }> = {
  8: { directive: "DB", datum: "byte", min: -128, max: 0xff },
  16: { directive: "DW", datum: "word", min: -0x8000, max: 0xffff },
  32: { directive: "DD", datum: "dword", min: -0x8000_0000, max: 0xffff_ffff },
};

/**
 * Widest window the expression evaluator can hold, used wherever a value has
 * to survive long enough to be range-checked rather than truncated first.
 */
const SCALAR_WINDOW = 0xffffffff;

/** True when `value` fits the storage a directive of `elementSize` bits reserves. */
function fitsScalar(elementSize: 8 | 16 | 32, value: number): boolean {
  const { min, max } = SCALAR_RANGES[elementSize];
  return value >= min && value <= max;
}

/**
 * The exact value of an element that is nothing but a literal, with an
 * optional sign, or `undefined` when it is an expression and only the
 * evaluator can say what it comes to.
 */
function writtenValue(tokens: readonly Token[]): number | undefined {
  if (tokens.length === 1 && tokens[0].kind === "number") return tokens[0].value;
  if (
    tokens.length === 2 &&
    tokens[0].kind === "punct" &&
    tokens[0].text === "-" &&
    tokens[1].kind === "number"
  ) {
    return -tokens[1].value;
  }
  return undefined;
}

function scalarRangeMessage(elementSize: 8 | 16 | 32, value: number): string {
  const { directive, datum, min, max } = SCALAR_RANGES[elementSize];
  return `${directive} value ${value} is out of range; a ${datum} holds ${min} to ${max}`;
}

/**
 * Emit one scalar of `elementSize` bits, little-endian.
 *
 * Values arrive already checked against `SCALAR_RANGES` by `readDataElements`,
 * which is what knows each element's source position and runs once per
 * initializer rather than once per byte of a `DUP`. The masks below therefore
 * only turn a negative value into its two's-complement bytes; there is no bit
 * left for them to drop.
 */
function writeScalar(ctx: PassContext, elementSize: 8 | 16 | 32, value: number): void {
  if (elementSize === 32) {
    ctx.current.putByte(value & 0xff);
    ctx.current.putByte((value >> 8) & 0xff);
    ctx.current.putByte((value >> 16) & 0xff);
    ctx.current.putByte((value >> 24) & 0xff);
    return;
  }
  ctx.current.putByte(value & 0xff);
  if (elementSize === 16) ctx.current.putByte((value >> 8) & 0xff);
}

/** The string instructions a repeat prefix may legally precede. */
const REPEATABLE = new Set([
  "MOVSB", "MOVSW", "CMPSB", "CMPSW", "STOSB", "STOSW",
  "LODSB", "LODSW", "SCASB", "SCASW",
  // The 80186 port I/O string instructions (INSB/INSW/OUTSB/OUTSW) used to be
  // here, so that `REP INSW` would be accepted. A 8086 has no string port I/O
  // at all, so `REP INSW` must now be refused like any other non-8086 form.
]);

/** Mnemonic to the byte that encodes it. */
const REPEAT_PREFIX: Readonly<Record<string, number>> = {
  REP: 0xf3,
  REPE: 0xf3,
  REPZ: 0xf3,
  REPNE: 0xf2,
  REPNZ: 0xf2,
};

function assembleInstruction(
  ctx: PassContext,
  statement: Statement,
  mnemonic: string,
  operandTokens: readonly Token[],
  prefix: readonly number[] = [],
): void {
  const { line, column } = statement;
  const start = ctx.current.counter;
  const segment = ctx.current.name;
  const text = statement.tokens.map((t) => t.text).join(" ");

  // The entry point is wherever code first appears, which is not necessarily
  // the origin: `ORG 200h` at the top of the file moves it.
  if (ctx.firstCodeOffset === undefined) ctx.firstCodeOffset = start;
  if (ctx.firstFlatOffset === undefined) ctx.firstFlatOffset = start;

  const resolver = makeResolver(ctx, start);
  const parsed = parseOperands(operandTokens, 0, resolver, ctx.diagnostics, { mnemonic });
  if (parsed.end < operandTokens.length) {
    const extra = operandTokens[parsed.end];
    ctx.diagnostics.error(extra.line, extra.column, `unexpected ${JSON.stringify(extra.text)} in operand list`);
  }

  // An unresolved forward reference still has to be sized. It is laid out as the
  // wide branch, which is the only choice that cannot turn out too small, and
  // the name is registered so pass 2 can resolve it.
  const allResolved = parsed.operands.every((operand) => !isUnresolved(operand));
  if (!allResolved) {
    for (const operand of parsed.operands) {
      if (operand.kind !== "imm" && operand.kind !== "target") continue;
      // A quoted literal in the operand means the expression was not waiting on a
      // symbol at all -- it was text where a value belonged, which the evaluator
      // has already reported precisely. Registering the whole operand as a name
      // to resolve in pass 2 used to follow from that, and pass 2 duly complained
      // about an undefined symbol called `'A,B'` for `MOV AX, OFFSET 'a,b'`: a
      // second error naming something the person never wrote. A symbol name
      // cannot contain a quote, so this cannot skip a real forward reference.
      if (operand.text.includes("'") || operand.text.includes('"')) continue;
      ctx.symbols.reference(operand.text, operand.line, operand.column);
    }
  }

  const request: EncodeRequest = {
    mnemonic,
    operands: parsed.operands,
    line,
    column,
    offset: start,
    unresolvedTarget: !allResolved,
    ...(prefix.length === 0 ? {} : { prefix }),
  };

  const encoded = encode(request, ctx.diagnostics);
  const bytes = encoded ? encoded.bytes : [];

  if (encoded) {
    for (const byte of bytes) ctx.current.putByte(byte);
  } else {
    // Keep the location counter moving so labels after a bad instruction still
    // get distinct addresses and later errors are reported against real places.
    ctx.current.reserve(2);
  }

  ctx.listing.push({ line, offset: start, segment, bytes, text });
  ctx.sourceLines.push({ line, segment, offset: start, bytes });
}

function isUnresolved(operand: Operand): boolean {
  return (operand.kind === "imm" || operand.kind === "target") && !operand.resolved;
}

function makeResolver(ctx: PassContext, locationCounter: number): SymbolResolver {
  return {
    locationCounter: () => locationCounter,
    lookup: (name) => {
      const symbol = ctx.symbols.lookup(name);
      if (!symbol?.valueKnown) return undefined;
      return symbol.value;
    },
    isKnown: (name) => ctx.symbols.has(name),
    // Only storage names are rejected in a constant expression. A code label is
    // allowed, because `JMP label` and `MOV AX, label` are both meaningful.
    isVariable: (name) => ctx.symbols.lookup(name)?.kind === "variable",
  };
}

function evaluate(
  ctx: PassContext,
  args: readonly Token[],
  line: number,
  column: number,
  /**
   * Working width of the expression. 16 bits by default, because 8086
   * arithmetic is 16-bit; callers that must see a value as written rather than
   * as the width they want pass `SCALAR_WINDOW` instead and range-check the
   * result themselves.
   */
  mask = 0xffff,
): { value: number; resolved: boolean } {
  if (args.length === 0) {
    ctx.diagnostics.error(line, column, "expected an expression");
    return { value: 0, resolved: false };
  }
  const parser = new ExpressionParser(args, makeResolver(ctx, ctx.current.counter), ctx.diagnostics, 0, mask);
  const result = parser.parse();
  if (parser.position < args.length) {
    const extra = args[parser.position];
    ctx.diagnostics.error(extra.line, extra.column, `unexpected ${JSON.stringify(extra.text)} in expression`);
  }
  return { value: result.value, resolved: result.resolved };
}

function findPunct(tokens: readonly Token[], from: number, text: string): number {
  for (let i = from; i < tokens.length; i++) {
    if (tokens[i].kind === "punct" && tokens[i].text === text) return i;
  }
  return -1;
}

function findWord(tokens: readonly Token[], from: number, word: string): number {
  for (let i = from; i < tokens.length; i++) {
    if (tokens[i].kind === "ident" && tokens[i].text.toUpperCase() === word) return i;
  }
  return -1;
}

function firstName(tokens: readonly Token[]): string | undefined {
  for (const token of tokens) {
    if (token.kind === "ident") return token.text;
  }
  return undefined;
}

const DIRECTIVES = new Set([
  "END",
  "PROC",
  "ENDP",
  "ENDS",
  "ASSUME",
  "ORG",
  "DB",
  "DW",
  "DD",
  "SEGMENT",
  ".CODE",
  ".DATA",
  ".MODEL",
  ".STACK",
  "EQU",
  ...IGNORED_DIRECTIVES,
  ...UNSUPPORTED_DIRECTIVES,
]);

function isDirectiveWord(word: string): boolean {
  return DIRECTIVES.has(word);
}

function isDataDirective(word: string): boolean {
  return word === "DB" || word === "DW" || word === "DD";
}

function markAsVariable(ctx: PassContext, name: string): void {
  const symbol = ctx.symbols.lookup(name);
  if (symbol?.defined) symbol.kind = "variable";
}

/** Extension mnemics the legacy engine supports on top of the base ISA. */
const EXTENSION_MNEMONICS = new Set(["OUT", "OUTC", "OUTP", "MOD"]);

function isExtensionMnemonic(word: string): boolean {
  return EXTENSION_MNEMONICS.has(word);
}

function isRegisterName(word: string): boolean {
  return /^(AX|BX|CX|DX|AH|BH|CH|DH|AL|BL|CL|DL|A[LX]|S[PS]|D[SI]|C[RL]|ES|CS|SS|DS)$/.test(word.toUpperCase());
}

interface ResolvedLayout {
  segments: SegmentImage[];
  entry: EntryPoint;
  codeSegmentName: string;
}

/**
 * `SEGMENT`-named programs refer to a segment by name; `.MODEL` programs refer to
 * one by class, with `@DATA`, `@CODE` and `@STACK`. Both forms end up as the load
 * paragraph in `entry`.
 *
 * Returns whether any name moved, which is what tells the caller that the bytes
 * already emitted are stale.
 */
function applySegmentGroupBases(
  symbols: SymbolTable,
  bases: { data: number; code: number; stack: number },
): boolean {
  let changed = false;
  const wanted: Array<[string, number]> = [
    ["@DATA", bases.data],
    ["@CODE", bases.code],
    ["@STACK", bases.stack],
  ];
  for (const [name, base] of wanted) {
    const symbol = symbols.lookup(name);
    if (symbol?.valueKnown === true && symbol.value === base) continue;
    symbols.defineSegmentGroup(name, base);
    changed = true;
  }
  return changed;
}

function resolveLayout(ctx: PassContext): ResolvedLayout {
  // Whether the program has real segments, which is not the same question as
  // whether it used the SEGMENT directive.
  //
  // `.MODEL SMALL` followed by `.DATA` and `.CODE` is the other way to say it,
  // and it is how most 8086 programs in the world are written. Those two forms
  // each get their own named buffers (`_DATA`, `_CODE`), so asking only about
  // `usesSegmentDirective` sent them down the flat path below -- which reports
  // the `_COM` buffer and nothing else. The result was an empty image and no
  // diagnostic: a textbook program assembled cleanly and ran nothing.
  const hasNamedSegments = ctx.segmentOrder.some((name) => name !== "_COM");
  const segmented = ctx.usesSegmentDirective || hasNamedSegments;

  // Without SEGMENT blocks the whole program is one flat segment, and code is
  // loaded at `origin` so that direct `[0x0100]` references resolve.
  // `ORG` at the top of a program moves the entry point, so prefer the first
  // offset code was actually emitted at over the declared origin.
  // A flat .COM program may hold only data, so fall back to wherever its first
  // byte landed -- `ORG 200h` followed by a DB is the common case.
  const entryOffset = segmented
    ? (ctx.firstCodeOffset ?? ctx.origin)
    : (ctx.firstCodeOffset ?? ctx.firstFlatOffset ?? ctx.origin);

  if (!segmented) {
    const buffer = ctx.buffers.get("_COM")!;
    const base = 0;
    const segment: SegmentImage = {
      name: "_COM",
      cls: "CODE",
      base,
      entryOffset: entryOffset,
      bytes: buffer.image(),
      origin: buffer.origin,
    };
    return {
      segments: [segment],
      codeSegmentName: "_COM",
      entry: {
        codeSegment: "_COM",
        codeBase: base,
        ip: entryOffset,
        dataSegment: "_COM",
        dataBase: base,
        stackSegment: "_COM",
        stackBase: base,
        sp: ctx.stackSize ?? ctx.initialSP,
        extraSegment: "_COM",
        extraBase: base,
      },
    };
  }

  // Named segments are packed in source order, each starting on a paragraph
  // boundary: 16 bytes, because a segment base is shifted left by four when the
  // CPU forms a physical address. MASM links this way, so a program assembled
  // here addresses the same bytes it would after a real link -- and consecutive
  // segments abut rather than sitting 4 KB apart with a hole between them.
  const segments: SegmentImage[] = [];
  const bases = new Map<string, number>();
  let nextBase = 0;
  for (const name of ctx.segmentOrder) {
    if (name === "_COM") continue;
    bases.set(name, nextBase);
    const buffer = ctx.buffers.get(name);
    nextBase = alignToParagraph(nextBase + (buffer?.usedSize ?? 0));
  }

  // The implicit `_COM` buffer exists only so that a flat program has somewhere to
  // put its bytes. A program that named its own segments never writes to it, and
  // if it were still allowed to claim the CODE class it would win on source order
  // -- being first in the list -- and hand back an empty image for the program.
  // Leave it out unless it holds something; the `!foundCode` case below brings it
  // back for a program that declared data and no code to run.
  const segmentsInOrder = ctx.segmentOrder.filter(
    (name) => name !== "_COM" || (ctx.buffers.get(name)?.usedSize ?? 0) > 0,
  );

  let codeSegmentName = ctx.codeSegmentName;
  let dataSegmentName = ctx.dataSegmentName;
  let stackSegmentName = "_COM";
  let codeBase = 0;
  let stackBase = 0;
  let ip = entryOffset;
  let foundCode = false;

  for (const name of segmentsInOrder) {
    const buffer = ctx.buffers.get(name);
    if (!buffer) continue;
    const base = bases.get(name) ?? 0;
    if (buffer.cls === "CODE" && !foundCode) {
      codeSegmentName = name;
      codeBase = base;
      ip = buffer.origin;
      foundCode = true;
    }
    if (buffer.cls === "DATA") dataSegmentName = name;
    if (buffer.cls === "STACK") {
      stackSegmentName = name;
      stackBase = base;
    }
    segments.push({
      name,
      cls: buffer.cls,
      base,
      entryOffset: buffer.origin,
      bytes: buffer.image(),
      origin: buffer.origin,
    });
  }

  if (!foundCode) {
    // A program that only declared a data segment still needs somewhere to run.
    const buffer = ctx.buffers.get("_COM")!;
    codeSegmentName = "_COM";
    codeBase = 0;
    ip = buffer.origin;
    segments.unshift({
      name: "_COM",
      cls: "CODE",
      base: 0,
      entryOffset: buffer.origin,
      bytes: buffer.image(),
      origin: buffer.origin,
    });
  }

  if (stackSegmentName === "_COM") {
    stackBase = bases.get(dataSegmentName) ?? 0;
  }

  if (ctx.entryLabel) {
    const symbol = ctx.symbols.lookup(ctx.entryLabel);
    if (symbol?.defined) {
      ip = symbol.value;
      codeSegmentName = symbol.segment ?? codeSegmentName;
      const segment = segments.find((s) => s.name === codeSegmentName);
      if (segment) codeBase = segment.base;
    }
  }

  return {
    segments,
    codeSegmentName,
    entry: {
      codeSegment: codeSegmentName,
      codeBase,
      ip,
      dataSegment: dataSegmentName,
      dataBase: bases.get(dataSegmentName) ?? 0,
      stackSegment: stackSegmentName,
      stackBase,
      sp: ctx.stackSize ?? ctx.initialSP,
      extraSegment: dataSegmentName,
      extraBase: bases.get(dataSegmentName) ?? 0,
    },
  };
}

/** Re-exported so callers can inspect a single candidate encoding. */
export { selectEncoding };
export type { InsnDef };
export type { Symbol };
