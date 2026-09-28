#!/usr/bin/env node
/**
 * test/fixtures/generate-encoder-fixtures.mjs
 *
 * Regenerates test/fixtures/encoder-bytes.json using a real assembler
 * (GNU binutils `as` in .code16 / .intel_syntax noprefix mode, which targets
 * the original 8086 encoding). Run it only when the fixture list changes:
 *
 *   node test/fixtures/generate-encoder-fixtures.mjs
 *
 * The committed JSON is what the Vitest encoder test asserts against, so the
 * test suite never needs `as` installed. The bytes below were produced by `as`
 * and are therefore an independent check on our encoder, not a restatement of
 * it.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Each case is one instruction. `asm` is fed to GNU as verbatim; the recorded
 * bytes are the whole assembled text section, so every case must be exactly
 * one instruction. `mnem`/`ops` are our own normalised spelling and are used
 * to report which case failed.
 *
 * Relative branches use `.+N` (N = instruction length) so the displacement is
 * 0 and the fixture does not depend on where the snippet is loaded; cases
 * with a real displacement use an explicit label plus `.space` padding.
 */
const CASES = [
  // --- data movement ---------------------------------------------------
  { mnem: "MOV", ops: "AX,BX", asm: "mov ax, bx" },
  { mnem: "MOV", ops: "AL,BL", asm: "mov al, bl" },
  { mnem: "MOV", ops: "AX,[BX]", asm: "mov ax, [bx]" },
  { mnem: "MOV", ops: "AX,[SI]", asm: "mov ax, [si]" },
  { mnem: "MOV", ops: "AX,[DI]", asm: "mov ax, [di]" },
  { mnem: "MOV", ops: "AX,[BP]", asm: "mov ax, [bp]" },
  { mnem: "MOV", ops: "[BX],AX", asm: "mov [bx], ax" },
  { mnem: "MOV", ops: "[BX+SI],AX", asm: "mov [bx+si], ax" },
  { mnem: "MOV", ops: "[BX+DI],AX", asm: "mov [bx+di], ax" },
  { mnem: "MOV", ops: "[BP+SI],AX", asm: "mov [bp+si], ax" },
  { mnem: "MOV", ops: "[BP+DI],AX", asm: "mov [bp+di], ax" },
  { mnem: "MOV", ops: "AX,[BX+SI+4]", asm: "mov ax, [bx+si+4]" },
  { mnem: "MOV", ops: "AX,[BX+SI+0x1234]", asm: "mov ax, [bx+si+0x1234]" },
  { mnem: "MOV", ops: "AX,[BX-2]", asm: "mov ax, [bx-2]" },
  { mnem: "MOV", ops: "AX,ES:[DI]", asm: "mov ax, es:[di]" },
  { mnem: "MOV", ops: "AX,DS:[SI]", asm: "mov ax, ds:[si]" },
  { mnem: "MOV", ops: "AL,CS:[BP]", asm: "mov al, cs:[bp]" },
  { mnem: "MOV", ops: "AX,[0x1234]", asm: "mov ax, [0x1234]" },
  { mnem: "MOV", ops: "[0x1234],AX", asm: "mov [0x1234], ax" },
  { mnem: "MOV", ops: "AL,[0x80]", asm: "mov al, [0x80]" },
  { mnem: "MOV", ops: "AL,0x12", asm: "mov al, 0x12" },
  { mnem: "MOV", ops: "AX,0x1234", asm: "mov ax, 0x1234" },
  { mnem: "MOV", ops: "CL,0x5A", asm: "mov cl, 0x5a" },
  { mnem: "MOV", ops: "DX,0x0040", asm: "mov dx, 0x0040" },
  { mnem: "MOV", ops: "DS,AX", asm: "mov ds, ax" },
  { mnem: "MOV", ops: "ES,AX", asm: "mov es, ax" },
  { mnem: "MOV", ops: "SS,AX", asm: "mov ss, ax" },
  { mnem: "MOV", ops: "AX,DS", asm: "mov ax, ds" },
  { mnem: "MOV", ops: "AL,[BX+SI]", asm: "mov al, [bx+si]" },
  { mnem: "MOV", ops: "BYTE PTR [BX+DI],0x5", asm: "mov byte ptr [bx+di], 0x5" },
  { mnem: "MOV", ops: "WORD PTR [SI+8],0xBEEF", asm: "mov word ptr [si+8], 0xbeef" },

  // --- XCHG ------------------------------------------------------------
  { mnem: "XCHG", ops: "AX,BX", asm: "xchg ax, bx" },
  { mnem: "XCHG", ops: "AL,BL", asm: "xchg al, bl" },
  { mnem: "XCHG", ops: "AX,[BX]", asm: "xchg ax, [bx]" },
  { mnem: "XCHG", ops: "CX,DX", asm: "xchg cx, dx" },

  // --- LEA -------------------------------------------------------------
  { mnem: "LEA", ops: "AX,[BX+SI]", asm: "lea ax, [bx+si]" },
  { mnem: "LEA", ops: "SI,[BX+DI+2]", asm: "lea si, [bx+di+2]" },
  { mnem: "LEA", ops: "BP,[BP+DI-4]", asm: "lea bp, [bp+di-4]" },
  { mnem: "LEA", ops: "DX,[DI]", asm: "lea dx, [di]" },
  { mnem: "LEA", ops: "AX,[0x1234]", asm: "lea ax, [0x1234]" },
  { mnem: "LEA", ops: "BX,[SI+0x1234]", asm: "lea bx, [si+0x1234]" },

  // --- arithmetic / logic, byte and word, both directions ---------------
  { mnem: "ADD", ops: "AL,BL", asm: "add al, bl" },
  { mnem: "ADD", ops: "BL,AL", asm: "add bl, al" },
  { mnem: "ADD", ops: "AX,BX", asm: "add ax, bx" },
  { mnem: "ADD", ops: "AX,[BX+SI]", asm: "add ax, [bx+si]" },
  { mnem: "ADD", ops: "[BX+DI],AL", asm: "add [bx+di], al" },
  { mnem: "ADD", ops: "AL,1", asm: "add al, 1" },
  { mnem: "ADD", ops: "AX,1", asm: "add ax, 1" },
  { mnem: "ADD", ops: "AX,0x1234", asm: "add ax, 0x1234" },
  { mnem: "ADD", ops: "WORD PTR [BX],0x10", asm: "add word ptr [bx], 0x10" },
  { mnem: "OR", ops: "AL,BL", asm: "or al, bl" },
  { mnem: "OR", ops: "AX,0x0F0F", asm: "or ax, 0x0f0f" },
  { mnem: "ADC", ops: "AL,BL", asm: "adc al, bl" },
  { mnem: "ADC", ops: "AX,1", asm: "adc ax, 1" },
  { mnem: "SBB", ops: "AL,BL", asm: "sbb al, bl" },
  { mnem: "SBB", ops: "AX,BX", asm: "sbb ax, bx" },
  { mnem: "AND", ops: "AL,0x0F", asm: "and al, 0x0f" },
  { mnem: "AND", ops: "AX,0x0F0F", asm: "and ax, 0x0f0f" },
  { mnem: "SUB", ops: "AL,BL", asm: "sub al, bl" },
  { mnem: "SUB", ops: "AX,BX", asm: "sub ax, bx" },
  { mnem: "SUB", ops: "AX,1", asm: "sub ax, 1" },
  { mnem: "SUB", ops: "AL,1", asm: "sub al, 1" },
  { mnem: "XOR", ops: "AL,BL", asm: "xor al, bl" },
  { mnem: "XOR", ops: "AX,AX", asm: "xor ax, ax" },
  { mnem: "CMP", ops: "AL,BL", asm: "cmp al, bl" },
  { mnem: "CMP", ops: "AX,BX", asm: "cmp ax, bx" },
  { mnem: "CMP", ops: "AL,0x7F", asm: "cmp al, 0x7f" },
  { mnem: "CMP", ops: "AX,0x7FFF", asm: "cmp ax, 0x7fff" },
  { mnem: "CMP", ops: "AX,1", asm: "cmp ax, 1" },
  { mnem: "CMP", ops: "AL,1", asm: "cmp al, 1" },
  { mnem: "TEST", ops: "AL,BL", asm: "test al, bl" },
  { mnem: "TEST", ops: "AX,BX", asm: "test ax, bx" },
  { mnem: "TEST", ops: "AL,0x01", asm: "test al, 0x01" },
  { mnem: "TEST", ops: "AX,0x1234", asm: "test ax, 0x1234" },
  { mnem: "TEST", ops: "AX,0x0001", asm: "test ax, 0x0001" },

  // --- inc/dec ---------------------------------------------------------
  { mnem: "INC", ops: "AX", asm: "inc ax" },
  { mnem: "INC", ops: "BX", asm: "inc bx" },
  { mnem: "INC", ops: "BYTE PTR [BX]", asm: "inc byte ptr [bx]" },
  { mnem: "INC", ops: "WORD PTR [BP+SI]", asm: "inc word ptr [bp+si]" },
  { mnem: "DEC", ops: "AX", asm: "dec ax" },
  { mnem: "DEC", ops: "SI", asm: "dec si" },
  { mnem: "DEC", ops: "BYTE PTR [SI]", asm: "dec byte ptr [si]" },

  // --- multiply / divide / neg / not ------------------------------------
  { mnem: "MUL", ops: "BL", asm: "mul bl" },
  { mnem: "MUL", ops: "BX", asm: "mul bx" },
  { mnem: "MUL", ops: "BYTE PTR [BX+SI]", asm: "mul byte ptr [bx+si]" },
  { mnem: "MUL", ops: "WORD PTR [DI]", asm: "mul word ptr [di]" },
  { mnem: "IMUL", ops: "BL", asm: "imul bl" },
  { mnem: "IMUL", ops: "BX", asm: "imul bx" },
  { mnem: "DIV", ops: "BL", asm: "div bl" },
  { mnem: "DIV", ops: "BX", asm: "div bx" },
  { mnem: "IDIV", ops: "BL", asm: "idiv bl" },
  { mnem: "IDIV", ops: "BX", asm: "idiv bx" },
  { mnem: "NEG", ops: "AL", asm: "neg al" },
  { mnem: "NEG", ops: "AX", asm: "neg ax" },
  { mnem: "NEG", ops: "WORD PTR [BX+DI]", asm: "neg word ptr [bx+di]" },
  { mnem: "NOT", ops: "AL", asm: "not al" },
  { mnem: "NOT", ops: "WORD PTR [SI]", asm: "not word ptr [si]" },

  // --- shifts and rotates ----------------------------------------------
  { mnem: "SHL", ops: "AL,1", asm: "shl al, 1" },
  { mnem: "SHL", ops: "AX,CL", asm: "shl ax, cl" },
  { mnem: "SHL", ops: "BYTE PTR [BX],1", asm: "shl byte ptr [bx], 1" },
  { mnem: "SHL", ops: "WORD PTR [BP+DI],CL", asm: "shl word ptr [bp+di], cl" },
  { mnem: "SAL", ops: "AX,1", asm: "sal ax, 1" },
  { mnem: "SHR", ops: "AL,CL", asm: "shr al, cl" },
  { mnem: "SHR", ops: "AX,1", asm: "shr ax, 1" },
  { mnem: "SAR", ops: "AL,1", asm: "sar al, 1" },
  { mnem: "SAR", ops: "AX,CL", asm: "sar ax, cl" },
  { mnem: "ROL", ops: "AL,1", asm: "rol al, 1" },
  { mnem: "ROL", ops: "AX,CL", asm: "rol ax, cl" },
  { mnem: "ROR", ops: "AL,1", asm: "ror al, 1" },
  { mnem: "ROR", ops: "AX,CL", asm: "ror ax, cl" },
  { mnem: "RCL", ops: "AL,1", asm: "rcl al, 1" },
  { mnem: "RCL", ops: "AX,CL", asm: "rcl ax, cl" },
  { mnem: "RCR", ops: "AL,1", asm: "rcr al, 1" },
  { mnem: "RCR", ops: "AX,CL", asm: "rcr ax, cl" },

  // --- sign extension / BCD --------------------------------------------
  { mnem: "CBW", ops: "", asm: "cbw" },
  { mnem: "CWD", ops: "", asm: "cwd" },
  { mnem: "DAA", ops: "", asm: "daa" },
  { mnem: "DAS", ops: "", asm: "das" },
  { mnem: "AAA", ops: "", asm: "aaa" },
  { mnem: "AAS", ops: "", asm: "aas" },
  { mnem: "AAM", ops: "10", asm: "aam 10" },
  { mnem: "AAD", ops: "10", asm: "aad 10" },
  { mnem: "XLAT", ops: "", asm: "xlat" },

  // --- jumps, calls, returns -------------------------------------------
  { mnem: "JMP", ops: "SHORT .L", asm: "jmp short .+2" },
  // `.+200` forces the near (16-bit displacement) encoding: GNU as shortens
  // `.+3` to a 2-byte jump, which would test the wrong opcode entirely.
  { mnem: "JMP", ops: "NEAR .L+200", asm: "jmp .+200" },
  { mnem: "JMP", ops: "AX", asm: "jmp ax" },
  { mnem: "JMP", ops: "[BX+SI]", asm: "jmp [bx+si]" },
  { mnem: "CALL", ops: "NEAR .L+200", asm: "call .+200" },
  { mnem: "CALL", ops: "AX", asm: "call ax" },
  { mnem: "CALL", ops: "[SI+4]", asm: "call [si+4]" },
  { mnem: "RET", ops: "", asm: "ret" },
  { mnem: "RET", ops: "4", asm: "ret 4" },
  { mnem: "RETF", ops: "", asm: "retf" },
  { mnem: "LEAVE", ops: "", asm: "leave" },
  { mnem: "ENTER", ops: "8,0", asm: "enter 8, 0" },

  // --- conditional jumps: all 16 conditions ---------------------------
  { mnem: "JO", ops: "SHORT .L", asm: "jo .+2" },
  { mnem: "JNO", ops: "SHORT .L", asm: "jno .+2" },
  { mnem: "JB", ops: "SHORT .L", asm: "jb .+2" },
  { mnem: "JNB", ops: "SHORT .L", asm: "jnb .+2" },
  { mnem: "JZ", ops: "SHORT .L", asm: "jz .+2" },
  { mnem: "JNZ", ops: "SHORT .L", asm: "jnz .+2" },
  { mnem: "JBE", ops: "SHORT .L", asm: "jbe .+2" },
  { mnem: "JA", ops: "SHORT .L", asm: "ja .+2" },
  { mnem: "JS", ops: "SHORT .L", asm: "js .+2" },
  { mnem: "JNS", ops: "SHORT .L", asm: "jns .+2" },
  { mnem: "JP", ops: "SHORT .L", asm: "jp .+2" },
  { mnem: "JNP", ops: "SHORT .L", asm: "jnp .+2" },
  { mnem: "JL", ops: "SHORT .L", asm: "jl .+2" },
  { mnem: "JGE", ops: "SHORT .L", asm: "jge .+2" },
  { mnem: "JLE", ops: "SHORT .L", asm: "jle .+2" },
  { mnem: "JG", ops: "SHORT .L", asm: "jg .+2" },
  { mnem: "JO", ops: "NEAR .L+200", asm: "jo .+200" },
  { mnem: "JNB", ops: "NEAR .L+200", asm: "jnb .+200" },
  { mnem: "JZ", ops: "NEAR .L+200", asm: "jz .+200" },
  { mnem: "JGE", ops: "NEAR .L+200", asm: "jge .+200" },
  { mnem: "LOOP", ops: "SHORT .L", asm: "loop .+2" },
  { mnem: "LOOPE", ops: "SHORT .L", asm: "loope .+2" },
  { mnem: "LOOPNE", ops: "SHORT .L", asm: "loopne .+2" },
  { mnem: "JCXZ", ops: "SHORT .L", asm: "jcxz .+2" },

  // --- stack -----------------------------------------------------------
  { mnem: "PUSH", ops: "AX", asm: "push ax" },
  { mnem: "PUSH", ops: "SP", asm: "push sp" },
  { mnem: "PUSH", ops: "ES", asm: "push es" },
  { mnem: "PUSH", ops: "WORD PTR [BX+DI]", asm: "push word ptr [bx+di]" },
  { mnem: "POP", ops: "AX", asm: "pop ax" },
  { mnem: "POP", ops: "DS", asm: "pop ds" },
  { mnem: "POP", ops: "WORD PTR [SI]", asm: "pop word ptr [si]" },
  { mnem: "PUSHF", ops: "", asm: "pushf" },
  { mnem: "POPF", ops: "", asm: "popf" },

  // --- flags -----------------------------------------------------------
  { mnem: "CLC", ops: "", asm: "clc" },
  { mnem: "STC", ops: "", asm: "stc" },
  { mnem: "CMC", ops: "", asm: "cmc" },
  { mnem: "CLD", ops: "", asm: "cld" },
  { mnem: "STD", ops: "", asm: "std" },
  { mnem: "CLI", ops: "", asm: "cli" },
  { mnem: "STI", ops: "", asm: "sti" },
  { mnem: "SAHF", ops: "", asm: "sahf" },
  { mnem: "LAHF", ops: "", asm: "lahf" },

  // --- string instructions --------------------------------------------
  { mnem: "MOVSB", ops: "", asm: "movsb" },
  { mnem: "MOVSW", ops: "", asm: "movsw" },
  { mnem: "STOSB", ops: "", asm: "stosb" },
  { mnem: "STOSW", ops: "", asm: "stosw" },
  { mnem: "LODSB", ops: "", asm: "lodsb" },
  { mnem: "LODSW", ops: "", asm: "lodsw" },
  { mnem: "SCASB", ops: "", asm: "scasb" },
  { mnem: "SCASW", ops: "", asm: "scasw" },
  { mnem: "CMPSB", ops: "", asm: "cmpsb" },
  { mnem: "CMPSW", ops: "", asm: "cmpsw" },

  // --- I/O -------------------------------------------------------------
  { mnem: "IN", ops: "AL,0x60", asm: "in al, 0x60" },
  { mnem: "IN", ops: "AX,0x60", asm: "in ax, 0x60" },
  { mnem: "IN", ops: "AL,DX", asm: "in al, dx" },
  { mnem: "IN", ops: "AX,DX", asm: "in ax, dx" },
  { mnem: "OUT", ops: "0x60,AL", asm: "out 0x60, al" },
  { mnem: "OUT", ops: "0x60,AX", asm: "out 0x60, ax" },
  { mnem: "OUT", ops: "DX,AL", asm: "out dx, al" },
  { mnem: "OUT", ops: "DX,AX", asm: "out dx, ax" },

  // --- interrupts, misc ------------------------------------------------
  { mnem: "INT", ops: "0x21", asm: "int 0x21" },
  { mnem: "INT3", ops: "", asm: "int3" },
  { mnem: "IRET", ops: "", asm: "iret" },
  { mnem: "HLT", ops: "", asm: "hlt" },
  { mnem: "NOP", ops: "", asm: "nop" },
  { mnem: "WAIT", ops: "", asm: "wait" },
  { mnem: "LES", ops: "AX,[BX]", asm: "les ax, [bx]" },
  { mnem: "LDS", ops: "AX,[SI+2]", asm: "lds ax, [si+2]" },
];

