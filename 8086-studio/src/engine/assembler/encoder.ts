/**
 * engine/assembler/encoder.ts — turns a parsed instruction into machine code.
 *
 * The encoder never switches on the mnemonic: it asks the ISA table which
 * definitions can express this mnemonic with this operand shape, encodes each
 * candidate structurally to measure it, and keeps the shortest. That is the
 * same rule MASM and gas use, which is why `add ax,1` becomes `83 C0 01`
 * rather than `05 01 00`, and `add al,1` becomes the 2-byte `04 01`.
 *
 * Measurement always goes through the same `encodeModRM` used for emission, so
 * a size estimate can never disagree with the bytes that get written.
 */

import {
  INSTRUCTION_TABLE,
  JCC_ALIASES,
  SHIFT_ALIASES,
  type InsnDef,
  type OperandType,
} from "../isa/table";
import { SEGMENT_PREFIX, addressToRm, encodeModRM, type MemAddress } from "../isa/modrm";
import type { Operand } from "./operands";
import { DiagnosticBag } from "./diagnostics";

/**
 * `JE` and `JZ` are the same instruction. The table only lists one name, so
 * aliases are folded before comparison and the caller can write either.
 */
export function canonicalMnemonic(mnemonic: string): string {
  const upper = mnemonic.toUpperCase();
  return JCC_ALIASES[upper] ?? SHIFT_ALIASES[upper] ?? upper;
}

export interface EncodeRequest {
  mnemonic: string;
  /**
   * Bytes emitted before the opcode: REP/REPE/REPNE and LOCK. These are part
   * of the instruction's length, which matters because a prefix shifts every
   * address after it.
   */
  prefix?: readonly number[];
  operands: readonly Operand[];
  line: number;
  column: number;
  /** Offset the instruction will be placed at, for relative branch sizing. */
  offset: number;
  /**
   * True when a branch target is not known yet.
   *
   * The first pass lays out every forward reference as the *wide* form, because
   * that is the only choice that cannot turn out too small. Picking the short
   * form instead would make the first pass one byte shorter than the second,
   * and every label after the jump would move by one — so the second pass would
   * compute its displacement from an address that no longer exists.
   */
  unresolvedTarget?: boolean;
}

export interface EncodedInstruction {
  bytes: number[];
  def: InsnDef;
}

/**
 * Which `OperandType` slots the given operand can fill. An operand may fill
 * several: a register is both a `reg8` (ModR/M reg field) and an `rm8`
 * (ModR/M r/m field), and an immediate is both an `imm8` and an `imm16`.
 */
function shapesFor(operand: Operand): readonly OperandType[] {
  switch (operand.kind) {
    case "reg8":
      return ["reg8", "rm8", "r8", ...(operand.name === "AL" ? (["al"] as const) : []),
              ...(operand.name === "CL" ? (["cl"] as const) : [])];
    case "reg16":
      return ["reg16", "rm16", "r16", ...(operand.name === "AX" ? (["ax"] as const) : []),
              ...(operand.name === "DX" ? (["dx"] as const) : [])];
    case "sreg":
      return ["sreg"];
    case "mem":
      if (operand.size === 8) return ["rm8"];
      if (operand.size === 16) return ["rm16"];
      // Size unknown: the memory operand can serve as either width. The
      // caller narrows it down using the register it is paired with.
      return ["rm8", "rm16"];
    case "implied":
      return [operand.name];
    case "imm":
      return ["imm8", "imm16"];
    case "target":
      return ["rel8", "rel16", "ptr16"];
  }
}

/** `["none"]` is how the table spells "this instruction takes no operand". */
function expectedOperandCount(def: InsnDef): number {
  return def.ops.length === 1 && def.ops[0] === "none" ? 0 : def.ops.length;
}

/**
 * True when `operand` can fill the slot `type` of `def` at position `index`.
 *
 * A slot of type `one` or `three` is the implied shift count, so `SHL AX, 1`
 * has to match even though the `1` parses as a plain immediate.
 */
function matches(operand: Operand, type: OperandType): boolean {
  if (type === "one") return isImpliedCount(operand, 1);
  if (type === "three") return isImpliedCount(operand, 3);
  if (type === "moffs8" || type === "moffs16") return isBareAddress(operand);
  if (type === "imm8") return isImmediate(operand) && fitsImmediate(operand, 8, false);
  if (type === "imm16") return isImmediate(operand);
  return shapesFor(operand).includes(type);
}

