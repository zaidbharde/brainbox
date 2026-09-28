/**
 * engine/isa/flags.ts — the 8086 flag register and width-correct flag logic.
 *
 * The old engine's bug (all CF/OF logic hardcoded to 16 bits, so every
 * 8-bit ADD/ADC/SUB/SBB/CMP/INC/DEC/NEG got CF and/or OF wrong) is structurally
 * impossible here: every helper takes an explicit `bits` argument and masks to
 * that width before testing. The width always comes from the *decoded
 * operand size*, never from a hardcoded constant.
 */

export const FLAG_NAMES = [
  "CF",
  "PF",
  "AF",
  "ZF",
  "SF",
  "OF",
  "DF",
  "IF",
  "TF",
] as const;

export type FlagName = (typeof FLAG_NAMES)[number];

/** A flag register value, kept as a plain number for cheap copying. */
export type Flags = number;

export const FLAG_BIT: Record<FlagName, number> = {
  CF: 0x0001,
  PF: 0x0004,
  AF: 0x0010,
  ZF: 0x0040,
  SF: 0x0080,
  TF: 0x0100,
  IF: 0x0200,
  DF: 0x0400,
  OF: 0x0800,
};

export function getFlag(flags: Flags, name: FlagName): boolean {
  return (flags & FLAG_BIT[name]) !== 0;
}

export function setFlag(flags: Flags, name: FlagName, value: boolean): Flags {
  return value ? flags | FLAG_BIT[name] : flags & ~FLAG_BIT[name];
}

/** Read a flag register as an object (used by the UI and by tests). */
export function decodeFlags(flags: Flags): Record<FlagName, boolean> {
  const out = {} as Record<FlagName, boolean>;
  for (const name of FLAG_NAMES) out[name] = getFlag(flags, name);
  return out;
}

export function encodeFlags(values: Partial<Record<FlagName, boolean>>): Flags {
  let flags = 0;
  for (const name of FLAG_NAMES) {
    if (values[name]) flags |= FLAG_BIT[name];
  }
  return flags;
}

/** Numeric index 0-15, with CF last, matching the classic FLAGS layout. */
export function flagIndex(name: FlagName): number {
  switch (name) {
    case "CF":
      return 0;
    case "PF":
      return 2;
    case "AF":
      return 4;
    case "ZF":
      return 6;
    case "SF":
      return 7;
    case "TF":
      return 8;
    case "IF":
      return 9;
    case "DF":
      return 10;
    case "OF":
      return 11;
  }
}

/** Even-parity flag: set when the low byte has an even number of 1 bits. */
export function parityOf(value: number): boolean {
  let v = value & 0xff;
  // Fold to a nibble parity, then to one bit.
  v ^= v >> 4;
  v &= 0x0f;
  v ^= v >> 2;
  v ^= v >> 1;
  return (v & 1) === 0;
}

export type Width = 8 | 16;

export function maskFor(bits: Width): number {
  return bits === 8 ? 0xff : 0xffff;
}

export function signBitFor(bits: Width): number {
  return bits === 8 ? 0x80 : 0x8000;
}

function signExtend(value: number, bits: Width): number {
  const sign = signBitFor(bits);
  return (value & sign) !== 0 ? value - (bits === 8 ? 0x100 : 0x10000) : value;
}

export function toSigned(value: number, bits: Width): number {
  return signExtend(value & maskFor(bits), bits);
}

export function toUnsigned(value: number, bits: Width): number {
  return value & maskFor(bits);
}

/**
 * Result of an addition/subtraction, shared by ADD, ADC, SUB, SBB, CMP, INC
 * and DEC so that the CF/AF/OF definitions can only exist once.
 *
 * CF  = unsigned carry out (add) or borrow (sub)
 * AF  = carry/borrow between bit 3 and bit 4
 * OF  = signed overflow
 * SF/ZF/PF always reflect the truncated result.
 */
export interface ArithResult {
  result: number;
  flags: Flags;
}