function hasAssembler() {
  try {
    execFileSync("as", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Read the exact byte size of the `.text` section from the ELF section header.
 *   [Nr] Name  Type   Address  Off    Size   ES Flg Lk Inf Al
 *   [ 1] .text PROGBITS 000000 000034 000003 00  AX   0  0  1
 */
function readSectionSize(obj) {
  const output = execFileSync("readelf", ["-S", "-W", obj], { encoding: "utf8" });
  for (const line of output.split("\n")) {
    if (!/\s\.text\s/.test(line)) continue;
    const parts = line.trim().split(/\s+/);
    // parts[0]='[', 1=Nr, 2=Name, 3=Type, 4=Address, 5=Off, 6=Size
    const size = parseInt(parts[6], 16);
    if (!Number.isFinite(size)) throw new Error(`cannot parse .text size from: ${line}`);
    return size;
  }
  throw new Error("no .text section found");
}

function assembleOne(asm, workdir, index) {
  const src = join(workdir, `case-${index}.s`);
  const obj = join(workdir, `case-${index}.o`);
  const bin = join(workdir, `case-${index}.bin`);
  writeFileSync(src, `.code16\n.intel_syntax noprefix\n${asm}\n`);
  execFileSync("as", ["--32", "-o", obj, src], { stdio: "pipe" });
  // objcopy pads a section out to a file boundary with zeros, so the exact
  // instruction length must come from the ELF section header, not from the
  // binary (a trailing zero is legitimate: `jmp short .+2` is `eb 00`).
  const size = readSectionSize(obj);
  execFileSync("objcopy", ["-O", "binary", "-j", ".text", obj, bin], { stdio: "pipe" });
  return Array.from(readFileSync(bin).subarray(0, size));
}

function main() {
  if (!hasAssembler()) {
    console.error(
      "GNU as not found. Fixtures are committed, so regeneration is optional; " +
        "install binutils to regenerate.",
    );
    process.exit(1);
  }
  const workdir = mkdtempSync(join(tmpdir(), "bb-isa-"));
  const out = {};
  let failed = 0;
  try {
    CASES.forEach((c, i) => {
      let bytes;
      try {
        bytes = assembleOne(c.asm, workdir, i);
      } catch (err) {
        failed++;
        console.error(`FAIL ${c.mnem} ${c.ops}  (${c.asm}): ${String(err.stderr ?? err).trim()}`);
        return;
      }
      if (bytes.length === 0 || bytes.length > 7) {
        failed++;
        console.error(`SUSPECT ${c.mnem} ${c.ops}: ${bytes.length} bytes`);
        return;
      }
      out[`${c.mnem} ${c.ops}`.trim()] = bytes;
    });
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }

  const target = join(here, "encoder-bytes.json");
  writeFileSync(target, `${JSON.stringify(out, null, 2)}\n`);
  console.log(
    `wrote ${Object.keys(out).length} fixtures to ${target}` +
      (failed ? ` (${failed} failed)` : ""),
  );
  if (failed) process.exit(1);
}

if (existsSync(process.argv[1] ?? "")) main();
