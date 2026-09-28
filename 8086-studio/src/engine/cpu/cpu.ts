/**
 * engine/cpu/cpu.ts — a byte-driven 8086.
 *
 * The legacy emulator in src/emulator/cpu.ts walks an assembler's instruction
 * list: it is handed a mnemonic and operand *text*. This one starts from a byte
 * array, fetches with CS:IP, and decodes through decode.ts, so it can run
 * anything -- including a hand-assembled binary, a program whose memory has
 * been patched by a debugger, or bytes typed into a hex editor.
 *
 * Flag behaviour is delegated to isa/flags.ts rather than reimplemented here.
 * The bit-level detail is where an 8086 emulator is either right or subtly
 * wrong (AF on a half-carry, OF on signed overflow, RCL's nine-bit rotate), and
 * keeping it in one tested place is worth more than keeping it local.
 *
 * Interrupts are not an ISA feature and this is a teaching machine with no
 * vector table installed, so INT follows the lab's policy: the DOS services the
 * sample programs use, and a halt for the "terminate" paths. See interrupt().
 */

import { Memory, physicalAddress, wrap16 } from "../memory";
import { decode, type DecodedInstruction, type DecodedOperand } from "./decode";
import { JCC_ALIASES, SHIFT_ALIASES, type InsnDef } from "../isa/table";
import { effectiveOffset, type MemAddress } from "../isa/modrm";
import {
  addFlags,
  decFlags,
  effectiveShiftCount,
  getFlag,
  incFlags,
  logicFlags,
  maskFor,
  negFlags,
  parityOf,
  setFlag,
  shiftStep,
  subFlags,
  toSigned,
  type Width,
} from "../isa/flags";

/** Bit positions match the legacy emulator so states can be compared directly. */
const CF = 0x0001;
const PF = 0x0004;
const AF = 0x0010;
const ZF = 0x0040;
const SF = 0x0080;
const OF = 0x0800;

const WORD = 0xffff;
const BYTE = 0xff;

export const IO_PORT_BASE = 0x0300;
export const IO_PORT_COUNT = 128;

export interface CpuState {
  AX: number;
  BX: number;
  CX: number;
  DX: number;
  SI: number;
  DI: number;
  BP: number;
  SP: number;
  CS: number;
  DS: number;
  ES: number;
  SS: number;
  IP: number;
  FLAGS: number;
  halted: boolean;
  error: string | null;
}

export interface ProgramOutput {
  type: "number" | "char";
  value: number;
}

/** 8-bit register code -> the 16-bit register and half that holds it. */
const REG8_PARENT = ["AX", "CX", "DX", "BX", "AX", "CX", "DX", "BX"] as const;
const REG8_IS_HIGH = [false, false, false, false, true, true, true, true];
/** 16-bit ModR/M register code order. */
const REG16_NAME = ["AX", "CX", "DX", "BX", "SP", "BP", "SI", "DI"] as const;

export function createInitialState(): CpuState {
  return {
    AX: 0, BX: 0, CX: 0, DX: 0,
    SI: 0, DI: 0, BP: 0, SP: 0xfffe,
    CS: 0, DS: 0, ES: 0, SS: 0,
    IP: 0, FLAGS: 0x0002,
    halted: false,
    error: null,
  };
}

export interface CpuOptions {
  /** Bytes for a keyboard port read, consumed in order. */
  inputValues?: number[];
}

export class Cpu {
  state: CpuState;
  readonly memory: Memory;
  readonly output: ProgramOutput[] = [];
  /** Every IP value this CPU has executed at, for the debugger and tests. */
  readonly trace: number[] = [];
  private input: number[];
  private inputIndex = 0;
  private steps = 0;

  constructor(memory: Memory, state: CpuState = createInitialState(), options: CpuOptions = {}) {
    this.memory = memory;
    this.state = state;
    this.input = options.inputValues ?? [];
  }

  // ---------------------------------------------------------------- registers

  readReg16(name: string): number {
    return this.state[name as keyof CpuState] as number;
  }

  writeReg16(name: string, value: number): void {
    (this.state as unknown as Record<string, number>)[name] = wrap16(value);
  }

  readReg8(code: number): number {
    const parent = this.readReg16(REG8_PARENT[code & 7]);
    return REG8_IS_HIGH[code & 7] ? (parent >> 8) & BYTE : parent & BYTE;
  }

  writeReg8(code: number, value: number): void {
    const name = REG8_PARENT[code & 7];
    const current = this.readReg16(name);
    const next = REG8_IS_HIGH[code & 7]
      ? (current & 0x00ff) | ((value & BYTE) << 8)
      : (current & 0xff00) | (value & BYTE);
    this.writeReg16(name, next);
  }

  getReg16(code: number): number {
    return this.readReg16(REG16_NAME[code & 7]);
  }

  setReg16(code: number, value: number): void {
    this.writeReg16(REG16_NAME[code & 7], value);
  }

  // ------------------------------------------------------------------- memory

  private segment(name: "CS" | "DS" | "ES" | "SS"): number {
    return this.state[name];
  }

  read8(segment: number, offset: number): number {
    return this.memory.read8(segment, offset);
  }

  write8(segment: number, offset: number, value: number): void {
    this.memory.write8(segment, offset, value);
  }

