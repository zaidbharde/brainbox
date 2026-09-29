/**
 * Which registers an instruction reads and writes, from its encoding alone.
 *
 * The table records an instruction's operands and the flags it can affect, but
 * not the direction of data flow: it stores `MOV AX, BX` and `CMP AX, BX` with
 * the same operand shape and the difference lives in the mnemonic. A debugger
 * showing "what does this instruction touch" needs that difference, so it is
 * spelled out here, once, by form rather than by opcode.
 *
 * The 8086's instruction set is small enough for the classification to be a
 * switch on the mnemonic. It is checked against the CPU by
 * `effects.test.ts`, which steps a corpus and fails if the CPU changes a
 * register this module did not predict -- so a missing case is a test failure
 * rather than a silently wrong panel.
 *
 * Register names are the ones the encoding actually names, so an 8-bit operand
 * is reported as `AL` rather than `AX`. A write to `AL` writes half of `AX`,
 * and the panel that renders this wants the precise one.
 */

import type { DecodedInstruction, DecodedOperand } from "./decode";
import { REG8, REG16 } from "../isa/registers";

export interface RegisterEffects {
  readonly reads: readonly string[];
  readonly writes: readonly string[];
}

/** Instructions whose data flow is not expressible by operand order alone. */
const RMW = new Set([
  "INC", "DEC", "NOT", "NEG",
  "SHL", "SHR", "SAR", "ROL", "ROR", "RCL", "RCR",
  "DAA", "DAS", "AAA", "AAS", "AAM", "AAD",
]);

/** Two-operand arithmetic: the destination is read as well as written. */
const ALU = new Set(["ADD", "OR", "ADC", "SBB", "AND", "SUB", "XOR"]);

/** Multiply and divide: the accumulator is an implicit operand. */
const ACCUMULATOR = new Set(["MUL", "IMUL", "DIV", "IDIV"]);

/** Reads both operands and writes no register, only flags. */
const COMPARE = new Set(["CMP", "TEST"]);

/** Writes the destination and reads the source; the destination is not read. */
const LOAD = new Set(["MOV"]);

/** `LDS`/`LES` load an offset and a segment into one r/m16 memory operand. */
const FAR_LOAD = new Set(["LDS", "LES"]);

/** String instructions, by what they move rather than by direction. */
const STRINGS = new Set([
  "MOVSB", "MOVSW", "CMPSB", "CMPSW", "STOSB", "STOSW",
  "LODSB", "LODSW", "SCASB", "SCASW",
]);

/** Jumps and calls: the target is in the operand for the indirect forms. */
const TRANSFER = new Set(["JMP", "CALL"]);

class Effects {
  private readonly reads = new Set<string>();
  private readonly writes = new Set<string>();

  read(...names: (string | undefined)[]): void {
    for (const name of names) if (name) this.reads.add(name);
  }

  write(...names: (string | undefined)[]): void {
    for (const name of names) if (name) this.writes.add(name);
  }

  readAndWrite(...names: (string | undefined)[]): void {
    this.read(...names);
    this.write(...names);
  }

  /** How many registers have been named so far, for a sanity check. */
  get size(): number {
    return this.reads.size + this.writes.size;
  }

  result(): RegisterEffects {
    return {
      reads: [...this.reads].sort(),
      writes: [...this.writes].sort(),
    };
  }
}

/**
 * The 16-bit register an 8-bit name is part of, or the name itself.
 *
 * Exported because the lab's `Registers` is 16-bit throughout: a panel asked to
 * highlight what `ADD AL, 1` wrote has to know that the answer, `AL`, is half
 * of `AX`.
 */
export function parentRegisterOf(name: string): string {
  const index = (REG8 as readonly string[]).indexOf(name);
  if (index < 0) return name;
  // REG8 is the low bytes of AX/CX/DX/BX then the high bytes of the same four.
  return REG16[index >> 2];
}

/**
 * Reads implied by a memory operand: the address registers, and `SS` when the
 * address is stack-relative and no override says otherwise.
 */
function memoryReads(operand: Extract<DecodedOperand, { kind: "mem" }>, into: Effects): void {
  const { base, index, segment } = operand.address;
  into.read(base, index);
  // The decoder has already resolved the default segment, so a stack-relative
  // address arrives as SS whether or not an index is present: `[BP+SI]` is SS on
  // a 8086, exactly as `[BP]` is. The fallback covers an address built by hand
  // that never went through the decoder.
  if (segment === "SS" || (segment === undefined && base === "BP")) into.read("SS");
}

function memoryRegisters(operand: DecodedOperand, into: Effects): void {
  if (operand.kind === "mem") memoryReads(operand, into);
}

function operandRegister(operand: DecodedOperand): string | undefined {
  if (operand.kind === "reg8" || operand.kind === "reg16" || operand.kind === "sreg") {
    return operand.name;
  }
  return undefined;
}

/** The port is in `DX` only for the `DX` forms; the immediate forms need no register. */
function portRegister(operand: DecodedOperand | undefined): string | undefined {
  return operand?.kind === "reg16" && operand.name === "DX" ? "DX" : undefined;
}

function stringEffects(mnem: string, into: Effects): void {
  if (mnem.startsWith("MOVS")) {
    into.readAndWrite("SI", "DI");
  } else if (mnem.startsWith("STOS")) {
    into.read("AX");
    into.write("DI");
  } else if (mnem.startsWith("LODS")) {
    into.write("AX");
    into.write("SI");
  } else if (mnem.startsWith("SCAS")) {
    // DI advances on every pass, not only under a repeat prefix. A bare SCAS
    // still moves the pointer; only the counting is the prefix's job.
    into.read("AX", "DI");
    into.write("DI");
  } else if (mnem.startsWith("CMPS")) {
    into.readAndWrite("SI", "DI");
  }
  if (into.size === 0) throw new Error(`unclassified string instruction ${mnem}`);
}

