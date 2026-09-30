/**
 * engine/isa/table.ts — the single 8086 instruction table.
 *
 * This is the only description of the 8086 in the codebase. The encoder
 * (assembler/encoder.ts) and the decoder (cpu/decode.ts) both consume the very
 * same `InsnDef` objects, so an encoding and its decoding cannot drift apart:
 * if the table is wrong, both are wrong in the same way and the round-trip
 * test in isa/table.test.ts fails.
 *
 * Each entry describes *where the bytes go*, not how to execute the
 * instruction. Execution lives in cpu/execute.ts keyed on `mnem`.
 *
 * Encoding conventions used by the `bytes` field:
 *   - Plain numbers are literal opcode bytes.
 *   - `modrm` describes where the ModR/M byte goes and which operand supplies
 *     each of its three fields.
 *   - `imm`/`rel`/`moffs`/`ptr` describe trailing immediates.
 */
/** Index of an operand within `ops`. */
export type OperandSlot = number;

export type OperandType =
  | "none"
  /** 8-bit register encoded in the low 3 bits of the primary opcode. */
  | "r8"
  /** 16-bit register encoded in the low 3 bits of the primary opcode. */
  | "r16"
  /** 8-bit register in the ModR/M reg field. */
  | "reg8"
  /** 16-bit register in the ModR/M reg field. */
  | "reg16"
  /** 8-bit register or memory in the ModR/M r/m field. */
  | "rm8"
  /** 16-bit register or memory in the ModR/M r/m field. */
  | "rm16"
  /** 16-bit direct memory offset (moffs). */
  | "moffs8"
  | "moffs16"
  | "imm8"
  | "imm16"
  /** Byte displacement relative to the end of the instruction. */
  | "rel8"
  | "rel16"
  /** Segment register. */
  | "sreg"
  /** Implied accumulator. */
  | "al"
  | "ax"
  | "dx"
  | "cl"
  | "one"
  | "three"
  /** 16-bit offset:16-bit segment far pointer. */
  | "ptr16"
  /** Assembler-internal: a label/branch target resolved to rel8 or rel16. */
  | "label";

export interface ModRMShape {
  /**
   * Operand supplying the ModR/M *reg* field. This is deliberately distinct
   * from `digit`: a group instruction (`op r/m, imm`) has a fixed /digit and
   * no reg operand, and conflating the two made the table impossible to check
   * statically.
   */
  reg?: OperandSlot;
  /**
   * A fixed /digit in the ModR/M reg field, for instructions like
   * `ADD r/m8, imm8` where the reg field selects the operation rather than an
   * operand. Mutually exclusive with `reg` and `sreg`.
   */
  digit?: number;
  /** Operand supplying the r/m field. */
  rm?: OperandSlot;
  /** Operand supplying the reg field as a segment register (0x8C/0x8E). */
  sreg?: OperandSlot;
  /** 1 = the reg field is a segment register rather than a /digit. */
  regIsSegment?: boolean;
  /** Restrict to register-direct (mod=11); LEA/LEA-style forms need mod!=11. */
  mod3Only?: boolean;
  /** Restrict to memory form (mod!=11). */
  mod3Forbidden?: boolean;
}

export interface InsnDef {
  /** Canonical mnemonic, upper case. */
  readonly mnem: string;
  /** Operand kinds, in operand order (destination first, Intel syntax). */
  readonly ops: readonly OperandType[];
  /** Literal opcode bytes, before any ModR/M byte. */
  readonly bytes: readonly number[];
  /**
   * Set when the opcode *is* the register-specific form of a group, i.e. the
   * register number lives in the low three bits of the opcode (0x40-0x4F
   * INC/DEC, 0x50-0x5F PUSH/POP, 0x90-0x97 XCHG, 0xB0-0xBF MOV reg,imm).
   *
   * Without this the table could not tell `INC BX` (0x43) from `INC SI`
   * (0x46), because both entries declare the same operand slot. The encoder
   * uses it to require that the operand really is register `code`, and the
   * decoder uses it to report the register a byte decodes to.
   */
  readonly opcodeReg?: { slot: OperandSlot; code: number };
  /**
   * Set when the opcode names one specific segment register, i.e. the segment
   * `PUSH`/`POP` forms `0x06 0x07`, `0x0E 0x0F`, `0x16 0x17` and `0x1E 0x1F`,
   * where there is no ModR/M byte and the segment *is* the instruction.
   *
   * This is needed for the same reason `opcodeReg` is. The encoder matches
   * candidate entries on operand shape, and all seven of these take a single
   * `sreg`, so without this they would be indistinguishable and `PUSH ES` would
   * encode to whichever entry the table happened to list first -- assembling
   * cleanly and then pushing DS. Silent, and worse than a refusal.
   */
  readonly opcodeSreg?: { slot: OperandSlot; code: number };
  readonly modrm?: ModRMShape;
  readonly imm?: {
    slot: OperandSlot;
    size: 8 | 16;
    /**
     * True for 0x83, whose byte is sign-extended to 16 bits. It matters twice:
     * the CPU must extend rather than zero, and the encoder prefers this form
     * over a 16-bit immediate when both are the same length, which is what
     * makes `add ax,1` come out as 83 C0 01 rather than 05 01 00.
     */
    signExtend?: boolean;
  };
  /**
   * A second immediate. No 8086 instruction has one -- the only entry that ever
   * did was `ENTER` (0xC8), which takes a frame size and a nesting level, and
   * ENTER is 80186. The field is kept because the decoder and encoder both read
   * it, and a table that cannot express a second immediate would push that
   * decision into three files instead of one.
   */
  readonly imm2?: { slot: OperandSlot; size: 8 | 16; signExtend?: boolean };
  /** Relative branch target. */
  readonly rel?: { slot: OperandSlot; size: 8 | 16 };
  /** moffs operand slot. */
  readonly moffs?: OperandSlot;
  /** Far pointer (off16, seg16) operand slot. */
  readonly ptr?: OperandSlot;
  /** Flags this instruction can affect ("OF" etc). Documentation + debugger. */
  readonly flags: readonly string[];
  /** True for undocumented 8086 forms that are still widely emitted. */
  readonly undocumented?: boolean;
  /** BrainBox extension: 0x0F sub-opcode byte. */
  readonly ext?: number;
  /** Human-readable note used by the disassembler and error messages. */
  readonly note?: string;
}

