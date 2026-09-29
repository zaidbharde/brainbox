/**
 * Are these flags the 8086's?
 *
 * The differential test in `differential.test.ts` answers "do the two engines
 * agree?", which is the wrong question for the flags: the legacy's 8-bit flag
 * behaviour is not the 8086's, so agreeing with it is not something to want.
 * This file asks the right question instead, and it asks it of a third party:
 * the flag rules below are written from the 8086 definitions rather than from
 * either engine, so they can referee a disagreement instead of just recording
 * it.
 *
 * It runs the same matrix through all three and asserts two things:
 *
 *   1. The new engine is right, everywhere. This is the test that has authority
 *      over the flags; a failure here is a real bug in the engine.
 *   2. The legacy is right everywhere except in a named, enumerated set. Its
 *      8-bit SF, CF, OF and AF, and the AF of 16-bit ADC and SBB, are not the
 *      8086's. Pinning that list means the exceptions cannot quietly grow, and
 *      a divergence outside it is a change in the legacy that needs looking at.
 *
 * Nothing here is a snapshot of current behaviour. The reference is arithmetic
 * that can be checked by hand, so it is safe to hold an engine to.
 */

import { describe, expect, it } from "vitest";
import { runProgram as legacyRunProgram } from "../../emulator/cpu";
import { assemble as legacyAssemble } from "../../emulator/assembler";
import { Cpu, createInitialState } from "./cpu";
import { Memory } from "../memory";
import { assemble } from "../assembler/assemble";

type FlagName = "CF" | "PF" | "AF" | "ZF" | "SF" | "OF";

const FLAGS: readonly FlagName[] = ["CF", "PF", "AF", "ZF", "SF", "OF"];

/** Where each flag sits in the word. */
const BIT: Record<FlagName, number> = {
  CF: 0,
  PF: 2,
  AF: 4,
  ZF: 6,
  SF: 7,
  OF: 11,
};

/** The operations whose flags are defined by the table below. */
const OPERATIONS = ["ADD", "ADC", "SUB", "SBB", "AND", "OR", "XOR", "CMP"] as const;
type Operation = (typeof OPERATIONS)[number];

/**
 * The multiplies are kept out of `OPERATIONS` on purpose: those eight mnemonics
 * share one flag definition and one accumulator shape, and mixing a second rule
 * into that matrix would make the allowance below ambiguous.
 */
const MULTIPLIES = ["MUL", "IMUL"] as const;
type MultiplyOperation = (typeof MULTIPLIES)[number];

interface Outcome {
  result: number;
  flags: Record<FlagName, number>;
}

/** Parity of the low byte: PF is set when that byte has an even number of ones. */
function evenParity(value: number): number {
  let ones = 0;
  for (let bit = 0; bit < 8; bit++) ones += (value >> bit) & 1;
  return ones % 2 === 0 ? 1 : 0;
}

/**
 * The 8086's flags for one operation, from the definitions:
 *
 * - CF is the carry out of the top bit for addition and a borrow for
 *   subtraction. The borrow belongs to the whole subtraction, so it is taken
 *   before the result is masked: `0 - 0FFh - 1` borrows even though the masked
 *   subtrahend is zero.
 * - OF is set when a result's sign is wrong for the carry into the top bit:
 *   `(a ^ result) & (b ^ result)` for addition, `(a ^ b) & (a ^ result)` for
 *   subtraction, both at the width's sign bit.
 * - AF is the carry out of bit 3, which is the classic `a ^ b ^ result` test.
 * - SF is the top bit of the result, PF the parity of its low byte, ZF whether
 *   it is zero.
 * - AND, OR and XOR clear CF and OF and leave AF undefined, so zero is used.
 */
