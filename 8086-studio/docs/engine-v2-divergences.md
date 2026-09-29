# Where the two engines differ

The lab runs one of two engines: the legacy emulator in `src/emulator/`, and the
new one in `src/engine/`. `?engine=v2` selects the new one; anything else, including
no parameter at all, runs the legacy, which is what the lab has always done.

Both are reached through the same interface, `src/lab/execution-engine.ts`, and
`src/lab/execution-engine.test.ts` checks from the outside that they answer it the
same way. This file is for the places where they genuinely do not, because those
are the places where flipping the URL parameter will change what a program does.

The distinction that matters throughout: **some of these are the new engine being
better, some are it being narrower, and the input model is neither** — the legacy
cannot read DOS input at all and the new engine cannot be fed by the Run button, so
each is limited in a way the other is not. None of these is a bug waiting to be
fixed in whichever engine is less convenient.

## Structural

These are consequences of the two engines having different models, not of either
being wrong. They are the reason the adapter exists.

### IP counts instructions on the legacy and addresses on the new engine

The legacy's `IP` register is an index into its parsed instruction list, so a
program's fourth instruction reports `IP = 4`. The new engine has real bytes at
real addresses, so the same program reports `IP = 0x103`. Both step by one
instruction per press; they just disagree about what the number means.