function isImmediate(operand: Operand): boolean {
  return operand.kind === "imm" || operand.kind === "target";
}

/**
 * A `moffs` operand (0xA0-0xA3) is a bare 16-bit address in the instruction
 * itself, so it can only express `[1234h]`. Without this check `mov ax,[bx+si]`
 * would match the 3-byte `A1` form by treating the effective address as a
 * constant, and silently read the wrong location.
 */
function isBareAddress(operand: Operand): boolean {
  if (operand.kind !== "mem") return false;
  const { address } = operand;
  return address.base === undefined && address.index === undefined;
}

/** True when `value` survives being stored in an `bits`-wide field. */
function fitsImmediate(
  operand: Operand,
  bits: 8 | 16,
  signExtend: boolean,
): boolean {
  if (operand.kind !== "imm" && operand.kind !== "target") return false;
  if (bits === 16) return true;
  if (signExtend) return operand.value >= -128 && operand.value <= 127;
  return operand.value >= -128 && operand.value <= 255;
}

function isImpliedCount(operand: Operand, value: number): boolean {
  if (operand.kind === "imm") return operand.value === value;
  if (operand.kind !== "implied") return false;
  return operand.name === (value === 1 ? "one" : "three");
}

export function findCandidates(request: EncodeRequest): InsnDef[] {
  const upper = canonicalMnemonic(request.mnemonic);
  return INSTRUCTION_TABLE.filter((def) => {
    if (canonicalMnemonic(def.mnem) !== upper) return false;
    if (expectedOperandCount(def) !== request.operands.length) return false;
    for (let i = 0; i < def.ops.length; i++) {
      if (def.ops[i] === "none") continue;
      if (!matches(request.operands[i], def.ops[i])) return false;
      // LEA computes an address, so its source must be memory, and the r/m
      // field must not be the register-direct form.
      if (def.mnem === "LEA" && def.ops[i] === "rm16" && request.operands[i].kind !== "mem") {
        return false;
      }
      // An opcode that *is* the register form only matches its own register,
      // so `INC BX` can never be encoded as the 0x46 that means INC SI.
      // A definition's immediate must be able to hold the value. 0x83 stores a
      // signed byte, so `add ax,0x1234` must not be truncated into it.
      const immSpec =
        def.imm?.slot === i ? def.imm : def.imm2?.slot === i ? def.imm2 : undefined;
      if (immSpec && !fitsImmediate(request.operands[i], immSpec.size, immSpec.signExtend === true)) {
        return false;
      }
      const opcodeReg = def.opcodeReg;
      if (opcodeReg && opcodeReg.slot === i) {
        const operand = request.operands[i];
        const code = registerCode(operand);
        if (code === undefined || code !== opcodeReg.code) return false;
      }
    }
    return true;
  });
}

/**
 * Tie-break between two encodings of identical length: prefer the one whose
 * immediate field is the narrowest that can hold the value.
 *
 * This is what makes `add ax,1` encode as 83 C0 01 (sign-extended byte) rather
 * than 05 01 00 (word). Both are three bytes and both are correct 8086 code, so
 * length alone cannot decide; masm and gas both prefer the sign-extended form.
 */
function immediateRank(def: InsnDef, request: EncodeRequest): number {
  const imm = def.imm;
  if (!imm) return 0;
  const operand = request.operands[imm.slot];
  if (operand.kind !== "imm" && operand.kind !== "target") return 0;
  if (imm.size === 8) return 0;
  return fitsImmediate(operand, 8, true) ? 1 : 0;
}

function registerCode(operand: Operand): number | undefined {
  if (operand.kind === "reg8" || operand.kind === "reg16" || operand.kind === "sreg") {
    return operand.code;
  }
  return undefined;
}

/** Displacement bytes the r/m operand of `def` will actually emit. */
function dispSizeFor(def: InsnDef, request: EncodeRequest): number {
  const slot = def.modrm?.rm;
  if (slot === undefined) return 0;
  const operand = request.operands[slot];
  if (operand?.kind !== "mem") return 0;
  try {
    return addressToRm(operand.address).dispBytes.length;
  } catch {
    return 0;
  }
}

/** Structural size in bytes, including ModR/M, displacement and immediates. */
export function encodedSize(def: InsnDef, request: EncodeRequest): number {
  let size = def.bytes.length + (request.prefix?.length ?? 0);
  if (def.modrm) size += 1 + dispSizeFor(def, request);
  if (def.imm) size += def.imm.size / 8;
  if (def.imm2) size += def.imm2.size / 8;
  if (def.rel) size += def.rel.size / 8;
  if (def.moffs !== undefined) size += 2;
  if (def.ptr !== undefined) size += 4;
  return size;
}

