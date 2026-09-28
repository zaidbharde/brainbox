/**
 * engine/isa/modrm.ts — ModR/M byte construction and parsing.
 *
 * Encoding and decoding of the ModR/M byte, its displacement bytes and its
 * effective address. The address is described as a structured `MemAddress`
 * rather than as three scalars, so the encoder and the decoder can both walk
 * the same object without either side re-deriving "which rm value means
 * [BX+SI]" and risking a mismatch.
 */

import { REG16, reg16Code, reg16Name, isHighByte, reg8Index } from "./registers";

/** The eight r/m values for register-direct and memory forms. */
export const RM = {
  BX_SI: 0,
  BX_DI: 1,
  BP_SI: 2,
  BP_DI: 3,
  SI: 4,
  DI: 5,
  BP_DISP: 6,
  BX_DISP: 7,
} as const;

export type RmValue = (typeof RM)[keyof typeof RM];

export type BaseRegister = "BX" | "BP" | "SI" | "DI";
export type IndexRegister = "SI" | "DI" | "BX" | "BP";

export interface MemAddress {
  /** Up to two registers added together, e.g. BX+SI. */
  base?: BaseRegister;
  index?: IndexRegister;
  /** Optional constant displacement. */
  disp?: number;
  /** Segment override written as ES:/CS:/SS:/DS:. Absent means the default. */
  segment?: "ES" | "CS" | "SS" | "DS";
}

export const SEGMENT_PREFIX: Readonly<Record<"ES" | "CS" | "SS" | "DS", number>> = {
  ES: 0x26,
  CS: 0x2e,
  SS: 0x36,
  DS: 0x3e,
};

export const SEGMENT_FROM_PREFIX: Readonly<Record<number, "ES" | "CS" | "SS" | "DS">> = {
  0x26: "ES",
  0x2e: "CS",
  0x36: "SS",
  0x3e: "DS",
};

/**
 * Decode the r/m field into a base/index pair.
 * Returns `undefined` for r/m = 110 with mod = 00, which means "pure
 * 16-bit displacement, no register".
 */
export function rmToAddress(rm: number, disp: number): MemAddress | undefined {
  // A zero displacement is left out so that the decoded form of `[BX+SI]`
  // is exactly the source form `[BX+SI]`, which keeps encode/decode a true
  // round trip. `[BP]` still encodes to mod=01/disp8=0 because a bare BP has
  // no mod=00 encoding.
  const d = disp === 0 ? undefined : disp;
  switch (rm & 7) {
    case RM.BX_SI:
      return d === undefined ? { base: "BX", index: "SI" } : { base: "BX", index: "SI", disp: d };
    case RM.BX_DI:
      return d === undefined ? { base: "BX", index: "DI" } : { base: "BX", index: "DI", disp: d };
    case RM.BP_SI:
      return d === undefined ? { base: "BP", index: "SI" } : { base: "BP", index: "SI", disp: d };
    case RM.BP_DI:
      return d === undefined ? { base: "BP", index: "DI" } : { base: "BP", index: "DI", disp: d };
    case RM.SI:
      return d === undefined ? { base: "SI" } : { base: "SI", disp: d };
    case RM.DI:
      return d === undefined ? { base: "DI" } : { base: "DI", disp: d };
    case RM.BP_DISP:
      return d === undefined ? { base: "BP" } : { base: "BP", disp: d };
    case RM.BX_DISP:
      return d === undefined ? { base: "BX" } : { base: "BX", disp: d };
  }
}

/**
 * Choose the r/m value and mod for an address, together with the displacement
 * bytes that mod implies. Throws when the address uses a register combination
 * the 8086 cannot express, which is the single most common source of
 * "impossible" 8086 addressing modes.
 */
/** Pick mod=1 (disp8) when the displacement fits, otherwise mod=2 (disp16). */
function withDisp(rm: number, disp: number, forceMod1 = false): {
  rm: number;
  mod: number;
  dispBytes: number[];
} {
  if (forceMod1 || (disp >= -128 && disp <= 127)) {
    return { rm, mod: 1, dispBytes: [disp & 0xff] };
  }
  return { rm, mod: 2, dispBytes: [disp & 0xff, (disp >> 8) & 0xff] };
}

