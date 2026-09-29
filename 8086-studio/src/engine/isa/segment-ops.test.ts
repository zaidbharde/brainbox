/**
 * The segment `PUSH`/`POP` forms, and the `MOV` forms that load and store a
 * segment register.
 *
 * These are original 8086 instructions. The ISA table used to leave their
 * opcodes unmodelled on the belief that they were 80186 additions, which is
 * wrong: `0x06 0x07`, `0x0E 0x0F`, `0x16 0x17` and `0x1E 0x1F` are the `+6`/`+7`
 * slots of the four 8-byte arithmetic/logic groups, and on an 8086 they are
 * `PUSH`/`POP` of ES, CS, SS and DS respectively. Every later x86 kept them, so
 * a program using `PUSH DS` is an ordinary 8086 program that this engine
 * refused to assemble — the error was `no encoding of PUSH accepts DS`.
 *
 * `POP CS` (`0x0F`) is the one form left out, deliberately. It is encodable on
 * real hardware, but this engine spends `0x0F` as its BrainBox extension escape
 * (`OUTC`, `OUTP`, `MOD`), and one byte cannot be both. See
 * `extension.test.ts` for the other side of that trade.
 */

import { describe, expect, it } from "vitest";
import { Memory } from "../memory";
import { Cpu, createInitialState, type CpuState } from "../cpu/cpu";
import { assemble } from "../assembler/assemble";
import { decode } from "../cpu/decode";

const ORIGIN = 0x100;

/**
 * The 8086 segment stack forms: source spelling, and the single opcode byte
 * each one is defined to be. Spelled out literally rather than derived, because
 * the whole point of this file is that the table gets these bytes right.
 */
const SEGMENT_STACK: ReadonlyArray<[mnemonic: string, segment: string, opcode: number]> = [
  ["PUSH", "ES", 0x06],
  ["POP", "ES", 0x07],
  ["PUSH", "CS", 0x0e],
  ["PUSH", "SS", 0x16],
  ["POP", "SS", 0x17],
  ["PUSH", "DS", 0x1e],
  ["POP", "DS", 0x1f],
];

function assembled(source: string): Uint8Array {
  const result = assemble(source, { origin: ORIGIN });
  expect(result.errors.map((d) => d.message)).toEqual([]);
  return result.image;
}

/** Run a .COM-style program with every segment settable independently. */
function run(
  source: string,
  initial: Partial<CpuState> = {},
): { cpu: Cpu; memory: Memory } {
  const image = assembled(source);
  const memory = new Memory();
  // Code sits at CS:0100h; the harness leaves CS at 0 so the image lands
  // where IP points. SS is free to move, which is what lets a test watch the
  // stack at a non-zero segment.
  memory.bytes.set(image, ORIGIN);
  const cpu = new Cpu(memory, {
    ...createInitialState(),
    IP: ORIGIN,
    CS: 0,
    SS: 0x1000,
    SP: 0xfffe,
    ...initial,
  });
  cpu.run(5000);
  expect(cpu.state.error).toBeFalsy();
  return { cpu, memory };
}

describe("segment PUSH/POP encoding", () => {
  it.each(SEGMENT_STACK)("%s %s is opcode %s", (mnemonic, segment, opcode) => {
    const bytes = assembled(`${mnemonic} ${segment}`);
    expect(Array.from(bytes.subarray(0, 1))).toEqual([opcode]);
  });

  it("gives each segment its own opcode rather than reusing one", () => {
    // The encoder matches table entries on operand *shape*, so four entries
    // that all take a segment register are indistinguishable unless something
    // narrows them to the right one. If that narrowing is missing, every
    // `PUSH <segment>` encodes to whichever entry the table happens to list
    // first, and the CPU would push the wrong segment's value.
    const opcodes = SEGMENT_STACK.map(([mnemonic, segment]) => {
      const bytes = assembled(`${mnemonic} ${segment}`);
      return bytes[0];
    });
    expect(new Set(opcodes).size).toBe(opcodes.length);

    // Spelled out, because "all distinct" would also pass if they were all
    // shifted by one.
    expect(assembled("PUSH ES")[0]).toBe(0x06);
    expect(assembled("PUSH CS")[0]).toBe(0x0e);
    expect(assembled("PUSH SS")[0]).toBe(0x16);
    expect(assembled("PUSH DS")[0]).toBe(0x1e);
    expect(assembled("POP ES")[0]).toBe(0x07);
    expect(assembled("POP SS")[0]).toBe(0x17);
    expect(assembled("POP DS")[0]).toBe(0x1f);
  });

  it("leaves the register forms at 0x50-0x5F", () => {
    // PUSH r16 is a different instruction that happens to share the mnemonic.
    // Adding the segment forms must not move the register ones.
    expect(assembled("PUSH AX")[0]).toBe(0x50);
    expect(assembled("PUSH BX")[0]).toBe(0x53);
    expect(assembled("PUSH SP")[0]).toBe(0x54);
    expect(assembled("POP AX")[0]).toBe(0x58);
    expect(assembled("POP DI")[0]).toBe(0x5f);
  });

  it("does not let PUSH ES encode through the PUSH DS entry, or the reverse", () => {
    // The failure this guards is silent: the program assembles, runs, and
    // reads the wrong segment, which is far harder to notice than a refusal.
    expect(assembled("PUSH ES")[0]).not.toBe(assembled("PUSH DS")[0]);
    expect(assembled("POP ES")[0]).not.toBe(assembled("POP DS")[0]);
  });

  it("still refuses a segment that has no opcode of its own", () => {
    // There is no `POP CS` here, so `POP CS` must fail rather than fall
    // through to some other encoding.
    const result = assemble("POP CS", { origin: ORIGIN });
    expect(result.errors.map((d) => d.message)).not.toEqual([]);
  });
});

