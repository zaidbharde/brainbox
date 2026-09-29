/**
 * engine/cpu/decode.ts — bytes back into an instruction.
 *
 * This is the exact inverse of assembler/encoder.ts, and it reads the *same*
 * `InsnDef` objects. That is the point: an encoding and its decoding cannot
 * drift apart, because there is only one description of each instruction in the
 * codebase. If the table is wrong, both directions are wrong identically and
 * the round-trip test in isa/decode.test.ts is what catches it.
 *
 * Decoding is read-only and total: it never throws on bad input. A byte that
 * matches nothing yields a `DecodedInstruction` with `ok: false` and a message,
 * because a disassembler pointed at random memory must be able to keep going
 * and a debugger must be able to show where it stopped.
 */

import {
  INSTRUCTION_TABLE,
  type InsnDef,
  type OperandType,
} from "../isa/table";
import {
  decodeModRM,
  defaultSegmentFor,
  formatAddress,
  rmRegisterName,
  type MemAddress,
} from "../isa/modrm";
import { reg16Name, reg8Name, segmentName } from "../isa/registers";
import { toSigned } from "../isa/flags";

/** One decoded operand, resolved to a concrete value. */
export type DecodedOperand =
  | { kind: "none" }
  | { kind: "reg8"; name: string; code: number }
  | { kind: "reg16"; name: string; code: number }
  | { kind: "sreg"; name: string; code: number }
  /** A 16-bit value that came from a sign-extended byte (opcode 0x83). */
  | { kind: "imm"; value: number; size: 8 | 16; signExtended?: boolean }
  /** Relative branch displacement, relative to the end of the instruction. */
  | {
      kind: "rel";
      /** Signed displacement from the end of the instruction. */
      displacement: number;
      /** Instruction end plus the displacement, wrapped to 16 bits. */
      target: number;
      size: 8 | 16;
    }
  | { kind: "mem"; address: MemAddress; width: 8 | 16 }
  | { kind: "moffs"; address: MemAddress; width: 8 | 16 }
  | { kind: "farptr"; offset: number; segment: number };

export interface DecodedInstruction {
  ok: boolean;
  def?: InsnDef;
  /** Mnemonic in Intel syntax, e.g. "MOV". */
  mnem: string;
  /** Text form, e.g. "MOV AX, [BX+SI]". */
  text: string;
  operands: readonly DecodedOperand[];
  /** Bytes consumed, including prefixes. */
  length: number;
  /** Segment override present in the byte stream, if any. */
  segmentOverride?: "ES" | "CS" | "SS" | "DS";
  /** REP/REPE/REPNE prefix. `none` when the instruction is not repeated. */
  repeat: "none" | "rep" | "repe" | "repne";
  /** Set when decoding failed. */
  error?: string;
  /** True when the instruction is a BrainBox 0x0F extension. */
  extension?: number;
}

/** Cursor over an instruction's bytes. */
class ByteReader {
  private pos = 0;

  constructor(private readonly bytes: Uint8Array) {}

  get position(): number {
    return this.pos;
  }

  get remaining(): number {
    return this.bytes.length - this.pos;
  }

  get done(): boolean {
    return this.pos >= this.bytes.length;
  }

  /** Look at the next byte without consuming it. */
  peek(): number | undefined {
    return this.done ? undefined : this.bytes[this.pos];
  }

  u8(): number | undefined {
    if (this.done) return undefined;
    return this.bytes[this.pos++];
  }

  u16(): number | undefined {
    const low = this.u8();
    const high = this.u8();
    if (low === undefined || high === undefined) return undefined;
    return low | (high << 8);
  }

  take(count: number): number[] {
    const out: number[] = [];
    for (let i = 0; i < count; i++) {
      const byte = this.u8();
      if (byte === undefined) break;
      out.push(byte);
    }
    return out;
  }
}

const PREFIX_REPEAT: Readonly<Record<number, "rep" | "repe" | "repne">> = {
  0xf2: "repne",
  0xf3: "repe",
};

/** The mnemonic a repeat prefix is written with. F3 serves as REP and REPE. */
const REPEAT_TEXT: Readonly<Record<DecodedInstruction["repeat"], string>> = {
  none: "",
  rep: "REP",
  repe: "REPE",
  repne: "REPNE",
};

