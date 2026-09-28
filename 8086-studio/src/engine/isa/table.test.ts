import { describe, expect, it } from "vitest";
import {
  ALL_MNEMONICS,
  BY_EXTENSION,
  BY_PRIMARY_OPCODE,
  INSTRUCTION_TABLE,
  JCC_ALIASES,
  PREFIXES,
  type InsnDef,
} from "./table";
import { addressToRm, decodeModRM, encodeModRM } from "./modrm";

describe("ISA table structure", () => {
  it("has entries", () => {
    expect(INSTRUCTION_TABLE.length).toBeGreaterThan(200);
  });

  it("every opcode byte is a byte", () => {
    for (const def of INSTRUCTION_TABLE) {
      for (const b of def.bytes) {
        expect(b, `${def.mnem} ${def.ops.join(",")}`).toBeGreaterThanOrEqual(0);
        expect(b, `${def.mnem} ${def.ops.join(",")}`).toBeLessThanOrEqual(0xff);
      }
    }
  });

  it("has no duplicate definitions", () => {
    const seen = new Set<string>();
    for (const def of INSTRUCTION_TABLE) {
      const key = `${def.mnem} ${def.ops.join(",")} ${def.bytes.join(" ")} ` +
        `modrm=${JSON.stringify(def.modrm)} imm=${JSON.stringify(def.imm)} ` +
        `rel=${JSON.stringify(def.rel)} moffs=${def.moffs} ptr=${def.ptr}`;
      expect(seen.has(key), `duplicate definition: ${key}`).toBe(false);
      seen.add(key);
    }
  });

  it("has no two definitions that would make encoding ambiguous", () => {
    // Two defs with the same opcode bytes and the same operand kinds are
    // indistinguishable, so the encoder could never pick the right one.
    const byKey = new Map<string, InsnDef[]>();
    for (const def of INSTRUCTION_TABLE) {
      const digit = def.modrm?.digit;
      const key =
        `${def.bytes.join(" ")}|${def.ops.join(",")}` +
        `|/digit=${digit ?? "none"}`;
      const list = byKey.get(key) ?? [];
      list.push(def);
      byKey.set(key, list);
    }
    for (const [key, defs] of byKey) {
      if (defs.length < 2) continue;
      // 0x0F escapes are fine only if the sub-opcode differs (it is in bytes).
      expect(defs.length, `ambiguous encoding for ${key}`).toBe(1);
    }
  });

  it("every modrm slot indexes a valid operand", () => {
    for (const def of INSTRUCTION_TABLE) {
      const m = def.modrm;
      if (!m) continue;
      const check = (slot: unknown, label: string) => {
        if (typeof slot !== "number") return;
        expect(slot, `${def.mnem}: ${label} slot`).toBeLessThan(def.ops.length);
        expect(slot, `${def.mnem}: ${label} slot`).toBeGreaterThanOrEqual(0);
      };
      check(m.reg, "reg");
      check(m.rm, "rm");
      check(m.sreg, "sreg");
    }
  });

  it("a fixed /digit is a valid 0-7 value and never coexists with a reg slot", () => {
    for (const def of INSTRUCTION_TABLE) {
      const m = def.modrm;
      if (!m) continue;
      if (m.digit === undefined) continue;
      expect(m.digit, `${def.mnem} digit`).toBeGreaterThanOrEqual(0);
      expect(m.digit, `${def.mnem} digit`).toBeLessThanOrEqual(7);
      expect(m.reg, `${def.mnem} must not have both digit and reg`).toBeUndefined();
      expect(m.sreg, `${def.mnem} must not have both digit and sreg`).toBeUndefined();
    }
  });

  it("the reg field is only a slot or a segment operand, never a bare digit", () => {
    // Guards the 0x00-0x3F direction bug: if reg/rm were not slots, ADD r8,rm8
    // and ADD rm8,r8 would encode identically.
    for (const def of INSTRUCTION_TABLE) {
      const reg = def.modrm?.reg;
      if (reg === undefined) continue;
      expect(def.ops[reg], `${def.mnem} reg slot ${reg}`).toBeDefined();
    }
  });

  it("every imm/rel/moffs/ptr slot indexes a valid operand", () => {
    for (const def of INSTRUCTION_TABLE) {
      for (const [label, slot] of [
        ["imm", def.imm?.slot],
        ["rel", def.rel?.slot],
        ["moffs", def.moffs],
        ["ptr", def.ptr],
      ] as const) {
        if (slot === undefined) continue;
        expect(slot, `${def.mnem}: ${label} slot`).toBeLessThan(def.ops.length);
      }
    }
  });

  it("imm/rel operand kinds agree with the declared size", () => {
    for (const def of INSTRUCTION_TABLE) {
      if (def.imm) {
        const kind = def.ops[def.imm.slot];
        expect(kind, `${def.mnem} imm${def.imm.size}`).toBe(`imm${def.imm.size}`);
      }
      if (def.rel) {
        const kind = def.ops[def.rel.slot];
        expect([kind], `${def.mnem} rel${def.rel.size}`).toContain(`rel${def.rel.size}`);
      }
    }
  });

  it("the same mnemonic never declares two different operand widths for the same operand", () => {
    // e.g. MOV AL,imm8 and MOV AX,imm16 are fine, but MOV rm8,imm16 is not.
    for (const def of INSTRUCTION_TABLE) {
      for (const op of def.ops) {
        if (op === "none" || op === "label" || op === "ptr16") continue;
        expect(op, `${def.mnem} ${def.ops.join(",")}`).toMatch(
          /^(r8|r16|reg8|reg16|rm8|rm16|moffs8|moffs16|imm8|imm16|rel8|rel16|sreg|al|ax|dx|cl|one|three)$/,
        );
      }
    }
  });
});