This is the divergence that has the widest blast radius. The debugger's panels
index `debugProgram.instructions[ip]`, which is correct for the legacy and
meaningless for the new engine. That is why the debug view is not yet wired to the
new engine — see [Remaining work](#remaining-work).

### Memory is 4 KB flat on the legacy and a 64 KB segment on the new engine

`session.state.memory` is a 4096-byte array for the legacy and a 65536-byte mirror
of the running segment for the new one. The mirror is what makes the lab's existing
Stack and Data Segment views show the addresses they always have.

### Input is a pre-filled port window on the legacy and a character queue on the new engine

This one changed what the lab's Run button can ask for, so it is worth being
precise.

The legacy implements only three `INT 21h` services: AH=`4C` to terminate, and
AH=`02` and AH=`09` to print. It has **no read services at all**. Its entire input
model is the Run button writing a number into the port window before each `IN`, so
a program using `IN AL, 30h` names its own inputs in the source and the prompt can
say which port each one is.

The new engine inverts both halves. It implements AH=`01`, `07`, `08` and `0Ah` as
reads, and its input is a character queue those services consume. But its `IN`
reads a port window that only `OUTP` writes, so **a number collected for an `IN`
would never be read**, and a program that uses `MOV AH, 01h / INT 21h` reads input
without containing an `IN` at all, so there is nothing to count up front.

`DebugSession.inputPrompts()` therefore returns one entry per `IN` on the legacy and
an empty list on the new engine, and the Run button asks nothing there. The empty
list is a defined answer rather than a hang: the queue is finite and returns zero
when it runs dry, where real DOS would block. Collecting a value the engine then
discards would be worse than not asking, because the run would look fed when it was
not.

### The new engine's step diagnostics report printed text; the legacy's do not

A whole-program run collects DOS print-string output on both engines, but the
legacy's per-step diagnostics know only about `OUT` and `OUTC`. A program using
`INT 21h AH=09H` therefore shows nothing in the debug output panel on the legacy
while printing correctly when run. The legacy is left alone; this is a gap in its
step diagnostics, not a difference in what the programs do.

### Hand-written assembly maps to source lines only on the new engine

The legacy builds its source map from `_SRC_` labels that the structured compiler
emits, so for assembly typed into the editor its map is empty and the editor
highlights nothing. The new assembler reports every statement as it lays it out, so
the same source is mapped with no preprocessing.

## The new engine being narrower

### Far `CALL` and far `JMP` have no source syntax

`CALLF ptr16` (`9Ah`) and `JMP ptr16` (`0EAh`) are in the instruction table and
decode and execute correctly, but **no spelling in the assembler produces them**:
there is no `ptr16` operand syntax, and a bare label always takes the near form.

They are listed by name in `NOT_ASSEMBLABLE` in
`src/engine/cpu/executable-coverage.test.ts`, which asserts that each one *still*
fails to assemble. If a far form ever becomes spellable, that test fails and the
exception is stale, so the gap cannot quietly stop being a gap.

### `JNO NEAR` and `JG NEAR` are shadowed by other opcodes

Two table entries cannot be reached because a shorter opcode already means something
else on an 8086:

| Entry | Shadowed by |
| --- | --- |
| `JNO NEAR` (`0x81`) | `0x81` is the 16-bit immediate arithmetic group |
| `JG NEAR` (`0x8F`) | `0x8F` is `POP r/m16` |

Both are pinned with their reasons in `SHADOWED` in
`src/engine/cpu/operand-coverage.test.ts`, which fails if the set of unreachable
entries ever changes. Only the short-displacement `JNO` and `JG` are spellable, and
that is correct: on real hardware those are the forms that exist.

## The legacy being wrong, and left alone

These are cases where the legacy does something incorrect and the new engine does
not. None of them are fixed in the legacy, deliberately: changing the legacy would
change what existing programs do, and the whole point of the switch is that the
legacy stays exactly as it was.

### `DS` and `ES` are not really segment registers in the legacy

The seven segment `PUSH`/`POP` forms — `PUSH ES`/`POP ES` (`06`/`07`), `PUSH CS`
(`0E`), `PUSH SS`/`POP SS` (`16`/`17`), `PUSH DS`/`POP DS` (`1E`/`1F`) — are 8086,
not 80186, and both engines assemble and execute all seven. `0F` is deliberately
absent: the legacy spends that opcode on a BrainBox extension, so `POP CS` is the
one form in the family that neither engine emits.

An earlier version of this document claimed the opposite, that these were 80186
additions and that rejecting them was the new engine being correct. That was
backwards, and rejecting them broke every program that used `PUSH DS`.

What the legacy actually does is the interesting part. Its `DS` and `ES` are
initialised to `0x0100` and are not programmable segment registers: the legacy
memory model is flat, with the data segment base folded into addressing, so
`PUSH DS` reads back `0x100`. The new engine treats `DS` and `ES` as real
segment registers, and in the compatibility harness all segments are zero, so
`PUSH DS` reads back `0`.

**The new engine is right**, but note that this one is a genuine behavioural
difference rather than a case where both engines do the same thing correctly: a
program that pushes `DS` and reads it back into `AX` sees `0x100` on the legacy
and the real segment value here. No shipped sample does this, and
`src/engine/assembler/legacy-differential.test.ts` covers the rest of the segment
forms.

### Arithmetic and shift flags

The legacy's flag behaviour differs from the 8086 in several cases, and the new
engine follows the 8086 rather than the legacy. `src/engine/cpu/flags-conformance.test.ts`
computes the 8086's expected flags for every ALU operation at both widths and
asserts two separate things: that the new CPU matches, and that the legacy does not
in the cases named there.

Where the legacy is right, the new engine matches it. Where it is wrong, the
conformance suite is what says so, and matching it would have meant writing the bug
a second time.

### A print-string run is padded with NULs, because the legacy does not resolve a label to an address

Given the conventional way to print in this lab:

```asm
MOV DX, msg
MOV AH, 09h
INT 21h
HLT
msg DB "Ok$"
```

the legacy assembles `MOV DX, msg` as `MOV DX, BYTE PTR [100h]` — a memory *read* at
the segment origin, not the address of the string. So DX ends up holding the first
character of the message rather than the message's address: the bytes at `100h` are
`4F 6B 24` (`Ok$`), and the byte-width read yields `DX = 4Fh`.

The print-string scan then starts at offset `4Fh` and walks forward to the `$`,
crossing 177 zero bytes on the way, so the run emits those NULs before `Ok`. It
reaches the right text only because the scan runs forward far enough to find it.

The new engine resolves the label to the address, so DX is `100h`, the scan starts
at the first character, and the output is exactly `Ok`.

The Run button's output panel shows this stream as it comes, so a program that
prints will show the padding on the legacy and will not on the new engine. This is
pre-existing legacy behaviour — the Run button called the same `runProgram` before
the switch existed — and it is pinned in `execution-engine.test.ts` so that neither
engine can lose it unnoticed.

## Two bugs the new engine had, and no longer has

- **Direct-offset stores were dropped.** `MOV [0200h], AX` is opcode `A3`, a direct
  memory offset rather than a ModR/M form, and the new engine used to discard it,
  leaving `0200h` empty.
- **Segment-register `MOV` was not decoded.** `MOV AX, DS` and its relatives.

Both were found by `compatibility.test.ts`, which runs the shipped samples on both
engines and compares the data they leave behind. The samples had been passing while
the new engine silently discarded a store, because nothing had compared the two
engines' memory.

## What the new engine implements that the legacy does not

Not differences to be careful about, but the reason some programs behave differently
for no mysterious reason. All found by running the shipped compiler samples on both
engines, which is what `test/compatibility.test.ts` now does for every sample.

- `NOP`, `INT3`, `LES`, `LDS`
- `INSB`, `INSW`, `OUTSB`, `OUTSW`, and `REP`/`REPE`/`REPNE` acceptance for them
- Correct word width for `MOVSW` and `LODSW`, and correct `REPE`/`REPNE` `SCAS`
  semantics
- 8-bit `MUL`/`IMUL` overflow-width selection
- `OF` preservation across multi-bit shifts
- `INT 21h` AH=`01`, `07`, `08` and `0Ah` (the legacy has only `02`, `09` and `4C`)

## Remaining work

### The debug view is still legacy-only

The Run button runs on whichever engine the URL selects. **The debugger does not** —
it still assembles and steps through the legacy, on both engines.

This is not an oversight to be tidied away; the panels would have to be rewritten
rather than adapted. They read `debugProgram.instructions[ip]` in about a dozen
places — the listing, the selected instruction, step-over, the source map, the
program length — and that indexing is correct only while `IP` is an instruction
index. `V2Session` deliberately holds no instruction list and instead decodes at the
current `IP` on demand, which is the right design and the wrong shape for these
panels.

So the remaining work is:

- express instruction lookup as *decode at an address* rather than *index a list*,
  for both engines
- make selection, step-over and the program length address-based
- route stepping through `DebugSession.step`, which both engines already implement

Until then, `?engine=v2` changes what Run does and leaves Debug as it was.

### A real input stream for the new engine

`inputPrompts()` returning an empty list is a safe answer, not a working one. The
new engine needs an input stream the Run button can actually write to — most
plausibly by having the prompt collect text and feed its character codes to the DOS
read services, which is the shape the engine already expects. This belongs with the
debug view work, since a program that reads input is a program you want to step.

### A known, accepted `typecheck` failure

`npm run typecheck` reports one error, and it is in the legacy:

```
src/emulator/assembler.ts(126,10): error TS6133: 'isByteRegister' is declared but its value is never read.
```

`isByteRegister` is genuinely unused. It is left in place because deleting it is a
change to the legacy assembler with no test demanding it, and this work has left the
legacy alone on principle. `npm test` and `npm run build` are both green.

## How to check any of this still holds

```bash
npm test          # 1357 tests, 14 files
npm run build     # vite build
npm run typecheck # the one accepted error above
```

The divergences above are not all pinned by a test — the `PUSH ES` row in
particular is asserted only indirectly, by the encoder fixtures' `NOT_8086` set. If
you change either engine, the places that will catch you are:

- `src/lab/execution-engine.test.ts` — the interface, the switch, and the deliberate
  differences in the `where the engines genuinely differ` block
- `src/engine/cpu/executable-coverage.test.ts` — every table entry executes
- `src/engine/cpu/operand-coverage.test.ts` — every operand kind resolves, and the
  shadowed entries stay shadowed
- `src/engine/cpu/flags-conformance.test.ts` — flags against the 8086, not the legacy
- `test/compatibility.test.ts` — every shipped compiler sample on both engines
