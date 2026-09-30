/**
 * The return forms, near and far, with and without an immediate.
 *
 * `RET imm16` (`C2`) and `RETF imm16` (`CA`) are original 8086 instructions. The
 * immediate is a *release count*: the number of bytes of caller arguments to
 * drop on the way out, so `SP` ends up above where it started rather than back
 * at its starting value. The far form pops the segment as well, which is the
 * only difference between the two and the reason they are separate opcodes at
 * all.
 *
 * `RETF imm16` was missing. The ISA table listed `C8` ENTER and `C9` LEAVE as
 * 80186 and left `CA` out with them, on the belief that a far return with an
 * immediate was also a later addition. It is not: the `CA iw` form is documented
 * in the 8086 instruction set, and the plain `RETF` at `CB` is its immediate-less
 * sibling, so refusing `CA` left a hole next to an instruction that was already
 * there. The error said `RETF with an immediate is an 80186 instruction`, which
 * sent anyone writing a `PASCAL`-style far procedure to work around a form that
 * always existed.
 *
 * The encoding and the `CA` decode assertion live here rather than in
 * `isa-boundary.test.ts` only, because that file's job is the boundary and this
 * form is on the near side of it.
 */

import { describe, expect, it } from "vitest";
import { Memory } from "../memory";
import { Cpu, createInitialState, type CpuState } from "../cpu/cpu";
import { assemble } from "../assembler/assemble";
import { decode } from "../cpu/decode";

const ORIGIN = 0x100;

function assembled(source: string): Uint8Array {
  const result = assemble(source, { origin: ORIGIN });
  expect(result.errors.map((d) => d.message), `${source} must assemble`).toEqual([]);
  return result.image;
}

/**
 * A CPU holding one instruction at CS:0100h with a return frame already on the
 * stack. The frame is written by the harness rather than pushed by a `CALL`, so
 * a test that watches `SP` afterwards is not also testing that `CALL` pushes the
 * bytes it is supposed to.
 */
function returning(
  source: string,
  frame: { offset: number; segment: number; ip: number; arguments?: number[] },
  initial: Partial<CpuState> = {},
): Cpu {
  const memory = new Memory();
  memory.bytes.set(assembled(source), ORIGIN);
  const base = frame.segment * 16;
  memory.setRaw(base + frame.offset, frame.ip & 0xff);
  memory.setRaw(base + frame.offset + 1, (frame.ip >> 8) & 0xff);
  if (frame.segment !== 0) {
    memory.setRaw(base + frame.offset + 2, frame.segment & 0xff);
    memory.setRaw(base + frame.offset + 3, (frame.segment >> 8) & 0xff);
  }
  // The caller's pushed arguments, sitting above the frame. A release count is
  // supposed to step over these without touching them.
  (frame.arguments ?? []).forEach((value, n) => {
    memory.setRaw(base + frame.offset + (frame.segment === 0 ? 2 : 4) + n, value);
  });
  const cpu = new Cpu(memory, {
    ...createInitialState(),
    IP: ORIGIN,
    CS: 0,
    DS: 0,
    ES: 0,
    SS: frame.segment,
    SP: frame.offset,
    ...initial,
  });
  cpu.step();
  return cpu;
}

/** The bytes still sitting above `SP` after a return, low address first. */
function aboveStack(cpu: Cpu, from: number, count: number): number[] {
  const base = cpu.state.SS * 16;
  return Array.from({ length: count }, (_, n) => cpu.memory.read8(0, base + from + n));
}

describe("the return forms encode as the 8086 defines them", () => {
  it.each([
    ["RET", [0xc3]],
    ["RETF", [0xcb]],
  ])("%s with no operand is one byte", (source, expected) => {
    expect(Array.from(assembled(source))).toEqual(expected);
  });

  it.each([
    ["RET 4", [0xc2, 0x04, 0x00]],
    ["RETF 4", [0xca, 0x04, 0x00]],
  ])("%s is an opcode and a little-endian immediate", (source, expected) => {
    expect(Array.from(assembled(source))).toEqual(expected);
  });

  it("keeps the whole 16 bits of the release count", () => {
    // A count is a byte count in a word field, so 1234h is one instruction and
    // not two. Truncating here would silently change how much the caller
    // releases, which is the one thing the immediate is for.
    expect(Array.from(assembled("RET 1234h"))).toEqual([0xc2, 0x34, 0x12]);
  });

  it("treats a zero immediate as the same instruction length, not as no immediate", () => {
    // `RET 0` is C2 00 00. It releases nothing, but it is not C3, and a
    // disassembler looking at the bytes needs to be told which.
    expect(Array.from(assembled("RET 0"))).toEqual([0xc2, 0x00, 0x00]);
  });
});

describe("the return forms decode back to themselves", () => {
  it.each([
    [0xc2, "RET", 0x04, 3],
    [0xca, "RETF", 0x04, 3],
  ])("%s decodes as %s and reports its length", (opcode, mnem, imm, length) => {
    const result = decode(Uint8Array.of(opcode, imm, 0));
    expect(result.ok).toBe(true);
    expect(result.mnem).toBe(mnem);
    expect(result.length).toBe(length);
    expect(result.operands[0]).toMatchObject({ kind: "imm", value: 4, size: 16 });
  });

  it("still decodes the immediate-less form of the same mnemonics", () => {
    // The two-entry-per-mnemonic shape is the risk here: adding CA must not
    // disturb CB, or every existing far return stops decoding.
    expect(decode(Uint8Array.of(0xc3)).mnem).toBe("RET");
    expect(decode(Uint8Array.of(0xcb)).mnem).toBe("RETF");
    expect(decode(Uint8Array.of(0xcb)).length).toBe(1);
  });
});