/**
 * Choose the r/m value and mod for an address, together with the displacement
 * bytes that mod implies. Throws when the address uses a register combination
 * the 8086 cannot express, which is the single most common source of
 * "impossible" 8086 addressing modes.
 */
export function addressToRm(address: MemAddress): {
  rm: number;
  mod: number;
  dispBytes: number[];
} {
  const hasDisp = address.disp !== undefined && address.disp !== 0;
  const disp = address.disp ?? 0;
  const base = address.base;
  const index = address.index;

  if (base === undefined && index === undefined) {
    // A bare displacement is *only* expressible as mod=00, rm=110 with a full
    // 16-bit displacement. Crucially this is NOT the same encoding as
    // [BP+disp]: mod=00/rm=110 means "no register at all", which is why a bare
    // [1234h] is always DS-relative while [BP+1234h] is always SS-relative.
    // There is deliberately no short form, so [10h] still costs two bytes.
    return { rm: RM.BP_DISP, mod: 0, dispBytes: [disp & 0xff, (disp >> 8) & 0xff] };
  }

  if (index === undefined) {
    // A single base register. SI/DI/BX have a mod=00 form; BP does not, so a
    // bare [BP] always needs a displacement byte (mod=01, disp8=0).
    if (base === "SI") return hasDisp ? withDisp(RM.SI, disp) : { rm: RM.SI, mod: 0, dispBytes: [] };
    if (base === "DI") return hasDisp ? withDisp(RM.DI, disp) : { rm: RM.DI, mod: 0, dispBytes: [] };
    if (base === "BX") return hasDisp ? withDisp(RM.BX_DISP, disp) : { rm: RM.BX_DISP, mod: 0, dispBytes: [] };
    if (base === "BP") return withDisp(RM.BP_DISP, disp, !hasDisp);
  }

  if (base !== undefined && index !== undefined) {
    let rm: number;
    if (base === "BX" && index === "SI") rm = RM.BX_SI;
    else if (base === "BX" && index === "DI") rm = RM.BX_DI;
    else if (base === "BP" && index === "SI") rm = RM.BP_SI;
    else if (base === "BP" && index === "DI") rm = RM.BP_DI;
    else if (base === "SI" && index === "BX") rm = RM.BX_SI;
    else if (base === "BX" && index === "BX") rm = RM.BX_DISP;
    else if (base === "DI" && index === "BX") rm = RM.BX_DI;
    else if (base === "SI" && index === "SI") rm = RM.SI;
    else if (base === "DI" && index === "DI") rm = RM.DI;
    else {
      throw new Error(
        `addressing mode [${base}+${index}] cannot be encoded on the 8086 ` +
          `(combinations are [BX+SI] [BX+DI] [BP+SI] [BP+DI] and single registers)`,
      );
    }
    if (hasDisp) return withDisp(rm, disp);
    return { rm, mod: 0, dispBytes: [] };
  }

  // An index with no base, e.g. [SI] or [DI].
  if (index === "SI") return hasDisp ? withDisp(RM.SI, disp) : { rm: RM.SI, mod: 0, dispBytes: [] };
  if (index === "DI") return hasDisp ? withDisp(RM.DI, disp) : { rm: RM.DI, mod: 0, dispBytes: [] };
  if (index === "BX") return hasDisp ? withDisp(RM.BX_DISP, disp) : { rm: RM.BX_DISP, mod: 0, dispBytes: [] };
  if (index === "BP") return withDisp(RM.BP_DISP, disp, !hasDisp);

  throw new Error(`cannot encode address [${base ?? ""}${index ? "+" + index : ""}]`);
}

export interface ModRMEncoding {
  byte: number;
  /** Displacement bytes that follow the ModR/M byte. */
  dispBytes: number[];
  /** True when mod/rm means "pure 16-bit displacement, no register". */
  pureDisp: boolean;
}

export interface RegOrMem {
  /** Present when the operand is a register rather than memory. */
  register?: number;
  /** Present when the operand is memory. */
  address?: MemAddress;
}

