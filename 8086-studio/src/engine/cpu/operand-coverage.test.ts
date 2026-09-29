/**
 * Coverage: every operand the decoder can produce, and what the CPU does with it.
 *
 * `readOperand` and `writeOperand` used to return 0 and do nothing for a kind
 * they had no case for, and that turned two real bugs into silent ones:
 *
 *   - `MOV [0200h], AX` (A3) picked the wrong operand slot, so the store went
 *     to AX and the program lost its data with nothing to show for it.
 *   - `MOV ES, AX` (8E) has the same ModR/M shape as `MOV r/m, imm`, so it ran
 *     as that and wrote AX to itself, leaving the segment where it was.
 *
 * Neither is findable by reading the code, because in both cases the code is a
 * plausible-looking `if` that is simply wrong. The two tests below are what make
 * the class findable:
 *
 *   1. Walk the whole instruction table, encode one representative of every
 *      entry, decode it, and collect every operand kind that comes out. That set
 *      is pinned. A new kind in the decoder fails here, and the failure names it.
 *   2. Execute every one of those instructions and require the CPU not to have
 *      given up on an operand. The default branch of the operand switches throws
 *      rather than returning 0, so a kind the CPU cannot handle shows up as
 *      `state.error` naming the kind instead of as a quiet wrong answer.
 *
 * They point in opposite directions on purpose. The first fails when the
 * decoder knows something new; the second fails when the CPU does not. Neither
 * can fail on its own.
 */

import { describe, expect, it } from "vitest";
import { INSTRUCTION_TABLE, type InsnDef } from "../isa/table";
import { decode, type DecodedOperand } from "./decode";
import { Cpu, createInitialState } from "./cpu";
import { Memory } from "../memory";

const ORIGIN = 0x100;

/**
 * The operand kinds `readOperand` and `writeOperand` resolve between them.
 *
 * `none` is here because an instruction such as `HLT` really does decode to an
 * operand list containing it, and reading one has to be a no-op rather than a
 * crash: `cpu.test.ts` runs DAA, AAA, MOVSB and the rest through the same
 * switch.
 */
const RESOLVED: readonly DecodedOperand["kind"][] = [
  "farptr",
  "imm",
  "mem",
  "moffs",
  "none",
  "reg16",
  "reg8",
  "rel",
  "sreg",
];

/** Bytes of a given width, filled with something recognisable. */
function filler(size: 8 | 16): number[] {
  return size === 8 ? [0x11] : [0x11, 0x22];
}

/**
 * Table entries the decoder cannot reach, and the opcode each one is under.
 *
 * The near conditional jumps occupy 0x80-0x8F, and on an 8086 most of those
 * bytes are already spoken for: 0x80-0x83 are the arithmetic group and 0x8F is
 * `POP r/m16`. `JNO NEAR` and `JG NEAR` therefore live under a group opcode, and
 * the decoder takes the group -- which is right, because that is what the bytes
 * are. GNU as only emits those two for `jcc near` against a 32-bit target, which
 * is not 8086 code, and decode.test.ts excludes them for the same reason.
 *
 * Pinned here by name so a *new* collision cannot arrive unnoticed: the test
 * below fails if the set of unreachable entries is not exactly this one.
 */
const SHADOWED = new Map<string, string>([
  ["JNO/81", "0x81 is the 16-bit immediate arithmetic group"],
  ["JG/8F", "0x8F is POP r/m16"],
]);

/**
 * One representative encoding for a table entry.
 *
 * The register-direct ModR/M form (mod=11) is used wherever it is legal, so
 * nothing here needs a displacement. `mod3Forbidden` entries -- LEA and the
 * string destination forms -- take mod=00 with r/m=110, which is `[BP]` and
 * therefore also needs no displacement bytes. That keeps the synthesised
 * length exactly the length the encoder would produce, which is what lets the
 * decode be trusted.
 */
function encodeOne(def: InsnDef): number[] {
  const bytes = [...def.bytes];

  // 0x40-0x4F and friends: the register is the low three bits of the opcode.
  if (def.opcodeReg !== undefined) {
    const last = bytes.length - 1;
    bytes[last] = (bytes[last] & 0xf8) | (def.opcodeReg.code & 7);
  }

  const shape = def.modrm;
  if (shape !== undefined) {
    // A group instruction takes its /digit from the reg field; for every other
    // shape the reg field is an operand's register, and 0 (AX/AL) will do.
    const reg = shape.digit ?? 0;
    const mod = shape.mod3Forbidden ? 0b00 : 0b11;
    const rm = shape.mod3Forbidden ? 0b110 : 0b000;
    bytes.push((mod << 6) | (reg << 3) | rm);
  }

  // Trailing fields, in the order the decoder reads them: it walks the operand
  // list in slot order, and ENTER is the only entry with two of them.
  if (def.imm !== undefined) bytes.push(...filler(def.imm.size));
  if (def.imm2 !== undefined) bytes.push(...filler(def.imm2.size));
  if (def.moffs !== undefined) bytes.push(...filler(16));
  if (def.rel !== undefined) bytes.push(...filler(def.rel.size));
  if (def.ptr !== undefined) bytes.push(...filler(16), ...filler(16));
  return bytes;
}