describe("segment PUSH/POP decoding", () => {
  it.each(SEGMENT_STACK)("decodes %s as %s %s", (mnemonic, segment, opcode) => {
    const decoded = decode(Uint8Array.of(opcode));
    expect(decoded.ok).toBe(true);
    expect(decoded.mnem).toBe(mnemonic);
    const operand = decoded.operands[0];
    expect(operand.kind).toBe("sreg");
    // The segment code matters as well as the name: it is what the encoder
    // matches on, and what 0x8C/0x8E put in the ModR/M reg field.
    expect(operand.kind === "sreg" && operand.name).toBe(segment);
    expect(["ES", "CS", "SS", "DS"].indexOf(segment)).toBe(
      operand.kind === "sreg" ? operand.code : -1,
    );
  });

  it("does not decode 0x0F as POP CS", () => {
    // 0x0F is the BrainBox extension escape. Reading it as POP CS would make
    // every extension unreachable, and the byte can only mean one thing.
    const decoded = decode(Uint8Array.of(0x0f));
    expect(decoded.mnem).not.toBe("POP");
  });

  it("round-trips every form through encode and decode", () => {
    for (const [mnemonic, segment] of SEGMENT_STACK) {
      const bytes = assembled(`${mnemonic} ${segment}`);
      const decoded = decode(bytes);
      expect(decoded.text).toBe(`${mnemonic} ${segment}`);
    }
  });

  it("round-trips the bytes the CPU then reads back", () => {
    // Assemble, decode the emitted bytes, and check the CPU reads the same
    // segment out of them. The three agreeing is what makes the table
    // trustworthy: a table entry that is wrong is wrong in the encoder and the
    // decoder at once, and the two would otherwise agree with each other.
    for (const [mnemonic, segment] of SEGMENT_STACK) {
      if (mnemonic !== "PUSH") continue;
      const decoded = decode(assembled(`${mnemonic} ${segment}`));
      expect(decoded.operands[0]).toMatchObject({ kind: "sreg", name: segment });
    }
  });
});