const PREFIX_SEGMENT: Readonly<Record<number, "ES" | "CS" | "SS" | "DS">> = {
  0x26: "ES",
  0x2e: "CS",
  0x36: "SS",
  0x3e: "DS",
};

/** Bytes consumed by an instruction of a given size, for the truncating case. */
const DEFAULT_PROBE = 16;

/**
 * How many bytes of context the decoder may read. Longest 8086 instruction is
 * `MOV moffs16, AX` at 6 bytes; a few undocumented forms reach 7. Sixteen is
 * generous and keeps `decode` usable directly on a slice of a program image.
 */
export function decode(bytes: Uint8Array, offset = 0): DecodedInstruction {
  const slice = bytes.subarray(offset, offset + DEFAULT_PROBE);
  return decodeAt(slice, 0);
}

/** Decode at an offset within `bytes`, without copying the whole image. */
export function decodeAt(bytes: Uint8Array, offset: number): DecodedInstruction {
  const reader = new ByteReader(bytes.subarray(offset, offset + DEFAULT_PROBE));

  // Segment overrides and REP may precede the opcode, more than once, and the
  // last of each kind wins. Peeking rather than consuming keeps the opcode byte
  // for the matcher.
  let segmentOverride: "ES" | "CS" | "SS" | "DS" | undefined;
  let repeat: "none" | "rep" | "repe" | "repne" = "none";
  for (;;) {
    const next = reader.peek();
    if (next === undefined) return truncated();
    const named = PREFIX_SEGMENT[next];
    if (named !== undefined) {
      segmentOverride = named;
      reader.u8();
      continue;
    }
    const repeated = PREFIX_REPEAT[next];
    if (repeated === undefined) break;
    // F3 on its own is REP, and REPE only where a compare is meaningful; a
    // disassembler cannot know which instruction follows, so it reports the
    // name the manual uses and lets the CPU decide.
    repeat = repeated;
    reader.u8();
  }

  const first = reader.u8();
  if (first === undefined) return truncated();

  // 0x0F is not a prefix on an 8086; it escapes into the extension space.
  if (first === 0x0f) {
    const sub = reader.u8();
    if (sub === undefined) return truncated();
    return decodeExtension(sub, reader, segmentOverride, repeat);
  }

  const candidates = BY_OPCODE.get(first);
  if (candidates === undefined) {
    return {
      ok: false,
      mnem: "DB",
      text: `DB 0x${hex(first)}`,
      operands: [{ kind: "imm", value: first, size: 8 }],
      length: reader.position,
      segmentOverride,
      repeat,
      error: `no instruction for opcode ${hex(first)}`,
    };
  }

  // Group opcodes (80-83, C0/C1, D0-D3, F6/F7, FE/FF) put the /digit in the
  // ModR/M reg field, and the table holds one entry per digit under the same
  // primary byte. 83 D0 is `ADC AX, 1` because the reg field reads 010; taking
  // the first 0x83 entry in the table would say `ADD`. So the choice has to wait
  // until the ModR/M byte has been seen.
  const isGroup = candidates.some((d) => d.modrm?.digit !== undefined);
  const modrmPeek = reader.peek();
  let def = candidates[0];
  if (isGroup && candidates.length > 1 && modrmPeek !== undefined) {
    const reg = (modrmPeek >> 3) & 7;
    const byDigit = candidates.find((d) => d.modrm?.digit === reg);
    if (byDigit === undefined) {
      return {
        ok: false,
        mnem: "DB",
        text: `DB 0x${hex(first)}`,
        operands: [],
        length: reader.position,
        segmentOverride,
        repeat,
        error: `opcode ${hex(first)} has no /${reg} form`,
      };
    }
    def = byDigit;
  } else if (candidates.length > 1 && def.opcodeReg !== undefined) {
    // Multiple entries under one opcode byte that are *not* a /digit group: the
    // low three bits of the opcode are the register (0x90..0x97 are XCHG AX,r).
    const byRegister = candidates.find(
      (d) => d.opcodeReg !== undefined && (d.opcodeReg.code & 7) === (first & 7),
    );
    if (byRegister) def = byRegister;
  }

  return buildInstruction(def, reader, segmentOverride, repeat);
}