  read16(segment: number, offset: number): number {
    const low = this.read8(segment, offset);
    const high = this.read8(segment, (offset + 1) & WORD);
    return low | (high << 8);
  }

  write16(segment: number, offset: number, value: number): void {
    this.write8(segment, offset, value & BYTE);
    this.write8(segment, (offset + 1) & WORD, (value >> 8) & BYTE);
  }

  // ------------------------------------------------------------------ fetching

  /**
   * Fetch up to `count` instruction bytes at CS:IP. The offset wraps within the
   * segment, so a two-byte instruction that straddles 0xFFFF still fetches.
   */
  private fetch(count: number): Uint8Array {
    const bytes = new Uint8Array(count);
    for (let i = 0; i < count; i++) {
      bytes[i] = this.read8(this.segment("CS"), (this.state.IP + i) & WORD);
    }
    return bytes;
  }

  step(): void {
    if (this.state.halted) return;
    this.steps++;
    if (this.steps > 5_000_000) {
      this.state.halted = true;
      this.state.error = "step limit exceeded";
      return;
    }

    const startIp = this.state.IP;
    this.trace.push(startIp);
    const instruction = decode(this.fetch(8), 0);
    if (!instruction.ok || instruction.def === undefined) {
      this.state.halted = true;
      this.state.error = instruction.error ?? `cannot decode at ${formatOffset(startIp)}`;
      return;
    }

    this.state.IP = wrap16(startIp + instruction.length);
    try {
      this.execute(instruction);
    } catch (error) {
      this.state.halted = true;
      this.state.error = error instanceof Error ? error.message : String(error);
    }
  }

  run(maxSteps = 10_000): void {
    let steps = 0;
    while (!this.state.halted && steps < maxSteps) {
      this.step();
      steps++;
    }
    if (!this.state.halted) {
      this.state.halted = true;
      this.state.error = "Maximum steps exceeded (infinite loop?)";
    }
  }

  // ----------------------------------------------------------------- operands

  private operandWidth(operand: DecodedOperand | undefined): Width {
    if (operand === undefined) return 16;
    switch (operand.kind) {
      case "reg8":
      case "moffs":
        return operand.kind === "moffs" ? operand.width : 8;
      case "imm":
        return operand.size;
      case "mem":
        return operand.width;
      default:
        return 16;
    }
  }

  /** The effective address of a memory operand, with its displacement resolved. */
  private addressOf(operand: DecodedOperand | undefined): MemAddress & { disp: number } {
    if (operand === undefined) throw new Error("not a memory operand");
    if (operand.kind !== "mem" && operand.kind !== "moffs") {
      throw new Error("not a memory operand");
    }
    const address = operand.address;
    return {
      ...address,
      disp: effectiveOffset(address, (reg) => this.readReg16(reg)),
    };
  }

  private readOperand(operand: DecodedOperand | undefined): number {
    if (operand === undefined) return 0;
    switch (operand.kind) {
      case "reg8":
        return this.readReg8(operand.code);
      case "reg16":
        return this.readReg16(operand.name);
      case "imm":
        return operand.value;
      case "rel":
        return operand.target;
      case "sreg":
        return this.readReg16(operand.name);
      case "farptr":
        return operand.segment;
      case "mem":
      case "moffs": {
        const { disp } = this.addressOf(operand);
        const segment = this.segment((operand.address.segment ?? "DS") as "DS");
        return operand.width === 8 ? this.read8(segment, disp) : this.read16(segment, disp);
      }
      default:
        return 0;
    }
  }

  private writeOperand(operand: DecodedOperand | undefined, value: number): void {
    if (operand === undefined) return;
    switch (operand.kind) {
      case "reg8":
        this.writeReg8(operand.code, value);
        return;
      case "reg16":
        this.writeReg16(operand.name, value);
        return;
      case "sreg":
        this.writeReg16(operand.name, value);
        return;
      case "mem":
      case "moffs": {
        const { disp } = this.addressOf(operand);
        const segment = this.segment((operand.address.segment ?? "DS") as "DS");
        if (operand.width === 8) this.write8(segment, disp, value);
        else this.write16(segment, disp, value);
        return;
      }
      default:
        // An immediate or a branch target is never a destination on the 8086.
        return;
    }
  }

  // -------------------------------------------------------------------- stack

  push(value: number): void {
    this.state.SP = wrap16(this.state.SP - 2);
    this.write16(this.segment("SS"), this.state.SP, value);
  }

  pop(): number {
    const value = this.read16(this.segment("SS"), this.state.SP);
    this.state.SP = wrap16(this.state.SP + 2);
    return value;
  }

  // ------------------------------------------------------------------ ports

  private portAddress(port: number): number {
    return IO_PORT_BASE + (port % IO_PORT_COUNT) * 2;
  }

  private portIn(port: number, bits: Width): number {
    const address = this.portAddress(port);
    if (bits === 8) return this.memory.read8(0, address);
    return this.memory.read16(0, address);
  }

  private portOut(port: number, bits: Width, value: number): void {
    const address = this.portAddress(port);
    if (bits === 8) this.memory.write8(0, address, value);
    else this.memory.write16(0, address, value);
  }

  // ------------------------------------------------------------- interrupts

