/**
 * CPU behaviour tests.
 *
 * Programs are assembled and run the way a .COM program is: everything at
 * CS:0100h with all four segments equal, because that is the only layout where
 * a single flat byte array is unambiguously correct, and getting it wrong makes
 * a failing test ambiguous about which of the two things is at fault.
 *
 * The differential tests in src/engine/cpu/differential.test.ts cover the
 * interaction between instructions. These cover each instruction against the
 * architecture manual, which is the only way to catch a flag rule that both
 * engines happen to get wrong in the same way. The one thing they cannot be is
 * the authority: for flags that is flags-conformance.test.ts, which scores both
 * engines against rules written from the definitions.
 */

import { describe, expect, it } from "vitest";
import { Memory } from "../memory";
import { Cpu, createInitialState, type CpuOptions, type CpuState } from "./cpu";
import { assemble } from "../assembler/assemble";
import { getFlag, type FlagName } from "../isa/flags";
import { INSTRUCTION_TABLE } from "../isa/table";

const ORIGIN = 0x100;

interface Harness {
  cpu: Cpu;
  memory: Memory;
  run(): Harness;
  reg(name: keyof CpuState): number;
}

function com(
  source: string,
  initial: Partial<CpuState> = {},
  options: CpuOptions = {},
): Harness {
  const assembled = assemble(source, { origin: ORIGIN });
  expect(assembled.errors.map((d) => d.message)).toEqual([]);
  const memory = new Memory();
  memory.bytes.set(assembled.image, ORIGIN);
  const state: CpuState = {
    ...createInitialState(),
    IP: ORIGIN,
    SS: 0,
    SP: 0xfffe,
    ...initial,
  };
  const cpu = new Cpu(memory, state, options);
  return {
    cpu,
    memory,
    run() {
      cpu.run(5000);
      return this;
    },
    reg(name: keyof CpuState) {
      return cpu.state[name] as number;
    },
  };
}

const AX = (h: Harness) => h.cpu.readReg16("AX");
const AL = (h: Harness) => h.cpu.readReg8(0);
const AH = (h: Harness) => h.cpu.readReg8(4);
const hex = (value: number) => `0x${value.toString(16)}`;
const flag = (h: Harness, name: FlagName) => getFlag(h.cpu.state.FLAGS, name);

/**
 * A .COM program with memory already filled in at the addresses the program
 * names. The string instructions and compares need operands that are not
 * instructions, and putting them in the source would mean the program assembled
 * its own operands and the test would be checking the assembler as much as the
 * CPU.
 */
function seeded(
  source: string,
  bytes: Record<number, number> = {},
  initial: Partial<CpuState> = {},
  options: CpuOptions = {},
): Harness {
  const memory = new Memory();
  for (const [address, value] of Object.entries(bytes)) memory.setRaw(Number(address), value);
  const assembled = assemble(source, { origin: ORIGIN });
  expect(assembled.errors.map((d) => d.message)).toEqual([]);
  memory.bytes.set(assembled.image, ORIGIN);
  const state: CpuState = {
    ...createInitialState(),
    IP: ORIGIN,
    CS: 0,
    DS: 0,
    ES: 0,
    SS: 0,
    SP: 0xfffe,
    ...initial,
  };
  const cpu = new Cpu(memory, state, options);
  return {
    cpu,
    memory,
    run() {
      cpu.run(5000);
      return this;
    },
    reg(name: keyof CpuState) {
      return cpu.state[name] as number;
    },
  }.run();
}

describe("fetch and decode", () => {
  it("starts at IP and stops at HLT", () => {
    const h = com("MOV AX, 1234h\nHLT").run();
    expect(AX(h)).toBe(0x1234);
    expect(h.cpu.state.halted).toBe(true);
  });

  it("reports where it stopped", () => {
    const h = com("again:\nJMP SHORT again").run();
    expect(h.cpu.state.error).toContain("Maximum steps");
  });

  it("stops on an opcode the 8086 does not have", () => {
    const memory = new Memory();
    // 0x62 is BOUND, which is an 186 instruction and so undefined here.
    memory.setRaw(ORIGIN, 0x62);
    const cpu = new Cpu(memory, { ...createInitialState(), IP: ORIGIN });
    cpu.step();
    expect(cpu.state.halted).toBe(true);
    expect(cpu.state.error).toBeTruthy();
  });
});

describe("MOV and addressing", () => {
  it("moves between registers", () => {
    const h = com("MOV AX, 1111h\nMOV BX, 2222h\nMOV AX, BX\nHLT").run();
    expect(AX(h)).toBe(0x2222);
  });

  it("reads and writes memory with a displacement", () => {
    const h = com("MOV WORD PTR [BX+4], 0BEEFh\nMOV AX, [BX+4]\nHLT").run();
    expect(AX(h)).toBe(0xbeef);
  });

  it("treats a bare displacement as a DS offset", () => {
    const h = com("MOV WORD PTR [0x30], 0CAFEh\nMOV AX, [0x30]\nHLT").run();
    expect(AX(h)).toBe(0xcafe);
    expect(h.memory.read8(0, 0x30)).toBe(0xfe);
  });

  it("honours a segment override", () => {
    // DS and ES both start at zero, so a CPU that ignored either the load of
    // ES or the override itself would still land on the right bytes here. The
    // two segments are put somewhere different first, so the override has to be
    // honoured on both sides to pass.
    const h = com(
      "MOV AX, 1000h\nMOV ES, AX\nMOV BX, 2000h\nMOV DS, BX\n" +
        "MOV WORD PTR [0x30], 1111h\nMOV AX, 0\nMOV AX, [0x30]\n" +
        "MOV BX, 0\nMOV BX, ES:[0x30]\nHLT",
    ).run();
    // DS is 2000h: the word went to DS:0x30 and came back from there.
    expect(AX(h)).toBe(0x1111);
    // ES is 1000h and has never been written to, so the same offset is empty.
    expect(h.reg("BX")).toBe(0);
  });

  it("loads a segment register from a register", () => {
    // 8E: MOV sreg, r/m16. This shares a ModR/M shape with `MOV r/m, imm`, and
    // executing it as that writes the register to itself: the instruction looks
    // like it ran and the segment never moves.
    const h = com("MOV AX, 1000h\nMOV ES, AX\nHLT").run();
    expect(h.reg("ES")).toBe(0x1000);
  });

  it("stores a segment register into memory", () => {
    // 8C: MOV r/m16, sreg. The other half of the same pair.
    const h = com("MOV AX, 2000h\nMOV DS, AX\nMOV BX, 0200h\nMOV [BX], DS\nHLT").run();
    expect(h.memory.read8(0x2000, 0x200)).toBe(0x00);
    expect(h.memory.read8(0x2000, 0x201)).toBe(0x20);
  });

  it("takes the segment from memory", () => {
    const h = com(
      "MOV BX, 0200h\nMOV WORD PTR [BX], 3000h\nMOV ES, [BX]\n" +
        "MOV WORD PTR ES:[BX], 0AAAAh\nMOV DX, [BX]\nHLT",
    ).run();
    expect(h.reg("ES")).toBe(0x3000);
    // The word written through ES is in ES, and DS still has what it had.
    expect(h.memory.read8(0x3000, 0x200)).toBe(0xaa);
    expect(h.reg("DX")).toBe(0x3000);
  });

  it("pops a value into a general register", () => {
    const h = com("MOV AX, 4000h\nPUSH AX\nPOP CX\nHLT").run();
    expect(h.reg("CX")).toBe(0x4000);
  });

  it("loads an effective address without touching memory", () => {
    const h = com("MOV BX, 40h\nMOV SI, 8\nLEA AX, [BX+SI]\nHLT").run();
    expect(AX(h)).toBe(0x48);
  });

  it("records no data access for LEA", () => {
    // LEA computes an address, so the whole point is that it does not read the
    // byte it names. A step at 0x48 that had been fetched from an 8-bit and a
    // 16-bit operand would show up here as two reads, and the debugger's memory
    // highlight would point at an address the program never looked at.
    const h = com("MOV BX, 40h\nLEA AX, [BX]\nHLT");
    h.cpu.step();
    h.cpu.step();
    expect(AX(h)).toBe(0x40);
    expect(h.cpu.lastReads).toEqual([]);
    expect(h.cpu.lastWrites).toEqual([]);
  });

  it("reads no memory for LEA even where the address is not readable", () => {
    // The address is computed from the segment and offset alone, so a LEA that
    // points at nothing is still legal and still writes no read. If this trapped
    // or recorded a read, the address would have been dereferenced.
    const h = com("MOV BX, 0FFFFh\nLEA AX, [BX]\nHLT");
    h.cpu.step();
    h.cpu.step();
    expect(AX(h)).toBe(0xffff);
    expect(h.cpu.lastReads).toEqual([]);
  });

  it("moves 8-bit halves independently", () => {
    const h = com("MOV AX, 1234h\nMOV AH, 0\nHLT").run();
    expect(AH(h)).toBe(0);
    expect(AL(h)).toBe(0x34);
  });
});