export function addFlags(a: number, b: number, carryIn: number, bits: Width, flags: Flags): ArithResult {
  const mask = maskFor(bits);
  const sign = signBitFor(bits);
  const aU = a & mask;
  const bU = b & mask;
  const cin = carryIn & 1;

  const wide = aU + bU + cin;
  const result = wide & mask;

  const carry = wide > mask;
  const af = ((aU & 0x0f) + (bU & 0x0f) + cin) > 0x0f;
  // Signed overflow: both operands share a sign that the result disagrees with.
  const of = ((aU ^ result) & (bU ^ result) & sign) !== 0;

  let out = flags;
  out = setFlag(out, "CF", carry);
  out = setFlag(out, "AF", af);
  out = setFlag(out, "ZF", result === 0);
  out = setFlag(out, "SF", (result & sign) !== 0);
  out = setFlag(out, "OF", of);
  out = setFlag(out, "PF", parityOf(result));
  return { result, flags: out };
}

export function subFlags(a: number, b: number, borrowIn: number, bits: Width, flags: Flags): ArithResult {
  const mask = maskFor(bits);
  const sign = signBitFor(bits);
  const aU = a & mask;
  const bU = b & mask;
  const bin = borrowIn & 1;

  const wide = aU - bU - bin;
  const result = wide & mask;

  // SUB sets CF when a borrow is *required*.
  const carry = wide < 0;
  const af = ((aU & 0x0f) - (bU & 0x0f) - bin) < 0;
  // Signed overflow: a and b differ in sign and the result's sign differs from a.
  const of = ((aU ^ bU) & (aU ^ result) & sign) !== 0;

  let out = flags;
  out = setFlag(out, "CF", carry);
  out = setFlag(out, "AF", af);
  out = setFlag(out, "ZF", result === 0);
  out = setFlag(out, "SF", (result & sign) !== 0);
  out = setFlag(out, "OF", of);
  out = setFlag(out, "PF", parityOf(result));
  return { result, flags: out };
}

/** Logic ops (AND/OR/XOR/TEST) affect OF/CF/AF (all cleared), SF/ZF/PF. */
export function logicFlags(result: number, bits: Width, flags: Flags): Flags {
  const mask = maskFor(bits);
  const sign = signBitFor(bits);
  const r = result & mask;
  let out = flags;
  out = setFlag(out, "CF", false);
  out = setFlag(out, "OF", false);
  out = setFlag(out, "AF", false);
  out = setFlag(out, "ZF", r === 0);
  out = setFlag(out, "SF", (r & sign) !== 0);
  out = setFlag(out, "PF", parityOf(r));
  return out;
}

/** INC/DEC leave CF untouched. */
export function incFlags(a: number, bits: Width, flags: Flags): ArithResult {
  const cf = getFlag(flags, "CF");
  const out = addFlags(a, 1, 0, bits, flags);
  return { result: out.result, flags: setFlag(out.flags, "CF", cf) };
}

export function decFlags(a: number, bits: Width, flags: Flags): ArithResult {
  const cf = getFlag(flags, "CF");
  const out = subFlags(a, 1, 0, bits, flags);
  return { result: out.result, flags: setFlag(out.flags, "CF", cf) };
}

/** NEG: CF = (operand != 0), OF = (operand == sign bit). */
export function negFlags(a: number, bits: Width, flags: Flags): ArithResult {
  const mask = maskFor(bits);
  const sign = signBitFor(bits);
  const aU = a & mask;
  const out = subFlags(0, aU, 0, bits, flags);
  let f = setFlag(out.flags, "CF", aU !== 0);
  f = setFlag(f, "OF", aU === sign);
  return { result: out.result, flags: f };
}

/** Single-step shift/rotate by one, used for the CL-capped count. */
export interface ShiftStep {
  value: number;
  carry: boolean;
  overflow: boolean;
}

export function rolStep(value: number, bits: Width): ShiftStep {
  const mask = maskFor(bits);
  const v = value & mask;
  const rotated = ((v << 1) | (v >> (bits - 1))) & mask;
  return { value: rotated, carry: (rotated & 1) !== 0, overflow: false };
}