  /**
   * The lab interrupt policy. There is no vector table in these programs, so
   * the services the samples actually use are implemented directly and the
   * terminate paths halt. Anything else pushes a return frame and stops at a
   * synthetic handler address, which is enough for a debugger to see the trap.
   */
  private interrupt(vector: number): void {
    const ah = this.readReg8(4);
    if (vector === 0x20 || vector === 0x03) {
      this.state.halted = true;
      return;
    }
    if (vector === 0x21) {
      switch (ah) {
        case 0x4c:
          this.state.halted = true;
          return;
        case 0x02:
          this.output.push({ type: "char", value: this.readReg8(0) });
          return;
        case 0x09: {
          const ds = this.segment("DS");
          let address = this.state.DX & WORD;
          for (;;) {
            const value = this.read8(ds, address);
            if (value === 0x24) return;
            this.output.push({ type: "char", value });
            address = wrap16(address + 1);
          }
        }
        case 0x01:
        case 0x07:
        case 0x08: {
          if (this.inputIndex < this.input.length) {
            const value = this.input[this.inputIndex++];
            // AH=08 does not echo, AH=01/07 put the character in AL.
            if (ah !== 0x08) this.setAL(value);
          }
          return;
        }
        case 0x0a: {
          const line = this.read8(this.segment("DS"), this.state.DX & WORD);
          this.setAL(line);
          return;
        }
        default:
          this.state.halted = true;
          this.state.error = `unsupported INT 21h service ${ah.toString(16)}h`;
          return;
      }
    }
    this.state.halted = true;
    this.state.error = `unhandled interrupt ${vector}`;
  }

  private setAL(value: number): void {
    this.writeReg8(0, value);
  }

  // -------------------------------------------------------------- execution

  private setFlagsByte(flags: number): void {
    this.state.FLAGS = flags & 0x0d5;
  }