interface Sampled {
  def: InsnDef;
  bytes: number[];
  instruction: ReturnType<typeof decode>;
}

/** One decodeable instruction per table entry, with anything that failed kept. */
const SAMPLED: Sampled[] = INSTRUCTION_TABLE.map((def) => {
  const bytes = encodeOne(def);
  return { def, bytes, instruction: decode(new Uint8Array(bytes)) };
});

/** Every kind of operand the decoder produced, sorted. */
function producedKinds(): DecodedOperand["kind"][] {
  const kinds = new Set<DecodedOperand["kind"]>();
  for (const { instruction } of SAMPLED) {
    if (!instruction.ok) continue;
    for (const operand of instruction.operands) kinds.add(operand.kind);
  }
  return [...kinds].sort();
}

/**
 * A CPU set up so that the sampled instructions run rather than fault on
 * something incidental: CX is 1 so a REP prefix has work to do, the divisor
 * registers are non-zero so a DIV does not trap, and nothing points at an
 * uninitialised segment. The point is to reach the operand code, not to produce
 * a meaningful end state.
 */
function freshCpu(bytes: number[]): Cpu {
  const memory = new Memory();
  memory.bytes.set(bytes, ORIGIN);
  return new Cpu(memory, {
    ...createInitialState(),
    IP: ORIGIN,
    SP: 0xfffe,
    CX: 1,
    BX: 0x200,
    DX: 0x300,
    SI: 0x310,
    DI: 0x320,
    BP: 0x330,
  });
}

describe("operand coverage: the decoder's operand kinds", () => {
  it("reaches every instruction in the table apart from the documented shadows", () => {
    // Without this, "every kind" would quietly mean "every kind the table
    // happens to be shaped so that this generator can reach", which is a
    // weaker claim than it looks. Listing what is missing, rather than skipping
    // it silently, is what makes the list above a statement about the ISA
    // instead of a gap in the test.
    const failed = SAMPLED.filter((s) => !s.instruction.ok).map(
      (s) => `${s.def.mnem}/${s.def.bytes[0].toString(16).toUpperCase()}`,
    );
    expect(failed.sort()).toEqual([...SHADOWED.keys()].sort());
  });

  it("says why each shadowed entry is shadowed", () => {
    // A reason is not decoration: it is what tells a reader that 0x81/0x8F is a
    // known collision rather than a decoder that has lost an opcode.
    for (const reason of SHADOWED.values()) expect(reason).toMatch(/^0x[0-9A-F]{2} is /);
  });

  it("produces only kinds the CPU knows how to resolve", () => {
    // A new kind added to DecodedOperand shows up here by name, which is the
    // whole point: the failure says which kind needs a case in the CPU.
    expect(producedKinds()).toEqual([...RESOLVED].sort());
  });

  it("produces the memory kinds separately, because they are separate", () => {
    // `mem` comes from a ModR/M byte and `moffs` from an offset in the
    // instruction stream. They are handled by the same case, and the test that
    // would notice if they ever stopped being the same case is in cpu.test.ts.
    const kinds = new Set<DecodedOperand["kind"]>();
    for (const { instruction } of SAMPLED) {
      if (!instruction.ok) continue;
      for (const operand of instruction.operands) kinds.add(operand.kind);
    }
    expect(kinds.has("mem")).toBe(true);
    expect(kinds.has("moffs")).toBe(true);
  });
});

describe("operand coverage: the CPU executes every instruction it can decode", () => {
  it("never gives up on an operand", () => {
    const problems: string[] = [];
    for (const { def, bytes, instruction } of SAMPLED) {
      if (!instruction.ok) continue;
      const cpu = freshCpu(bytes);
      // Two steps: the first decodes and executes, and the second catches a
      // fault raised on the trailing instruction the fetch pulled in.
      cpu.step();
      cpu.step();
      const error = cpu.state.error ?? "";
      if (/cannot (read|write) a/.test(error)) {
        problems.push(`${def.mnem}: ${error}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("stops with a message rather than continuing when it cannot resolve one", () => {
    // The white-box half of the same guarantee. The union is closed, so nothing
    // the decoder can currently produce reaches the default branch; this asserts
    // what happens if something ever does, which is the difference between a
    // loud failure and the bug this file is about.
    const cpu = freshCpu([0xf4]);
    const read = cpu as unknown as { readOperand(operand: DecodedOperand): number };
    const write = cpu as unknown as { writeOperand(operand: DecodedOperand, value: number): void };
    const impossible = { kind: "not-an-operand" } as unknown as DecodedOperand;
    expect(() => read.readOperand(impossible)).toThrow(/cannot read a "not-an-operand" operand/);
    expect(() => write.writeOperand(impossible, 0)).toThrow(/cannot write a "not-an-operand" operand/);
  });
});