export function rorStep(value: number, bits: Width): ShiftStep {
  const mask = maskFor(bits);
  const v = value & mask;
  const rotated = ((v >> 1) | (v << (bits - 1))) & mask;
  return { value: rotated, carry: (rotated & signBitFor(bits)) !== 0, overflow: false };
}

export function rclStep(value: number, carryIn: boolean, bits: Width): ShiftStep {
  const mask = maskFor(bits);
  const v = value & mask;
  const rotated = ((v << 1) | (carryIn ? 1 : 0)) & mask;
  // CF after the rotate is the bit that fell off the top.
  return { value: rotated, carry: (v & signBitFor(bits)) !== 0, overflow: false };
}

export function rcrStep(value: number, carryIn: boolean, bits: Width): ShiftStep {
  const mask = maskFor(bits);
  const v = value & mask;
  const rotated = ((v >> 1) | (carryIn ? signBitFor(bits) : 0)) & mask;
  return { value: rotated, carry: (v & 1) !== 0, overflow: false };
}

/**
 * Compute one shift/rotate step for `mnemonic` at the given width.
 * `count` is already reduced to 1..width by the caller (the CPU masks the
 * count to 5 bits and skips the instruction when the result is 0, per the
 * 8086 behaviour for 0/1 special encodings).
 */
export function shiftStep(
  mnemonic: string,
  value: number,
  carryIn: boolean,
  bits: Width,
): ShiftStep {
  switch (mnemonic) {
    case "SHL":
    case "SAL": {
      const mask = maskFor(bits);
      const sign = signBitFor(bits);
      const v = value & mask;
      const shifted = (v << 1) & mask;
      // OF is only architecturally defined for a single-bit shift.
      const of = ((v ^ shifted) & sign) !== 0;
      return { value: shifted, carry: (v & sign) !== 0, overflow: of };
    }
    case "SHR": {
      const mask = maskFor(bits);
      const v = value & mask;
      const shifted = (v >>> 1) & mask;
      // For SHR, OF is the original sign bit.
      return { value: shifted, carry: (v & 1) !== 0, overflow: (v & signBitFor(bits)) !== 0 };
    }
    case "SAR": {
      const mask = maskFor(bits);
      const v = value & mask;
      const sign = signBitFor(bits);
      // Arithmetic shift must see the sign, so use the *signed* value.
      const sv = toSigned(v, bits);
      const shifted = (sv >> 1) & mask;
      return { value: shifted, carry: (v & 1) !== 0, overflow: (v & sign) !== 0 };
    }
    case "ROL":
      return rolStep(value, bits);
    case "ROR":
      return rorStep(value, bits);
    case "RCL":
      return rclStep(value, carryIn, bits);
    case "RCR":
      return rcrStep(value, carryIn, bits);
    default:
      throw new Error(`shiftStep: not a shift/rotate mnemonic: ${mnemonic}`);
  }
}

/** The 8086 masks a variable shift count with 0x1F; 0 then means 0 iterations. */
export function effectiveShiftCount(count: number, bits: Width): number {
  return (count & 0x1f) === 0 ? 0 : (count & 0x1f) % bits;
}

/** ASCII adjust after ADD/INC AL,AB (DAA-style core used by AAA/AAS). */
export function decimalAdjustAdd(al: number, af: boolean): { al: number; cf: boolean } {
  let a = al & 0xff;
  let cf = false;
  if ((a & 0x0f) > 9 || af) {
    a = (a + 0x06) & 0xff;
    cf = true;
  }
  if (a > 0x9f) {
    a = (a + 0x60) & 0xff;
    cf = true;
  }
  return { al: a, cf };
}

/** ASCII adjust after SUB/SBB AL,AB. */
export function decimalAdjustSub(al: number, af: boolean): { al: number; cf: boolean } {
  let a = al & 0xff;
  let cf = false;
  if ((a & 0x0f) > 9 || af) {
    a = (a - 0x06) & 0xff;
    cf = true;
  }
  if (al > 0x99) {
    a = (a - 0x60) & 0xff;
    cf = true;
  }
  return { al: a & 0xff, cf };
}