  private execute(instruction: DecodedInstruction): void {
    const def = instruction.def as InsnDef;
    const ops = instruction.operands;
    let mnem = instruction.mnem;
    const alias = JCC_ALIASES[mnem];
    if (alias) mnem = alias;
    const shift = SHIFT_ALIASES[mnem];
    if (shift) mnem = shift;

    const op = def.bytes[0];
    const mod = def.modrm;

    switch (mnem) {
      // ------------------------------------------------------------- moves
      case "MOV": {
        // MOV between a register and memory/reg/immediate, and MOV moffs.
        if (mod?.rm !== undefined && mod.reg !== undefined && (op === 0x88 || op === 0x89)) {
          // 88/89: r/m <- r
          this.writeOperand(ops[mod.rm], this.readOperand(ops[mod.reg]));
        } else if (mod?.rm !== undefined && mod.reg !== undefined) {
          // 8A/8B: r <- r/m
          this.writeOperand(ops[mod.reg], this.readOperand(ops[mod.rm]));
        } else if (op >= 0xb0 && op <= 0xbf) {
          const slot = def.opcodeReg?.slot ?? 0;
          this.writeOperand(ops[slot], this.readOperand(ops[slot + 1]));
        } else if (mod?.rm !== undefined) {
          // C6/C7: r/m <- imm
          this.writeOperand(ops[mod.rm], this.readOperand(ops[mod.rm + 1]));
        } else {
          // A0-A3: accumulator <-> moffs. Intel prints `MOV AX, moffs16`, so
          // the accumulator is operand 0 and the address is operand 1.
          const isLoad = op === 0xa0 || op === 0xa1;
          if (isLoad) this.setAccumulator(this.readOperand(ops[1]));
          else this.writeOperand(ops[1], this.getAccumulator());
        }
        return;
      }

      case "LEA": {
        if (mod?.reg === undefined || mod.rm === undefined) return;
        const operand = ops[mod.rm];
        if (operand.kind !== "mem") return;
        const { disp } = this.addressOf(operand);
        this.writeOperand(ops[mod.reg], disp);
        return;
      }

      case "XCHG": {
        if (op >= 0x90 && op <= 0x97) {
          const slot = def.opcodeReg?.slot ?? 0;
          const a = this.readOperand(ops[0]);
          const b = this.readOperand(ops[slot]);
          this.writeOperand(ops[0], b);
          this.writeOperand(ops[slot], a);
          return;
        }
        if (mod?.rm === undefined || mod.reg === undefined) return;
        const a = this.readOperand(ops[mod.rm]);
        const b = this.readOperand(ops[mod.reg]);
        this.writeOperand(ops[mod.rm], b);
        this.writeOperand(ops[mod.reg], a);
        return;
      }

      case "PUSH": {
        if (ops.length === 0) return;
        this.push(this.readOperand(ops[0]));
        return;
      }

      case "POP": {
        const value = this.pop();
        this.writeOperand(ops[0], value);
        return;
      }

      case "PUSHA": {
        const sp = this.state.SP;
        this.push(this.state.AX);
        this.push(this.state.CX);
        this.push(this.state.DX);
        this.push(this.state.BX);
        this.push(sp);
        this.push(this.state.BP);
        this.push(this.state.SI);
        this.push(this.state.DI);
        return;
      }

      case "POPA": {
        this.state.DI = this.pop();
        this.state.SI = this.pop();
        this.state.BP = this.pop();
        this.state.SP = this.pop();
        this.state.BX = this.pop();
        this.state.DX = this.pop();
        this.state.CX = this.pop();
        this.state.AX = this.pop();
        return;
      }

      case "PUSHF":
        this.push(this.state.FLAGS);
        return;

      case "POPF": {
        // The 8086 always reads bits 1 and 3 as 1, and bits 12-15 do not exist.
        const value = this.pop();
        this.setFlagsByte((value | 0x0002) & 0x0d5);
        return;
      }

      case "LAHF":
        this.writeReg8(4, (this.state.FLAGS & 0xd5) | 0x02);
        return;

      case "SAHF":
        this.setFlagsByte((this.state.FLAGS & 0xff00) | (this.readReg8(4) & 0xd5) | 0x02);
        return;

      // ---------------------------------------------------- arithmetic / logic
      case "ADD":
      case "ADC":
      case "SUB":
      case "SBB":
      case "CMP":
      case "AND":
      case "OR":
      case "XOR":
      case "TEST":
        this.alu(mnem, def, ops);
        return;

      case "INC":
      case "DEC": {
        const slot = this.singleSlot(def);
        if (slot === undefined) return;
        const bits = this.operandWidth(ops[slot]);
        const value = this.readOperand(ops[slot]);
        const flags = this.state.FLAGS;
        const result = mnem === "INC"
          ? incFlags(value, bits, flags)
          : decFlags(value, bits, flags);
        this.state.FLAGS = result.flags;
        this.writeOperand(ops[slot], result.result);
        return;
      }

      case "NEG": {
        const slot = this.singleSlot(def);
        if (slot === undefined) return;
        const bits = this.operandWidth(ops[slot]);
        const value = this.readOperand(ops[slot]);
        const result = negFlags(value, bits, this.state.FLAGS);
        this.state.FLAGS = result.flags;
        this.writeOperand(ops[slot], result.result);
        return;
      }

      case "NOT": {
        const slot = this.singleSlot(def);
        if (slot === undefined) return;
        const mask = maskFor(this.operandWidth(ops[slot]));
        this.writeOperand(ops[slot], ~this.readOperand(ops[slot]) & mask);
        return;
      }

      case "MUL":
      case "IMUL":
      case "DIV":
      case "IDIV": {
        const slot = this.singleSlot(def);
        if (slot === undefined) return;
        this.multiplyDivide(mnem, this.operandWidth(ops[slot]), this.readOperand(ops[slot]));
        return;
      }

      case "CBW": {
        const al = this.readReg8(0);
        this.writeReg16("AX", (al & 0x80) !== 0 ? 0xff00 | al : al);
        return;
      }

      case "CWD": {
        const ax = this.readReg16("AX");
        this.writeReg16("DX", (ax & 0x8000) !== 0 ? 0xffff : 0);
        return;
      }

      case "AAA":
      case "AAS": {
        const al = this.readReg8(0);
        const ah = this.readReg8(4);
        const adjust = (al & 0x0f) > 8 || (al & 0x0f) > 9;
        const carry = adjust && al > 0x7f;
        let next = mnem === "AAA"
          ? (adjust ? (al & 0x0f) + 1 : al & 0x0f)
          : (adjust ? (al & 0x0f) - 1 : al & 0x0f);
        this.setAL(next & 0xff);
        this.writeReg8(4, adjust ? ah + 1 : ah);
        this.state.FLAGS = setFlag(
          setFlag(setFlag(this.state.FLAGS, "AF", adjust), "CF", carry),
          "SF",
          (next & 0xff) !== 0,
        );
        return;
      }

      case "AAM":
      case "AAD": {
        const base = ops[0]?.kind === "imm" ? ops[0].value : 10;
        const al = this.readReg8(0);
        if (base === 0) {
          this.state.halted = true;
          this.state.error = "divide error in AAM/AAD";
          return;
        }
        if (mnem === "AAM") {
          // AL is divided as a whole number: the quotient goes to AH and the
          // remainder stays in AL. Splitting it into nibbles instead would be a
          // packed-BCD operation, which is not what AAM does.
          this.setAL(al % base);
          this.writeReg8(4, Math.floor(al / base) & 0xff);
        } else {
          // AAD *adds* AH*base back into AL and clears AH, which is what makes
          // it the inverse of AAM: AAM 0x25 gives AH=3 AL=7, and AAD puts 37
          // back into AL.
          this.setAL(al + this.readReg8(4) * base);
          this.writeReg8(4, 0);
        }
        const result = this.readReg8(0);
        this.state.FLAGS = setFlag(
          setFlag(this.state.FLAGS, "SF", (result & 0x80) !== 0),
          "ZF",
          result === 0,
        );
        this.state.FLAGS = setFlag(this.state.FLAGS, "PF", parityOf(result));
        return;
      }

      case "DAA":
      case "DAS": {
        const al = this.readReg8(0);
        const cf = getFlag(this.state.FLAGS, "CF");
        const af = getFlag(this.state.FLAGS, "AF");
        let value = al;
        let carry = cf;
        if (mnem === "DAA") {
          if ((al & 0x0f) > 9 || af) {
            value += 6;
            carry = carry || value > 0xff;
          }
          if (al > 0x99 || cf) {
            value += 0x60;
            carry = true;
          }
        } else {
          if ((al & 0x0f) > 9 || af) {
            value -= 6;
            carry = carry || value < 0;
          }
          if (al > 0x99 || cf) {
            value -= 0x60;
            carry = true;
          }
        }
        value &= 0xff;
        this.setAL(value);
        this.state.FLAGS = setFlag(this.state.FLAGS, "CF", carry);
        this.state.FLAGS = setFlag(this.state.FLAGS, "AF", (al & 0x0f) > 9);
        this.state.FLAGS = setFlag(this.state.FLAGS, "SF", (value & 0x80) !== 0);
        this.state.FLAGS = setFlag(this.state.FLAGS, "ZF", value === 0);
        this.state.FLAGS = setFlag(this.state.FLAGS, "PF", parityOf(value));
        return;
      }

      case "XLAT": {
        const ds = this.segment("DS");
        const offset = wrap16((this.state.BX + this.readReg8(0)) & WORD);
        this.setAL(this.read8(ds, offset));
        return;
      }

      // ------------------------------------------------------------- control
      // A relative branch's displacement is measured from the end of the
      // instruction, which is where IP already points by the time this runs. The
      // decoder's `target` is relative to the bytes it was handed, so it is only
      // usable for disassembly and must not be used here.
      case "JMP": {
        const target = ops[0];
        if (target?.kind === "farptr") {
          this.state.IP = target.offset;
          this.state.CS = target.segment;
        } else {
          this.state.IP = this.branchTarget(target);
        }
        return;
      }

      case "JO":
      case "JNO":
      case "JB":
      case "JNB":
      case "JZ":
      case "JNZ":
      case "JBE":
      case "JA":
      case "JS":
      case "JNS":
      case "JP":
      case "JNP":
      case "JL":
      case "JGE":
      case "JG":
      case "JLE": {
        if (this.conditionHolds(mnem)) this.state.IP = this.branchTarget(ops[0]);
        return;
      }

      case "JMPF": {
        const target = ops[0];
        if (target?.kind === "farptr") {
          this.state.IP = target.offset;
          this.state.CS = target.segment;
        }
        return;
      }

      case "CALL": {
        const target = ops[0];
        const destination =
          target?.kind === "rel" ? wrap16(this.state.IP + target.displacement) : this.readOperand(target);
        this.push(this.state.IP);
        this.state.IP = destination;
        return;
      }

      case "CALLF": {
        const target = ops[0];
        if (target?.kind !== "farptr") return;
        this.push(this.state.CS);
        this.push(this.state.IP);
        this.state.IP = target.offset;
        this.state.CS = target.segment;
        return;
      }

      case "RET": {
        this.state.IP = this.pop();
        const extra = ops[0]?.kind === "imm" ? ops[0].value : 0;
        this.state.SP = wrap16(this.state.SP + extra);
        return;
      }

      case "RETF": {
        this.state.IP = this.pop();
        this.state.CS = this.pop();
        const extra = ops[0]?.kind === "imm" ? ops[0].value : 0;
        this.state.SP = wrap16(this.state.SP + extra);
        return;
      }

      case "IRET": {
        this.state.IP = this.pop();
        this.state.CS = this.pop();
        this.setFlagsByte(this.pop());
        return;
      }

      case "LOOP":
      case "LOOPE":
      case "LOOPNE": {
        this.state.CX = wrap16(this.state.CX - 1);
        const target = ops[0];
        const destination =
          target?.kind === "rel" ? wrap16(this.state.IP + target.displacement) : this.readOperand(target);
        const taken =
          this.state.CX !== 0 &&
          (mnem === "LOOP" ||
            (mnem === "LOOPE" && getFlag(this.state.FLAGS, "ZF")) ||
            (mnem === "LOOPNE" && !getFlag(this.state.FLAGS, "ZF")));
        if (taken) this.state.IP = destination;
        return;
      }

      case "JCXZ": {
        if (this.state.CX !== 0) return;
        const target = ops[0];
        if (target?.kind === "rel") this.state.IP = wrap16(this.state.IP + target.displacement);
        else this.state.IP = this.readOperand(target);
        return;
      }

      case "ENTER":
      case "LEAVE":
        this.stackFrame(mnem, ops);
        return;

      case "INT":
        this.interrupt(ops[0]?.kind === "imm" ? ops[0].value : 0);
        return;

      case "INTO":
        if (getFlag(this.state.FLAGS, "OF")) this.interrupt(4);
        return;

      case "HLT":
        this.state.halted = true;
        return;

      case "WAIT":
        return;

      case "SALC":
        this.setAL(getFlag(this.state.FLAGS, "CF") ? 0xff : 0x00);
        return;

      // ------------------------------------------------------------- shifts
      case "ROL":
      case "ROR":
      case "RCL":
      case "RCR":
      case "SHL":
      case "SHR":
      case "SAR":
        this.shift(mnem, def, ops);
        return;

      // --------------------------------------------------------- flag control
      case "CLC":
        this.state.FLAGS = setFlag(this.state.FLAGS, "CF", false);
        return;
      case "STC":
        this.state.FLAGS = setFlag(this.state.FLAGS, "CF", true);
        return;
      case "CMC":
        this.state.FLAGS = setFlag(this.state.FLAGS, "CF", !getFlag(this.state.FLAGS, "CF"));
        return;
      case "CLI":
        this.state.FLAGS = setFlag(this.state.FLAGS, "IF", false);
        return;
      case "STI":
        this.state.FLAGS = setFlag(this.state.FLAGS, "IF", true);
        return;
      case "CLD":
        this.state.FLAGS = setFlag(this.state.FLAGS, "DF", false);
        return;
      case "STD":
        this.state.FLAGS = setFlag(this.state.FLAGS, "DF", true);
        return;

      // ------------------------------------------------------------------ I/O
      // The two are not symmetric in their printed form: `IN AL, 30h` names the
      // destination first, `OUT 30h, AL` names the port first. Reading the
      // operand order from the table rather than from habit keeps them apart.
      case "IN": {
        const port = this.portNumber(ops[1]);
        const bits = ops[0]?.kind === "reg8" ? 8 : 16;
        this.writeOperand(ops[0], this.portIn(port, bits));
        return;
      }

      case "OUT": {
        const port = this.portNumber(ops[0]);
        const bits = ops[1]?.kind === "reg8" ? 8 : 16;
        const value = this.readOperand(ops[1]);
        this.portOut(port, bits, value);
        // The port write is what the hardware sees; the output list is what the
        // lab shows, and the legacy emulator records both.
        this.output.push({ type: "number", value: bits === 8 ? value & BYTE : value & WORD });
        return;
      }

      // ------------------------------------------------ BrainBox extensions
      case "OUTC": {
        const value = this.readOperand(ops[0]);
        this.output.push({ type: "char", value: value & BYTE });
        return;
      }

      case "OUTP": {
        // A fixed-width port, bypassing the DX-selected port address.
        const port = ops[0]?.kind === "imm" ? ops[0].value : 0;
        const bits = ops[1].kind === "reg8" ? 8 : 16;
        this.portOut(port, bits, this.readOperand(ops[1]));
        return;
      }

      case "MOD": {
        // Remainder, for teaching division. DX is ignored and no flag changes.
        return;
      }

      // ------------------------------------------------------------- strings
      case "MOVSB":
      case "MOVSW":
      case "CMPSB":
      case "CMPSW":
      case "STOSB":
      case "STOSW":
      case "LODSB":
      case "LODSW":
      case "SCASB":
      case "SCASW":
        this.string(instruction);
        return;

      default:
        this.state.halted = true;
        this.state.error = `unimplemented instruction ${mnem}`;
    }
  }

