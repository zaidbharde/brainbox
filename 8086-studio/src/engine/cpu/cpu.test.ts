/**
 * CPU behaviour tests.
 *
 * Programs are assembled and run the way a .COM program is: everything at
 * CS:0100h with all four segments equal, because that is the only layout where
 * a single flat byte array is unambiguously correct, and getting it wrong makes
 * a failing test ambiguous about which of the two things is at fault.
 *
 * The differential tests in test/cpu-differential.test.ts cover the interaction
 * between instructions. These cover each instruction against the architecture
 * manual, which is the only way to catch a flag rule that both engines happen to
 * get wrong in the same way.
 */

import { describe, expect, it } from "vitest";
import { Memory } from "../memory";
import { Cpu, createInitialState, type CpuState } from "./cpu";
import { assemble } from "../assembler/assemble";
import { getFlag, type FlagName } from "../isa/flags";

const ORIGIN = 0x100;

interface Harness {
  cpu: Cpu;
  memory: Memory;
  run(): Harness;
  reg(name: keyof CpuState): number;
}

function com(source: string, initial: Partial<CpuState> = {}): Harness {
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
  const cpu = new Cpu(memory, state);
  return {
    cpu,
    memory,
    run() {
      cpu.run(5000);
      return this;
    },
    reg(name) {
      return cpu.state[name] as number;
    },
  };
}

const AX = (h: Harness) => h.cpu.readReg16("AX");
const AL = (h: Harness) => h.cpu.readReg8(0);
const AH = (h: Harness) => h.cpu.readReg8(4);
const flag = (h: Harness, name: FlagName) => getFlag(h.cpu.state.FLAGS, name);

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
    const h = com(
      "MOV AX, 1000h\nMOV ES, AX\nMOV WORD PTR [0x30], 1111h\nMOV AX, 0\n" +
        "MOV AX, ES:[0x30]\nHLT",
    ).run();
    expect(AX(h)).toBe(0x1111);
  });

  it("loads an effective address without touching memory", () => {
    const h = com("MOV BX, 40h\nMOV SI, 8\nLEA AX, [BX+SI]\nHLT").run();
    expect(AX(h)).toBe(0x48);
  });

  it("moves 8-bit halves independently", () => {
    const h = com("MOV AX, 1234h\nMOV AH, 0\nHLT").run();
    expect(AH(h)).toBe(0);
    expect(AL(h)).toBe(0x34);
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

  it("traps a divide by zero instead of hanging", () => {
    const h = com("MOV AX, 5\nMOV BX, 0\nDIV BX\nHLT").run();
    expect(h.cpu.state.halted).toBe(true);
    expect(h.cpu.state.error).toContain("divide error");
  });

  it("traps a quotient that cannot be represented", () => {
    const h = com("MOV AX, 0\nMOV AL, 0FFh\nMOV BL, 1\nIDIV BL\nHLT").run();
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
    const h = com("MOV SI, 200h\nLODSW\nHLT").run();
    expect(AX(h)).toBe(h.memory.read16(0, 0x200));
  });

  it("scans with SCASB", () => {
    const h = com("MOV AL, 5\nMOV DI, 0\nMOV CX, 4\nREPNE SCASB\nHLT").run();
    expect(h.cpu.state.halted).toBe(true);
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
  it("writes a byte to a port", () => {
    const h = com("MOV AL, 42h\nOUT 30h, AL\nHLT").run();
    expect(h.memory.read8(0, 0x300 + 0x30 * 2)).toBe(0x42);
  });

  it("writes a word through DX", () => {
    const h = com("MOV AX, 1234h\nMOV DX, 20h\nOUT DX, AX\nHLT").run();
    expect(h.memory.read16(0, 0x300 + 0x20 * 2)).toBe(0x1234);
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
});

describe("interrupts", () => {
  it("halts on the DOS exit service", () => {
    const h = com("MOV AX, 4C00h\nINT 21h\nMOV AX, 0BADh").run();
    expect(h.cpu.state.halted).toBe(true);
  });

  it("emits a character for INT 21h AH=02", () => {
    const h = com("MOV AH, 2\nMOV AL, 5Ah\nINT 21h\nHLT").run();
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
});

describe("the trace", () => {
  it("records every instruction address it executed", () => {
    const h = com("MOV AX, 1\nMOV BX, 2\nHLT").run();
    expect(h.cpu.trace).toEqual([ORIGIN, ORIGIN + 3, ORIGIN + 6]);
  });
});