function classify(decoded: DecodedInstruction): Effects {
  const into = new Effects();
  const mnem = decoded.mnem;
  const ops = decoded.operands;
  const first = ops[0];
  const second = ops[1];

  // Every instruction ends by writing IP, whether it falls through or branches.
  into.write("IP");

  if (STRINGS.has(mnem)) {
    stringEffects(mnem, into);
  } else if (RMW.has(mnem)) {
    const reg = operandRegister(first);
    into.readAndWrite(reg);
    memoryRegisters(first, into);
  } else if (ACCUMULATOR.has(mnem)) {
    // 16-bit forms use DX:AX, 8-bit forms only the accumulator half.
    const sixteenBit = first?.kind === "reg16";
    into.read("AX");
    if (sixteenBit) {
      into.read("DX");
      into.write("DX");
    }
    into.write("AX");
    memoryRegisters(first, into);
  } else if (COMPARE.has(mnem)) {
    into.read(operandRegister(first), operandRegister(second));
    memoryRegisters(first, into);
    memoryRegisters(second, into);
  } else if (LOAD.has(mnem)) {
    // The destination is written without being read first.
    into.write(operandRegister(first), parentRegisterOf(operandRegister(first) ?? ""));
    into.read(operandRegister(second));
    memoryRegisters(second, into);
  } else if (FAR_LOAD.has(mnem)) {
    into.write(operandRegister(first), "DS");
    memoryRegisters(second, into);
  } else if (mnem === "LEA") {
    // LEA computes an address and stores it: the address registers are read,
    // the memory at that address is not.
    into.write(operandRegister(first));
    memoryRegisters(second, into);
  } else if (mnem === "XCHG") {
    for (const operand of ops) {
      into.readAndWrite(operandRegister(operand));
      memoryRegisters(operand, into);
    }
  } else if (ALU.has(mnem)) {
    into.readAndWrite(operandRegister(first));
    memoryRegisters(first, into);
    into.read(operandRegister(second));
    memoryRegisters(second, into);
  } else if (mnem === "PUSH" || mnem === "POP") {
    const reg = operandRegister(first);
    if (mnem === "PUSH") into.read(reg);
    else into.write(reg, parentRegisterOf(reg ?? ""));
    memoryRegisters(first, into);
    into.readAndWrite("SP");
    into.read("SS");
  } else if (mnem === "IN" || mnem === "OUT") {
    into.read(portRegister(mnem === "IN" ? second : first));
    into.write(mnem === "IN" ? operandRegister(first) : undefined);
  } else if (mnem === "CALLF") {
    into.readAndWrite("SP");
    into.read("SS");
    memoryRegisters(first, into);
  } else if (TRANSFER.has(mnem)) {
    // The direct forms have no register operand; the indirect ones read it.
    into.read(operandRegister(first));
    memoryRegisters(first, into);
    if (mnem === "CALL") into.readAndWrite("SP");
  } else if (mnem === "LOOP" || mnem === "LOOPE" || mnem === "LOOPNE" || mnem === "JCXZ") {
    into.read("CX");
  } else if (mnem === "OUTC" || mnem === "OUTP") {
    // Emit-only: the register is read and sent out, nothing comes back.
    into.read(operandRegister(second ?? first));
    memoryRegisters(second ?? first, into);
  } else if (mnem === "MOD") {
    into.write("AX");
    into.read("AX");
    into.read(operandRegister(first));
    memoryRegisters(first, into);
  } else if (mnem === "XLAT") {
    into.write("AX");
    into.read("BX", "DS");
  } else if (mnem === "CBW") {
    into.readAndWrite("AX");
  } else if (mnem === "CWD") {
    into.read("AX");
    into.write("DX");
  } else if (mnem === "RET" || mnem === "RETF") {
    into.readAndWrite("SP");
    into.read("SS");
  } else if (mnem === "SALC") {
    into.write("AX");
  } else if (mnem === "LAHF") {
    into.write("AX");
  } else if (mnem === "PUSHF" || mnem === "POPF" || mnem === "SAHF") {
    // Flags are not a register the panel lists; FLAGS itself is added below
    // whenever the table says the instruction touches a flag.
  } else if (mnem !== "NOP" && mnem !== "HLT" && mnem !== "WAIT" && mnem !== "IRET"
    && mnem !== "INT" && mnem !== "INT3" && mnem !== "INTO" && !mnem.startsWith("J") && mnem !== "CLC" && mnem !== "STC"
    && mnem !== "CMC" && mnem !== "CLD" && mnem !== "STD" && mnem !== "CLI" && mnem !== "STI") {
    throw new Error(`unclassified instruction ${mnem}`);
  }

  // REP is a prefix, not an operand, and it counts CX down.
  if (decoded.repeat !== "none") into.readAndWrite("CX");

  // FLAGS is a register the panel shows, so touching any flag touches it.
  if (decoded.def !== undefined && decoded.def.flags.length > 0) into.write("FLAGS");

  return into;
}

/**
 * The registers an instruction reads and writes.
 *
 * Throws on an instruction with no classification rather than returning nothing,
 * because an unclassified instruction means this table is out of date and the
 * debugger would then quietly show a register list that is merely plausible.
 * `effects.test.ts` walks the whole table, so that case is a test failure.
 */
export function registerEffects(decoded: DecodedInstruction): RegisterEffects {
  return classify(decoded).result();
}
