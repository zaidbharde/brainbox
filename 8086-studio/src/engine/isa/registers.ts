/**
 * engine/isa/registers.ts — canonical 8086 register numbering.
 *
 * The 8086 encodes registers in only 3 bits (plus the /digit scheme), so these
 * tables are the single source of truth for name <-> code in both the encoder
 * and the decoder. `reg8` numbering is deliberately *not* the same as `reg16`
 * numbering: AL..BH are 0..7 while AX..DI are 0..7 too, but the mapping to
 * physical storage differs (AH is bits 8-15 of AX, not a separate register).
 */

/** 16-bit general purpose registers, indexed by their 3-bit encoding. */
export const REG16 = ["AX", "CX", "DX", "BX", "SP", "BP", "SI", "DI"] as const;
export type Reg16 = (typeof REG16)[number];

/** 8-bit general purpose registers, indexed by their 3-bit encoding. */
export const REG8 = ["AL", "CL", "DL", "BL", "AH", "CH", "DH", "BH"] as const;
export type Reg8 = (typeof REG8)[number];

/** Segment registers, indexed by their 3-bit encoding. */
export const SEGMENT = ["ES", "CS", "SS", "DS", undefined, undefined] as const;
export type SegmentName = "ES" | "CS" | "SS" | "DS";

/** High byte of each 16-bit register: reg8 code 4..7 map to AH/CH/DH/BH. */
export const REG8_HIGH_PARENT: readonly Reg16[] = ["AX", "CX", "DX", "BX"];
/** Low byte of each 16-bit register: reg8 code 0..3 map to AL/CL/DL/BL. */
export const REG8_LOW_PARENT: readonly Reg16[] = ["AX", "CX", "DX", "BX"];

const reg16ToCode = new Map<string, number>(REG16.map((n, i) => [n, i]));
const reg8ToCode = new Map<string, number>(REG8.map((n, i) => [n, i]));
const segmentToCode = new Map<string, number>([
  ["ES", 0],
  ["CS", 1],
  ["SS", 2],
  ["DS", 3],
]);

export function reg16Code(name: string): number | undefined {
  return reg16ToCode.get(name.toUpperCase());
}

export function reg8Code(name: string): number | undefined {
  return reg8ToCode.get(name.toUpperCase());
}

export function segmentCode(name: string): number | undefined {
  return segmentToCode.get(name.toUpperCase());
}

export function reg16Name(code: number): Reg16 {
  return REG16[code & 7];
}

export function reg8Name(code: number): Reg8 {
  return REG8[code & 7];
}

export function segmentName(code: number): SegmentName {
  return (SEGMENT[code & 7] ?? "DS") as SegmentName;
}

/** True for the 16-bit registers usable with ModR/M and immediate forms. */
export function isReg16(name: string): boolean {
  return reg16ToCode.has(name.toUpperCase());
}

export function isReg8(name: string): boolean {
  return reg8ToCode.has(name.toUpperCase());
}

export function isSegmentReg(name: string): boolean {
  return segmentToCode.has(name.toUpperCase());
}

/**
 * Storage index for each 8-bit register, so the CPU can map AL..BH onto its
 * 16-bit register pair: 0-3 are the low byte, 4-7 the high byte.
 */
export function reg8Index(code: number): number {
  return code & 7;
}

export function isHighByte(code: number): boolean {
  return (code & 3) === 0 && code >= 4;
}