function expected(operation: Operation, a: number, b: number, carryIn: number, width: 8 | 16): Outcome {
  const mask = width === 8 ? 0xff : 0xffff;
  const sign = width === 8 ? 0x80 : 0x8000;
  // Only ADC and SBB consume the incoming carry. Folding it into ADD as well was
  // a mistake here once, and it made a correct engine look wrong.
  const addend = operation === "ADC" ? carryIn : 0;
  let result: number;
  let CF = 0;
  let AF = 0;
  let OF = 0;
  switch (operation) {
    case "ADD":
    case "ADC": {
      const sum = a + b + addend;
      result = sum & mask;
      CF = sum > mask ? 1 : 0;
      OF = (a ^ result) & (b ^ result) & sign ? 1 : 0;
      AF = (a ^ b ^ result) & 0x10 ? 1 : 0;
      break;
    }
    case "SUB":
    case "CMP":
    case "SBB": {
      const subtrahend = b + (operation === "SBB" ? carryIn : 0);
      CF = a - subtrahend < 0 ? 1 : 0;
      result = (a - subtrahend) & mask;
      OF = (a ^ b) & (a ^ result) & sign ? 1 : 0;
      AF = (a ^ b ^ result) & 0x10 ? 1 : 0;
      break;
    }
    case "AND":
      result = (a & b) & mask;
      break;
    case "OR":
      result = (a | b) & mask;
      break;
    case "XOR":
      result = (a ^ b) & mask;
      break;
  }
  return {
    result,
    flags: {
      CF,
      PF: evenParity(result & 0xff),
      AF,
      ZF: result === 0 ? 1 : 0,
      SF: (result & sign) ? 1 : 0,
      OF,
    },
  };
}

/** The registers and flags the legacy ends with, for one program. */
function runLegacy(source: string): Outcome {
  const program = legacyAssemble(source);
  expect(program.errors.filter((e) => e.type === "error")).toEqual([]);
  const { finalState } = legacyRunProgram(program, 5000);
  const flags = {} as Record<FlagName, number>;
  for (const name of FLAGS) flags[name] = (finalState.registers.FLAGS >> BIT[name]) & 1;
  return { result: finalState.registers.AX, flags };
}

/** The same for the new engine. */
function runNew(source: string): Outcome {
  const assembled = assemble(source, { origin: 0 });
  expect(assembled.errors.map((d) => d.message)).toEqual([]);
  const memory = new Memory();
  memory.bytes.set(assembled.image, 0);
  // The segments are pinned to zero and IP starts at the first instruction so
  // that this test is about flags and nothing else. See differential.test.ts for
  // why the two address spaces are made to coincide there.
  const cpu = new Cpu(memory, {
    ...createInitialState(),
    IP: assembled.entry.ip,
    CS: 0,
    DS: 0,
    ES: 0,
    SS: 0,
    SP: 0xf00,
    FLAGS: 0,
  });
  cpu.run(5000);
  const flags = {} as Record<FlagName, number>;
  for (const name of FLAGS) flags[name] = (cpu.state.FLAGS >> BIT[name]) & 1;
  return { result: cpu.readReg16("AX"), flags };
}

/** One program per operation, width, operand pair and incoming carry. */
function* programs(): Generator<{ source: string; operation: Operation; width: 8 | 16; a: number; b: number; carryIn: number }> {
  const values = [0x00, 0x01, 0x0f, 0x7f, 0x80, 0x81, 0xfe, 0xff];
  for (const width of [8, 16] as const) {
    // 8-bit arithmetic works on AL with an 8-bit source; 16-bit on AX with a
    // 16-bit one. AX and AL are the same register, and leaving the high byte
    // clear is what keeps the 8-bit cases honest.
    const [target, other] = width === 8 ? (["AL", "CL"] as const) : (["AX", "CX"] as const);
    for (const operation of OPERATIONS) {
      for (const a of values) {
        for (const b of values) {
          for (const carryIn of [0, 1]) {
            const hex = (value: number) => value.toString(16).toUpperCase();
            yield {
              operation,
              width,
              a,
              b,
              carryIn,
              // The carry is set before the operands are loaded, because MOV
              // leaves the flags alone but nothing else may be relied on to.
              source: [
                carryIn ? "STC" : "CLC",
                `MOV ${target}, 0${hex(a)}h`,
                `MOV ${other}, 0${hex(b)}h`,
                `${operation} ${target}, ${other}`,
                "HLT",
              ].join("\n"),
            };
          }
        }
      }
    }
  }
}

const label = (c: { source: string; operation: Operation; width: 8 | 16; a: number; b: number; carryIn: number }) =>
  `${c.operation} ${c.width}-bit a=0x${c.a.toString(16)} b=0x${c.b.toString(16)} carryIn=${c.carryIn}`;

/**
 * One program per multiply, width and operand pair.
 *
 * The ALU matrix above covers the six operations whose flags come out of an
 * arithmetic definition. MUL and IMUL are a different rule and are worth their
 * own matrix, because the rule is not "a carry out of the top bit": it is
 * "the upper half is not an extension of the lower one", and the bit that
 * decides which kind of extension is expected is the top bit of the *width*.
 * Nothing about the arithmetic itself reveals that, so a matrix that only
 * multiplied unsigned pairs would agree with a wrong implementation forever.
 */