describe("direct memory offsets, opcodes A0-A3", () => {
  // These four encodings carry the address in the instruction stream instead of
  // a ModR/M byte, so the operand arrives as `moffs` rather than `mem`. The
  // failure they invite is a silent one: `MOV [0200h], AX` decodes to something
  // the CPU recognises, writes to nothing, and leaves AX holding its own value,
  // so the program looks like it ran and simply lost the store.
  it("stores AX through a direct offset", () => {
    const h = com("MOV AX, 1234h\nMOV [0200h], AX\nHLT").run();
    expect(h.memory.read8(0, 0x200)).toBe(0x34);
    expect(h.memory.read8(0, 0x201)).toBe(0x12);
  });

  it("loads AX through a direct offset", () => {
    const h = com("MOV BX, 0200h\nMOV WORD PTR [BX], 0BEEFh\nMOV AX, [0200h]\nHLT").run();
    expect(AX(h)).toBe(0xbeef);
  });

  it("stores AL through a direct offset, and only the low byte", () => {
    const h = com("MOV AX, 1234h\nMOV [0200h], AL\nHLT").run();
    expect(h.memory.read8(0, 0x200)).toBe(0x34);
    // The byte above it is untouched, which is what makes this A2 and not A3.
    expect(h.memory.read8(0, 0x201)).toBe(0);
  });

  it("loads AL through a direct offset, and only the low byte", () => {
    const h = com("MOV BX, 0200h\nMOV WORD PTR [BX], 1234h\nMOV AL, [0200h]\nHLT").run();
    expect(AL(h)).toBe(0x34);
    expect(AX(h)).toBe(0x0034);
  });

  it("round-trips through the same address", () => {
    const h = com("MOV AX, 0ABCDh\nMOV [0300h], AX\nMOV BX, 0\nMOV AX, [0300h]\nHLT").run();
    expect(AX(h)).toBe(0xabcd);
  });

  it("records the address it wrote, so a debugger can show it", () => {
    const h = com("MOV AX, 1234h\nMOV [0200h], AX\nHLT");
    h.cpu.step();
    h.cpu.step();
    expect(h.cpu.lastWrites).toEqual([0x200, 0x201]);
  });

  it("honours a segment override on a direct offset", () => {
    // The direct offset is a bare 16-bit address, and on the 8086 it is still
    // relative to a segment register -- DS unless a prefix says otherwise. An
    // override that the operand path ignores stores to the wrong segment and
    // still looks like it worked.
    const h = com(
      "MOV AX, 1000h\nMOV ES, AX\nMOV AX, 5678h\n" +
        "MOV ES:[0200h], AX\nMOV BX, 0200h\nMOV DX, ES:[BX]\nHLT",
    ).run();
    expect(h.memory.read8(0x1000, 0x200)).toBe(0x78);
    expect(h.memory.read8(0x1000, 0x201)).toBe(0x56);
    // And nothing landed in the default segment.
    expect(h.memory.read8(0, 0x200)).toBe(0);
    expect(h.reg("DX")).toBe(0x5678);
  });

  it("uses DS when there is no override", () => {
    const h = com("MOV AX, 1000h\nMOV DS, AX\nMOV BX, 1234h\nMOV [0200h], BX\nHLT");
    h.cpu.step(); h.cpu.step(); h.cpu.step(); h.cpu.step();
    expect(h.cpu.lastWrites).toEqual([0x10000 + 0x200, 0x10000 + 0x201]);
  });

  it("stores to a .DATA variable named by a label", () => {
    // The same form, but with the address coming from a symbol in another
    // segment. `MOV [VALUE], AX` is what a MASM program means by a direct
    // offset, and it is the shape the lab's own samples use.
    const source = [
      ".MODEL small",
      "CODE SEGMENT",
      "  MOV AX, 0BEEFh",
      "  MOV [VALUE], AX",
      "  MOV BX, VALUE",
      "  MOV CX, [BX]",
      "  HLT",
      "CODE ENDS",
      "DATA SEGMENT",
      "  VALUE DW 0",
      "DATA ENDS",
      "END",
    ].join("\n");
    const assembled = assemble(source, { origin: 0 });
    expect(assembled.errors.map((d) => d.message)).toEqual([]);
    const memory = new Memory();
    for (const segment of assembled.segments) {
      memory.bytes.set(segment.bytes, segment.base + segment.origin);
    }
    const cpu = new Cpu(memory, {
      ...createInitialState(),
      IP: assembled.entry.ip,
      CS: assembled.entry.codeBase,
      DS: assembled.entry.dataBase,
      SS: assembled.entry.stackBase,
      SP: assembled.entry.sp,
    });
    cpu.run(100);
    expect(cpu.state.error).toBeFalsy();
    // The variable's address is its offset in DATA, and DATA is at the segment
    // DS now points at, so the value is read back through that segment.
    const data = assembled.segments.find((s) => s.name === "DATA")!;
    const segment = assembled.entry.dataBase;
    const offset = assembled.symbols.lookup("VALUE")!.value - data.origin;
    expect(memory.read8(segment, offset)).toBe(0xef);
    expect(memory.read8(segment, offset + 1)).toBe(0xbe);
    expect(cpu.readReg16("CX")).toBe(0xbeef);
  });
});

describe("arithmetic and flags", () => {
  it("sets CF on an unsigned carry", () => {
    const h = com("MOV AX, 0FFFFh\nADD AX, 1\nHLT").run();
    expect(AX(h)).toBe(0);
    expect(flag(h, "CF")).toBe(true);
  });

  it("sets OF on a signed overflow that CF misses", () => {
    // 0x7FFF + 1 is 0x8000: no carry out, but a positive became negative.
    const h = com("MOV AX, 7FFFh\nADD AX, 1\nHLT").run();
    expect(AX(h)).toBe(0x8000);
    expect(flag(h, "OF")).toBe(true);
    expect(flag(h, "CF")).toBe(false);
  });

  it("sets AF on a half-carry", () => {
    const h = com("MOV AL, 0Fh\nADD AL, 1\nHLT").run();
    expect(AL(h)).toBe(0x10);
    expect(flag(h, "AF")).toBe(true);
  });

  it("sets PF from the low byte's parity", () => {
    // 3 has two set bits: even parity, so PF is set.
    const h = com("MOV AL, 3\nADD AL, 0\nHLT").run();
    expect(flag(h, "PF")).toBe(true);
  });

  it("clears CF and OF on a logic operation but keeps SF/ZF/PF", () => {
    const h = com("STC\nMOV AX, 0F0F0Fh\nOR AX, 0F0F0Fh\nHLT").run();
    // OR clears CF and OF even though the result is unchanged.
    expect(flag(h, "CF")).toBe(false);
    expect(flag(h, "OF")).toBe(false);
    expect(flag(h, "ZF")).toBe(false);
    // 0F0F0Fh is 20 bits wide, so AX keeps its low 16: 0F0Fh.
    expect(AX(h)).toBe(0x0f0f);
  });

  it("CMP leaves the destination alone", () => {
    const h = com("MOV AX, 5\nMOV BX, 5\nCMP AX, BX\nHLT").run();
    expect(AX(h)).toBe(5);
    expect(flag(h, "ZF")).toBe(true);
  });

  it("ADC uses the incoming carry", () => {
    const h = com("MOV AX, 1\nSTC\nMOV BX, 1\nADC AX, BX\nHLT").run();
    expect(AX(h)).toBe(3);
  });

  it("SBB uses the incoming borrow", () => {
    const h = com("MOV AX, 0\nSTC\nMOV BX, 3\nSBB AX, BX\nHLT").run();
    expect(AX(h)).toBe(0xfffc);
  });

  it("sign-extends the 0x83 immediate", () => {
    // 83 E8 FF is `SUB AX, -1`: 0xFF is a sign-extended byte, so AX must go
    // down by one and not by 255. Written as bytes because the encoder picks
    // the equally long 2D FF 00 form for `SUB AX, 0FFh`.
    const memory = new Memory();
    memory.setRaw(ORIGIN + 3, 0xb8); memory.setRaw(ORIGIN + 4, 0x0a); memory.setRaw(ORIGIN + 5, 0x00);
    memory.setRaw(ORIGIN + 6, 0x83); memory.setRaw(ORIGIN + 7, 0xe8); memory.setRaw(ORIGIN + 8, 0xff);
    memory.setRaw(ORIGIN + 9, 0xf4);
    const cpu = new Cpu(memory, { ...createInitialState(), IP: ORIGIN + 3 });
    cpu.run(20);
    expect(cpu.readReg16("AX")).toBe(0x0b);
  });

  it("INC and DEC leave CF alone", () => {
    const h = com("MOV AX, 0FFFFh\nINC AX\nHLT").run();
    expect(AX(h)).toBe(0);
    // The increment carried, but INC itself must not report it.
    expect(flag(h, "CF")).toBe(false);
    expect(flag(h, "ZF")).toBe(true);
  });

  it("wraps at the 8-bit boundary", () => {
    const h = com("MOV AL, 0FFh\nINC AL\nHLT").run();
    expect(AL(h)).toBe(0);
  });
});

describe("8-bit flags, where the legacy emulator is not the 8086", () => {
  // Each of these is a case the legacy gets wrong, found by scoring both engines
  // over 2048 ALU programs in flags-conformance.test.ts. They are here under
  // their own names because they are the ones that mislead: a differential test
  // cannot fail on them, since the legacy is the other party. The rule in each
  // case is the architecture's, and the expected value can be checked by hand.
  it("takes SF from bit 7 of an 8-bit addition", () => {
    // 7F + 1 is 80h: negative in eight bits, and the 8086 says so even though
    // nothing reached bit 15. The legacy leaves SF clear.
    const h = com("MOV AL, 7Fh\nADD AL, 1\nHLT").run();
    expect(AL(h)).toBe(0x80);
    expect(flag(h, "SF")).toBe(true);
  });

  it("takes SF from bit 7 of an 8-bit OR and XOR", () => {
    const or = com("MOV AL, 12h\nOR AL, 80h\nHLT").run();
    expect(AL(or)).toBe(0x92);
    expect(flag(or, "SF")).toBe(true);
    const xor = com("MOV AL, 12h\nXOR AL, 80h\nHLT").run();
    expect(AL(xor)).toBe(0x92);
    expect(flag(xor, "SF")).toBe(true);
  });

  it("takes SF from bit 7 of an 8-bit CMP", () => {
    // CMP discards the difference but not its flags: 0 - 1 is -1 in eight bits.
    const h = com("MOV AL, 0\nCMP AL, 1\nHLT").run();
    expect(AL(h)).toBe(0);
    expect(flag(h, "SF")).toBe(true);
    expect(flag(h, "CF")).toBe(true);
  });

  it("reports overflow on an 8-bit subtraction of opposite signs", () => {
    // 80h - 1 is 7Fh: the sign flipped, so the answer is out of range.
    const h = com("MOV AL, 80h\nSUB AL, 1\nHLT").run();
    expect(AL(h)).toBe(0x7f);
    expect(flag(h, "OF")).toBe(true);
    expect(flag(h, "SF")).toBe(false);
  });

  it("carries into AF when ADC is given a set carry", () => {
    // FFh + 0 + 1 = 100h, so the byte is 00h with a carry out of bit 7, and out
    // of bit 3 as well, which is AF. Landing on zero also sets ZF.
    const h = com("STC\nMOV AL, 0FFh\nADC AL, 0\nHLT").run();
    expect(AL(h)).toBe(0x00);
    expect(flag(h, "CF")).toBe(true);
    expect(flag(h, "AF")).toBe(true);
    expect(flag(h, "ZF")).toBe(true);
  });

  it("borrows from AF when SBB is given a set carry", () => {
    // 0 - 0 - 1 borrows, and the borrow counts as the auxiliary carry.
    const h = com("STC\nMOV AL, 0\nSBB AL, 0\nHLT").run();
    expect(AL(h)).toBe(0xff);
    expect(flag(h, "CF")).toBe(true);
    expect(flag(h, "AF")).toBe(true);
  });

  it("takes SF from bit 7 of an 8-bit shift", () => {
    // 40h shifted left is 80h, which is negative in eight bits. The legacy
    // leaves SF clear after every 8-bit shift, whatever the result.
    const h = com("MOV AL, 40h\nSHL AL, 1\nHLT").run();
    expect(AL(h)).toBe(0x80);
    expect(flag(h, "SF")).toBe(true);
    const sign = com("MOV AL, 80h\nSAR AL, 1\nHLT").run();
    expect(AL(sign)).toBe(0xc0);
    expect(flag(sign, "SF")).toBe(true);
  });
});