// --------------------------------------------------------------------------
// Table construction helpers
// --------------------------------------------------------------------------

/** Arithmetic/logic /digit for opcodes 0x00-0x3F and 0x80-0x83. */
const ARITH: ReadonlyArray<{ digit: number; mnem: string; base: number; flags: string[] }> = [
  { digit: 0, mnem: "ADD", base: 0x00, flags: ["OF", "SF", "ZF", "AF", "PF", "CF"] },
  { digit: 1, mnem: "OR", base: 0x08, flags: ["SF", "ZF", "PF"] },
  { digit: 2, mnem: "ADC", base: 0x10, flags: ["OF", "SF", "ZF", "AF", "PF", "CF"] },
  { digit: 3, mnem: "SBB", base: 0x18, flags: ["OF", "SF", "ZF", "AF", "PF", "CF"] },
  { digit: 4, mnem: "AND", base: 0x20, flags: ["SF", "ZF", "PF"] },
  { digit: 5, mnem: "SUB", base: 0x28, flags: ["OF", "SF", "ZF", "AF", "PF", "CF"] },
  { digit: 6, mnem: "XOR", base: 0x30, flags: ["SF", "ZF", "PF"] },
  { digit: 7, mnem: "CMP", base: 0x38, flags: ["OF", "SF", "ZF", "AF", "PF", "CF"] },
];

/** Shift/rotate /digit for opcodes 0xD0-0xD3. */
const SHIFT: ReadonlyArray<{ digit: number; mnem: string; note?: string }> = [
  { digit: 0, mnem: "ROL" },
  { digit: 1, mnem: "ROR" },
  { digit: 2, mnem: "RCL" },
  { digit: 3, mnem: "RCR" },
  { digit: 4, mnem: "SHL" },
  { digit: 5, mnem: "SHR" },
  // 0xD0-0xD3 /6 is undefined on an 8086. SAL is not a separate opcode: it is
  // a second name for /4, handled by SHIFT_ALIASES below. Encoding it as /6
  // would be wrong, and gas confirms it emits D1 E0 for `sal ax,1`.
  { digit: 7, mnem: "SAR" },
];

const SHIFT_FLAGS = ["CF", "OF", "SF", "ZF", "AF", "PF"];

/** Shifts whose only 8086 opcode is spelled under a different name. */
export const SHIFT_ALIASES: Readonly<Record<string, string>> = {
  SAL: "SHL",
};

/**
 * LOOPE/LOOPNE also go by LOOPZ/LOOPNZ. They are listed as notes on the table
 * entries rather than as entries of their own, because two entries with the same
 * opcode and operand shape make encoding ambiguous -- the table asserts against
 * that, and rightly so.
 */
export const LOOP_ALIASES: Readonly<Record<string, string>> = {
  LOOPZ: "LOOPE",
  LOOPNZ: "LOOPNE",
};

/** Jcc aliases, short jumps (0x70-0x7F) and near jumps (0x80-0x8F). */
const JCC: ReadonlyArray<{ digit: number; mnem: string; condition: string }> = [
  { digit: 0, mnem: "JO", condition: "OF=1" },
  { digit: 1, mnem: "JNO", condition: "OF=0" },
  { digit: 2, mnem: "JB", condition: "CF=1" },
  { digit: 3, mnem: "JNB", condition: "CF=0" },
  { digit: 4, mnem: "JZ", condition: "ZF=1" },
  { digit: 5, mnem: "JNZ", condition: "ZF=0" },
  { digit: 6, mnem: "JBE", condition: "CF=1 or ZF=1" },
  { digit: 7, mnem: "JA", condition: "CF=0 and ZF=0" },
  { digit: 8, mnem: "JS", condition: "SF=1" },
  { digit: 9, mnem: "JNS", condition: "SF=0" },
  { digit: 10, mnem: "JP", condition: "PF=1" },
  { digit: 11, mnem: "JNP", condition: "PF=0" },
  { digit: 12, mnem: "JL", condition: "SF!=OF" },
  { digit: 13, mnem: "JGE", condition: "SF=OF" },
  { digit: 14, mnem: "JLE", condition: "ZF=1 or SF!=OF" },
  { digit: 15, mnem: "JG", condition: "ZF=0 and SF=OF" },
];

/**
 * Jcc aliases that map onto the same encoding. The encoder accepts any of
 * these; the decoder reports the first name.
 */