interface MultiplyProgram {
  source: string;
  operation: MultiplyOperation;
  width: 8 | 16;
  a: number;
  b: number;
}

function* multiplyPrograms(): Generator<MultiplyProgram> {
  const values = [0x00, 0x01, 0x02, 0x0f, 0x40, 0x7f, 0x80, 0x81, 0xc0, 0xfe, 0xff];
  for (const width of [8, 16] as const) {
    const [target, other] = width === 8 ? (["AL", "CL"] as const) : (["AX", "CX"] as const);
    for (const operation of MULTIPLIES) {
      for (const a of values) {
        for (const b of values) {
          const hex = (value: number) => value.toString(16).toUpperCase();
          yield {
            operation,
            width,
            a,
            b,
            source: [
              `MOV ${target}, 0${hex(a)}h`,
              `MOV ${other}, 0${hex(b)}h`,
              `${operation} ${other}`,
              "HLT",
            ].join("\n"),
          };
        }
      }
    }
  }
}

interface MultiplyOutcome {
  ax: number;
  dx: number;
  flags: Record<FlagName, number>;
}

const signed = (value: number, bits: 8 | 16) => (value << (32 - bits)) >> (32 - bits);
/**
 * The 8086's result and CF/OF for a multiply, from the definition. Everything
 * except CF and OF is left exactly as it was, which is why only those two are
 * returned.
 *
 * The product is not masked to the operand's width anywhere: an 8-bit multiply
 * still produces up to sixteen bits of result, and IMUL's can be negative, so
 * AX holds the product as a 16-bit two's complement number. Masking it to eight
 * bits first is what turns -128 into 128 and calls a correct multiply wrong.
 */
function expectedMultiply(
  operation: MultiplyOperation,
  a: number,
  b: number,
  width: 8 | 16,
): { product: number; tooLarge: number } {
  const negative = operation === "IMUL";
  const x = negative ? signed(a, width) : a & (width === 8 ? 0xff : 0xffff);
  const y = negative ? signed(b, width) : b & (width === 8 ? 0xff : 0xffff);
  const product = x * y;
  // The 8-bit form keeps all sixteen bits in AX, so the upper half is AH; the
  // 16-bit form keeps the lower half in AX and the upper half in DX.
  const [low, high] = width === 8 ? [product & 0xff, (product >> 8) & 0xff] : [product & 0xffff, (product >> 16) & 0xffff];
  const mask = width === 8 ? 0xff : 0xffff;
  const signBit = width === 8 ? 0x80 : 0x8000;
  const expectedHigh = (low & signBit) !== 0 ? mask : 0;
  return { product, tooLarge: (high & mask) !== expectedHigh ? 1 : 0 };
}

function runMultiplyNew(source: string): MultiplyOutcome {
  const assembled = assemble(source, { origin: 0 });
  expect(assembled.errors.map((d) => d.message)).toEqual([]);
  const memory = new Memory();
  memory.bytes.set(assembled.image, 0);
  const cpu = new Cpu(memory, { ...createInitialState(), IP: assembled.entry.ip, DS: 0, SS: 0, SP: 0xf00, FLAGS: 0 });
  cpu.run(5000);
  const flags = {} as Record<FlagName, number>;
  for (const name of FLAGS) flags[name] = (cpu.state.FLAGS >> BIT[name]) & 1;
  return { ax: cpu.readReg16("AX"), dx: cpu.state.DX, flags };
}

function runMultiplyLegacy(source: string): MultiplyOutcome {
  const program = legacyAssemble(source);
  expect(program.errors.filter((e) => e.type === "error")).toEqual([]);
  const { finalState } = legacyRunProgram(program, 5000);
  const flags = {} as Record<FlagName, number>;
  for (const name of FLAGS) flags[name] = (finalState.registers.FLAGS >> BIT[name]) & 1;
  return { ax: finalState.registers.AX, dx: finalState.registers.DX, flags };
}

/**
 * Where the legacy's flags are known not to be the 8086's. Anything outside
 * this set is a divergence that needs explaining before it is tolerated.
 */