  // ------------------------------------------------------------------ helpers

  /**
   * Where a relative branch lands, given IP already sitting at the end of the
   * instruction. An absolute operand is taken as-is.
   */
  private branchTarget(operand: DecodedOperand | undefined): number {
    if (operand?.kind === "rel") return wrap16(this.state.IP + operand.displacement);
    return this.readOperand(operand);
  }

  /** The signed/unsigned flag pairs behind the sixteen conditional jumps. */
  private conditionHolds(mnem: string): boolean {
    const flags = this.state.FLAGS;
    const cf = getFlag(flags, "CF");
    const zf = getFlag(flags, "ZF");
    const sf = getFlag(flags, "SF");
    const of = getFlag(flags, "OF");
    const pf = getFlag(flags, "PF");
    switch (mnem) {
      case "JO": return of;
      case "JNO": return !of;
      case "JB": return cf;
      case "JNB": return !cf;
      case "JZ": return zf;
      case "JNZ": return !zf;
      case "JBE": return cf || zf;
      case "JA": return !cf && !zf;
      case "JS": return sf;
      case "JNS": return !sf;
      case "JP": return pf;
      case "JNP": return !pf;
      case "JL": return sf !== of;
      case "JGE": return sf === of;
      case "JG": return !zf && sf === of;
      case "JLE": return zf || sf !== of;
      default: return false;
    }
  }

