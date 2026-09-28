/**
 * Lexer tests. These pin the number and comment syntax that the existing
 * BrainBox examples and the compiler's code generator actually use, so a
 * regression in the tokenizer shows up here rather than as a baffling encoding
 * difference later.
 */

import { describe, expect, it } from "vitest";
import { tokenize } from "./lexer";
import { DiagnosticBag } from "./diagnostics";

function kinds(source: string): string[] {
  return tokenize(source)
    .filter((t) => t.kind !== "eof" && t.kind !== "newline")
    .map((t) => `${t.kind}:${t.text}`);
}

function numbers(source: string): number[] {
  return tokenize(source)
    .filter((t) => t.kind === "number" || t.kind === "char")
    .map((t) => t.value);
}

describe("lexer", () => {
  describe("number syntax", () => {
    it("reads decimal", () => {
      expect(numbers("1234")).toEqual([1234]);
    });

    it("reads 0x-prefixed hex", () => {
      expect(numbers("0xFF 0Xff")).toEqual([255, 255]);
    });

    it("reads an h-suffixed hex literal", () => {
      expect(numbers("0FFh 0ffH")).toEqual([255, 255]);
    });

    it("reads an h-suffixed literal whose digits are all decimal", () => {
      // MASM reads any digit run followed by `h` as hex. 0Bh is 11, not 0, and
      // not the identifier `Bh`.
      expect(numbers("0Bh 1Bh 12h 20h")).toEqual([0x0b, 0x1b, 0x12, 0x20]);
    });

    it("reads a b-suffixed binary literal", () => {
      expect(numbers("1010b 11111111B")).toEqual([10, 255]);
    });

    it("reads 0b-prefixed binary", () => {
      expect(numbers("0b1010")).toEqual([10]);
    });

    it("does not mistake a decimal for binary", () => {
      expect(numbers("1012b")).toEqual([1012]);
    });

    it("does not read a register as a hex literal", () => {
      // AH starts with a hex letter, so it stays a register name.
      expect(kinds("MOV AH, 1")).toEqual(["ident:MOV", "ident:AH", "punct:,", "number:1"]);
      expect(kinds("MOV BH, 1")[1]).toBe("ident:BH");
    });

    it("reads an unterminated hex run as a number then an identifier", () => {
      // MASM needs the h suffix; `10AB` is 10 followed by the name AB.
      expect(kinds("MOV AX, 10AB")).toEqual([
        "ident:MOV",
        "ident:AX",
        "punct:,",
        "number:10",
        "ident:AB",
      ]);
    });

    it("ignores underscore digit separators", () => {
      expect(numbers("1_000 0xF_F")).toEqual([1000, 0xff]);
    });
  });

  describe("literals", () => {
    it("reads a character literal", () => {
      expect(numbers("'A' 'z'")).toEqual([65, 122]);
    });

    it("honours escapes in character literals", () => {
      expect(numbers("'\\n' '\\t'")).toEqual([10, 9]);
    });

    it("decodes a string literal", () => {
      const [token] = tokenize('"Hi"').filter((t) => t.kind === "string");
      expect(token.string).toBe("Hi");
    });
  });

  describe("comments", () => {
    it("drops a semicolon comment", () => {
      expect(kinds("MOV AX, 1 ; set it\nHLT")).toEqual([
        "ident:MOV",
        "ident:AX",
        "punct:,",
        "number:1",
        "ident:HLT",
      ]);
    });

    it("drops a // comment", () => {
      expect(kinds("MOV AX, 1 // set it\nHLT")).toHaveLength(5);
    });

    it("drops a block comment", () => {
      expect(kinds("MOV /* sneaky */ AX, 1")).toEqual([
        "ident:MOV",
        "ident:AX",
        "punct:,",
        "number:1",
      ]);
    });

    it("reports an unterminated block comment", () => {
      const bag = new DiagnosticBag();
      tokenize("MOV /* forever", bag);
      expect(bag.errors.map((e) => e.message)).toEqual(["unterminated block comment"]);
    });
  });

  describe("structure tokens", () => {
    it("emits ? as the DUP filler, not as an identifier", () => {
      expect(kinds("5 DUP (?)")).toEqual(["number:5", "ident:DUP", "punct:(", "question:?", "punct:)"]);
    });

    it("emits $ as the location counter", () => {
      expect(kinds("JMP $")).toEqual(["ident:JMP", "dollar:$"]);
    });

    it("emits a newline token so statements can be told apart", () => {
      const lines = tokenize("MOV AX, 1\nHLT");
      const newlines = lines.filter((t) => t.kind === "newline");
      expect(newlines).toHaveLength(1);
      expect(newlines[0].line).toBe(1);
    });
  });

  describe("positions", () => {
    it("reports 1-based line and column", () => {
      const [mov, ax] = tokenize("MOV AX, 1").filter((t) => t.kind === "ident");
      expect([mov.line, mov.column]).toEqual([1, 1]);
      expect([ax.line, ax.column]).toEqual([1, 5]);
    });

    it("counts columns per line", () => {
      const hlt = tokenize("MOV AX, 1\n  HLT").find((t) => t.kind === "ident" && t.text === "HLT");
      expect([hlt?.line, hlt?.column]).toEqual([2, 3]);
    });
  });

  describe("errors", () => {
    it("reports an unexpected character with its position", () => {
      const bag = new DiagnosticBag();
      tokenize("MOV AX, 1\nMOV AX, #", bag);
      expect(bag.errors).toHaveLength(1);
      expect(bag.errors[0].line).toBe(2);
      expect(bag.errors[0].message).toContain("#");
    });

    it("reports an unterminated string", () => {
      const bag = new DiagnosticBag();
      tokenize('DB "oops', bag);
      expect(bag.errors.map((e) => e.message)).toEqual(["unterminated string literal"]);
    });
  });
});