export const JCC_ALIASES: Readonly<Record<string, string>> = {
  JC: "JB",
  JAE: "JNB",
  JNC: "JNB",
  JE: "JZ",
  JNE: "JNZ",
  JBE: "JBE",
  JNBE: "JA",
  JNAE: "JB",
  JPE: "JP",
  JPO: "JNP",
  JL: "JL",
  JNLE: "JG",
  JGE: "JGE",
  JNL: "JGE",
  JLE: "JLE",
  JNG: "JLE",
  JECXZ: "JCXZ",
};

function buildTable(): InsnDef[] {
  const table: InsnDef[] = [];

  // -- 0x00-0x3F: the eight arithmetic/logic operations, 8 forms each -------
  // Opcode bit 0 selects byte/word; opcode bit 3 selects the direction
  // (0 = "op r/m, reg", 1 = "op reg, r/m"), which is what decides whether the
  // plain register lands in the ModR/M reg field or the r/m field.
  for (const op of ARITH) {
    const forms: ReadonlyArray<{
      byte: number;
      ops: readonly OperandType[];
      reg: OperandSlot;
      rm: OperandSlot;
    }> = [
      { byte: op.base + 0, ops: ["rm8", "r8"], reg: 1, rm: 0 },
      { byte: op.base + 1, ops: ["rm16", "r16"], reg: 1, rm: 0 },
      { byte: op.base + 2, ops: ["r8", "rm8"], reg: 0, rm: 1 },
      { byte: op.base + 3, ops: ["r16", "rm16"], reg: 0, rm: 1 },
    ];
    for (const f of forms) {
      table.push({
        mnem: op.mnem,
        ops: f.ops,
        bytes: [f.byte],
        modrm: { reg: f.reg, rm: f.rm },
        flags: op.flags,
      });
    }
  }

  // -- 0x06/0x0E/0x16/0x1E: the segment PUSH and POP forms ----------------
  // These are the `+6`/`+7` slots of the first four 8-byte groups, and on an
  // 8086 they are the segment register stack forms. `ES` is group 0, `CS` is
  // group 1, `SS` is group 2 and `DS` is group 3, so the opcode is derivable
  // from the group exactly as the arithmetic opcodes above are.
  //
  // `POP CS` (0x0F) is the one form left out. It is encodable on real
  // hardware, but 0x0F is this engine's BrainBox extension escape, and a byte
  // cannot be both. `SALC` (0xD6) and the `AAM`/`AAD` imm forms are omitted for
  // the ordinary reason: undocumented or not worth a spelling.
  for (const [code, segment] of [
    [0, "ES"],
    [1, "CS"],
    [2, "SS"],
    [3, "DS"],
  ] as const) {
    const base = code * 8;
    table.push({
      mnem: "PUSH",
      ops: ["sreg"],
      bytes: [base + 6],
      opcodeSreg: { slot: 0, code },
      flags: [],
      note: `SP -= 2; SS:SP <- ${segment}`,
    });
    if (segment === "CS") continue; // 0x0F is the extension escape, not POP CS
    table.push({
      mnem: "POP",
      ops: ["sreg"],
      bytes: [base + 7],
      opcodeSreg: { slot: 0, code },
      flags: [],
      note: `${segment} <- SS:SP; SP += 2`,
    });
  }

  // -- 0x27/0x2F/0x37/0x3F: the four BCD adjust instructions ----------------
  table.push(
    { mnem: "DAA", ops: ["none"], bytes: [0x27], flags: ["CF", "AF"] },
    { mnem: "DAS", ops: ["none"], bytes: [0x2f], flags: ["CF", "AF"] },
    { mnem: "AAA", ops: ["none"], bytes: [0x37], flags: ["CF", "AF"] },
    { mnem: "AAS", ops: ["none"], bytes: [0x3f], flags: ["CF", "AF"] },
  );

  // -- accumulator short forms: op AL,imm8 / op AX,imm16 ------------------
  // These sit at +4 and +5 within each arithmetic group and name the
  // accumulator directly, which is why they encode a byte shorter than the
  // 0x80-0x83 group. `ADD AL,1` is 04 01, not 80 C0 01.
  for (const op of ARITH) {
    table.push({
      mnem: op.mnem,
      ops: ["al", "imm8"],
      bytes: [op.base + 4],
      imm: { slot: 1, size: 8 },
      flags: op.flags,
    });
    table.push({
      mnem: op.mnem,
      ops: ["ax", "imm16"],
      bytes: [op.base + 5],
      imm: { slot: 1, size: 16 },
      flags: op.flags,
    });
  }

  // -- 0x40-0x7F: INC/DEC r16 --------------------------------------------
  for (let i = 0; i < 8; i++) {
    table.push({
      mnem: "INC",
      ops: ["r16"],
      bytes: [0x40 + i],
      opcodeReg: { slot: 0, code: i },
      flags: ["OF", "SF", "ZF", "AF", "PF"],
    });
  }

  // -- 0x60-0x6F: deliberately absent ------------------------------------
  // The whole block is 80186: PUSHA/POPA (60/61), BOUND (62), ARPL (63),
  // PUSH imm16 (68), IMUL r,rm,imm16 (69), PUSH imm8 (6A), IMUL r,rm,imm8
  // (6B), and the string port I/O INSB/INSW/OUTSB/OUTSW (6C-6F).
  //
  // These four string I/O entries were here once, under a comment that said the
  // range "is otherwise 80186+ and is deliberately not modelled" -- in the same
  // breath as modelling it. A 8086 has no string port instructions at all: port
  // I/O is only `IN` and `OUT`, a byte or word between AL/AX and DX. So
  // `REP INSW` is not something this engine should be able to assemble.
  //
  // The comment is the lesson as much as the removal: a boundary that is only
  // described in prose gets crossed. `isa-boundary.test.ts` now asserts the
  // opcodes are undecodable.


  // -- 0x50-0x5F: PUSH/POP r16 -------------------------------------------
  // On the 8086 PUSH and POP default to SS; that is what the segment
  // prefix-less form means, and the CPU supplies SS.
  for (let i = 0; i < 8; i++) {
    table.push({
      mnem: "PUSH",
      ops: ["r16"],
      bytes: [0x50 + i],
      opcodeReg: { slot: 0, code: i },
      flags: [],
    });
    table.push({
      mnem: "POP",
      ops: ["r16"],
      bytes: [0x58 + i],
      opcodeReg: { slot: 0, code: i },
      flags: [],
    });
    table.push({
      mnem: "DEC",
      ops: ["r16"],
      bytes: [0x48 + i],
      opcodeReg: { slot: 0, code: i },
      flags: ["OF", "SF", "ZF", "AF", "PF"],
    });
  }

  // -- 0x80-0x83: op r/m, imm ---------------------------------------------
  for (const op of ARITH) {
    table.push({
      mnem: op.mnem,
      ops: ["rm8", "imm8"],
      bytes: [0x80],
      modrm: { digit: op.digit, rm: 0 },
      imm: { slot: 1, size: 8 },
      flags: op.flags,
    });
    table.push({
      mnem: op.mnem,
      ops: ["rm16", "imm16"],
      bytes: [0x81],
      modrm: { digit: op.digit, rm: 0 },
      imm: { slot: 1, size: 16 },
      flags: op.flags,
    });
    table.push({
      mnem: op.mnem,
      ops: ["rm8", "imm8"],
      bytes: [0x82],
      modrm: { digit: op.digit, rm: 0 },
      imm: { slot: 1, size: 8 },
      flags: op.flags,
      undocumented: true,
      note: "0x82 is an alias of 0x80",
    });
    table.push({
      mnem: op.mnem,
      ops: ["rm16", "imm8"],
      bytes: [0x83],
      modrm: { digit: op.digit, rm: 0 },
      imm: { slot: 1, size: 8, signExtend: true },
      flags: op.flags,
      note: "imm8 is sign-extended to 16 bits",
    });
  }

  // -- 0x84-0x8F ---------------------------------------------------------
  table.push(
    { mnem: "TEST", ops: ["rm8", "r8"], bytes: [0x84], modrm: { reg: 1, rm: 0 }, flags: ["SF", "ZF", "PF"] },
    { mnem: "TEST", ops: ["rm16", "r16"], bytes: [0x85], modrm: { reg: 1, rm: 0 }, flags: ["SF", "ZF", "PF"] },
    { mnem: "XCHG", ops: ["rm8", "r8"], bytes: [0x86], modrm: { reg: 1, rm: 0 }, flags: [] },
    { mnem: "XCHG", ops: ["rm16", "r16"], bytes: [0x87], modrm: { reg: 1, rm: 0 }, flags: [] },
    // XCHG is commutative, so `xchg ax,[bx]` has to encode the same way as
    // `xchg [bx],ax`; only the destination of the store differs. gas confirms
    // both spellings produce 87 04.
    { mnem: "XCHG", ops: ["r8", "rm8"], bytes: [0x86], modrm: { reg: 0, rm: 1 }, flags: [] },
    { mnem: "XCHG", ops: ["r16", "rm16"], bytes: [0x87], modrm: { reg: 0, rm: 1 }, flags: [] },
    { mnem: "MOV", ops: ["rm8", "r8"], bytes: [0x88], modrm: { reg: 1, rm: 0 }, flags: [] },
    { mnem: "MOV", ops: ["rm16", "r16"], bytes: [0x89], modrm: { reg: 1, rm: 0 }, flags: [] },
    { mnem: "MOV", ops: ["r8", "rm8"], bytes: [0x8a], modrm: { reg: 0, rm: 1 }, flags: [] },
    { mnem: "MOV", ops: ["r16", "rm16"], bytes: [0x8b], modrm: { reg: 0, rm: 1 }, flags: [] },
    {
      mnem: "MOV",
      ops: ["rm16", "sreg"],
      bytes: [0x8c],
      modrm: { sreg: 1, rm: 0, regIsSegment: true },
      flags: [],
    },
    {
      mnem: "MOV",
      ops: ["sreg", "rm16"],
      bytes: [0x8e],
      modrm: { sreg: 0, rm: 1, regIsSegment: true },
      flags: [],
    },
    {
      mnem: "LEA",
      ops: ["r16", "rm16"],
      bytes: [0x8d],
      modrm: { reg: 0, rm: 1, mod3Forbidden: true },
      flags: [],
      note: "LEA computes the effective address; it never reads memory",
    },
    {
      mnem: "POP",
      ops: ["rm16"],
      bytes: [0x8f],
      modrm: { digit: 0, rm: 0 },
      flags: [],
    },
  );

  // -- 0x90-0x9F ---------------------------------------------------------
  for (let i = 0; i < 8; i++) {
    table.push({
      mnem: i === 0 ? "NOP" : "XCHG",
      ops: i === 0 ? ["none"] : ["ax", "r16"],
      bytes: [0x90 + i],
      // 0x90+reg is XCHG AX,reg; 0x90 alone is the one-byte NOP.
      ...(i === 0 ? { note: "0x90 is the canonical one-byte NOP" } : { opcodeReg: { slot: 1, code: i } }),
      flags: [],
    });
  }
  table.push(
    { mnem: "CBW", ops: ["none"], bytes: [0x98], flags: [] },
    { mnem: "CWD", ops: ["none"], bytes: [0x99], flags: [] },
    { mnem: "CALLF", ops: ["ptr16"], bytes: [0x9a], ptr: 0, flags: [] },
    { mnem: "WAIT", ops: ["none"], bytes: [0x9b], flags: [] },
    { mnem: "PUSHF", ops: ["none"], bytes: [0x9c], flags: [] },
    { mnem: "POPF", ops: ["none"], bytes: [0x9d], flags: ["OF", "SF", "ZF", "AF", "PF", "CF", "DF", "IF", "TF"] },
    { mnem: "SAHF", ops: ["none"], bytes: [0x9e], flags: ["SF", "ZF", "AF", "PF", "CF"] },
    { mnem: "LAHF", ops: ["none"], bytes: [0x9f], flags: [] },
  );

  // -- 0xA0-0xAF ---------------------------------------------------------
  table.push(
    { mnem: "MOV", ops: ["al", "moffs8"], bytes: [0xa0], moffs: 1, flags: [] },
    { mnem: "MOV", ops: ["ax", "moffs16"], bytes: [0xa1], moffs: 1, flags: [] },
    { mnem: "MOV", ops: ["moffs8", "al"], bytes: [0xa2], moffs: 0, flags: [] },
    { mnem: "MOV", ops: ["moffs16", "ax"], bytes: [0xa3], moffs: 0, flags: [] },
    { mnem: "MOVSB", ops: ["none"], bytes: [0xa4], flags: ["DF"], note: "ES:[DI] <- DS:[SI]" },
    { mnem: "MOVSW", ops: ["none"], bytes: [0xa5], flags: ["DF"], note: "ES:[DI] <- DS:[SI]" },
    { mnem: "CMPSB", ops: ["none"], bytes: [0xa6], flags: ["ZF", "SF", "PF", "CF", "AF", "OF", "DF"] },
    { mnem: "CMPSW", ops: ["none"], bytes: [0xa7], flags: ["ZF", "SF", "PF", "CF", "AF", "OF", "DF"] },
    { mnem: "TEST", ops: ["al", "imm8"], bytes: [0xa8], imm: { slot: 1, size: 8 }, flags: ["SF", "ZF", "PF"] },
    { mnem: "TEST", ops: ["ax", "imm16"], bytes: [0xa9], imm: { slot: 1, size: 16 }, flags: ["SF", "ZF", "PF"] },
    { mnem: "STOSB", ops: ["none"], bytes: [0xaa], flags: ["DF"], note: "ES:[DI] <- AL" },
    { mnem: "STOSW", ops: ["none"], bytes: [0xab], flags: ["DF"], note: "ES:[DI] <- AX" },
    { mnem: "LODSB", ops: ["none"], bytes: [0xac], flags: ["DF"], note: "AL <- DS:[SI]" },
    { mnem: "LODSW", ops: ["none"], bytes: [0xad], flags: ["DF"], note: "AX <- DS:[SI]" },
    { mnem: "SCASB", ops: ["none"], bytes: [0xae], flags: ["ZF", "SF", "PF", "CF", "AF", "OF", "DF"] },
    { mnem: "SCASW", ops: ["none"], bytes: [0xaf], flags: ["ZF", "SF", "PF", "CF", "AF", "OF", "DF"] },
  );

  // -- 0xB0-0xBF: MOV reg, imm -------------------------------------------
  for (let i = 0; i < 8; i++) {
    table.push({
      mnem: "MOV",
      ops: ["r8", "imm8"],
      bytes: [0xb0 + i],
      opcodeReg: { slot: 0, code: i },
      imm: { slot: 1, size: 8 },
      flags: [],
    });
    table.push({
      mnem: "MOV",
      ops: ["r16", "imm16"],
      bytes: [0xb8 + i],
      opcodeReg: { slot: 0, code: i },
      imm: { slot: 1, size: 16 },
      flags: [],
    });
  }

  // -- 0xC0-0xCF ---------------------------------------------------------
  table.push(
    { mnem: "RET", ops: ["imm16"], bytes: [0xc2], imm: { slot: 0, size: 16 }, flags: [] },
    { mnem: "RET", ops: ["none"], bytes: [0xc3], flags: [] },
    { mnem: "LES", ops: ["r16", "rm16"], bytes: [0xc4], modrm: { reg: 0, rm: 1, mod3Forbidden: true }, flags: [] },
    { mnem: "LDS", ops: ["r16", "rm16"], bytes: [0xc5], modrm: { reg: 0, rm: 1, mod3Forbidden: true }, flags: [] },
    { mnem: "MOV", ops: ["rm8", "imm8"], bytes: [0xc6], modrm: { digit: 0, rm: 0 }, imm: { slot: 1, size: 8 }, flags: [] },
    { mnem: "MOV", ops: ["rm16", "imm16"], bytes: [0xc7], modrm: { digit: 0, rm: 0 }, imm: { slot: 1, size: 16 }, flags: [] },
    // 0xC8 ENTER and 0xC9 LEAVE are 80186, so they are not in the table, and
    // neither is the `imm2` field that existed only for ENTER. 0xCA is a
    // different case and belongs here: `RETF imm16` is 8086, the sibling of
    // the plain `RETF` at 0xCB below, and it was left out on the belief that a
    // far return could only take an immediate from the 80186 onwards. It could
    // not. See src/engine/isa/return-forms.test.ts.
    { mnem: "RETF", ops: ["imm16"], bytes: [0xca], imm: { slot: 0, size: 16 }, flags: [] },
    { mnem: "RETF", ops: ["none"], bytes: [0xcb], flags: [] },
    { mnem: "INT3", ops: ["none"], bytes: [0xcc], flags: [], note: "INT 3" },
    { mnem: "INT", ops: ["imm8"], bytes: [0xcd], imm: { slot: 0, size: 8 }, flags: [] },
    { mnem: "INTO", ops: ["none"], bytes: [0xce], flags: [], undocumented: true },
    { mnem: "IRET", ops: ["none"], bytes: [0xcf], flags: ["OF", "SF", "ZF", "AF", "PF", "CF", "DF", "IF", "TF"] },
  );

  // -- 0xC0/0xC1: deliberately absent -------------------------------------
  // These are the 80186 "shift/rotate by an 8-bit immediate" opcodes. They were
  // in this table once, with the reasoning that `shl ax,4` is what people write
  // and it needs an encoding. That reasoning is the bug: the bytes came out as
  // `C1 E8 04`, which an 8086 treats as a reserved opcode. The program ran here
  // and would not run on the machine it was written for, and nothing failed.
  //
  // On an 8086 the only shift counts are the implied 1 (`D0`/`D1`) and CL
  // (`D2`/`D3`). `shl ax,4` has to be written as `mov cl,4` / `shl ax,cl`, which
  // is what it was always assembled to on real hardware.
  //
  // `isa-boundary.test.ts` pins both halves of this: the immediate form must be
  // refused, and `shl ax,1` and `shl ax,cl` must keep working.

  // -- 0xD0-0xD3: shift/rotate group -------------------------------------
  for (const op of SHIFT) {
    table.push({
      mnem: op.mnem,
      ops: ["rm8", "one"],
      bytes: [0xd0],
      modrm: { digit: op.digit, rm: 0 },
      flags: SHIFT_FLAGS,
      ...(op.note ? { note: op.note } : {}),
    });
    table.push({
      mnem: op.mnem,
      ops: ["rm16", "one"],
      bytes: [0xd1],
      modrm: { digit: op.digit, rm: 0 },
      flags: SHIFT_FLAGS,
      ...(op.note ? { note: op.note } : {}),
    });
    table.push({
      mnem: op.mnem,
      ops: ["rm8", "cl"],
      bytes: [0xd2],
      modrm: { digit: op.digit, rm: 0 },
      flags: SHIFT_FLAGS,
      ...(op.note ? { note: op.note } : {}),
    });
    table.push({
      mnem: op.mnem,
      ops: ["rm16", "cl"],
      bytes: [0xd3],
      modrm: { digit: op.digit, rm: 0 },
      flags: SHIFT_FLAGS,
      ...(op.note ? { note: op.note } : {}),
    });
  }
  table.push(
    { mnem: "AAM", ops: ["imm8"], bytes: [0xd4], imm: { slot: 0, size: 8 }, flags: ["SF", "ZF", "PF"], note: "default radix 10" },
    { mnem: "AAD", ops: ["imm8"], bytes: [0xd5], imm: { slot: 0, size: 8 }, flags: ["SF", "ZF", "PF"], note: "default radix 10" },
    { mnem: "SALC", ops: ["none"], bytes: [0xd6], flags: [], undocumented: true, note: "MOV AL,CF" },
    { mnem: "XLAT", ops: ["none"], bytes: [0xd7], flags: [], note: "AL <- DS:[BX+AL]" },
  );

  // -- 0xE0-0xEF ---------------------------------------------------------
  table.push(
    { mnem: "LOOPNE", ops: ["rel8"], bytes: [0xe0], rel: { slot: 0, size: 8 }, flags: ["ZF"], note: "alias LOOPNZ" },
    { mnem: "LOOPE", ops: ["rel8"], bytes: [0xe1], rel: { slot: 0, size: 8 }, flags: ["ZF"], note: "alias LOOPZ" },
    { mnem: "LOOP", ops: ["rel8"], bytes: [0xe2], rel: { slot: 0, size: 8 }, flags: [] },
    { mnem: "JCXZ", ops: ["rel8"], bytes: [0xe3], rel: { slot: 0, size: 8 }, flags: [] },
    { mnem: "IN", ops: ["al", "imm8"], bytes: [0xe4], imm: { slot: 1, size: 8 }, flags: [] },
    { mnem: "IN", ops: ["ax", "imm8"], bytes: [0xe5], imm: { slot: 1, size: 8 }, flags: [] },
    { mnem: "OUT", ops: ["imm8", "al"], bytes: [0xe6], imm: { slot: 0, size: 8 }, flags: [], note: "8086 port I/O" },
    { mnem: "OUT", ops: ["imm8", "ax"], bytes: [0xe7], imm: { slot: 0, size: 8 }, flags: [], note: "8086 port I/O" },
    { mnem: "CALL", ops: ["rel16"], bytes: [0xe8], rel: { slot: 0, size: 16 }, flags: [] },
    { mnem: "JMP", ops: ["rel16"], bytes: [0xe9], rel: { slot: 0, size: 16 }, flags: [] },
    { mnem: "JMP", ops: ["ptr16"], bytes: [0xea], ptr: 0, flags: [] },
    { mnem: "JMP", ops: ["rel8"], bytes: [0xeb], rel: { slot: 0, size: 8 }, flags: [] },
    { mnem: "IN", ops: ["al", "dx"], bytes: [0xec], flags: [] },
    { mnem: "IN", ops: ["ax", "dx"], bytes: [0xed], flags: [] },
    { mnem: "OUT", ops: ["dx", "al"], bytes: [0xee], flags: [], note: "8086 port I/O" },
    { mnem: "OUT", ops: ["dx", "ax"], bytes: [0xef], flags: [], note: "8086 port I/O" },
  );

  // -- 0xF4-0xFD: flag and I/O --------------------------------------------
  table.push(
    { mnem: "HLT", ops: ["none"], bytes: [0xf4], flags: [] },
    { mnem: "CMC", ops: ["none"], bytes: [0xf5], flags: ["CF"] },
    { mnem: "CLC", ops: ["none"], bytes: [0xf8], flags: ["CF"] },
    { mnem: "STC", ops: ["none"], bytes: [0xf9], flags: ["CF"] },
    { mnem: "CLI", ops: ["none"], bytes: [0xfa], flags: ["IF"] },
    { mnem: "STI", ops: ["none"], bytes: [0xfb], flags: ["IF"] },
    { mnem: "CLD", ops: ["none"], bytes: [0xfc], flags: ["DF"] },
    { mnem: "STD", ops: ["none"], bytes: [0xfd], flags: ["DF"] },
  );

  // -- 0xF6/0xF7: the miscellaneous group ---------------------------------
  const f6: ReadonlyArray<[number, string, readonly string[], string?]> = [
    [0, "TEST", ["SF", "ZF", "PF"], "r/m, imm8"],
    [2, "NOT", [], undefined],
    [3, "NEG", ["OF", "SF", "ZF", "AF", "PF", "CF"], undefined],
    [4, "MUL", ["CF", "OF"], "CF=OF=1 if the high half is non-zero"],
    [5, "IMUL", ["CF", "OF"], "CF=OF=1 if the result is not representable"],
    [6, "DIV", [], "CF/OF undefined"],
    [7, "IDIV", [], "CF/OF undefined"],
  ];
  for (const [digit, mnem, flags, note] of f6) {
    if (digit === 0) {
      table.push({ mnem, ops: ["rm8", "imm8"], bytes: [0xf6], modrm: { digit, rm: 0 }, imm: { slot: 1, size: 8 }, flags });
      table.push({ mnem, ops: ["rm16", "imm16"], bytes: [0xf7], modrm: { digit, rm: 0 }, imm: { slot: 1, size: 16 }, flags });
    } else {
      table.push({ mnem, ops: ["rm8"], bytes: [0xf6], modrm: { digit, rm: 0 }, flags, ...(note ? { note } : {}) });
      table.push({ mnem, ops: ["rm16"], bytes: [0xf7], modrm: { digit, rm: 0 }, flags, ...(note ? { note } : {}) });
    }
  }

  // -- 0xFE/0xFF: INC/DEC/CALL/JMP/PUSH group -----------------------------
  table.push(
    { mnem: "INC", ops: ["rm8"], bytes: [0xfe], modrm: { digit: 0, rm: 0 }, flags: ["OF", "SF", "ZF", "AF", "PF"] },
    { mnem: "DEC", ops: ["rm8"], bytes: [0xfe], modrm: { digit: 1, rm: 0 }, flags: ["OF", "SF", "ZF", "AF", "PF"] },
    { mnem: "INC", ops: ["rm16"], bytes: [0xff], modrm: { digit: 0, rm: 0 }, flags: ["OF", "SF", "ZF", "AF", "PF"] },
    { mnem: "DEC", ops: ["rm16"], bytes: [0xff], modrm: { digit: 1, rm: 0 }, flags: ["OF", "SF", "ZF", "AF", "PF"] },
    { mnem: "CALL", ops: ["rm16"], bytes: [0xff], modrm: { digit: 2, rm: 0 }, flags: [] },
    { mnem: "CALLF", ops: ["rm16"], bytes: [0xff], modrm: { digit: 3, rm: 0, mod3Forbidden: true }, flags: [], note: "operand is a far pointer in memory" },
    { mnem: "JMP", ops: ["rm16"], bytes: [0xff], modrm: { digit: 4, rm: 0 }, flags: [] },
    { mnem: "JMPF", ops: ["rm16"], bytes: [0xff], modrm: { digit: 5, rm: 0, mod3Forbidden: true }, flags: [], note: "operand is a far pointer in memory" },
    { mnem: "PUSH", ops: ["rm16"], bytes: [0xff], modrm: { digit: 6, rm: 0 }, flags: [] },
  );

  // -- Jcc ---------------------------------------------------------------
  for (const j of JCC) {
    table.push({
      mnem: j.mnem,
      ops: ["rel8"],
      bytes: [0x70 + j.digit],
      rel: { slot: 0, size: 8 },
      flags: [],
      note: j.condition,
    });
    table.push({
      mnem: j.mnem,
      ops: ["rel16"],
      bytes: [0x80 + j.digit],
      rel: { slot: 0, size: 16 },
      flags: [],
      note: j.condition,
    });
  }

  // -- BrainBox extension opcodes (0x0F xx) ------------------------------
  // 0x0F is not a valid prefix on the 8086, so these encodings cannot collide
  // with real hardware instructions. Semantics are copied verbatim from
  // emulator/cpu.ts: OUT/OUTC produce output and change nothing; OUTP writes a
  // 16-bit word to the I/O port window; MOD leaves the remainder in AX/AL and
  // touches no flags.
  table.push(
    {
      mnem: "OUT",
      ops: ["rm8"],
      bytes: [0x0f, 0x00],
      modrm: { digit: 0, rm: 0 },
      flags: [],
      ext: 0x00,
      note: "BrainBox extension: emit register as a numeric output value",
    },
    {
      mnem: "OUTC",
      ops: ["rm8"],
      bytes: [0x0f, 0x01],
      modrm: { digit: 0, rm: 0 },
      flags: [],
      ext: 0x01,
      note: "BrainBox extension: emit register as a character",
    },
    {
      mnem: "OUTP",
      ops: ["imm8", "rm8"],
      bytes: [0x0f, 0x02],
      modrm: { digit: 0, rm: 1 },
      imm: { slot: 0, size: 8 },
      flags: [],
      ext: 0x02,
      note: "BrainBox extension: write register to the I/O port window",
    },
    {
      mnem: "MOD",
      ops: ["rm16"],
      bytes: [0x0f, 0x03],
      modrm: { digit: 0, rm: 0 },
      flags: [],
      ext: 0x03,
      note: "BrainBox extension: AX = AX % operand (no flags)",
    },
    {
      mnem: "MOD",
      ops: ["rm8"],
      bytes: [0x0f, 0x04],
      modrm: { digit: 0, rm: 0 },
      flags: [],
      ext: 0x04,
      note: "BrainBox extension: AL = AL % operand (no flags)",
    },
    // The legacy engine gives these extensions the full value of whichever
    // register is named, at either width — the demos print 16-bit results with
    // `OUT AX` and single characters with `OUTC DL` — so each has a form per
    // width rather than one canonical size.
    {
      mnem: "OUT",
      ops: ["rm16"],
      bytes: [0x0f, 0x05],
      modrm: { digit: 0, rm: 0 },
      flags: [],
      ext: 0x05,
      note: "BrainBox extension: emit 16-bit register as a numeric output value",
    },
    {
      mnem: "OUTC",
      ops: ["rm16"],
      bytes: [0x0f, 0x06],
      modrm: { digit: 0, rm: 0 },
      flags: [],
      ext: 0x06,
      note: "BrainBox extension: emit 16-bit register as a character",
    },
    {
      mnem: "OUTP",
      ops: ["imm8", "rm16"],
      bytes: [0x0f, 0x07],
      modrm: { digit: 0, rm: 1 },
      imm: { slot: 0, size: 8 },
      flags: [],
      ext: 0x07,
      note: "BrainBox extension: write 16-bit register to the I/O port window",
    },
    // `IN r, imm8` for a register other than AL/AX is an 186 addition, and on
    // an 8086 the opcodes it would use (0x04/0x05) belong to ADD AL/AX, imm8.
    // The shipped interrupt demo reads into BX, so these go in the extension
    // space instead of stealing ADD.
    {
      mnem: "IN",
      ops: ["rm8", "imm8"],
      bytes: [0x0f, 0x08],
      modrm: { digit: 0, rm: 0 },
      imm: { slot: 1, size: 8 },
      flags: [],
      ext: 0x08,
      note: "BrainBox extension: read a port into an 8-bit register",
    },
    {
      mnem: "IN",
      ops: ["rm16", "imm8"],
      bytes: [0x0f, 0x09],
      modrm: { digit: 0, rm: 0 },
      imm: { slot: 1, size: 8 },
      flags: [],
      ext: 0x09,
      note: "BrainBox extension: read a port into a 16-bit register",
    },
  );

  return table;
}