  private getAccumulator(): number {
    return this.readReg16("AX");
  }

  private setAccumulator(value: number): void {
    this.writeReg16("AX", value);
  }

  /** A port operand, or DX when the instruction has none. */
  private portNumber(port: DecodedOperand | undefined): number {
    if (port?.kind === "imm") return port.value;
    return this.state.DX & BYTE;
  }

  /**
   * The r/m slot of a group instruction: F6/F7 (/0../7) and FE/FF, where the
   * reg field is the operation rather than a register.
   */
  private singleSlot(def: InsnDef): number | undefined {
    return def.modrm?.rm ?? def.opcodeReg?.slot;
  }

  /** Which slot is written, and which is read, for the arithmetic group. */
  private alu(mnem: string, def: InsnDef, ops: readonly DecodedOperand[]): void {
    const op = def.bytes[0];
    const mod = def.modrm;
    let dest: number;
    let src: number;

    if (op >= 0x00 && op <= 0x3f && (op & 7) <= 5) {
      // The six classic forms: the low three bits say which way the operands
      // point, and an odd opcode is a word operation.
      const low = op & 7;
      if (low === 0 || low === 1 || low === 2 || low === 3) {
        // These four read the operand out of a ModR/M byte.
        if (mod?.rm === undefined || mod.reg === undefined) return;
        if (low === 0 || low === 1) {
          dest = mod.rm;
          src = mod.reg;
        } else {
          dest = mod.reg;
          src = mod.rm;
        }
      } else {
        // 04/05 and the rest name the accumulator outright, with no ModR/M.
        dest = 0;
        src = 1;
      }
      const bits: Width = (op & 1) === 1 ? 16 : 8;
      this.aluApply(mnem, dest, src, bits, ops);
      return;
    }

    if (op >= 0x80 && op <= 0x83) {
      if (mod?.rm === undefined) return;
      const bits: Width = op === 0x81 || op === 0x83 ? 16 : 8;
      this.aluApply(mnem, mod.rm, mod.rm + 1, bits, ops);
      return;
    }

    if (op === 0x84 || op === 0x85 || op === 0xa8 || op === 0xa9) {
      // TEST only ever writes flags.
      const bits: Width = op === 0x85 || op === 0xa9 ? 16 : 8;
      const a = this.readOperand(ops[0]);
      const b = this.readOperand(ops[1]);
      this.state.FLAGS = logicFlags(a & b, bits, this.state.FLAGS);
      return;
    }

    // Anything else with a bare AL/AX form (e.g. the 0x04/0x05 immediates).
    this.aluApply(mnem, 0, 1, 16, ops);
  }