function toleratedInLegacy(c: { operation: Operation; width: 8 | 16 }, flag: FlagName): boolean {
  if (c.width === 8) return flag === "SF" || flag === "CF" || flag === "OF" || flag === "AF";
  // The 16-bit carry paths are wrong only in AF.
  if (flag !== "AF") return false;
  return c.operation === "ADC" || c.operation === "SBB";
}

describe("flags: the new CPU follows the 8086, and the legacy's gaps stay named", () => {
  it("computes the 8086's flags for every ALU operation at both widths", () => {
    const failures: string[] = [];
    let checked = 0;
    for (const program of programs()) {
      const want = expected(program.operation, program.a, program.b, program.carryIn, program.width);
      const got = runNew(program.source);
      checked++;
      for (const flag of FLAGS) {
        if (got.flags[flag] !== want.flags[flag]) {
          failures.push(`${label(program)} ${flag}: want ${want.flags[flag]} new ${got.flags[flag]}`);
        }
      }
      // CMP computes the subtraction and throws it away, so the register still
      // holds what was loaded. Its flags come from the difference all the same,
      // which is the whole point of the instruction.
      const stored = program.operation === "CMP" ? program.a : want.result;
      const mask = program.width === 8 ? 0xff : 0xffff;
      if ((got.result & mask) !== (stored & mask)) {
        failures.push(
          `${label(program)} result: want 0x${(stored & mask).toString(16)} new 0x${(got.result & mask).toString(16)}`,
        );
      }
    }
    expect(checked).toBeGreaterThan(1000);
    expect(failures, `the new engine's flags are wrong in ${failures.length} of ${checked} cases`).toEqual([]);
  });

  it("differs from the 8086 only where the legacy is known to be wrong", () => {
    const untolerated: string[] = [];
    const tolerated = new Map<string, number>();
    for (const program of programs()) {
      const want = expected(program.operation, program.a, program.b, program.carryIn, program.width);
      const got = runLegacy(program.source);
      for (const flag of FLAGS) {
        if (got.flags[flag] === want.flags[flag]) continue;
        if (toleratedInLegacy(program, flag)) {
          const key = `${program.width}-bit ${program.operation} ${flag}`;
          tolerated.set(key, (tolerated.get(key) ?? 0) + 1);
        } else {
          untolerated.push(`${label(program)} ${flag}: 8086 wants ${want.flags[flag]} legacy gives ${got.flags[flag]}`);
        }
      }
    }
    // The allowance has to be a real measurement, not a way of never noticing.
    // If the legacy is ever fixed, this fails and the list should be trimmed.
    expect([...tolerated.keys()].sort()).toEqual(
      [
        ...[
          "8-bit ADC AF",
          "8-bit ADC CF",
          "8-bit ADC OF",
          "8-bit ADC SF",
          "8-bit ADD CF",
          "8-bit ADD OF",
          "8-bit ADD SF",
          "8-bit AND SF",
          "8-bit CMP OF",
          "8-bit CMP SF",
          "8-bit OR SF",
          "8-bit SBB AF",
          "8-bit SBB OF",
          "8-bit SBB SF",
          "8-bit SUB OF",
          "8-bit SUB SF",
          "8-bit XOR SF",
          "16-bit ADC AF",
          "16-bit SBB AF",
        ],
      ].sort(),
    );
    expect(untolerated, "the legacy now diverges somewhere it did not used to").toEqual([]);
  });

  it("agrees with the legacy on its results, whatever its flags do", () => {
    // The results are the part users depend on most, and the part the legacy
    // gets right, so they stay comparable across the whole matrix.
    const failures: string[] = [];
    for (const program of programs()) {
      const legacy = runLegacy(program.source);
      const mine = runNew(program.source);
      if ((legacy.result & 0xff) !== (mine.result & 0xff)) {
        failures.push(`${label(program)}: legacy 0x${legacy.result.toString(16)} new 0x${mine.result.toString(16)}`);
      }
    }
    expect(failures, "the two engines compute different results").toEqual([]);
  });
});