function decodeExtension(
  sub: number,
  reader: ByteReader,
  segmentOverride: "ES" | "CS" | "SS" | "DS" | undefined,
  repeat: "none" | "rep" | "repe" | "repne",
): DecodedInstruction {
  const def = INSTRUCTION_TABLE.find((d) => d.ext === sub);
  if (def === undefined) {
    return {
      ok: false,
      mnem: "DB",
      text: `DB 0x0F, 0x${hex(sub)}`,
      operands: [],
      length: reader.position,
      segmentOverride,
      repeat,
      error: `no BrainBox extension for 0F ${hex(sub)}`,
    };
  }
  return buildInstruction(def, reader, segmentOverride, repeat);
}

function buildInstruction(
  def: InsnDef,
  reader: ByteReader,
  segmentOverride: "ES" | "CS" | "SS" | "DS" | undefined,
  repeat: "none" | "rep" | "repe" | "repne",
): DecodedInstruction {
  const startLength = reader.position;
  const operands: DecodedOperand[] = new Array(def.ops.length);

  // A register-specific opcode: the register number is the low three bits, and
  // the table entry was built for exactly that register.
  if (def.opcodeReg !== undefined) {
    const { slot, code } = def.opcodeReg;
    const type = def.ops[slot];
    operands[slot] = registerOperand(type, code);
  }

  // A segment-specific opcode: the segment is the instruction, so the operand
  // comes from the table rather than from any byte in the stream.
  if (def.opcodeSreg !== undefined) {
    const { slot, code } = def.opcodeSreg;
    operands[slot] = { kind: "sreg", name: segmentName(code), code };
  }

  if (def.modrm !== undefined) {
    const byte = reader.u8();
    if (byte === undefined) return truncated(startLength);
    const shape = def.modrm;
    // The displacement is read eagerly, and the default segment rule is applied
    // here: [BP] with no override means SS, everything else means DS. Getting
    // this wrong is silent -- the instruction still runs, against the wrong
    // bytes.
    // `readDisp` is told how many bytes the mod field calls for. Reading a
    // fixed two bytes here would swallow the following byte for mod=01 and
    // shift every operand after the displacement.
    const decoded = decodeModRM(byte, (count) => {
      if (count === 1) return reader.u8() ?? 0;
      return reader.u16() ?? 0;
    });

    if (shape.sreg !== undefined) {
      operands[shape.sreg] = { kind: "sreg", name: segmentName(decoded.reg), code: decoded.reg };
    } else if (shape.reg !== undefined) {
      const type = def.ops[shape.reg];
      operands[shape.reg] =
        type === "sreg"
          ? { kind: "sreg", name: segmentName(decoded.reg), code: decoded.reg }
          : registerOperand(type, decoded.reg);
    }

    if (shape.rm !== undefined) {
      const type = def.ops[shape.rm];
      operands[shape.rm] = rmOperand(type, decoded, segmentOverride);
    }

    if (shape.mod3Only && !decoded.register) {
      return failure(def, reader, segmentOverride, repeat, startLength, "requires a register operand");
    }
    if (shape.mod3Forbidden && decoded.register) {
      return failure(def, reader, segmentOverride, repeat, startLength, "does not accept a register operand");
    }
  }

  for (let slot = 0; slot < def.ops.length; slot++) {
    if (operands[slot] !== undefined) continue;
    const type = def.ops[slot];
    const fixed = fixedOperand(type);
    if (fixed !== undefined) {
      operands[slot] = fixed;
      continue;
    }
    // Anything left has to come out of the byte stream.
    if (type === "imm8" || type === "imm16") {
      const value = type === "imm8" ? reader.u8() : reader.u16();
      if (value === undefined) return truncated(startLength);
      operands[slot] = {
        kind: "imm",
        value: value & (type === "imm8" ? 0xff : 0xffff),
        size: type === "imm8" ? 8 : 16,
      };
      continue;
    }
    if (type === "rel8" || type === "rel16") {
      const raw = type === "rel8" ? reader.u8() : reader.u16();
      if (raw === undefined) return truncated(startLength);
      // A displacement is signed relative to the *end* of the instruction, and
      // the end is not known until every trailing field has been read.
      // `target` is filled in below, once the end of the instruction is known.
      operands[slot] = {
        kind: "rel",
        displacement: type === "rel8" ? (raw << 24) >> 24 : (raw << 16) >> 16,
        target: 0,
        size: type === "rel8" ? 8 : 16,
      };
      continue;
    }
    if (type === "moffs8" || type === "moffs16") {
      const value = reader.u16();
      if (value === undefined) return truncated(startLength);
      operands[slot] = {
        kind: "moffs",
        address: { segment: segmentOverride, disp: value },
        width: type === "moffs8" ? 8 : 16,
      };
      continue;
    }
    if (type === "ptr16") {
      const offset = reader.u16();
      const segment = reader.u16();
      if (offset === undefined || segment === undefined) return truncated(startLength);
      operands[slot] = { kind: "farptr", offset, segment };
      continue;
    }
    if (type === "r8") {
      // Not bound by opcodeReg (no such table entry), so it cannot be decoded.
      return failure(def, reader, segmentOverride, repeat, startLength, `cannot decode operand ${slot}`);
    }
    return failure(def, reader, segmentOverride, repeat, startLength, `cannot decode operand ${slot}`);
  }

  // A displacement is relative to the end of the instruction, so the target
  // cannot be known until the length is. Fixing it up here is also what makes
  // the text re-assemblable: the assembler takes an absolute target for
  // `SHORT`/`NEAR` and derives the displacement itself, so printing the raw
  // displacement would re-assemble to a different encoding.
  for (const operand of operands) {
    if (operand?.kind === "rel") {
      operand.target = (reader.position + operand.displacement) & 0xffff;
    }
  }

  // 0x83 sign-extends; a decoder that zero-extended would compute a different
  // immediate from the same bytes.
  if (def.imm?.signExtend === true) {
    for (let slot = 0; slot < def.ops.length; slot++) {
      if (def.imm.slot !== slot) continue;
      const operand = operands[slot];
      if (operand?.kind === "imm" && operand.size === 8) {
        operands[slot] = {
          kind: "imm",
          value: (operand.value << 24) >> 24,
          size: 16,
          signExtended: true,
        };
      }
    }
  }

  return {
    ok: true,
    def,
    mnem: def.mnem,
    // The repeat prefix has to reach the text, not just the `repeat` field:
    // without it the text would re-assemble to a bare MOVSW, which is a valid
    // program that quietly does the wrong thing.
    text:
      repeat === "none"
        ? formatInstruction(def.mnem, operands)
        : `${REPEAT_TEXT[repeat]} ${formatInstruction(def.mnem, operands)}`,
    operands,
    length: reader.position,
    segmentOverride,
    repeat,
    extension: def.ext,
  };
}