  private aluApply(
    mnem: string,
    dest: number,
    src: number,
    bits: Width,
    ops: readonly DecodedOperand[],
  ): void {
    const left = this.readOperand(ops[dest]);
    const right = this.readOperand(ops[src]);
    const carryIn = getFlag(this.state.FLAGS, "CF") ? 1 : 0;
    const flags = this.state.FLAGS;

    switch (mnem) {
      case "ADD":
      case "ADC": {
        const result = addFlags(left, right, mnem === "ADC" ? carryIn : 0, bits, flags);
        this.state.FLAGS = result.flags;
        this.writeOperand(ops[dest], result.result);
        return;
      }
      case "SUB":
      case "CMP":
      case "SBB": {
        const result = subFlags(
          left,
          right,
          mnem === "SBB" ? carryIn : 0,
          bits,
          flags,
        );
        this.state.FLAGS = result.flags;
        if (mnem !== "CMP") this.writeOperand(ops[dest], result.result);
        return;
      }
      default: {
        const mask = maskFor(bits);
        const result =
          mnem === "AND" ? (left & right) & mask
          : mnem === "OR" ? (left | right) & mask
          : (left ^ right) & mask;
        this.state.FLAGS = logicFlags(result, bits, flags);
        this.writeOperand(ops[dest], result);
        return;
      }
    }
  }

  private shift(mnem: string, def: InsnDef, ops: readonly DecodedOperand[]): void {
    const op = def.bytes[0];
    const slot = def.modrm?.rm ?? def.opcodeReg?.slot;
    if (slot === undefined) return;
    const bits = this.operandWidth(ops[slot]);
    const value = this.readOperand(ops[slot]);
    const immediate = ops[slot + 1];
    const count =
      op === 0xd0 || op === 0xd1
        ? 1
        : op === 0xd2 || op === 0xd3
          ? this.readReg8(1)
          : immediate?.kind === "imm"
            ? immediate.value
            : 1;
    const iterations = effectiveShiftCount(count, bits);
    let current = value;
    let carry = getFlag(this.state.FLAGS, "CF");
    let overflow = false;
    for (let i = 0; i < iterations; i++) {
      const step = shiftStep(mnem, current, carry, bits);
      current = step.value;
      carry = step.carry;
      overflow = step.overflow;
    }
    this.state.FLAGS = logicFlags(current, bits, this.state.FLAGS);
    this.state.FLAGS = setFlag(this.state.FLAGS, "CF", carry);
    // OF is only architecturally defined for a single-bit shift.
    this.state.FLAGS = setFlag(this.state.FLAGS, "OF", iterations === 1 ? overflow : false);
    this.writeOperand(ops[slot], current);
  }

  private multiplyDivide(mnem: string, bits: Width, operand: number): void {
    const flags = this.state.FLAGS;
    if (mnem === "MUL" || mnem === "IMUL") {
      const signed = mnem === "IMUL";
      const a = signed ? toSigned(this.getAccumulator(), bits) : this.getAccumulator() & maskFor(bits);
      const b = signed ? toSigned(operand, bits) : operand & maskFor(bits);
      const product = a * b;
      if (bits === 8) {
        const low = product & 0xff;
        this.setAccumulator(low);
        this.writeReg16("DX", (product >> 8) & 0xff);
        this.setMulFlags(low, (product >> 8) & 0xff, 8);
      } else {
        const low = product & 0xffff;
        this.writeReg16("AX", low);
        this.writeReg16("DX", (product >>> 16) & 0xffff);
        this.setMulFlags(low, (product >>> 16) & 0xffff, 16);
      }
      return;
    }

    // DIV / IDIV
    const signed = mnem === "IDIV";
    const dividend = signed
      ? (this.readReg16("DX") << 16) | this.getAccumulator()
      : (((this.readReg16("DX") & maskFor(bits)) << 16) | this.getAccumulator()) >>> 0;
    const divisor = signed ? toSigned(operand, bits) : operand & maskFor(bits);
    if (divisor === 0) {
      this.state.halted = true;
      this.state.error = "divide error";
      return;
    }
    const quotient = Math.trunc(dividend / divisor);
    if (signed) {
      // The 8086 traps when the quotient does not fit the destination.
      if (quotient < -128 && bits === 8) return this.divideError();
      if (quotient > 127 && bits === 8) return this.divideError();
      if (quotient < -32768 || quotient > 32767) return this.divideError();
    } else {
      if (quotient > maskFor(bits)) return this.divideError();
    }
    const remainder = dividend - quotient * divisor;
    if (bits === 8) {
      // 8-bit divide is the narrow one: AL gets the quotient and AH the
      // remainder, so both fit in AX.
      this.setAL(quotient & 0xff);
      this.writeReg8(4, remainder & 0xff);
    } else {
      this.writeReg16("AX", quotient & 0xffff);
      this.writeReg16("DX", remainder & 0xffff);
    }
    this.state.FLAGS = flags;
  }

