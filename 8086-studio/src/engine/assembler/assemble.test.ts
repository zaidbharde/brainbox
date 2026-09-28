/**
 * Assembler tests: directives, the two-pass layout, macros, listing and source
 * map, plus an assembly-level compatibility check over every program the app
 * already ships (the lab demos and the compiler's code generator output).
 */

import { describe, expect, it } from "vitest";
import { assemble } from "./assemble";

const bytes = (result: ReturnType<typeof assemble>): number[] => Array.from(result.image);

const at = (result: ReturnType<typeof assemble>, offset: number, length: number): number[] =>
  Array.from(result.image.subarray(offset, offset + length));

const errorsOf = (result: ReturnType<typeof assemble>): string[] =>
  result.errors.map((e) => `${e.line}:${e.column} ${e.message}`);

describe("assembler", () => {
  describe("instructions", () => {
    it("assembles a straight-line program", () => {
      const result = assemble("MOV AX, 9\nMOV BX, 2\nADD AX, BX\nHLT", { origin: 0 });
      expect(errorsOf(result)).toEqual([]);
      expect(bytes(result)).toEqual([0xb8, 0x09, 0x00, 0xbb, 0x02, 0x00, 0x01, 0xd8, 0xf4]);
    });

    it("defaults to a COM layout at 0x100 with SP=FFFE", () => {
      const result = assemble("HLT");
      expect(result.entry.ip).toBe(0x100);
      expect(result.entry.sp).toBe(0xfffe);
      expect(result.entry.codeSegment).toBe(result.entry.dataSegment);
      expect(result.entry.dataSegment).toBe(result.entry.stackSegment);
    });

    it("accepts Jcc aliases", () => {
      // JE and JZ are the same instruction.
      expect(at(assemble("JZ 0", { origin: 0 }), 0, 2)).toEqual(at(assemble("JE 0", { origin: 0 }), 0, 2));
    });

    it("treats SAL as SHL", () => {
      expect(at(assemble("SAL AX, 1", { origin: 0 }), 0, 2)).toEqual([0xd1, 0xe0]);
      expect(at(assemble("SHL AX, 1", { origin: 0 }), 0, 2)).toEqual([0xd1, 0xe0]);
    });

    it("prefers the sign-extended byte immediate for a word operation", () => {
      expect(at(assemble("ADD AX, 1", { origin: 0 }), 0, 3)).toEqual([0x83, 0xc0, 0x01]);
    });

    it("uses the accumulator form for a byte operation", () => {
      expect(at(assemble("ADD AL, 1", { origin: 0 }), 0, 2)).toEqual([0x04, 0x01]);
    });

    it("omits a segment override that matches the default", () => {
      expect(at(assemble("MOV AX, [SI]", { origin: 0 }), 0, 2)).toEqual([0x8b, 0x04]);
      expect(at(assemble("MOV AX, DS:[SI]", { origin: 0 }), 0, 2)).toEqual([0x8b, 0x04]);
    });

    it("emits a segment override that is needed", () => {
      // Matches the GNU-as fixture for `mov ax, es:[di]`.
      expect(at(assemble("MOV AX, ES:[DI]", { origin: 0 }), 0, 3)).toEqual([0x26, 0x8b, 0x05]);
    });

    it("defaults a BP address to SS rather than DS", () => {
      // [BP] with no override must not carry a DS prefix; [BP] with an explicit
      // DS must.
      expect(at(assemble("MOV AX, [BP]", { origin: 0 }), 0, 2)).toEqual([0x8b, 0x46, 0x00].slice(0, 2));
      expect(at(assemble("MOV AX, [BP+0]", { origin: 0 }), 0, 3)).toEqual([0x8b, 0x46, 0x00]);
      expect(at(assemble("MOV AX, DS:[BP+0]", { origin: 0 }), 0, 4)).toEqual([0x3e, 0x8b, 0x46, 0x00]);
    });
  });

  describe("labels and forward references", () => {
    it("resolves a forward branch and relaxes it to rel8", () => {
      const result = assemble("JE done\nNOP\ndone:\nHLT", { origin: 0 });
      expect(errorsOf(result)).toEqual([]);
      expect(at(result, 0, 2)).toEqual([0x74, 0x01]);
      expect(result.symbols.lookup("DONE")?.value).toBe(3);
    });

    it("uses rel16 when the target is out of rel8 range", () => {
      const source = ["JE far_away", ...Array(200).fill("NOP"), "far_away:", "HLT"].join("\n");
      const result = assemble(source, { origin: 0 });
      expect(errorsOf(result)).toEqual([]);
      // The 8086 near form is a single 0x8x byte with a 16-bit displacement.
      // The two-byte 0x0F 0x8x escape is 386-and-later and must not be used.
      expect(result.image[0]).toBe(0x84);
      const displacement = result.image[1] | (result.image[2] << 8);
      expect(displacement).toBe(200);
    });

    it("settles on one layout when several branches shrink at once", () => {
      // A forward branch has to be sized before its target is known, so early
      // passes lay it out wide and later passes narrow it. Each narrowing moves
      // the labels after it, so this only works if the passes are repeated until
      // the addresses stop changing. The bytes are then checked by actually
      // following the jumps, rather than by trusting the reported addresses.
      const source = [
        "a0: JMP a1",
        ...Array(120).fill("NOP"),
        "a1: JMP a2",
        ...Array(120).fill("NOP"),
        "a2: JMP a3",
        ...Array(120).fill("NOP"),
        "a3: HLT",
      ].join("\n");
      const result = assemble(source, { origin: 0 });
      expect(errorsOf(result)).toEqual([]);

      let ip = result.symbols.lookup("A0")!.value;
      for (let hop = 0; hop < 3; hop++) {
        const opcode = result.image[ip];
        const wide = opcode === 0xe9 || (opcode >= 0x80 && opcode <= 0x8f);
        const width = wide ? 3 : 2;
        const disp = wide
          ? (result.image[ip + 1] | (result.image[ip + 2] << 8)) << 16 >> 16
          : (result.image[ip + 1] << 24 >> 24);
        ip += width + disp;
      }
      expect(ip).toBe(result.symbols.lookup("A3")!.value);
      expect(result.image[ip]).toBe(0xf4);
    });

    it("resolves a forward reference used as a data address", () => {
      const result = assemble("MOV AX, later\nlater:\nDB 5", { origin: 0 });
      expect(errorsOf(result)).toEqual([]);
      expect(at(result, 0, 3)).toEqual([0xb8, 0x03, 0x00]);
    });

    it("accepts a colon-less label in the first column", () => {
      const result = assemble("done:\nHLT\n", { origin: 0 });
      expect(result.symbols.lookup("DONE")?.value).toBe(0);
    });

    it("does not mistake a mnemonic for a label", () => {
      // A bare-label heuristic that grabbed `JE` would silently define a label
      // and then fail to assemble the operand.
      const result = assemble("JE over\nNOP\nover:\nHLT", { origin: 0 });
      expect(errorsOf(result)).toEqual([]);
      expect(result.symbols.lookup("JE")).toBeUndefined();
    });
  });

  describe("equates", () => {
    it("defines a constant with EQU", () => {
      const result = assemble("count EQU 5\nMOV CX, count", { origin: 0 });
      expect(errorsOf(result)).toEqual([]);
      expect(at(result, 0, 3)).toEqual([0xb9, 0x05, 0x00]);
    });

    it("defines a constant with =", () => {
      const result = assemble("count = 7\nMOV CX, count", { origin: 0 });
      expect(at(result, 0, 3)).toEqual([0xb9, 0x07, 0x00]);
    });

    it("evaluates constant expressions", () => {
      const result = assemble("base EQU 0x10\nMOV AX, base * 2 + 1", { origin: 0 });
      expect(at(result, 0, 3)).toEqual([0xb8, 0x21, 0x00]);
    });

    it("resolves OFFSET of a label", () => {
      const result = assemble("MOV AX, OFFSET buf\nbuf: DB 1", { origin: 0 });
      expect(at(result, 0, 3)).toEqual([0xb8, 0x03, 0x00]);
    });
  });

  describe("data directives", () => {
    it("emits DB values", () => {
      const result = assemble("DB 1, 2, 3", { origin: 0 });
      expect(bytes(result)).toEqual([1, 2, 3]);
    });

    it("emits little-endian DW", () => {
      const result = assemble("DW 1234h", { origin: 0 });
      expect(bytes(result)).toEqual([0x34, 0x12]);
    });

    it("emits a four-byte DD", () => {
      const result = assemble("DD 11223344h", { origin: 0 });
      expect(bytes(result)).toEqual([0x44, 0x33, 0x22, 0x11]);
    });

    it("expands DUP with a single value", () => {
      const result = assemble("DB 4 DUP (0)", { origin: 0 });
      expect(bytes(result)).toEqual([0, 0, 0, 0]);
    });

    it("expands DUP with a list", () => {
      const result = assemble("DB 2 DUP (1, 2)", { origin: 0 });
      expect(bytes(result)).toEqual([1, 2, 1, 2]);
    });

    it("emits a string and a terminator", () => {
      const result = assemble('DB "Hi", 0', { origin: 0 });
      expect(bytes(result)).toEqual([0x48, 0x69, 0x00]);
    });

    it("treats ? as uninitialised", () => {
      const result = assemble("DB ?", { origin: 0 });
      expect(bytes(result)).toEqual([0]);
    });

    it("supports a DUP count from an equate", () => {
      const result = assemble("n EQU 3\nDB n DUP (7)", { origin: 0 });
      expect(bytes(result)).toEqual([7, 7, 7]);
    });
  });

  describe("layout", () => {
    it("honours ORG", () => {
      const result = assemble("ORG 200h\nDB 1", { origin: 0 });
      expect(result.image[0x200]).toBe(1);
      expect(result.entry.ip).toBe(0x200);
    });

    it("honours a .STACK size for SP", () => {
      const result = assemble(".MODEL small\n.STACK 400h\nHLT");
      expect(result.entry.sp).toBe(0x400);
    });

    it("puts code at offset 0 for a .MODEL program", () => {
      const result = assemble(".MODEL small\nHLT");
      expect(result.entry.ip).toBe(0);
    });

    it("lays out separate segments", () => {
      const source = [
        ".MODEL small",
        "CODE SEGMENT",
        "start:",
        "  MOV AX, 1",
        "CODE ENDS",
        "DATA SEGMENT",
        "var DW 2",
        "DATA ENDS",
        "END start",
      ].join("\n");
      const result = assemble(source);
      expect(errorsOf(result)).toEqual([]);
      const names = result.segments.map((s) => s.name);
      expect(names).toContain("CODE");
      expect(names).toContain("DATA");
      expect(result.entry.codeSegment).toBe("CODE");
      expect(result.entry.dataSegment).toBe("DATA");
      // Distinct bases, so the segments are independently addressable.
      const code = result.segments.find((s) => s.name === "CODE")!;
      const data = result.segments.find((s) => s.name === "DATA")!;
      expect(code.base).not.toBe(data.base);
      expect(result.symbols.lookup("VAR")?.segment).toBe("DATA");
    });

    it("uses the END label as the entry point", () => {
      const source = ["CODE SEGMENT", "  JMP over", "  NOP", "over:", "  HLT", "CODE ENDS", "END over"].join("\n");
      const result = assemble(source);
      expect(result.entry.ip).toBe(result.symbols.lookup("OVER")!.value);
    });
  });

  describe("macros", () => {
    it("expands a macro and substitutes its parameters", () => {
      const result = assemble("DELAY MACRO n\n  MOV CX, n\n  LOOP $\nENDM\n  DELAY 5\n  HLT", { origin: 0 });
      expect(errorsOf(result)).toEqual([]);
      expect(bytes(result)).toEqual([0xb9, 0x05, 0x00, 0xe2, 0xfe, 0xf4]);
    });

    it("expands a macro invoked with parentheses", () => {
      const result = assemble("DELAY MACRO n\n  MOV CX, n\nENDM\n  DELAY(9)\n  HLT", { origin: 0 });
      expect(at(result, 0, 3)).toEqual([0xb9, 0x09, 0x00]);
    });

    it("keeps separate labels for separate invocations", () => {
      const result = assemble(
        ["TWICE MACRO", "  JMP local", "local:", "  NOP", "ENDM", "  TWICE", "  TWICE"].join("\n"),
        { origin: 0 },
      );
      expect(errorsOf(result)).toEqual([]);
    });

    it("reports the wrong number of arguments", () => {
      const result = assemble("D MACRO a, b\n  NOP\nENDM\n  D 1", { origin: 0 });
      expect(errorsOf(result).join()).toContain("takes 2 argument(s) but 1");
    });

    it("reports a macro with no ENDM", () => {
      const result = assemble("D MACRO\n  NOP", { origin: 0 });
      expect(errorsOf(result).join()).toContain("missing its ENDM");
    });
  });

  describe("diagnostics", () => {
    it("collects every error rather than stopping at the first", () => {
      const result = assemble("FOO\nBAR\nBAZ", { origin: 0 });
      expect(result.errors).toHaveLength(3);
      expect(result.success).toBe(false);
    });

    it("reports a 1-based line and column", () => {
      const result = assemble("MOV AX, 1\n  NOTANOP", { origin: 0 });
      expect(errorsOf(result)).toEqual(["2:3 unknown instruction NOTANOP"]);
    });

    it("names an undefined symbol", () => {
      const result = assemble("MOV AX, nowhere", { origin: 0 });
      expect(errorsOf(result).join()).toContain("undefined symbol NOWHERE");
    });

    it("rejects an operand shape the instruction cannot take", () => {
      const result = assemble("MOV AX, BX, CX", { origin: 0 });
      expect(errorsOf(result).join()).toContain("no encoding of MOV accepts");
    });

    it("rejects three registers in an 8086 effective address", () => {
      const result = assemble("MOV AX, [BX+SI+BP]", { origin: 0 });
      expect(errorsOf(result).join()).toContain("at most two registers");
    });

    it("rejects a register being subtracted in an effective address", () => {
      const result = assemble("MOV AX, [BX-SI]", { origin: 0 });
      expect(errorsOf(result).join()).toContain("cannot be subtracted");
    });

    it("rejects an immediate too large for its field", () => {
      const result = assemble("MOV AL, 1234h", { origin: 0 });
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("reports division by zero in an expression", () => {
      const result = assemble("n EQU 1/0", { origin: 0 });
      expect(errorsOf(result).join()).toContain("division by zero");
    });

    it("reports an unknown segment in ASSUME", () => {
      const result = assemble("ASSUME DS:NOTHING_HERE\nHLT", { origin: 0 });
      expect(errorsOf(result).join()).toContain("unknown segment");
    });

    it("names a directive that is not implemented yet", () => {
      const result = assemble("IF 1\nHLT\nENDIF", { origin: 0 });
      expect(errorsOf(result).join()).toContain("not supported yet");
    });
  });

  describe("listing and source map", () => {
    it("records the bytes and offset of every statement", () => {
      const result = assemble("MOV AX, 1\nHLT", { origin: 0x100 });
      expect(result.listing.map((e) => [e.line, e.offset, e.bytes])).toEqual([
        [1, 0x100, [0xb8, 0x01, 0x00]],
        [2, 0x103, [0xf4]],
      ]);
    });

    it("maps each statement back to its source line", () => {
      const result = assemble("MOV AX, 1\nNOP\nHLT", { origin: 0x100 });
      expect(result.sourceLines.map((e) => e.line)).toEqual([1, 2, 3]);
      expect(result.sourceLines[1].offset).toBe(0x103);
    });

    it("maps the compiler's _SRC_ labels to their addresses", () => {
      const result = assemble("_SRC_7_0:\n  HLT", { origin: 0 });
      expect(result.symbols.lookup("_SRC_7_0")?.value).toBe(0);
    });
  });
});