describe("a near return pops the offset and releases the arguments", () => {
  it("takes the offset from the stack and leaves the segment alone", () => {
    const cpu = returning("RET", { offset: 0x2000, segment: 0x1234, ip: 0x4321 });
    expect(cpu.state.IP).toBe(0x4321);
    // A near return is intrasegment: CS is not read, so CS is still 0 here even
    // though the frame on the stack carried a segment field.
    expect(cpu.state.CS).toBe(0);
  });

  it("leaves SP where the frame ended when there is no immediate", () => {
    const cpu = returning("RET", { offset: 0x2000, segment: 0, ip: 0x4321 });
    expect(cpu.state.SP).toBe(0x2002);
  });

  it("adds the immediate to SP, so the caller sees its arguments released", () => {
    // This is the whole reason the immediate exists. BP-relative parameters
    // pushed by the caller are at SP:0..3; the callee returns with `RET 4` and
    // SP ends up past them, which is what lets the caller read them as BP-8.
    const cpu = returning("RET 4", { offset: 0x2000, segment: 0, ip: 0x4321 });
    expect(cpu.state.IP).toBe(0x4321);
    expect(cpu.state.SP).toBe(0x2006);
  });

  it("wraps SP at 16 bits rather than growing the register", () => {
    const cpu = returning("RET 4", { offset: 0xfffd, segment: 0, ip: 0x4321 });
    expect(cpu.state.SP).toBe(0x0003);
  });

  it("releases the arguments without reading or clearing them", () => {
    // A release count is arithmetic on SP, not four more pops. If it read the
    // bytes the arguments would be gone, and a caller that wanted to look at
    // its own parameters after the call could not.
    const cpu = returning("RET 4", {
      offset: 0x2000,
      segment: 0,
      ip: 0x4321,
      arguments: [0xaa, 0xbb, 0xcc, 0xdd],
    });
    expect(cpu.state.SP).toBe(0x2006);
    expect(aboveStack(cpu, 0x2000, 6)).toEqual([0x21, 0x43, 0xaa, 0xbb, 0xcc, 0xdd]);
  });
});

describe("a far return pops the segment too", () => {
  it("takes both the offset and the segment from the stack", () => {
    const cpu = returning("RETF", { offset: 0x2000, segment: 0x1234, ip: 0x4321 });
    expect(cpu.state.IP).toBe(0x4321);
    expect(cpu.state.CS).toBe(0x1234);
  });

  it("consumes four bytes of frame, against the near form's two", () => {
    const far = returning("RETF", { offset: 0x2000, segment: 0x1234, ip: 0x4321 });
    expect(far.state.SP).toBe(0x2004);
  });

  it("releases the arguments past the segment, not instead of it", () => {
    // The order is fixed: offset, then segment, then the release. Getting it
    // the other way round would release 4 bytes over the segment and return
    // into the middle of the frame.
    const cpu = returning("RETF 4", { offset: 0x2000, segment: 0x1234, ip: 0x4321 });
    expect(cpu.state.IP).toBe(0x4321);
    expect(cpu.state.CS).toBe(0x1234);
    expect(cpu.state.SP).toBe(0x2008);
  });

  it("truncates the popped offset to 16 bits", () => {
    // Real hardware ANDs the popped value with FFFFh. The frame here holds a
    // 17-bit-looking value, so the high bit must not reach IP.
    const cpu = returning("RETF", { offset: 0x2000, segment: 0, ip: 0x4321 });
    expect(cpu.state.IP & 0x1_0000).toBe(0);
  });
});

describe("a procedure that returns with a release count", () => {
  it("leaves the caller's stack above the arguments it consumed", () => {
    // The end-to-end shape the immediate exists for. The far version of this
    // is not written here because `CALL FAR` has no source spelling on this
    // engine at all -- the far forms are covered by the frames above, which
    // are placed by hand rather than by a `CALL`.
    const memory = new Memory();
    memory.bytes.set(
      assembled([
        "CALL takesArgument",
        "HLT",
        "takesArgument:",
        "RET 4",
      ].join("\n")),
      ORIGIN,
    );
    const cpu = new Cpu(memory, {
      ...createInitialState(),
      IP: ORIGIN,
      CS: 0,
      DS: 0,
      ES: 0,
      SS: 0,
      SP: 0xfffc,
    });
    cpu.run(100);

    // `CALL` pushed two bytes of return address; `RET 4` popped those and
    // released four more, so SP is four above where the caller left it -- which
    // is 10000h, wrapped to 0000h. The program then reached its HLT, which is
    // the proof the return landed.
    expect(cpu.state.SP).toBe(0x0000);
    expect(cpu.state.halted).toBe(true);
    expect(cpu.state.error).toBeNull();
  });

  it("returns to the instruction after the call, not into the procedure", () => {
    const memory = new Memory();
    memory.bytes.set(assembled("CALL proc\nMOV AX, 0BEEFh\nHLT\nproc:\nRET 6"), ORIGIN);
    const cpu = new Cpu(memory, {
      ...createInitialState(),
      IP: ORIGIN,
      CS: 0,
      DS: 0,
      ES: 0,
      SS: 0,
      SP: 0xfffc,
    });
    cpu.run(100);
    expect(cpu.readReg16("AX")).toBe(0xbeef);
  });
});