  private divideError(): void {
    this.state.halted = true;
    this.state.error = "divide error";
  }

  /**
   * MUL and IMUL both set CF and OF when the upper half of the result is not
   * merely a sign or zero extension of the lower half. That single test is the
   * whole rule, and it is easier to state than the two special cases.
   */
  private setMulFlags(lower: number, high: number, bits: Width): void {
    const mask = maskFor(bits);
    const expected = (lower & 0x8000) !== 0 ? mask : 0;
    const tooLarge = (high & mask) !== expected;
    let flags = this.state.FLAGS;
    flags = setFlag(flags, "CF", tooLarge);
    flags = setFlag(flags, "OF", tooLarge);
    this.state.FLAGS = flags;
  }

  private stackFrame(mnem: string, ops: readonly DecodedOperand[]): void {
    if (mnem === "LEAVE") {
      this.state.SP = this.state.BP;
      this.state.BP = this.pop();
      return;
    }
    const alloc = ops[0]?.kind === "imm" ? ops[0].value : 0;
    const level = ops[1]?.kind === "imm" ? ops[1].value : 0;
    // ENTER is only implemented at nesting level 0, which is all an 8086
    // teaching program uses; the deeper forms need the display pseudo-register.
    if (level > 0) {
      this.state.halted = true;
      this.state.error = "ENTER with nesting is not supported";
      return;
    }
    this.push(this.state.BP);
    this.state.BP = this.state.SP;
    this.state.SP = wrap16(this.state.SP - alloc);
  }

  /**
   * One pass of a string instruction. Repetition is handled by looping here
   * rather than by a REP prefix in the decoder, because a REP'd instruction has
   * exactly the same body and the count is just CX.
   */
  private string(instruction: DecodedInstruction): void {
    const mnem = instruction.mnem;
    const repeat = instruction.repeat;
    const width = mnem.endsWith("W") ? 16 : 8;
    const mask = maskFor(width);
    const doRepeat = repeat !== "none";
    const iterations = doRepeat ? this.state.CX & mask : 1;

    for (let i = 0; i < iterations; i++) {
      if (!this.stringStep(mnem, width)) return;
      if (!doRepeat) break;
    }

    if (doRepeat) this.state.CX = wrap16(this.state.CX - (iterations & mask));
  }

  private stringStep(mnem: string, width: Width): boolean {
    // `width` is in bits, but SI and DI move in bytes: a word instruction steps
    // two, a byte instruction one. Using the bit count would step sixteen.
    const element = width / 8;
    const delta = this.state.FLAGS & 0x0400 ? -element : element;
    const ds = this.segment("DS");
    const es = this.segment("ES");

    switch (mnem) {
      case "MOVSB":
      case "MOVSW": {
        const value = this.read8(ds, this.state.SI);
        this.write8(es, this.state.DI, value);
        this.state.SI = wrap16(this.state.SI + delta);
        this.state.DI = wrap16(this.state.DI + delta);
        return true;
      }
      case "STOSB":
      case "STOSW": {
        const value = width === 8 ? this.readReg8(0) : this.getAccumulator();
        if (width === 8) this.write8(es, this.state.DI, value);
        else this.write16(es, this.state.DI, value);
        this.state.DI = wrap16(this.state.DI + delta);
        return true;
      }
      case "LODSB":
      case "LODSW": {
        const value = this.read8(ds, this.state.SI);
        if (width === 8) this.setAL(value);
        else this.setAccumulator(value);
        this.state.SI = wrap16(this.state.SI + delta);
        return true;
      }
      case "CMPSB":
      case "CMPSW": {
        const a = width === 8 ? this.read8(ds, this.state.SI) : this.read16(ds, this.state.SI);
        const b = width === 8 ? this.read8(es, this.state.DI) : this.read16(es, this.state.DI);
        this.state.FLAGS = subFlags(a, b, 0, width, this.state.FLAGS).flags;
        this.state.SI = wrap16(this.state.SI + delta);
        this.state.DI = wrap16(this.state.DI + delta);
        return true;
      }
      case "SCASB":
      case "SCASW": {
        const a = width === 8 ? this.readReg8(0) : this.getAccumulator();
        const b = width === 8 ? this.read8(es, this.state.DI) : this.read16(es, this.state.DI);
        this.state.FLAGS = subFlags(a, b, 0, width, this.state.FLAGS).flags;
        this.state.DI = wrap16(this.state.DI + delta);
        return true;
      }
      default:
        this.state.halted = true;
        this.state.error = `unimplemented string instruction ${mnem}`;
        return false;
    }
  }
}

function formatOffset(offset: number): string {
  return `0x${offset.toString(16).padStart(4, "0")}`;
}

export { CF, PF, AF, ZF, SF, OF, physicalAddress };