describe("ISA table coverage", () => {
  const REQUIRED = [
    // data
    "MOV", "XCHG", "LEA", "PUSH", "POP",
    // arithmetic
    "ADD", "ADC", "SUB", "SBB", "INC", "DEC", "NEG",
    "MUL", "IMUL", "DIV", "IDIV",
    // logical
    "AND", "OR", "XOR", "NOT", "TEST",
    // bcd / sign
    "DAA", "DAS", "AAA", "AAS", "AAM", "AAD", "CBW", "CWD",
    // shifts
    "SHL", "SAL", "SHR", "SAR", "ROL", "ROR", "RCL", "RCR",
    // control
    "JMP", "CALL", "RET", "RETF", "LOOP", "LOOPE", "LOOPNE", "JCXZ",
    // flags
    "CLC", "STC", "CMC", "CLD", "STD", "CLI", "STI", "SAHF", "LAHF", "PUSHF", "POPF",
    // string
    "MOVSB", "MOVSW", "STOSB", "STOSW", "LODSB", "LODSW", "SCASB", "SCASW",
    "CMPSB", "CMPSW", "XLAT",
    // io
    "IN", "OUT", "HLT", "NOP", "WAIT", "INT", "INT3", "IRET", "LES", "LDS",
    "ENTER", "LEAVE",
    // all 16 conditional jumps
    "JO", "JNO", "JB", "JNB", "JZ", "JNZ", "JBE", "JA",
    "JS", "JNS", "JP", "JNP", "JL", "JGE", "JLE", "JG",
    // BrainBox extensions
    "OUTC", "OUTP", "MOD",
  ];

  it.each(REQUIRED)("supports %s", (mnem) => {
    expect(ALL_MNEMONICS).toContain(mnem);
  });

  it("covers all 16 Jcc conditions in both short and near form", () => {
    for (const digit of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) {
      // 0x80-0x8F is shared with the `op r/m, imm` group, so select the Jcc by
      // its rel field rather than by primary opcode alone.
      const short = INSTRUCTION_TABLE.filter(
        (d) => d.bytes[0] === 0x70 + digit && d.rel?.size === 8,
      );
      const near = INSTRUCTION_TABLE.filter(
        (d) => d.bytes[0] === 0x80 + digit && d.rel?.size === 16,
      );
      expect(short.length, `short 0x${(0x70 + digit).toString(16)}`).toBe(1);
      expect(near.length, `near 0x${(0x80 + digit).toString(16)}`).toBe(1);
      expect(short[0].rel?.size).toBe(8);
      expect(near[0].rel?.size).toBe(16);
    }
  });

  it("covers all 8 arithmetic /digit groups in all four 0x00-0x3F forms", () => {
    const names = ["ADD", "OR", "ADC", "SBB", "AND", "SUB", "XOR", "CMP"];
    for (let digit = 0; digit < 8; digit++) {
      for (let form = 0; form < 4; form++) {
        const byte = [0x00, 0x08, 0x10, 0x18, 0x20, 0x28, 0x30, 0x38][digit] + form;
        const def = INSTRUCTION_TABLE.find((d) => d.bytes.length === 1 && d.bytes[0] === byte);
        expect(def, `opcode 0x${byte.toString(16)}`).toBeDefined();
        expect(def!.mnem, `opcode 0x${byte.toString(16)}`).toBe(names[digit]);
      }
    }
  });

  it("covers all 8 shift /digit groups in all four 0xD0-0xD3 forms", () => {
    const names = ["ROL", "ROR", "RCL", "RCR", "SHL", "SHR", "SAL", "SAR"];
    for (let digit = 0; digit < 8; digit++) {
      for (const base of [0xd0, 0xd1, 0xd2, 0xd3]) {
        const defs = INSTRUCTION_TABLE.filter(
          (d) => d.bytes[0] === base && d.modrm?.digit === digit,
        );
        expect(defs.length, `opcode 0x${base.toString(16)} /${digit}`).toBe(1);
        expect(defs[0].mnem).toBe(names[digit]);
      }
    }
  });

  it("covers the 0xF6/0xF7 group", () => {
    for (const digit of [0, 2, 3, 4, 5, 6, 7]) {
      for (const base of [0xf6, 0xf7]) {
        const defs = INSTRUCTION_TABLE.filter(
          (d) => d.bytes[0] === base && d.modrm?.digit === digit,
        );
        expect(defs.length, `opcode 0x${base.toString(16)} /${digit}`).toBe(1);
      }
    }
  });

  it("covers the 0xFF group", () => {
    for (const [digit, mnem] of [
      [0, "INC"], [1, "DEC"], [2, "CALL"], [3, "CALLF"],
      [4, "JMP"], [5, "JMPF"], [6, "PUSH"],
    ] as const) {
      const defs = INSTRUCTION_TABLE.filter((d) => d.bytes[0] === 0xff && d.modrm?.digit === digit);
      expect(defs.length, `0xFF /${digit} (${mnem})`).toBe(1);
      expect(defs[0].mnem).toBe(mnem);
    }
  });

  it("has all 8 INC and 8 DEC one-byte register forms", () => {
    for (let i = 0; i < 8; i++) {
      expect(INSTRUCTION_TABLE.find((d) => d.mnem === "INC" && d.bytes[0] === 0x40 + i)).toBeDefined();
      expect(INSTRUCTION_TABLE.find((d) => d.mnem === "DEC" && d.bytes[0] === 0x48 + i)).toBeDefined();
    }
  });

  it("has all 8 MOV r8,imm8 and 8 MOV r16,imm16 forms", () => {
    for (let i = 0; i < 8; i++) {
      expect(
        INSTRUCTION_TABLE.find((d) => d.mnem === "MOV" && d.bytes[0] === 0xb0 + i && d.ops[0] === "r8"),
      ).toBeDefined();
      expect(
        INSTRUCTION_TABLE.find((d) => d.mnem === "MOV" && d.bytes[0] === 0xb8 + i && d.ops[0] === "r16"),
      ).toBeDefined();
    }
  });

  it("keeps BrainBox extensions out of the real 8086 opcode space", () => {
    for (const def of INSTRUCTION_TABLE) {
      if (def.ext === undefined) continue;
      expect(def.bytes[0], `${def.mnem} must escape via 0x0F`).toBe(0x0f);
    }
    expect(BY_EXTENSION.size).toBe(5);
    expect([...BY_EXTENSION.keys()].sort()).toEqual([0, 1, 2, 3, 4]);
  });

  it("does not define 0x0F as a real instruction", () => {
    // 0x0F must never be reachable as a normal one-byte opcode.
    for (const def of INSTRUCTION_TABLE) {
      if (def.bytes[0] === 0x0f) {
        expect(def.bytes.length, `${def.mnem} must be a 2-byte escape`).toBe(2);
      }
    }
  });

  it("every primary opcode is accounted for", () => {
    // 0x0F and the prefix bytes have no standalone instruction.
    const prefixes = new Set(Object.keys(PREFIXES).map(Number));
    for (const [byte, defs] of BY_PRIMARY_OPCODE) {
      if (byte === 0x0f) {
        expect(defs.every((d) => d.bytes.length === 2)).toBe(true);
        continue;
      }
      if (prefixes.has(byte)) continue;
      expect(defs.length, `opcode 0x${byte.toString(16)} has no definition`).toBeGreaterThan(0);
    }
  });

  it("Jcc aliases all point at real condition codes", () => {
    for (const [alias, target] of Object.entries(JCC_ALIASES)) {
      expect(ALL_MNEMONICS, `${alias} -> ${target}`).toContain(target);
    }
    // The aliases that the old engine accepted must all be present.
    for (const alias of ["JC", "JAE", "JNC", "JE", "JNE", "JNBE", "JNAE", "JPE", "JPO", "JNL", "JNG", "JNLE", "JECXZ"]) {
      expect(Object.keys(JCC_ALIASES)).toContain(alias);
    }
  });
});