/** Primary opcode byte -> the definitions that can start with it. */
const BY_OPCODE: ReadonlyMap<number, readonly InsnDef[]> = (() => {
  const map = new Map<number, InsnDef[]>();
  for (const def of INSTRUCTION_TABLE) {
    const primary = def.bytes[0];
    const list = map.get(primary);
    if (list) list.push(def);
    else map.set(primary, [def]);
  }
  return map;
})();

function registerOperand(type: OperandType, code: number): DecodedOperand {
  if (type === "r8" || type === "rm8" || type === "reg8") {
    return { kind: "reg8", name: reg8Name(code), code };
  }
  if (type === "r16" || type === "rm16" || type === "reg16") {
    return { kind: "reg16", name: reg16Name(code), code };
  }
  if (type === "sreg") return { kind: "sreg", name: segmentName(code), code };
  return { kind: "none" };
}

function rmOperand(
  type: OperandType,
  decoded: ReturnType<typeof decodeModRM>,
  segmentOverride: "ES" | "CS" | "SS" | "DS" | undefined,
): DecodedOperand {
  const width = type === "rm8" ? 8 : 16;
  if (decoded.register) {
    return { kind: width === 8 ? "reg8" : "reg16", name: rmRegisterName(decoded.rm, width), code: decoded.rm } as DecodedOperand;
  }
  const address: MemAddress = {};
  if (decoded.address) {
    Object.assign(address, decoded.address);
  } else {
    address.disp = decoded.disp;
  }
  // An explicit override always wins. Otherwise BP-based addressing uses SS and
  // everything else uses DS.
  address.segment = segmentOverride ?? defaultSegment(address);
  return { kind: "mem", address, width };
}