/** The one and only 8086 instruction table. */
export const INSTRUCTION_TABLE: readonly InsnDef[] = buildTable();

/** Primary opcode byte -> the definitions that can start with it. */
export const BY_PRIMARY_OPCODE: ReadonlyMap<number, readonly InsnDef[]> = (() => {
  const map = new Map<number, InsnDef[]>();
  for (const def of INSTRUCTION_TABLE) {
    const primary = def.bytes[0];
    const list = map.get(primary);
    if (list) list.push(def);
    else map.set(primary, [def]);
  }
  return map;
})();

/** BrainBox 0x0F extension sub-opcode -> definition. */
export const BY_EXTENSION: ReadonlyMap<number, InsnDef> = new Map(
  INSTRUCTION_TABLE.filter((d) => d.ext !== undefined).map((d) => [d.ext!, d]),
);

/** 8086 instruction prefixes. 0x0F is handled as an extension escape. */
export const PREFIXES: Readonly<Record<number, string>> = {
  0xf0: "LOCK",
  0xf2: "REPNE",
  0xf3: "REP",
  0x26: "ES:",
  0x2e: "CS:",
  0x36: "SS:",
  0x3e: "DS:",
};

/** All mnemonics in the table, sorted, for autocomplete and tests. */
export const ALL_MNEMONICS: readonly string[] = Array.from(
  new Set(INSTRUCTION_TABLE.map((d) => d.mnem)),
).sort();