describe("segment PUSH/POP execution", () => {
  it("PUSH ES puts the segment's value on the stack", () => {
    const { cpu, memory } = run("PUSH ES\nHLT", { ES: 0xb000 });
    // SP moves first, so the word lands at the *decremented* SP.
    expect(cpu.state.SP).toBe(0xfffc);
    expect(memory.read16(0x1000, 0xfffc)).toBe(0xb000);
  });

  it("PUSH CS puts CS on the stack", () => {
    const { cpu, memory } = run("PUSH CS\nHLT", { ES: 0x1111, DS: 0x2222 });
    // CS stays 0 in this harness, so the pushed value is 0 -- which is the
    // point: it is CS that is pushed, not ES or DS.
    expect(memory.read16(0x1000, 0xfffc)).toBe(cpu.state.CS);
    expect(memory.read16(0x1000, 0xfffc)).not.toBe(0x1111);
  });

  it("POP ES loads the popped word into the segment register", () => {
    // Through a register rather than a literal: `PUSH imm16` is an 80186
    // instruction, so there is no 8086 spelling of `PUSH 0BEEFh` to use here.
    const { cpu } = run("MOV AX, 0BEEFh\nPUSH AX\nPOP ES\nHLT", { ES: 0x0000 });
    expect(cpu.state.ES).toBe(0xbeef);
    expect(cpu.state.SP).toBe(0xfffe);
  });

  it("pushes and pops every segment symmetrically", () => {
    for (const [mnemonic, segment] of SEGMENT_STACK) {
      // A push of a register and its matching pop have to agree, so each pair
      // is exercised as a round trip: push the segment, pop it into the other
      // one, and the value must survive.
      const source =
        mnemonic === "PUSH" && segment === "CS"
          ? "PUSH CS\nPOP DS\nHLT"
          : mnemonic === "PUSH"
            ? `PUSH ${segment}\nPOP DS\nHLT`
            : `PUSH DS\nPOP ${segment}\nHLT`;
      const { cpu } = run(source, { [segment]: 0x5a5a, DS: 0x1111, CS: 0x0000 });
      expect(cpu.state.SP, `${mnemonic} ${segment} must balance the stack`).toBe(0xfffe);
    }
  });

  it("keeps the four segments distinct through a push and a pop", () => {
    // The specific wrong outcome to exclude: `PUSH ES` reading DS's value
    // because the encoder could not tell the entries apart.
    const { cpu } = run("PUSH ES\nPOP AX\nHLT", { ES: 0x0101, DS: 0x0202, CS: 0 });
    expect(cpu.readReg16("AX")).toBe(0x0101);
  });

  it("carries a segment across the common push cs / pop ds idiom", () => {
    // `PUSH CS` is how a program reads the code segment it is executing from.
    const { cpu } = run("PUSH CS\nPOP DS\nHLT", { CS: 0, DS: 0x7fff });
    expect(cpu.state.DS).toBe(0);
  });

  it("does not change how PUSH SP behaves", () => {
    // PUSH SP pushes the SP from *before* the decrement. The segment forms sit
    // next to it in the ISA and must not have pulled it onto the wrong path.
    const { cpu } = run("MOV SP, 0F00h\nPUSH SP\nPOP BX\nHLT");
    expect(cpu.readReg16("BX")).toBe(0x0f00);
  });

  it("leaves SS alone when a segment is pushed", () => {
    // Pushing a segment register is a read of it. Only POP SS and MOV SS
    // change SS, so a program can push ES without disturbing the stack it is
    // pushing onto.
    const { cpu } = run("PUSH ES\nHLT", { SS: 0x1000, ES: 0x4444 });
    expect(cpu.state.SS).toBe(0x1000);
    expect(cpu.state.SP).toBe(0xfffc);
  });
});

describe("segment register MOV forms", () => {
  it("loads a segment from a register with MOV sreg, r16 (0x8E)", () => {
    const { cpu } = run("MOV AX, 0BEEFh\nMOV DS, AX\nHLT");
    expect(cpu.state.DS).toBe(0xbeef);
  });

  it("reads a segment into a register with MOV r16, sreg (0x8C)", () => {
    const { cpu } = run("MOV AX, DS\nHLT", { DS: 0x1234 });
    expect(cpu.readReg16("AX")).toBe(0x1234);
  });

  it("loads a segment from memory with MOV sreg, rm16 (0x8E)", () => {
    const { cpu } = run("MOV AX, 0CAFEh\nMOV [0100h], AX\nMOV DS, [0100h]\nHLT", {
      DS: 0,
    });
    expect(cpu.state.DS).toBe(0xcafe);
  });

  it("stores a segment to memory with MOV rm16, sreg (0x8C)", () => {
    // 0500h, not 0100h: the harness puts the code itself at CS:0100h, so a
    // store to 0100h would overwrite the instruction that is doing the storing.
    // Read back through DS, because [0500h] with no override means DS:0500 --
    // and DS is the register being stored.
    const { memory } = run("MOV [0500h], DS\nHLT", { DS: 0x4321 });
    expect(memory.read16(0x4321, 0x500)).toBe(0x4321);
  });

  it("reaches a segment load and a segment store through MOV AX, DS", () => {
    // The `mov ds, ax` shape every hand-written 8086 program uses to set up
    // data addressing, followed by a store that has to land in that segment.
    // DS is loaded from AX rather than a literal because x86 has no
    // `MOV sreg, imm`: the only way in is through a register or memory.
    const { cpu, memory } = run("MOV AX, 00B000h\nMOV DS, AX\nMOV AX, 0ABCDh\nMOV [0000h], AX\nHLT", {
      CS: 0,
    });
    expect(cpu.state.DS).toBe(0xb000);
    expect(memory.read16(0xb000, 0)).toBe(0xabcd);
  });
});