/** `SHORT`/`NEAR` written on the operand, if any. */
function requestedDistance(request: EncodeRequest): "short" | "near" | undefined {
  for (const operand of request.operands) {
    if (operand.kind === "target" && operand.distance !== undefined) return operand.distance;
  }
  return undefined;
}

/** The displacement a `rel` form would encode, given the definition. */
function displacementFor(def: InsnDef, request: EncodeRequest): number {
  if (!def.rel) return 0;
  const operand = request.operands[def.rel.slot];
  if (operand?.kind !== "target") return 0;
  return operand.value - (request.offset + encodedSize(def, request));
}

/**
 * Pick an encoding: shortest candidate, with ties broken by table order.
 *
 * Branch range is applied after the length comparison, because a short jump is
 * one byte shorter but only legal within -128..+127. Choosing purely by size
 * would emit an `eb` whose displacement silently wraps.
 */
export function selectEncoding(request: EncodeRequest): InsnDef | undefined {
  let candidates = findCandidates(request);
  if (candidates.length === 0) return undefined;

  // `JMP NEAR label` asks for the 16-bit displacement even when the target is
  // close enough for the 8-bit one. The size rule below would otherwise always
  // pick the short form, and a disassembler could not describe a near jump at
  // all. Range checking still applies: a forced form that cannot reach is an
  // error, not a truncated displacement.
  const distance = requestedDistance(request);
  if (distance !== undefined) {
    const filtered = candidates.filter((d) => d.rel?.size === (distance === "short" ? 8 : 16));
    if (filtered.length > 0) candidates = filtered;
  }

  let best = candidates[0];
  let bestSize = encodedSize(best, request);
  let bestRank = immediateRank(best, request);
  for (const def of candidates.slice(1)) {
    const size = encodedSize(def, request);
    const rank = immediateRank(def, request);
    if (size < bestSize || (size === bestSize && rank < bestRank)) {
      best = def;
      bestSize = size;
      bestRank = rank;
    }
  }

  if (best.rel?.size === 8) {
    // An unknown target gets the wide form, and a known one that does not fit
    // in rel8 is widened. Either way the displacement is measured from the end
    // of the instruction that is actually emitted, in the same pass that emits
    // it, so the two can never disagree.
    const disp = displacementFor(best, request);
    if (request.unresolvedTarget || disp < -128 || disp > 127) {
      const wide = candidates.find((d) => d.rel?.size === 16);
      if (wide) best = wide;
    }
  }
  return best;
}

export function encode(request: EncodeRequest, diagnostics: DiagnosticBag): EncodedInstruction | undefined {
  const def = selectEncoding(request);
  if (!def) {
    diagnostics.error(
      request.line,
      request.column,
      `no encoding of ${request.mnemonic.toUpperCase()} accepts ` +
        `${request.operands.map(describeOperand).join(", ")}`,
    );
    return undefined;
  }
  return { bytes: emit(def, request, diagnostics), def };
}

function describeOperand(operand: Operand): string {
  switch (operand.kind) {
    case "reg8":
    case "reg16":
    case "sreg":
      return operand.name;
    case "implied":
      return operand.name.toUpperCase();
    case "mem":
      return operand.size ? `${operand.size === 8 ? "BYTE" : "WORD"} PTR [...]` : "[...]";
    case "imm":
    case "target":
      return operand.text;
  }
}