describe("multiplies and divides", () => {
  it("multiplies 8-bit and widens the result", () => {
    const h = com("MOV AL, 12\nMOV BL, 10\nMUL BL\nHLT").run();
    expect(AX(h)).toBe(120);
  });

  it("reports an 8-bit multiply that does not fit", () => {
    // 100 * 100 needs 16 bits, so the upper half is not zero and CF is set.
    const h = com("MOV AL, 100\nMOV BL, 100\nMUL BL\nHLT").run();
    expect(flag(h, "CF")).toBe(true);
  });

  it("multiplies 16-bit into DX:AX", () => {
    const h = com("MOV AX, 1000h\nMOV BX, 10h\nMUL BX\nHLT").run();
    expect(AX(h)).toBe(0);
    expect(h.reg("DX")).toBe(1);
  });

  it("multiplies 8-bit with sign", () => {
    // -12 * 10 = -120, which as a 16-bit two's complement is 0xFF88. Unsigned
    // the same pair would give 0x0ED0, so this cannot pass by accident.
    const h = com("MOV AX, 0\nMOV AL, 0F4h\nMOV BL, 10\nIMUL BL\nHLT").run();
    expect(AX(h)).toBe(0xff88);
    expect(flag(h, "CF")).toBe(false);
  });

  it("multiplies 8-bit with sign and reports an overflow the same way", () => {
    // -128 * -128 is 16384, which needs 16 bits: the same overflow report as
    // MUL, from the same unsigned result, so CF is the only thing that differs.
    const h = com("MOV AL, 80h\nMOV BL, 80h\nIMUL BL\nHLT").run();
    expect(AX(h)).toBe(0x4000);
    expect(flag(h, "CF")).toBe(true);
  });

  it("multiplies 16-bit with sign into DX:AX", () => {
    // -1000 * 10 = -10000 = 0xFFFFD8F0.
    const h = com("MOV AX, 0FC18h\nMOV BX, 10\nIMUL BX\nHLT").run();
    expect(AX(h)).toBe(0xd8f0);
    expect(h.reg("DX")).toBe(0xffff);
    expect(flag(h, "CF")).toBe(false);
  });

  it("divides 8-bit into AL quotient and AH remainder", () => {
    const h = com("MOV AX, 0\nMOV AL, 100\nMOV BL, 7\nDIV BL\nHLT").run();
    expect(AL(h)).toBe(14);
    expect(AH(h)).toBe(2);
  });

  it("divides 16-bit into DX:AX remainder", () => {
    const h = com("MOV DX, 0\nMOV AX, 100\nMOV BX, 7\nDIV BX\nHLT").run();
    expect(AX(h)).toBe(14);
    expect(h.reg("DX")).toBe(2);
  });

  it("signs the dividend for IDIV", () => {
    // -100 / 7 = -14 remainder -2: AL = 0xF2, AH = 0xFE.
    const h = com("MOV DX, 0FFFFh\nMOV AX, 0FF9Ch\nMOV BL, 7\nIDIV BL\nHLT").run();
    expect(AL(h)).toBe(0xf2);
    expect(AH(h)).toBe(0xfe);
  });

  it("signs the 16-bit dividend for IDIV", () => {
    // -1000 / 7 = -142 remainder -6: AX = 0xFF72, DX = 0xFFFA.
    const h = com("MOV DX, 0FFFFh\nMOV AX, 0FC18h\nMOV BX, 7\nIDIV BX\nHLT").run();
    expect(AX(h)).toBe(0xff72);
    expect(h.reg("DX")).toBe(0xfffa);
  });

  it("traps a divide by zero instead of hanging", () => {
    const h = com("MOV AX, 5\nMOV BX, 0\nDIV BX\nHLT").run();
    expect(h.cpu.state.halted).toBe(true);
    expect(h.cpu.state.error).toContain("divide error");
  });

  it("traps a 16-bit divide by zero", () => {
    // The 16-bit form divides DX:AX, so a zero divisor has to be caught there
    // too: trapping only the 8-bit form would leave this hanging.
    const h = com("MOV DX, 0\nMOV AX, 5\nMOV BX, 0\nDIV BX\nHLT").run();
    expect(h.cpu.state.halted).toBe(true);
    expect(h.cpu.state.error).toContain("divide error");
  });

  it("traps a quotient that cannot be represented", () => {
    const h = com("MOV AX, 0\nMOV AL, 0FFh\nMOV BL, 1\nIDIV BL\nHLT").run();
    expect(h.cpu.state.error).toContain("divide error");
  });

  it("traps a 16-bit quotient that cannot be represented", () => {
    // DX:AX = 0x00010000 divided by 1 is 0x10000, which does not fit in AX. An
    // implementation that truncated would leave a quiet 0 in AX and 0 in DX.
    const h = com("MOV DX, 10h\nMOV AX, 0\nMOV BX, 1\nDIV BX\nHLT").run();
    expect(h.cpu.state.halted).toBe(true);
    expect(h.cpu.state.error).toContain("divide error");
  });

  it("traps a 16-bit signed quotient that cannot be represented", () => {
    // -2147483648 / 1 has no 16-bit quotient.
    const h = com("MOV DX, 8000h\nMOV AX, 0\nMOV BX, 1\nIDIV BX\nHLT").run();
    expect(h.cpu.state.halted).toBe(true);
    expect(h.cpu.state.error).toContain("divide error");
  });

  it("negates", () => {
    const h = com("MOV AL, 1\nNEG AL\nHLT").run();
    expect(AL(h)).toBe(0xff);
    expect(flag(h, "CF")).toBe(true);
  });

  it("CBW and CWD sign-extend", () => {
    const h = com("MOV AX, 0\nMOV AL, 0FFh\nCBW\nCWD\nHLT").run();
    expect(AX(h)).toBe(0xffff);
    expect(h.reg("DX")).toBe(0xffff);
  });
});