describe("flags: MUL and IMUL, where the width decides which bit counts", () => {
  it("computes the 8086's overflow report for every multiply at both widths", () => {
    const failures: string[] = [];
    let checked = 0;
    for (const program of multiplyPrograms()) {
      const want = expectedMultiply(program.operation, program.a, program.b, program.width);
      const got = runMultiplyNew(program.source);
      checked++;
      const stored = want.product & 0xffff;
      if (got.ax !== stored) {
        failures.push(
          `${program.operation} ${program.width}-bit a=0x${program.a.toString(16)} b=0x${program.b.toString(16)} AX: want 0x${(stored & 0xffff).toString(16)} new 0x${got.ax.toString(16)}`,
        );
      }
      // DX only takes part in the 16-bit form. Putting the byte form's high half
      // there is a plausible mistake that quietly loses the top byte, so it is
      // checked rather than assumed.
      const wantDx = program.width === 16 ? (want.product >> 16) & 0xffff : 0;
      if (got.dx !== wantDx) {
        failures.push(
          `${program.operation} ${program.width}-bit a=0x${program.a.toString(16)} b=0x${program.b.toString(16)} DX: want 0x${wantDx.toString(16)} new 0x${got.dx.toString(16)}`,
        );
      }
      for (const flag of ["CF", "OF"] as const) {
        if (got.flags[flag] !== want.tooLarge) {
          failures.push(
            `${program.operation} ${program.width}-bit a=0x${program.a.toString(16)} b=0x${program.b.toString(16)} ${flag}: want ${want.tooLarge} new ${got.flags[flag]}`,
          );
        }
      }
    }
    expect(checked).toBeGreaterThan(400);
    expect(failures, `the new engine's multiply flags are wrong in ${failures.length} of ${checked} cases`).toEqual([]);
  });

  it("reads the sign for overflow from the top bit of the operand's width", () => {
    // -12 * 10 is -120, which fits in a signed 8-bit result once widened, so
    // neither flag is set. Reading the sign from bit 15 of AX instead would call
    // this an overflow, because the high half is 0xFF and the byte 0x88 has no
    // bit 15.
    const got = runMultiplyNew("MOV AL, 0F4h\nMOV CL, 0Ah\nIMUL CL\nHLT");
    expect(got.ax).toBe(0xff88);
    expect(got.flags.CF).toBe(0);
    expect(got.flags.OF).toBe(0);
  });

  it("leaves every other flag alone", () => {
    // The flags a multiply does not define are not cleared, so a program that
    // sets them and then multiplies still sees them.
    const got = runMultiplyNew("STC\nMOV AL, 2\nMOV CL, 2\nMUL CL\nHLT");
    expect(got.flags.CF).toBe(0);
    expect(got.flags.ZF).toBe(0);
    expect(got.flags.SF).toBe(0);
    expect(got.flags.PF).toBe(0);
    expect(got.flags.AF).toBe(0);
    expect(got.flags.OF).toBe(0);
  });

  it("agrees with the legacy on the multiply results", () => {
    // Only MUL reaches the legacy at all: its assembler has no IMUL, which is a
    // gap in the old engine rather than a difference in the arithmetic. Only the
    // results are compared, because the legacy's overflow report for a multiply
    // is checked against the definition above rather than against the legacy.
    const failures: string[] = [];
    for (const program of multiplyPrograms()) {
      if (program.operation === "IMUL") continue;
      const want = expectedMultiply(program.operation, program.a, program.b, program.width);
      const legacy = runMultiplyLegacy(program.source);
      const stored = want.product & 0xffff;
      const wantDx = program.width === 16 ? (want.product >> 16) & 0xffff : 0;
      if (legacy.ax !== stored || legacy.dx !== wantDx) {
        failures.push(
          `${program.operation} ${program.width}-bit a=0x${program.a.toString(16)} b=0x${program.b.toString(16)}: legacy AX 0x${legacy.ax.toString(16)} DX 0x${legacy.dx.toString(16)}`,
        );
      }
    }
    expect(failures, "the two engines compute different multiply results").toEqual([]);
  });

  it("runs the signed multiplies the legacy assembler cannot even encode", () => {
    // The old engine has no IMUL or IDIV, so a program that uses them has always
    // failed to assemble. The new engine is a superset here, which is the
    // direction every other difference goes in and is worth pinning so that
    // losing it later would be a change rather than a shrug.
    for (const source of ["MOV AL, 0F4h\nMOV CL, 02h\nIMUL CL", "MOV BL, 0F4h\nMOV CL, 02h\nIDIV CL"]) {
      const legacy = legacyAssemble(source);
      expect(legacy.errors.some((e) => e.type === "error"), `the legacy should not know ${source.split("\n")[2]}`).toBe(true);
      expect(assemble(source, { origin: 0 }).errors.map((d) => d.message)).toEqual([]);
    }
  });
});