/** Emit the bytes for a chosen definition. */
export function emit(def: InsnDef, request: EncodeRequest, diagnostics: DiagnosticBag): number[] {
  const { operands } = request;
  const bytes: number[] = [...(request.prefix ?? []), ...def.bytes];
  let segmentPrefix: number | undefined;

  const m = def.modrm;
  if (m) {
    let regField = 0;
    if (typeof m.digit === "number") {
      regField = m.digit;
    } else if (m.sreg !== undefined) {
      const operand = operands[m.sreg];
      if (operand?.kind !== "sreg") {
        diagnostics.error(request.line, request.column, `${def.mnem} expects a segment register here`);
        return bytes;
      }
      regField = operand.code;
    } else if (m.reg !== undefined) {
      const operand = operands[m.reg];
      if (!operand) {
        diagnostics.error(request.line, request.column, `${def.mnem} is missing an operand`);
        return bytes;
      }
      if (operand.kind === "reg8" || operand.kind === "reg16" || operand.kind === "sreg") {
        regField = operand.code;
      } else {
        diagnostics.error(
          request.line,
          request.column,
          `${def.mnem} cannot use ${operand.kind === "mem" ? "memory" : "this operand"} in its register operand`,
        );
        return bytes;
      }
    }

    const rmOperand = m.rm !== undefined ? operands[m.rm] : undefined;
    const enc = encodeModRM(regField, toRegOrMem(rmOperand, def, request, diagnostics));
    bytes.push(enc.byte);
    bytes.push(...enc.dispBytes);

    // A segment override must precede the opcode, so it is spliced in after the
    // displacement has been appended. An override that matches the segment the
    // address would use anyway is redundant and gas omits it, so `mov ax,ds:[si]`
    // and `mov ax,[si]` must assemble identically.
    if (rmOperand?.kind === "mem" && rmOperand.address.segment) {
      if (rmOperand.address.segment !== defaultSegment(rmOperand.address)) {
        segmentPrefix = SEGMENT_PREFIX[rmOperand.address.segment];
      }
    }
  }

  if (def.imm) {
    const operand = operands[def.imm.slot];
    if (operand?.kind !== "imm") {
      diagnostics.error(request.line, request.column, `${def.mnem} expects an immediate here`);
      return bytes;
    }
    bytes.push(operand.value & 0xff);
    if (def.imm.size === 16) bytes.push((operand.value >> 8) & 0xff);
  }

  if (def.imm2) {
    const operand = operands[def.imm2.slot];
    if (operand?.kind !== "imm") {
      diagnostics.error(request.line, request.column, `${def.mnem} expects an immediate here`);
      return bytes;
    }
    bytes.push(operand.value & 0xff);
    if (def.imm2.size === 16) bytes.push((operand.value >> 8) & 0xff);
  }

  if (def.moffs !== undefined) {
    // `moffs` forms (`MOV AL, [0100h]`) carry a bare 16-bit address in the
    // instruction rather than a ModR/M byte.
    const operand = operands[def.moffs];
    if (operand?.kind !== "mem") {
      diagnostics.error(request.line, request.column, `${def.mnem} expects a memory operand here`);
      return bytes;
    }
    const disp = (operand.address.disp ?? 0) & 0xffff;
    bytes.push(disp & 0xff, (disp >> 8) & 0xff);
  }

  if (def.rel) {
    const operand = operands[def.rel.slot];
    if (operand?.kind !== "target") {
      diagnostics.error(request.line, request.column, `${def.mnem} expects a target here`);
      return bytes;
    }
    const disp = operand.value - (request.offset + bytes.length + def.rel.size / 8);
    bytes.push(disp & 0xff);
    if (def.rel.size === 16) bytes.push((disp >> 8) & 0xff);
  }

  if (def.ptr !== undefined) {
    // Far pointer: offset then segment. Only the offset is known for a near
    // label; the segment word is the owning segment's base, filled in by the
    // layout stage, so it is emitted as zero here and patched afterwards.
    const operand = operands[def.ptr];
    const offset = operand?.kind === "mem" ? (operand.address.disp ?? 0) : 0;
    bytes.push(offset & 0xff, (offset >> 8) & 0xff);
    bytes.push(0, 0);
  }

  if (segmentPrefix !== undefined) bytes.unshift(segmentPrefix);
  return bytes;
}

/**
 * The segment the 8086 would reach for on its own: DS everywhere except an
 * address based on BP, which defaults to SS because BP is the stack pointer's
 * companion register.
 */
function defaultSegment(address: MemAddress): NonNullable<MemAddress["segment"]> {
  return address.base === "BP" && address.index === undefined ? "SS" : "DS";
}

function toRegOrMem(
  operand: Operand | undefined,
  def: InsnDef,
  request: EncodeRequest,
  diagnostics: DiagnosticBag,
): { register?: number; address?: MemAddress } {
  if (!operand) {
    diagnostics.error(request.line, request.column, `${def.mnem} is missing an operand`);
    return { register: 0 };
  }
  if (operand.kind === "reg8" || operand.kind === "reg16" || operand.kind === "sreg") {
    return { register: operand.code };
  }
  if (operand.kind === "mem") return { address: operand.address };
  diagnostics.error(
    request.line,
    request.column,
    `${def.mnem} cannot use ${operand.kind === "imm" ? "an immediate" : "this operand"} in place of a memory operand`,
  );
  return { register: 0 };
}