export function encodeModRM(reg: number, rmOperand: RegOrMem): ModRMEncoding {
  if (rmOperand.register !== undefined) {
    return {
      byte: 0xc0 | ((reg & 7) << 3) | (rmOperand.register & 7),
      dispBytes: [],
      pureDisp: false,
    };
  }
  const address = rmOperand.address ?? {};
  const { rm, mod, dispBytes } = addressToRm(address);
  const pureDisp = !address.base && !address.index && mod === 0;
  return { byte: (mod << 6) | ((reg & 7) << 3) | (rm & 7), dispBytes, pureDisp };
}

export interface ModRMDecode {
  mod: number;
  reg: number;
  rm: number;
  register: boolean;
  address?: MemAddress;
  /** Displacement in bytes, sign-extended for mod=01. */
  disp: number;
  /** Displacement bytes to append to the instruction. */
  dispBytes: number[];
  /** True when mod/rm means "pure 16-bit displacement, no register". */
  pureDisp: boolean;
}

export function decodeModRM(modrm: number, readDisp: (count: number) => number): ModRMDecode {
  const mod = (modrm >> 6) & 3;
  const reg = (modrm >> 3) & 7;
  const rm = modrm & 7;
  const register = mod === 3;

  if (register) {
    return { mod, reg, rm, register: true, disp: 0, dispBytes: [], pureDisp: false };
  }

  let disp = 0;
  let dispBytes: number[] = [];
  let pureDisp = false;

  if (mod === 0) {
    if (rm === RM.BP_DISP) {
      // mod=00, rm=110: the special "16-bit displacement only" case.
      pureDisp = true;
      const value = readDisp(2);
      dispBytes = [value & 0xff, (value >> 8) & 0xff];
      disp = (value << 16) >> 16;
    } else {
      const address = rmToAddress(rm, 0);
      return { mod, reg, rm, register: false, address, disp: 0, dispBytes: [], pureDisp: false };
    }
  } else if (mod === 1) {
    const raw = readDisp(1);
    dispBytes = [raw & 0xff];
    disp = (raw << 24) >> 24;
  } else {
    const value = readDisp(2);
    dispBytes = [value & 0xff, (value >> 8) & 0xff];
    disp = (value << 16) >> 16;
  }

  if (pureDisp) {
    // A bare displacement decodes to an address with no base and no index,
    // which the CPU resolves against DS. This is deliberately different from
    // [BP+disp], which decodes with base=BP and therefore resolves against SS.
    return { mod, reg, rm, register: false, address: { disp }, disp, dispBytes, pureDisp: true };
  }
  const address = rmToAddress(rm, disp);
  return { mod, reg, rm, register: false, address, disp, dispBytes, pureDisp: false };
}

/**
 * Compute the effective address of a memory operand.
 * Returns the offset only; the caller applies the segment rule.
 */
export function effectiveOffset(
  address: MemAddress,
  getReg: (name: BaseRegister | IndexRegister) => number,
): number {
  let offset = address.disp ?? 0;
  if (address.base) offset += getReg(address.base);
  if (address.index) offset += getReg(address.index);
  return offset & 0xffff;
}

/** Human-readable form, e.g. `[BX+SI-4]` or `ES:[DI+0x10]`. */
export function formatAddress(address: MemAddress): string {
  const parts: string[] = [];
  if (address.segment) parts.push(`${address.segment}:`);
  let body = "";
  if (address.base) body += address.base;
  if (address.index) body += body ? `+${address.index}` : address.index;
  if (address.disp !== undefined) {
    if (address.disp >= 0) {
      body += body ? `+${address.disp}` : `${address.disp}`;
    } else {
      body += body ? address.disp.toString() : `${address.disp}`;
    }
  }
  if (!body) body = "0";
  return `${parts.join("")}[${body}]`;
}

/**
 * True when the operand is a register, expressed by its 3-bit code. Used by the
 * decoder to turn a ModR/M rm field into a register name.
 */
export function rmRegisterName(rm: number, bits: 8 | 16): string {
  if (bits === 8) {
    const names = ["AL", "CL", "DL", "BL", "AH", "CH", "DH", "BH"];
    return names[rm & 7];
  }
  return reg16Name(rm);
}

export { REG16, reg16Code, isHighByte, reg8Index };