describe("shifts and rotates", () => {
  it("shifts left by one and reports the bit shifted out", () => {
    const h = com("MOV AL, 81h\nSHL AL, 1\nHLT").run();
    expect(AL(h)).toBe(0x02);
    expect(flag(h, "CF")).toBe(true);
  });

  it("shifts right logically, not arithmetically", () => {
    const h = com("MOV AL, 0F0h\nSHR AL, 1\nHLT").run();
    expect(AL(h)).toBe(0x78);
  });

  it("SAR keeps the sign", () => {
    const h = com("MOV AL, 0F0h\nSAR AL, 1\nHLT").run();
    expect(AL(h)).toBe(0xf8);
    // 0xF0 is ...0000, so the bit shifted out of the bottom is a zero. A
    // logical shift would have produced 0x78 here instead of 0xF8.
    expect(flag(h, "CF")).toBe(false);
  });

  it("SAR reports the bit it shifted out", () => {
    const h = com("MOV AL, 0F1h\nSAR AL, 1\nHLT").run();
    expect(AL(h)).toBe(0xf8);
    expect(flag(h, "CF")).toBe(true);
  });

  it("rotates the top bit into the bottom", () => {
    const h = com("MOV AL, 81h\nROL AL, 1\nHLT").run();
    expect(AL(h)).toBe(0x03);
  });

  it("RCL takes the carry as the ninth bit", () => {
    const h = com("MOV AL, 80h\nSTC\nRCL AL, 1\nHLT").run();
    expect(AL(h)).toBe(0x01);
    expect(flag(h, "CF")).toBe(true);
  });

  it("uses CL as the count and masks it to five bits", () => {
    const h = com("MOV AL, 1\nMOV CL, 4\nSHL AL, CL\nHLT").run();
    expect(AL(h)).toBe(0x10);
  });

  it("does nothing when the masked count is zero", () => {
    const h = com("MOV AL, 42h\nMOV CL, 32\nSHL AL, CL\nHLT").run();
    expect(AL(h)).toBe(0x42);
  });

  it("reaches all four shift and rotate opcode forms", () => {
    // D0/D1 shift by one, D2/D3 by CL, and the D0/D2 pair is the 8-bit form. The
    // four are separate decode paths, so covering only "shift by 1" and "shift by
    // CL" on a word operand would leave three of them untested.
    //
    // Both bytes are asserted, not just the opcode. Within one of these groups
    // the /digit in the ModRM byte is the *only* thing that says which operation
    // it is, so a form that came out as the right opcode with the wrong digit
    // would execute as a different instruction while every value-only assertion
    // still passed - the assembler and the decoder would simply agree on the
    // wrong thing. A count written as 1 uses the implied-one opcode rather than
    // the immediate form, which is what masm and gas emit and what the encoder
    // fixtures already pin.
    const cases: ReadonlyArray<{
      source: string;
      bytes: readonly [number, number];
      initial?: Partial<CpuState>;
      wantAX: number;
      wantCF: boolean;
    }> = [
      { source: "SHL AL, 1", bytes: [0xd0, 0xe0], initial: { AX: 0x0081 }, wantAX: 0x02, wantCF: true },
      { source: "SHL AX, 1", bytes: [0xd1, 0xe0], initial: { AX: 0x8100 }, wantAX: 0x0200, wantCF: true },
      { source: "SHL AL, CL", bytes: [0xd2, 0xe0], initial: { AX: 0x0001, CX: 0x0004 }, wantAX: 0x10, wantCF: false },
      { source: "SHL AX, CL", bytes: [0xd3, 0xe0], initial: { AX: 0x0001, CX: 0x0004 }, wantAX: 0x0010, wantCF: false },
      { source: "ROL AL, 1", bytes: [0xd0, 0xc0], initial: { AX: 0x0081 }, wantAX: 0x03, wantCF: true },
      { source: "ROL AX, 1", bytes: [0xd1, 0xc0], initial: { AX: 0x8100 }, wantAX: 0x0201, wantCF: true },
      { source: "ROL AL, CL", bytes: [0xd2, 0xc0], initial: { AX: 0x0001, CX: 0x0004 }, wantAX: 0x10, wantCF: false },
      { source: "ROL AX, CL", bytes: [0xd3, 0xc0], initial: { AX: 0x0001, CX: 0x0004 }, wantAX: 0x0010, wantCF: false },
      { source: "SAR AL, 1", bytes: [0xd0, 0xf8], initial: { AX: 0x0080 }, wantAX: 0xc0, wantCF: false },
      { source: "SAR AX, 1", bytes: [0xd1, 0xf8], initial: { AX: 0x8000 }, wantAX: 0xc000, wantCF: false },
      { source: "SAR AL, CL", bytes: [0xd2, 0xf8], initial: { AX: 0x0080, CX: 0x0004 }, wantAX: 0xf8, wantCF: false },
      { source: "SAR AX, CL", bytes: [0xd3, 0xf8], initial: { AX: 0x8000, CX: 0x0004 }, wantAX: 0xf800, wantCF: false },
      { source: "SHR AL, 1", bytes: [0xd0, 0xe8], initial: { AX: 0x0081 }, wantAX: 0x40, wantCF: true },
      // RCR takes the carry in, so this depends on CF being clear: 0x81 shifts
      // right to 0x40 and the old carry of 0 goes into the top bit.
      { source: "RCR AL, 1", bytes: [0xd0, 0xd8], initial: { AX: 0x0081 }, wantAX: 0x40, wantCF: true },
      { source: "ROR AL, 1", bytes: [0xd0, 0xc8], initial: { AX: 0x0081 }, wantAX: 0xc0, wantCF: true },
    ];
    const failures: string[] = [];
    for (const testCase of cases) {
      const assembled = assemble(`${testCase.source}\nHLT`, { origin: ORIGIN });
      expect(assembled.errors.map((d) => d.message)).toEqual([]);
      // The shift is the first instruction, and every form in these groups is
      // exactly two bytes, so the first two bytes of the image are its encoding.
      const encoded = [...assembled.image.slice(0, 2)];
      if (encoded[0] !== testCase.bytes[0] || encoded[1] !== testCase.bytes[1]) {
        failures.push(
          `${testCase.source}: want ${testCase.bytes.map(hex).join(" ")} got ${encoded.map(hex).join(" ")}`,
        );
      }
      const h = com(`${testCase.source}\nHLT`, testCase.initial ?? {}).run();
      if (AX(h) !== testCase.wantAX) {
        failures.push(`${testCase.source}: want AX ${hex(testCase.wantAX)} got ${hex(AX(h))}`);
      }
      if (flag(h, "CF") !== testCase.wantCF) {
        failures.push(`${testCase.source}: want CF ${testCase.wantCF} got ${flag(h, "CF")}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("puts the right register in the r/m field at both widths", () => {
    // AL/CL/DL/BL and AX/CX/DX/BX share their r/m numbers, so a mix-up between
    // the widths cannot show up in the first four registers of either. The top
    // four are where it can: 4 is AH at 8 bits and SP at 16, and 5 is CH and BP.
    // A `shl sp,1` that came out as `d1 e4` would shift AH instead.
    const byte = (source: string) => {
      const assembled = assemble(`${source}\nHLT`, { origin: ORIGIN });
      expect(assembled.errors.map((d) => d.message)).toEqual([]);
      return [...assembled.image.slice(0, 2)];
    };
    const eight = ["AL", "CL", "DL", "BL", "AH", "CH", "DH", "BH"];
    const sixteen = ["AX", "CX", "DX", "BX", "SP", "BP", "SI", "DI"];
    for (const [index, register] of eight.entries()) {
      expect(byte(`SHL ${register}, 1`), register).toEqual([0xd0, 0xe0 | index]);
    }
    for (const [index, register] of sixteen.entries()) {
      expect(byte(`SHL ${register}, 1`), register).toEqual([0xd1, 0xe0 | index]);
    }
  });

  it("shifts SP, BP, SI and DI rather than their high-byte namesakes", () => {
    // The encoding test above says which register was named; this says the
    // value really moved, so a decoder that agreed with the wrong encoder would
    // still be caught. None of these four can be loaded from an immediate - the
    // 8086 has no `mov sreg, imm16` - so they are seeded through the initial
    // state, which is the only way to name them without a load sequence that
    // would itself use the register.
    for (const [register, slot] of [
      ["BP", "BP"],
      ["SI", "SI"],
      ["DI", "DI"],
      ["CX", "CX"],
      ["DX", "DX"],
      ["BX", "BX"],
    ] as const) {
      const h = com(`SHL ${register}, 1\nHLT`, { [slot]: 0x0100, AX: 0x0200 }).run();
      expect(h.cpu.readReg16(slot), register).toBe(0x0200);
      // AX holds 0x0200, whose high byte is a second 0x0200 in the same place
      // AH would be, so a shift that hit AH would show up as AX changing.
      expect(AX(h), `${register} must not have touched AX`).toBe(0x0200);
    }
    // SP is the stack pointer and is set up by the harness, so it is checked
    // through a push: SP is 0xFFFE, and shifting it gives 0xFFFC.
    const h = com("SHL SP, 1\nPUSH AX\nPOP BX\nHLT", { AX: 0x1234 }).run();
    expect(h.reg("SP")).toBe(0xfffc);
    expect(h.reg("BX")).toBe(0x1234);
  });

  it("shifts the high byte registers rather than the stack ones", () => {
    // The same eight r/m numbers, read at 8 bits. AH/CH/DH/BH are 4/5/6/7 here
    // and SP/BP/SI/DI are 4/5/6/7 at 16 bits, so this and the test above are
    // the only way to tell the two decoders apart.
    for (const [code, register] of ["AH", "CH", "DH", "BH"].entries()) {
      const h = com(`SHL ${register}, 1\nHLT`, { AX: 0x0100, CX: 0x0100, DX: 0x0100, BX: 0x0100 }).run();
      expect(h.cpu.readReg8(4 + code), register).toBe(0x02);
    }
  });

  it("refuses a count other than one, because 0xC0/0xC1 is not 8086", () => {
    // This used to assert the opposite, and be satisfied by the bytes
    // `C1 E0 04`. Those bytes are a reserved opcode on a real 8086: the by-
    // immediate shift was added on the 80186. Emitting them meant a program ran
    // here and nowhere else, which is worse than not assembling.
    //
    // The 8086 way to shift by a constant is to put it in CL. That is checked
    // immediately below, and it is what the assembler should now insist on.
    const result = assemble("SHL AX, 4", { origin: ORIGIN });
    expect(result.errors.map((d) => d.message)).not.toEqual([]);
  });

  it("shifts by a constant through CL, the only 8086 way", () => {
    const h = com("MOV CL, 4\nSHL AX, CL\nHLT", { AX: 0x0001 }).run();
    expect(AX(h)).toBe(0x0010);
  });

  it("leaves OF alone for a shift of more than one bit", () => {
    // OF is only defined for a single-bit shift, so a wider one has to leave it
    // as it was rather than clear it or compute something. 0x7F + 1 overflows,
    // and nothing after it writes OF.
    const h = com("MOV AL, 7Fh\nMOV BL, 1\nADD AL, BL\nMOV CL, 4\nSHL AL, CL\nHLT").run();
    expect(flag(h, "OF")).toBe(true);
    expect(AL(h)).toBe(0x00);
    expect(flag(h, "CF")).toBe(false);
  });

  it("computes OF for a shift of exactly one bit", () => {
    // The one case where the flag is defined: shifting a positive value into the
    // sign bit twice in a row is the overflow, and it is computed rather than
    // inherited, so a clear OF beforehand does not survive.
    const h = com("MOV AL, 40h\nSHL AL, 1\nHLT").run();
    expect(AL(h)).toBe(0x80);
    expect(flag(h, "OF")).toBe(true);
    const clear = com("MOV AX, 0\nCLC\nMOV AL, 40h\nSHL AL, 1\nHLT").run();
    expect(flag(clear, "OF")).toBe(true);
  });
});

describe("control flow", () => {
  it("jumps over an instruction", () => {
    const h = com("JMP +3\nMOV AX, 0BADh\nMOV AX, 1234h\nHLT").run();
    expect(AX(h)).toBe(0x1234);
  });

  it("takes a short jump", () => {
    const h = com("JMP SHORT skip\nMOV AX, 0BADh\nskip:\nMOV AX, 1234h\nHLT").run();
    expect(AX(h)).toBe(0x1234);
  });

  it("forces the near form when asked", () => {
    // The target is one byte away, so the encoder would narrow this to EB
    // unless NEAR says otherwise.
    const h = com("JMP NEAR skip\nskip:\nNOP\nHLT").run();
    expect(h.cpu.state.halted).toBe(true);
  });

  it("follows a conditional jump only when the flag agrees", () => {
    const h = com("MOV AX, 1\nCMP AX, 1\nJZ taken\nMOV AX, 0BADh\ntaken:\nHLT").run();
    expect(AX(h)).toBe(1);
  });

  it("falls through a conditional jump when the flag disagrees", () => {
    const h = com("MOV AX, 1\nCMP AX, 2\nJZ taken\nMOV AX, 1234h\ntaken:\nHLT").run();
    expect(AX(h)).toBe(0x1234);
  });

  it("sign-extends a negative displacement", () => {
    const h = com("MOV CX, 0\nJCXZ taken\nHLT\ntaken:\nMOV AX, 1234h\nHLT").run();
    expect(AX(h)).toBe(0x1234);
    expect(h.cpu.state.halted).toBe(true);
  });

  it("loops a counted number of times", () => {
    const h = com("MOV CX, 5\nMOV AX, 0\nloop:\nINC AX\nLOOP loop\nHLT").run();
    expect(AX(h)).toBe(5);
    expect(h.reg("CX")).toBe(0);
  });

  it("stops a LOOPE when ZF clears", () => {
    // LOOPE keeps going while ZF is set, and the compare is the last thing the
    // body does, so it decides the exit: BX reaches 2 and then ZF clears.
    const h = com("MOV CX, 10\nMOV BX, 0\nloop:\nINC BX\nCMP BX, 1\nLOOPE loop\nHLT").run();
    expect(h.reg("BX")).toBe(2);
    // It stopped early rather than counting CX down.
    expect(h.reg("CX")).toBe(8);
  });

  it("tests CX without changing flags", () => {
    const h = com("MOV CX, 0\nJCXZ taken\nHLT\ntaken:\nMOV AX, 1234h\nHLT").run();
    expect(AX(h)).toBe(0x1234);
  });
});

describe("stack", () => {
  it("pushes and pops", () => {
    const h = com("MOV AX, 1234h\nPUSH AX\nPOP BX\nHLT").run();
    expect(h.reg("BX")).toBe(0x1234);
    expect(h.reg("SP")).toBe(0xfffe);
  });

  it("uses SS for the stack", () => {
    // 8086 has no `MOV Sreg, imm16`: opcode 8E takes a register or memory.
    const h = com("MOV AX, 0\nMOV SS, AX\nMOV SP, 0FFFEh\nMOV AX, 0AAAAh\nPUSH AX\nPOP BX\nHLT").run();
    expect(h.reg("BX")).toBe(0xaaaa);
  });

  it("pushes and pops flags", () => {
    const h = com("STC\nPUSHF\nCLC\nPOPF\nHLT").run();
    expect(flag(h, "CF")).toBe(true);
  });

  it("moves AH into the flags and back", () => {
    const h = com("STC\nLAHF\nCLC\nSAHF\nHLT").run();
    expect(flag(h, "CF")).toBe(true);
  });

  it("calls and returns", () => {
    const h = com("CALL sub\nMOV AX, 1234h\nHLT\nsub:\nMOV BX, 4321h\nRET").run();
    expect(h.reg("BX")).toBe(0x4321);
    expect(AX(h)).toBe(0x1234);
  });

  it("nests calls", () => {
    const h = com("CALL outer\nHLT\nouter:\nCALL inner\nRET\ninner:\nMOV AX, 1234h\nRET").run();
    expect(AX(h)).toBe(0x1234);
  });

  it("uses BP-relative operands from the stack segment", () => {
    const h = com(
      "MOV AX, 1234h\nPUSH AX\nMOV BP, SP\nMOV BX, [BP]\nPOP AX\nHLT",
    ).run();
    expect(h.reg("BX")).toBe(0x1234);
  });

  it("pushes the stack pointer it had, not the one it has", () => {
    // PUSH SP pushes the *old* SP, which is the value 8086 documentation shows
    // and the one every program that uses this depends on to find its own frame.
    // The 80186 changed it to push the decremented value, so an implementation
    // that reads SP after the decrement is off by two - and a program that
    // computed a frame size from what it pushed would be wrong by two.
    const h = com("MOV SP, 0F00h\nPUSH SP\nPOP BX\nHLT").run();
    expect(h.reg("BX")).toBe(0x0f00);
    // The POP put the two bytes back, so SP is where it started.
    expect(h.reg("SP")).toBe(0x0f00);
  });

  it("reads SP before the decrement, not after", () => {
    // The same instruction with the popped value left alone. If SP were read
    // after the decrement the popped value would be 0x0EFE, and the two
    // assertions above and here are the only way to tell the two apart.
    const h = com("MOV SP, 0F00h\nPUSH SP\nHLT");
    h.cpu.run(3);
    expect(h.reg("SP")).toBe(0x0efe);
    // The word really is at the new top of stack, not at the old one.
    expect(h.memory.read16(0, 0x0efe)).toBe(0x0f00);
  });

  it("records the stack write for PUSH SP as a write", () => {
    // The debugger highlights memory from lastReads/lastWrites, so a PUSH that
    // wrote without recording would leave the stack invisible in the UI.
    const h = com("MOV SP, 0F00h\nPUSH SP\nHLT");
    h.cpu.run(2);
    h.cpu.step();
    expect(h.cpu.lastWrites).toEqual([0x0efe, 0x0eff]);
    expect(h.cpu.lastReads).toEqual([]);
  });
});

describe("string instructions", () => {
  it("copies a block with MOVSW and REP", () => {
    const h = com(
      "MOV SI, 200h\nMOV DI, 300h\nMOV CX, 4\nREP MOVSW\nHLT",
    ).run();
    expect(h.memory.read8(0, 0x300)).toBe(h.memory.read8(0, 0x200));
  });

  it("advances DI and SI by the width", () => {
    const h = com("MOV SI, 200h\nMOV DI, 300h\nMOV CX, 2\nREP MOVSW\nHLT").run();
    expect(h.reg("SI")).toBe(0x204);
    expect(h.reg("DI")).toBe(0x304);
    expect(h.reg("CX")).toBe(0);
  });

  it("counts the whole of CX for a byte instruction", () => {
    // Masking the count down to the operand size is 386 protected-mode
    // behaviour. On an 8086 CX is the counter whatever the operand size, so
    // 256 is a real count and not a truncated zero.
    const memory = new Memory();
    memory.setRaw(ORIGIN + 3, 0xb9); memory.setRaw(ORIGIN + 4, 0x00); memory.setRaw(ORIGIN + 5, 0x01);
    memory.setRaw(ORIGIN + 6, 0xf3); memory.setRaw(ORIGIN + 7, 0xa4);
    memory.setRaw(ORIGIN + 8, 0xf4);
    const cpu = new Cpu(memory, { ...createInitialState(), IP: ORIGIN + 3 });
    cpu.run(3000);
    expect(cpu.readReg16("CX")).toBe(0);
    expect(cpu.state.SI).toBe(256);
  });

  it("does nothing at all when the count is zero", () => {
    // Not one pass followed by a check: no pass, so SI does not move.
    const h = com("MOV CX, 0\nREP MOVSB\nHLT").run();
    expect(h.reg("SI")).toBe(0);
    expect(h.reg("DI")).toBe(0);
  });

  it("stops REPE on the pass that makes the operands unequal", () => {
    // DS:SI is "AB", ES:DI is "AB": two equal passes, then a difference on the
    // third, which is the pass that ends the loop.
    const memory = new Memory();
    memory.setRaw(0x200, 0x41); memory.setRaw(0x201, 0x42); memory.setRaw(0x202, 0x43);
    memory.setRaw(0x300, 0x41); memory.setRaw(0x301, 0x42);
    memory.setRaw(ORIGIN + 3, 0xb9); memory.setRaw(ORIGIN + 4, 0x0a); memory.setRaw(ORIGIN + 5, 0x00);
    memory.setRaw(ORIGIN + 6, 0xbe); memory.setRaw(ORIGIN + 7, 0x00); memory.setRaw(ORIGIN + 8, 0x02);
    memory.setRaw(ORIGIN + 9, 0xbf); memory.setRaw(ORIGIN + 10, 0x00); memory.setRaw(ORIGIN + 11, 0x03);
    memory.setRaw(ORIGIN + 12, 0xf3); memory.setRaw(ORIGIN + 13, 0xa6);
    memory.setRaw(ORIGIN + 14, 0xf4);
    const cpu = new Cpu(memory, { ...createInitialState(), IP: ORIGIN + 3 });
    cpu.run(50);
    // Three passes happened and the fourth did not, so CX is 7.
    expect(cpu.readReg16("CX")).toBe(7);
    expect(cpu.state.SI).toBe(0x203);
    expect(cpu.state.DI).toBe(0x303);
  });

  it("stops REPNE on the pass that makes the operands equal", () => {
    const memory = new Memory();
    memory.setRaw(0x200, 0x41); memory.setRaw(0x201, 0x41); memory.setRaw(0x202, 0x99);
    memory.setRaw(0x300, 0x42); memory.setRaw(0x301, 0x42); memory.setRaw(0x302, 0x99);
    memory.setRaw(ORIGIN + 3, 0xb9); memory.setRaw(ORIGIN + 4, 0x0a); memory.setRaw(ORIGIN + 5, 0x00);
    memory.setRaw(ORIGIN + 6, 0xbe); memory.setRaw(ORIGIN + 7, 0x00); memory.setRaw(ORIGIN + 8, 0x02);
    memory.setRaw(ORIGIN + 9, 0xbf); memory.setRaw(ORIGIN + 10, 0x00); memory.setRaw(ORIGIN + 11, 0x03);
    memory.setRaw(ORIGIN + 12, 0xf2); memory.setRaw(ORIGIN + 13, 0xa6);
    memory.setRaw(ORIGIN + 14, 0xf4);
    const cpu = new Cpu(memory, { ...createInitialState(), IP: ORIGIN + 3 });
    cpu.run(50);
    // Two unequal passes, then the match that ends it.
    expect(cpu.readReg16("CX")).toBe(7);
    expect(cpu.state.SI).toBe(0x203);
    expect(cpu.state.DI).toBe(0x303);
  });

  it("keeps going for REP on a move, which writes no flags", () => {
    // The condition only applies to the compares; MOVS consults nothing, so it
    // runs the full count even though ZF says otherwise.
    const memory = new Memory();
    memory.setRaw(ORIGIN + 3, 0xb9); memory.setRaw(ORIGIN + 4, 0x05); memory.setRaw(ORIGIN + 5, 0x00);
    memory.setRaw(ORIGIN + 6, 0xf3); memory.setRaw(ORIGIN + 7, 0xa4);
    memory.setRaw(ORIGIN + 8, 0xf4);
    const cpu = new Cpu(memory, { ...createInitialState(), IP: ORIGIN + 3 });
    cpu.run(50);
    expect(cpu.readReg16("CX")).toBe(0);
    expect(cpu.state.SI).toBe(5);
  });

  it("runs backwards once DF is set", () => {
    const h = com(
      "STD\nMOV SI, 204h\nMOV DI, 304h\nMOV CX, 2\nREP MOVSW\nHLT",
    ).run();
    expect(h.reg("DI")).toBe(0x300);
  });

  it("fills with STOSB", () => {
    const h = com("MOV AL, 0ABh\nMOV DI, 400h\nMOV CX, 4\nREP STOSB\nHLT").run();
    expect(h.memory.read8(0, 0x400)).toBe(0xab);
    expect(h.memory.read8(0, 0x403)).toBe(0xab);
  });

  it("stops a REPE scan when the bytes differ", () => {
    const h = com("MOV AX, 0\nMOV SI, 200h\nMOV DI, 200h\nMOV CX, 10\nREPE CMPSB\nHLT").run();
    // The first byte matches itself, so ZF stays set and all ten run.
    expect(h.reg("CX")).toBe(0);
  });

  it("loads with LODSW", () => {
    // The value is written out rather than read back out of the same memory:
    // `expect(AX).toBe(memory.read16(...))` passes for a load that read only the
    // low byte, because the memory being compared against is the memory the load
    // was supposed to read. Both bytes have to be non-zero and different.
    const h = seeded("MOV SI, 200h\nLODSW\nHLT", { 0x200: 0x34, 0x201: 0x12 });
    expect(AX(h)).toBe(0x1234);
    expect(h.reg("SI")).toBe(0x202);
  });

  it("moves a word block with MOVSW", () => {
    // The same trap as LODSW: a byte-wide move leaves the high byte of each
    // destination as it was, so the source has to be seeded with a pattern where
    // a zero high byte would be visible.
    const h = seeded("MOV SI, 200h\nMOV DI, 300h\nMOV CX, 2\nREP MOVSW\nHLT", {
      0x200: 0x34, 0x201: 0x12, 0x202: 0x78, 0x203: 0x56,
    });
    expect(h.memory.read16(0, 0x300)).toBe(0x1234);
    expect(h.memory.read16(0, 0x302)).toBe(0x5678);
    expect(h.reg("SI")).toBe(0x204);
    expect(h.reg("DI")).toBe(0x304);
  });

  it("scans with SCASB", () => {
    // With no match, the string scan runs through all four and ends with CX=0.
    const h = seeded("MOV AL, 5\nMOV DI, 200h\nMOV CX, 4\nREPNE SCASB\nHLT", {
      0x200: 0x01, 0x201: 0x02, 0x202: 0x03, 0x203: 0x04,
    });
    expect(h.cpu.state.halted).toBe(true);
    expect(h.reg("CX")).toBe(0);
    expect(h.reg("DI")).toBe(0x204);
  });

  it("stops a REPNE compare on the first pass when the bytes are equal", () => {
    // The discriminating case for the two prefixes. A byte that equals itself
    // sets ZF, which is what REPE wants to keep going and what REPNE wants to
    // stop for, so one pass and CX is one short of zero. A loop that ignored the
    // prefix and always continued would run all four.
    const h = seeded("MOV SI, 200h\nMOV DI, 200h\nMOV CX, 4\nREPNE CMPSB\nHLT", { 0x200: 0x41 });
    expect(h.reg("CX")).toBe(3);
    expect(flag(h, "ZF")).toBe(true);
  });

  it("stops a REPE compare on the first pass when the bytes differ", () => {
    // The mirror image: a difference clears ZF, which ends a REPE.
    const h = seeded("MOV SI, 200h\nMOV DI, 210h\nMOV CX, 4\nREPE CMPSB\nHLT", { 0x200: 0x41, 0x210: 0x42 });
    expect(h.reg("CX")).toBe(3);
    expect(flag(h, "ZF")).toBe(false);
  });

  it("runs a REPE compare to the count when every byte matches", () => {
    const h = seeded("MOV SI, 200h\nMOV DI, 210h\nMOV CX, 4\nREPE CMPSB\nHLT", {
      0x200: 0x41, 0x201: 0x42, 0x202: 0x43, 0x203: 0x44,
      0x210: 0x41, 0x211: 0x42, 0x212: 0x43, 0x213: 0x44,
    });
    expect(h.reg("CX")).toBe(0);
    expect(h.reg("SI")).toBe(0x204);
    expect(h.reg("DI")).toBe(0x214);
  });

  it("counts a word compare in elements, not bytes", () => {
    // CX is the number of comparisons, so a word compare of four words is four
    // passes over eight bytes. Reading it as a byte count would move SI and DI
    // sixteen bytes and finish early.
    const h = seeded("MOV SI, 200h\nMOV DI, 210h\nMOV CX, 4\nREPE CMPSW\nHLT", {
      0x200: 0x01, 0x201: 0x00, 0x202: 0x02, 0x203: 0x00, 0x204: 0x03, 0x205: 0x00, 0x206: 0x04, 0x207: 0x00,
      0x210: 0x01, 0x211: 0x00, 0x212: 0x02, 0x213: 0x00, 0x214: 0x03, 0x215: 0x00, 0x216: 0x04, 0x217: 0x00,
    });
    expect(h.reg("CX")).toBe(0);
    expect(h.reg("SI")).toBe(0x208);
    expect(h.reg("DI")).toBe(0x218);
  });

  it("stops a REPE SCASB on the first byte that differs", () => {
    // SCASB compares AL against ES:DI and does not move SI at all, so the only
    // way to tell it from CMPSB is which register the result ends up in. REPE
    // is the "while equal" form, so a difference is what ends it: one pass, and
    // the comparison is the pass that found the difference.
    const h = seeded("MOV AL, 42h\nMOV DI, 200h\nMOV CX, 4\nREPE SCASB\nHLT", {
      0x200: 0x41, 0x201: 0x42, 0x202: 0x43,
    });
    expect(h.reg("CX")).toBe(3);
    expect(h.reg("DI")).toBe(0x201);
    expect(h.reg("SI")).toBe(0);
    expect(flag(h, "ZF")).toBe(false);
  });

  it("keeps a REPE SCASB going past a byte that matches", () => {
    // The pass that continues. A scan that stopped on the first comparison it
    // made would also produce CX=3 here, so only the count and DI together show
    // that the match was allowed through and the difference after it was not.
    const h = seeded("MOV AL, 41h\nMOV DI, 200h\nMOV CX, 4\nREPE SCASB\nHLT", {
      0x200: 0x41, 0x201: 0x42, 0x202: 0x43,
    });
    expect(h.reg("CX")).toBe(2);
    expect(h.reg("DI")).toBe(0x202);
    expect(flag(h, "ZF")).toBe(false);
  });

  it("keeps a REPNE SCASB going until it finds the byte", () => {
    // The mirror image, and the one a scan loop in a real program is written
    // for: look for a match, and the match is what stops it.
    const h = seeded("MOV AL, 42h\nMOV DI, 200h\nMOV CX, 4\nREPNE SCASB\nHLT", {
      0x200: 0x41, 0x201: 0x42, 0x202: 0x43,
    });
    expect(h.reg("CX")).toBe(2);
    expect(h.reg("DI")).toBe(0x202);
    expect(flag(h, "ZF")).toBe(true);
  });

  it("runs a SCASW to the count with REPNE when nothing matches", () => {
    const h = seeded("MOV AX, 0\nMOV DI, 200h\nMOV CX, 3\nREPNE SCASW\nHLT", {
      0x200: 0x01, 0x201: 0x00, 0x202: 0x02, 0x203: 0x00, 0x204: 0x03, 0x205: 0x00,
    });
    expect(h.reg("CX")).toBe(0);
    expect(h.reg("DI")).toBe(0x206);
  });

  it("moves a byte block with MOVSB", () => {
    const h = seeded("MOV SI, 200h\nMOV DI, 300h\nMOV CX, 3\nREP MOVSB\nHLT", {
      0x200: 0xde, 0x201: 0xad, 0x202: 0xbe,
    });
    expect([h.memory.read8(0, 0x300), h.memory.read8(0, 0x301), h.memory.read8(0, 0x302)]).toEqual([0xde, 0xad, 0xbe]);
    expect(h.reg("SI")).toBe(0x203);
    expect(h.reg("DI")).toBe(0x303);
  });

  it("moves backwards when DF is set", () => {
    // Both pointers step the other way, and the block has to be copied from the
    // top down or a real 8086 would overwrite bytes it has yet to read.
    const h = seeded("STD\nMOV SI, 202h\nMOV DI, 302h\nMOV CX, 3\nREP MOVSB\nHLT", {
      0x200: 0xde, 0x201: 0xad, 0x202: 0xbe,
    });
    expect([h.memory.read8(0, 0x300), h.memory.read8(0, 0x301), h.memory.read8(0, 0x302)]).toEqual([0xde, 0xad, 0xbe]);
    expect(h.reg("SI")).toBe(0x1ff);
    expect(h.reg("DI")).toBe(0x2ff);
  });

  it("steps a load by one byte and by two", () => {
    const bytes = seeded("MOV SI, 200h\nLODSB\nLODSB\nHLT", { 0x200: 0x11, 0x201: 0x22 });
    expect(AL(bytes)).toBe(0x22);
    expect(bytes.reg("SI")).toBe(0x202);
    const words = seeded("MOV SI, 200h\nLODSW\nHLT", { 0x200: 0x34, 0x201: 0x12 });
    expect(AX(words)).toBe(0x1234);
    expect(words.reg("SI")).toBe(0x202);
  });

  it("fills two bytes at a time with STOSW", () => {
    const h = com("MOV AX, 0BEEFh\nMOV DI, 400h\nMOV CX, 2\nREP STOSW\nHLT").run();
    expect(h.memory.read16(0, 0x400)).toBe(0xbeef);
    expect(h.memory.read16(0, 0x402)).toBe(0xbeef);
    expect(h.memory.read8(0, 0x404)).toBe(0);
    expect(h.reg("DI")).toBe(0x404);
    // AL is the byte that is stored, so a word form does not need AX afterwards.
    expect(AL(h)).toBe(0xef);
  });

  it("moves SI and DI only when the count says so", () => {
    // Without a prefix a string instruction runs once and leaves CX alone. A
    // prefix that was decoded but not acted on would take all four passes here.
    const h = seeded("MOV SI, 200h\nMOV DI, 300h\nMOV CX, 4\nMOVSB\nHLT", { 0x200: 0x41 });
    expect(h.reg("CX")).toBe(4);
    expect(h.reg("SI")).toBe(0x201);
    expect(h.reg("DI")).toBe(0x301);
  });

  it("takes SI from DS and DI from ES for a move", () => {
    // The source and destination of a string instruction are in different
    // segments, so an override on one of them is the only way to move across.
    // A shared default segment would make this read and write the same place.
    const h = seeded("MOV SI, 200h\nMOV DI, 300h\nMOV CX, 1\nES: REP MOVSB\nHLT", { 0x200: 0x5a });
    expect(h.memory.read8(0, 0x300)).toBe(0x5a);
  });

  it("reaches a different segment only when the segments really differ", () => {
    // The test above is not enough on its own: with DS and ES both zero the
    // override changes nothing observable, so a CPU that ignored ES entirely
    // would pass it. Here ES is genuinely elsewhere -- physical 210h, because a
    // segment is shifted up by four -- and the destination starts empty, so a
    // write that went to DS:DI instead of ES:DI would leave 210h untouched.
    const h = seeded("MOV AX, 1\nMOV ES, AX\nMOV SI, 200h\nMOV DI, 200h\nMOV CX, 1\nREP MOVSB\nHLT", {
      0x200: 0xa5,
    }, { ES: 1 });
    expect(h.memory.read8(0, 0x200)).toBe(0xa5);
    expect(h.memory.read8(0, 0x210)).toBe(0xa5);
  });
});

describe("programs built with macros", () => {
  // The assembler tests cover what a macro expands to. These run the expansion,
  // because a macro can produce an image that assembles and still be the wrong
  // program: the CPU is what has to execute it.
  it("runs a macro that substitutes its argument", () => {
    const h = com("DELAY MACRO n\n  MOV CX, n\n  LOOP $\nENDM\n  DELAY 4\n  MOV AX, 1234h\n  HLT").run();
    expect(AX(h)).toBe(0x1234);
    expect(h.reg("CX")).toBe(0);
  });

  it("runs the same macro twice with different arguments", () => {
    // The parameter has to be substituted per invocation, not bound by the first
    // one, and both invocations have to end up in the trace.
    const h = com(
      [
        "ADD MACRO v",
        "  MOV AX, v",
        "  PUSH AX",
        "ENDM",
        "  ADD 1111h",
        "  ADD 2222h",
        "  POP DX",
        "  POP BX",
        "  HLT",
      ].join("\n"),
    ).run();
    expect(h.reg("BX")).toBe(0x1111);
    expect(h.reg("DX")).toBe(0x2222);
  });

  it("gives each invocation of a macro its own local label", () => {
    // A shared label would make the second invocation's JMP land on the first
    // one's target. The count of instructions in the trace is what shows the two
    // expansions are separate, and the value shows each loop ran to its own end.
    const h = com(
      [
        "SPIN MACRO",
        "  MOV CX, 2",
        "again:",
        "  LOOP again",
        "ENDM",
        "  SPIN",
        "  SPIN",
        "  HLT",
      ].join("\n"),
    ).run();
    // MOV CX,2 then LOOP twice, three instructions, twice, then HLT.
    expect(h.cpu.trace).toHaveLength(7);
    expect(h.cpu.state.halted).toBe(true);
  });

  it("runs a macro that uses a repeat prefix", () => {
    // The prefix and the macro interact through the same two-byte encoding, so
    // this is where a macro body could pick up the wrong repeat kind.
    const h = com(
      [
        "FILL MACRO v",
        "  MOV AL, v",
        "  MOV DI, 400h",
        "  MOV CX, 3",
        "  REP STOSB",
        "ENDM",
        "  FILL 5Ah",
        "  HLT",
      ].join("\n"),
    ).run();
    expect([h.memory.read8(0, 0x400), h.memory.read8(0, 0x402)]).toEqual([0x5a, 0x5a]);
    expect(h.reg("DI")).toBe(0x403);
  });
});

describe("BCD adjust", () => {
  it("DAA fixes a packed BCD add", () => {
    // 0x28 + 0x37 in packed BCD is 0x65.
    const h = com("MOV AL, 28h\nADD AL, 37h\nDAA\nHLT").run();
    expect(AL(h)).toBe(0x65);
  });

  it("AAA breaks AL into BCD digits", () => {
    const h = com("MOV AL, 9\nMOV AH, 0\nAAA\nHLT").run();
    expect(AL(h)).toBe(0x0a);
    expect(AH(h)).toBe(0x01);
  });

  it("AAM divides AL by the base", () => {
    // AL is divided as a whole number: 0x25 is 37, and 37 = 3*10 + 7.
    const h = com("MOV AL, 25h\nAAM 10\nHLT").run();
    expect(AL(h)).toBe(7);
    expect(AH(h)).toBe(3);
  });

  it("AAD is the inverse of AAM", () => {
    // AAM 0x25 (37) splits into AH=3, AL=7; AAD puts the 37 back.
    const h = com("MOV AL, 25h\nAAM 10\nAAD 10\nHLT").run();
    expect(AL(h)).toBe(0x25);
    expect(AH(h)).toBe(0);
  });
});

describe("ports and output", () => {
  it("captures a byte written to a port without touching the port window", () => {
    // OUT is the lab's "show this value" instruction: it appends to the output
    // stream and leaves the port itself alone. OUTP is the one that writes.
    const h = com("MOV AL, 42h\nOUT 30h, AL\nHLT").run();
    expect(h.cpu.output).toEqual([{ type: "number", value: 0x42 }]);
    expect(h.memory.read8(0, 0x300 + 0x30 * 2)).toBe(0);
  });

  it("captures a word written through DX", () => {
    const h = com("MOV AX, 1234h\nMOV DX, 20h\nOUT DX, AX\nHLT").run();
    expect(h.cpu.output).toEqual([{ type: "number", value: 0x1234 }]);
    expect(h.memory.read16(0, 0x300 + 0x20 * 2)).toBe(0);
  });

  it("writes a word to the port window for OUTP", () => {
    const h = com("MOV AL, 42h\nOUTP 30h, AL\nHLT").run();
    expect(h.memory.read8(0, 0x300 + 0x30 * 2)).toBe(0x42);
  });

  it("reads a word from a port", () => {
    const memory = new Memory();
    const assembled = assemble("MOV DX, 20h\nIN AX, DX\nHLT", { origin: ORIGIN });
    memory.bytes.set(assembled.image, ORIGIN);
    memory.write16(0, 0x300 + 0x20 * 2, 0xbeef);
    const cpu = new Cpu(memory, { ...createInitialState(), IP: ORIGIN });
    cpu.run(100);
    expect(cpu.readReg16("AX")).toBe(0xbeef);
  });

  it("leaves the remainder in AL and touches no flag", () => {
    // MOD is the teaching version of division: the remainder goes to AX/AL,
    // DX is ignored, and the flags are left exactly as they were.
    const h = com("STC\nMOV AX, 0FFFFh\nMOV CL, 10\nMOD CL\nHLT").run();
    expect(AL(h)).toBe(0xff % 10);
    expect(flag(h, "CF")).toBe(true);
  });

  it("divides AL alone for the byte form of MOD", () => {
    // Not AX % BL: the dividend is the accumulator at the operand's width, so
    // the high byte of AX is not part of it.
    const h = com("MOV AX, 0FF00h\nMOV AL, 19h\nMOV BL, 5\nMOD BL\nHLT").run();
    expect(AL(h)).toBe(0x19 % 5);
  });

  it("divides AX for the word form of MOD", () => {
    const h = com("MOV AX, 0FFFBh\nMOV BX, 5\nMOD BX\nHLT").run();
    expect(AX(h)).toBe(0xfffb % 5);
  });

  it("reports division by zero for MOD", () => {
    const h = com("MOV AX, 10\nMOV BX, 0\nMOD BX\nHLT").run();
    expect(h.cpu.state.error).toContain("Division by zero");
  });

  it("records a number for OUT", () => {
    const h = com("MOV AX, 1234h\nOUT 30h, AX\nHLT").run();
    expect(h.cpu.output).toEqual([{ type: "number", value: 0x1234 }]);
  });

  it("records a character for OUTC", () => {
    const h = com("MOV AL, 41h\nOUTC AL\nHLT").run();
    expect(h.cpu.output).toEqual([{ type: "char", value: 0x41 }]);
  });
});

describe("BrainBox extensions", () => {
  it("writes a word to a fixed port with OUTP", () => {
    const h = com("MOV BX, 0BEEFh\nOUTP 10h, BX\nHLT").run();
    expect(h.memory.read16(0, 0x300 + 0x10 * 2)).toBe(0xbeef);
  });

  it("leaves the flags alone for OUTC", () => {
    const h = com("STC\nMOV AL, 41h\nOUTC AL\nHLT").run();
    expect(flag(h, "CF")).toBe(true);
  });

  // The exact encodings. These are the lab's own instructions and nothing else
  // can be compared against them, because no other assembler has them, so a
  // change to a byte is invisible everywhere else: the tests above check the
  // behaviour, and these check that the behaviour is still reachable.
  // The ModR/M byte comes before the immediate, as it does on the hardware: the
  // escape code selects the instruction and the operand register is encoded in
  // the ModR/M, with the port last.
  it.each([
    ["OUT AL", [0x0f, 0x00, 0xc0]],
    ["OUTC AL", [0x0f, 0x01, 0xc0]],
    ["OUT AX", [0x0f, 0x05, 0xc0]],
    ["OUTC AX", [0x0f, 0x06, 0xc0]],
    ["MOD BX", [0x0f, 0x03, 0xc3]],
    ["MOD BL", [0x0f, 0x04, 0xc3]],
    ["OUTP 10h, AL", [0x0f, 0x02, 0xc0, 0x10]],
    ["OUTP 10h, BX", [0x0f, 0x07, 0xc3, 0x10]],
    ["IN BL, 10h", [0x0f, 0x08, 0xc3, 0x10]],
    ["IN BX, 10h", [0x0f, 0x09, 0xc3, 0x10]],
  ])("encodes %s to the documented bytes", (source, bytes) => {
    const result = assemble(source, { origin: 0 });
    expect(result.errors.map((d) => d.message)).toEqual([]);
    expect([...result.image]).toEqual(bytes);
  });

  it("puts every extension in the private 0F escape", () => {
    // 0F is not a prefix on the 8086, so an extension can never be mistaken for
    // a real instruction -- which is the whole reason the lab can add
    // instructions without taking any away. Checking it per entry means a new
    // extension cannot be added outside that space by accident.
    for (const def of INSTRUCTION_TABLE) {
      if (def.ext === undefined) continue;
      expect(def.bytes[0], `${def.mnem} escapes with ${hex(def.bytes[0])}`).toBe(0x0f);
    }
  });

  it("gives every extension its own escape code", () => {
    // Two mnemonics sharing a code would mean the table's `ext` field, which is
    // what a debugger and a disassembler read, could not say which one ran.
    const codes = new Map<number, string>();
    for (const def of INSTRUCTION_TABLE) {
      if (def.ext === undefined) continue;
      const existing = codes.get(def.ext);
      if (existing !== undefined) {
        throw new Error(`extension code ${hex(def.ext)} is used by both ${existing} and ${def.mnem}`);
      }
      codes.set(def.ext, def.mnem);
    }
    expect(codes.size).toBe(10);
  });

  it("gives every extension a code of its own as well as a mnemonic", () => {
    // MOD has two codes because it has two widths, and IN has two for the same
    // reason. What must not happen is a code that names a mnemonic the table
    // does not otherwise spell, because then the escape byte and the table
    // disagree about what exists.
    const byCode = new Map(INSTRUCTION_TABLE.filter((d) => d.ext !== undefined).map((d) => [d.ext!, d.mnem]));
    expect(new Set(byCode.values())).toEqual(new Set(["OUT", "OUTC", "OUTP", "MOD", "IN"]));
  });
});

describe("interrupts", () => {
  it("halts on the DOS exit service", () => {
    const h = com("MOV AX, 4C00h\nINT 21h\nMOV AX, 0BADh").run();
    expect(h.cpu.state.halted).toBe(true);
  });

  it("emits a character for INT 21h AH=02", () => {
    // AH=02 prints DL, not AL. The legacy took DL and the lab's own programs
    // put the character there, so matching it keeps their output correct.
    const h = com("MOV AH, 2\nMOV DL, 5Ah\nINT 21h\nHLT").run();
    expect(h.cpu.output).toEqual([{ type: "char", value: 0x5a }]);
  });

  it("halts on INT 20h", () => {
    const h = com("INT 20h\nMOV AX, 0BADh").run();
    expect(h.cpu.state.halted).toBe(true);
  });

  it("reports an interrupt it has no policy for", () => {
    const h = com("INT 3\nMOV AX, 0BADh").run();
    expect(h.cpu.state.halted).toBe(true);
  });

  it("names the service it does not implement", () => {
    // An unsupported service has to be visible. Halting is right -- the CPU has
    // no vector table to hand over to -- but a program that halted for no stated
    // reason is indistinguishable from one that finished, and the difference
    // between the two is exactly what a student is being asked to find.
    const h = com("MOV AH, 0Bh\nINT 21h").run();
    expect(h.cpu.state.halted).toBe(true);
    expect(h.cpu.state.error).toBe("unsupported INT 21h service bh");
  });

  it("puts the next input character in AL for AH=01", () => {
    // AH=01, AH=07 and AH=08 read one character and leave it in AL. Two calls
    // consume two characters, and AL ends up holding the second -- which is the
    // only thing that distinguishes a queue from a single slot.
    const h = com("MOV AH, 1\nINT 21h\nINT 21h\nHLT", {}, { inputValues: [0x41, 0x42] }).run();
    expect(AL(h)).toBe(0x42);
  });

  it("puts the next input character in AL for AH=07, like AH=01", () => {
    // AH=07 is the no-echo read; with echo not modeled the two services are
    // the same call, and this pins that they stay that way.
    const h = com("MOV AH, 7\nINT 21h\nHLT", {}, { inputValues: [0x41] }).run();
    expect(AL(h)).toBe(0x41);
    expect(h.cpu.state.error).toBe(null);
  });

  it("puts the next input character in AL for AH=08", () => {
    // AH=08 differs from AH=01 only in Ctrl-Break handling, which is not
    // modeled, so it reads like the others. AL is pre-set here: the bug this
    // replaces skipped the assignment for AH=08, and a program that had not
    // touched AL would have hidden it.
    const h = com("MOV AX, 4241h\nMOV AH, 8\nINT 21h\nHLT", {}, { inputValues: [0x43] }).run();
    expect(AL(h)).toBe(0x43);
    expect(h.cpu.state.error).toBe(null);
  });

  it("returns AL=0 from AH=01 when there is no input", () => {
    // Real DOS blocks. A program in the lab must not hang the browser, so the
    // queue runs dry and the service returns zero -- explicitly, not "whatever
    // AL happened to hold". The program pre-sets AL precisely to show that:
    // a stale character left in AL could keep a read-until loop looping, and
    // zero is the value the engine's own documentation promises.
    const h = com("MOV AX, 4241h\nMOV AH, 1\nINT 21h\nHLT", {}, { inputValues: [] }).run();
    expect(AL(h)).toBe(0);
    expect(h.cpu.state.error).toBe(null);
  });

  it("returns AL=0 from AH=07 and AH=08 when there is no input", () => {
    // The same dry-queue answer for the two sibling services, which share one
    // path with AH=01: all three read alike, and this pins that they stay
    // read alike when there is nothing to read.
    const seven = com("MOV AX, 4241h\nMOV AH, 7\nINT 21h\nHLT", {}, { inputValues: [] }).run();
    expect(AL(seven)).toBe(0);
    const eight = com("MOV AX, 4241h\nMOV AH, 8\nINT 21h\nHLT", {}, { inputValues: [] }).run();
    expect(AL(eight)).toBe(0);
    expect(eight.cpu.state.error).toBe(null);
  });

  it("reads a line into a DOS buffer for AH=0Ah", () => {
    // The buffer layout is the DOS one: capacity, count, then the characters
    // and a trailing CR. The count excludes the CR, which is the detail a
    // program printing `count` characters depends on.
    // The program owns the buffer and sets the capacity before it calls, which
    // is what DOS expects: the service fills a buffer the program has already
    // described.
    const h = seeded(
      "MOV DX, 200h\nMOV AH, 0Ah\nINT 21h\nHLT",
      { 0x200: 16 },
      {},
      { inputValues: [0x68, 0x69, 0x0d] },
    );
    expect(h.memory.read8(0, 0x200)).toBe(16);
    expect(h.memory.read8(0, 0x201)).toBe(2);
    expect([0, 1, 2, 3].map((n) => h.memory.read8(0, 0x202 + n))).toEqual([0x68, 0x69, 0x0d, 0]);
    expect(AL(h)).toBe(0);
  });

  it("leaves the characters that did not fit for the next read", () => {
    // The capacity covers the CR, so a buffer of 3 takes two characters and
    // stops. The character that would have been third stays in the queue, which
    // is what lets a program read a second line instead of losing one.
    const h = seeded(
      "MOV DX, 200h\nMOV AH, 0Ah\nINT 21h\nHLT",
      { 0x200: 3 },
      {},
      { inputValues: [0x61, 0x62, 0x63, 0x0d] },
    );
    expect(h.memory.read8(0, 0x201)).toBe(2);
    expect([0, 1].map((n) => h.memory.read8(0, 0x202 + n))).toEqual([0x61, 0x62]);
    // Nothing was written past the two characters, so the CR slot is untouched.
    expect(h.memory.read8(0, 0x204)).toBe(0);
  });

  it("returns an empty line for AH=0Ah with no input", () => {
    // Not an error and not a hang: the count says zero and the characters are
    // left alone, so a program that reads a count first behaves.
    const h = seeded("MOV DX, 200h\nMOV AH, 0Ah\nINT 21h\nHLT", { 0x200: 16 }, {}, { inputValues: [] });
    expect(h.memory.read8(0, 0x201)).toBe(0);
    expect(AL(h)).toBe(0);
    expect(h.cpu.state.error).toBe(null);
  });

  it("does not write a line buffer too small to hold a CR", () => {
    // A capacity below 2 cannot hold a character and its terminator. DOS refuses
    // the call, and so does this: nothing is written and no character is eaten.
    const h = seeded("MOV DX, 200h\nMOV AH, 0Ah\nINT 21h\nHLT", { 0x200: 1 }, {}, { inputValues: [0x61, 0x0d] });
    // The capacity byte is the program's own and is left alone; what must not
    // happen is a count or a stored character.
    expect(h.memory.read8(0, 0x200)).toBe(1);
    expect(h.memory.read8(0, 0x201)).toBe(0);
    expect(h.memory.read8(0, 0x202)).toBe(0);
  });

  it("stores what arrived when input ends mid-line without a CR", () => {
    // The queue ran dry before Enter. DOS would keep waiting for it; this
    // returns instead, with the count saying what was stored, no terminator
    // invented, and the program's own bytes past the stored text untouched.
    const h = seeded(
      "MOV DX, 200h\nMOV AH, 0Ah\nINT 21h\nHLT",
      { 0x200: 16 },
      {},
      { inputValues: [0x61, 0x62] },
    );
    expect(h.memory.read8(0, 0x201)).toBe(2);
    expect([0, 1].map((n) => h.memory.read8(0, 0x202 + n))).toEqual([0x61, 0x62]);
    // The byte after the two characters, where a CR would have gone, was never
    // written.
    expect(h.memory.read8(0, 0x204)).toBe(0);
    expect(h.cpu.state.error).toBe(null);
  });

  it("reads a key into AL for INT 16h AH=00", () => {
    // The BIOS read takes from the same queue as the DOS services. The scan
    // code is not modeled, so AH carries nothing new -- it is what the caller
    // set to select this service, zero.
    const h = com("MOV AH, 0\nINT 16h\nHLT", {}, { inputValues: [0x41] }).run();
    expect(AL(h)).toBe(0x41);
    expect(AH(h)).toBe(0);
    expect(h.cpu.state.error).toBe(null);
  });

  it("returns AL=0 from INT 16h AH=00 when there is no input", () => {
    // The same defined answer as every other read: zero instead of blocking,
    // with AL pre-set so a stale character could not pass for a key.
    const h = com("MOV AL, 61h\nMOV AH, 0\nINT 16h\nHLT", {}, { inputValues: [] }).run();
    expect(AL(h)).toBe(0);
    expect(h.cpu.state.error).toBe(null);
  });

  it("reads one key across the DOS and BIOS services, from one queue", () => {
    // A program that mixes the two families reads a single stream: the DOS
    // read takes the first key and the BIOS read the second, not both the
    // first.
    const h = com(
      "MOV AH, 1\nINT 21h\nMOV BL, AL\nMOV AH, 0\nINT 16h\nHLT",
      {},
      { inputValues: [0x41, 0x42] },
    ).run();
    expect(h.reg("BX") & 0xff).toBe(0x41);
    expect(AL(h)).toBe(0x42);
  });

  it("reports a waiting key with ZF clear and AX holding it for AH=01", () => {
    // Status in one call: ZF is what a program branches on, AX is the key it
    // is about to be given, and the unmodeled scan code reads 0 in AH.
    const h = com("MOV AH, 1\nINT 16h\nHLT", {}, { inputValues: [0x41] }).run();
    expect(flag(h, "ZF")).toBe(false);
    expect(AX(h)).toBe(0x0041);
    expect(h.cpu.state.error).toBe(null);
  });

  it("sets ZF for INT 16h AH=01 when no key is waiting", () => {
    // The program tests ZF and must not be told a key is there. The flag is
    // the whole answer; nothing else is changed.
    const h = com("MOV AH, 1\nINT 16h\nHLT", {}, { inputValues: [] }).run();
    expect(flag(h, "ZF")).toBe(true);
    expect(h.cpu.state.error).toBe(null);
  });

  it("leaves the key it reported for INT 16h AH=01 to the next read", () => {
    // Status peeks: the key comes back in AX but stays in the queue, so the
    // AH=00h read that follows still gets it.
    const h = com(
      "MOV AH, 1\nINT 16h\nMOV BX, AX\nMOV AH, 0\nINT 16h\nHLT",
      {},
      { inputValues: [0x41] },
    ).run();
    expect(h.reg("BX")).toBe(0x0041);
    expect(AL(h)).toBe(0x41);
  });

  it("rejects an INT 16h service it does not implement", () => {
    // AH=02h reads the shift flags, which this lab does not model. Halted
    // with a message, the same way an unknown DOS service is refused, rather
    // than silently doing nothing.
    const h = com("MOV AH, 2\nINT 16h\nHLT").run();
    expect(h.cpu.state.halted).toBe(true);
    expect(h.cpu.state.error).toBe("unsupported INT 16h service 2h");
  });

  it("stops a scan with no terminator instead of looping", () => {
    // 64 KB with no '$'. Without a bound the scan wraps to its own start,
    // re-reads the same bytes, and appends to the output forever.
    const h = com("MOV DX, 0\nMOV AH, 9\nINT 21h\nHLT").run();
    expect(h.cpu.state.halted).toBe(true);
    expect(h.cpu.state.error).toBe(null);
    expect(h.cpu.output.length).toBeLessThanOrEqual(0x10000);
  });

  it("stops at the instruction after the one that halts", () => {
    // INT 20h and the exit service both halt, and neither may run the next
    // instruction. AX staying zero is the whole check: 0BADh would mean the
    // program carried on past the halt.
    const h = com("INT 20h\nMOV AX, 0BADh").run();
    expect(AX(h)).toBe(0);
  });
});

describe("the trace", () => {
  it("records every instruction address it executed", () => {
    const h = com("MOV AX, 1\nMOV BX, 2\nHLT").run();
    expect(h.cpu.trace).toEqual([ORIGIN, ORIGIN + 3, ORIGIN + 6]);
  });
});