/**
 * The default segment, from the one place that decides it.
 *
 * The resolved segment goes on the operand because the CPU needs to know which
 * segment an address is relative to. The *text* deliberately does not show it
 * when it was only implied, which is what `formatAddress(..., true)` is for.
 */
function defaultSegment(address: MemAddress): "SS" | "DS" {
  return defaultSegmentFor(address);
}

function fixedOperand(type: OperandType): DecodedOperand | undefined {
  switch (type) {
    case "none":
      return { kind: "none" };
    case "al":
      return { kind: "reg8", name: "AL", code: 0 };
    case "ax":
      return { kind: "reg16", name: "AX", code: 0 };
    case "dx":
      return { kind: "reg16", name: "DX", code: 2 };
    case "cl":
      return { kind: "reg8", name: "CL", code: 1 };
    case "one":
      return { kind: "imm", value: 1, size: 8 };
    case "three":
      return { kind: "imm", value: 3, size: 8 };
    case "label":
      // Assembler-internal only; it never reaches the byte stream.
      return undefined;
    default:
      return undefined;
  }
}

function formatInstruction(mnem: string, operands: readonly DecodedOperand[]): string {
  const parts = operands.map(formatOperand).filter((text) => text.length > 0);
  return parts.length === 0 ? mnem : `${mnem} ${parts.join(", ")}`;
}

/**
 * One operand as text, in the same spelling the full instruction line uses.
 *
 * Exported so the debugger can offer an instruction's operands without taking
 * the text apart again. Splitting `text` on commas would break on a string
 * literal containing one, and the split is not the parse: the same formatting
 * that produced the line is what has to produce the pieces.
 */
export function formatOperand(operand: DecodedOperand): string {
  switch (operand.kind) {
    case "none":
      return "";
    case "imm":
      // 16-bit immediates print as hex digits. Printing decimal digits with a
      // trailing `h` looks right (`0x1234` -> `4660h`) but is a different
      // number to the assembler: it reads `4660h` as 0x4660.
      if (operand.signExtended) return String(toSigned(operand.value, 16));
      // `0x` rather than a bare `h` suffix: a hex run that starts with a letter
      // is an identifier, because that is what keeps the register `AH` from
      // being read as the hex number 10. `BEEFh` would be an undefined symbol.
      return operand.size === 8
        ? String(operand.value)
        : `0x${(operand.value & 0xffff).toString(16).toUpperCase()}`;
    case "rel":
      // The form keyword is not decoration: it selects the opcode. The same
      // target is 0xEB (short) or 0xE9 (near), and dropping it would change the
      // instruction's size.
      return `${operand.size === 8 ? "SHORT" : "NEAR"} ${operand.target}`;
    case "moffs":
      return formatAddress(operand.address, true);
    case "farptr":
      return `${operand.offset}h:${operand.segment.toString(16).padStart(4, "0")}h`;
    case "mem":
      // Without the size, `ADD [BX], 16h` re-assembles as the byte form 80 07
      // and means something else entirely.
      return `${operand.width === 8 ? "BYTE PTR" : "WORD PTR"} ${formatAddress(operand.address, true)}`;
    default:
      return operand.name;
  }
}

function truncated(atLeast = 1): DecodedInstruction {
  return {
    ok: false,
    mnem: "?",
    text: "?",
    operands: [],
    length: Math.max(atLeast, 1),
    repeat: "none",
    error: "instruction runs past the end of the available bytes",
  };
}

function failure(
  def: InsnDef,
  reader: ByteReader,
  segmentOverride: "ES" | "CS" | "SS" | "DS" | undefined,
  repeat: "none" | "rep" | "repe" | "repne",
  startLength: number,
  message: string,
): DecodedInstruction {
  return {
    ok: false,
    def,
    mnem: def.mnem,
    text: `${def.mnem} ?`,
    operands: [],
    length: Math.max(reader.position, startLength),
    segmentOverride,
    repeat,
    error: message,
  };
}

function hex(value: number): string {
  return value.toString(16).padStart(2, "0").toUpperCase();
}