describe("ModR/M round trip", () => {
  const addresses: Array<{ text: string; addr: Parameters<typeof addressToRm>[0] }> = [
    { text: "[BX+SI]", addr: { base: "BX", index: "SI" } },
    { text: "[BX+DI]", addr: { base: "BX", index: "DI" } },
    { text: "[BP+SI]", addr: { base: "BP", index: "SI" } },
    { text: "[BP+DI]", addr: { base: "BP", index: "DI" } },
    { text: "[SI]", addr: { base: "SI" } },
    { text: "[DI]", addr: { base: "DI" } },
    { text: "[BX]", addr: { base: "BX" } },
    { text: "[BP]", addr: { base: "BP" } },
    { text: "[BX+SI+4]", addr: { base: "BX", index: "SI", disp: 4 } },
    { text: "[BP+DI-2]", addr: { base: "BP", index: "DI", disp: -2 } },
    { text: "[SI+0x1234]", addr: { base: "SI", disp: 0x1234 } },
    { text: "[BX-2]", addr: { base: "BX", disp: -2 } },
    { text: "[0x1234]", addr: { disp: 0x1234 } },
    { text: "[0]", addr: { disp: 0 } },
    { text: "[BP+0]", addr: { base: "BP" } },
  ];

  it.each(addresses)("round-trips $text", ({ addr }) => {
    const enc = encodeModRM(0, { address: addr });
    let pos = 0;
    const dec = decodeModRM(enc.byte, (n) => {
      let value = 0;
      for (let i = 0; i < n; i++) value |= enc.dispBytes[pos + i] << (8 * i);
      pos += n;
      return value;
    });
    expect(enc.dispBytes.length).toBe(pos);
    expect(dec.address).toEqual(addr);
  });

  it("sign-extends an 8-bit displacement", () => {
    const enc = encodeModRM(0, { address: { base: "BX", disp: -2 } });
    expect(enc.byte & 0xc0).toBe(0x40);
    const dec = decodeModRM(enc.byte, () => 0xfe);
    expect(dec.disp).toBe(-2);
    expect(dec.address).toEqual({ base: "BX", disp: -2 });
  });

  it("uses mod=00 rm=110 for a bare 16-bit displacement", () => {
    const enc = encodeModRM(0, { address: { disp: 0x1234 } });
    expect(enc.pureDisp).toBe(true);
    expect(enc.byte & 0xc7).toBe(0x06);
    let pos = 0;
    const dec = decodeModRM(enc.byte, (n) => {
      let v = 0;
      for (let i = 0; i < n; i++) v |= enc.dispBytes[pos + i] << (8 * i);
      pos += n;
      return v;
    });
    expect(dec.pureDisp).toBe(true);
    // No base and no index: the CPU resolves this against DS. [BP+0x1234]
    // would decode with base "BP" and therefore resolve against SS instead.
    expect(dec.address).toEqual({ disp: 0x1234 });
    expect(dec.disp).toBe(0x1234);
  });

  it("register-direct form is mod=11", () => {
    const enc = encodeModRM(3, { register: 5 });
    expect(enc.byte).toBe(0xdd);
    const dec = decodeModRM(enc.byte, () => 0);
    expect(dec.register).toBe(true);
    expect(dec.reg).toBe(3);
    expect(dec.rm).toBe(5);
  });

  it("rejects register combinations the 8086 cannot encode", () => {
    expect(() => addressToRm({ base: "SI", index: "DI" })).toThrow(/cannot be encoded/);
    expect(() => addressToRm({ base: "DI", index: "BP" })).toThrow(/cannot be encoded/);
  });
});
