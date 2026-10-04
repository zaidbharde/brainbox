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

The Run button's output panel shows this stream as it comes, so a program written
this way shows the padding on the legacy and will not on the new engine. This is
pre-existing legacy behaviour — the Run button called the same `runProgram` before
the switch existed.

**Write `MOV DX, OFFSET msg` instead.** `OFFSET` is the one spelling both assemblers
accept and both mean the same thing by; with it the legacy assembles `MOV DX, 100h`,
the scan starts at the first character, and the two engines produce byte-identical
output. Every fixture in the suite that prints a string uses it, and
`run-output.test.ts` asserts that the printed section of the panel is exactly the
message on both engines. The padding above is a property of the bare-label spelling,
not of a print-string run in general — a reading that this document previously got
wrong, in the other direction, by treating it as unavoidable.

### A single-quoted string is a data initializer on the new engine only

The legacy has no single-quoted string support at all:

```asm
msg DB 'Hello 8086$'
```

fails to assemble with `Invalid data initializer: 'Hello 8086$'`. It wants
`msg DB "Hello 8086$"`. This is a legacy limitation and is left alone: the legacy
assembler is not being extended, and the report is that a person who writes
single quotes gets a clear error rather than a silent wrong answer.

The new engine accepts either quote, as MASM does. It did not always, and the
version that did not is the most confusing failure in this file's history — see
below.

### A bare label in `MOV` is a memory read on the legacy, and is rejected by the new engine

Related to the padding above, and worth stating on its own because it is silent on
the legacy rather than loud. Given `values DW 10, 20, 30, 40`, the legacy assembles
`MOV SI, values` as a load of the word stored at that address, so SI ends up holding
`10` — the first element, not its address — and any loop built on it walks off into
whatever follows and computes a wrong answer with no diagnostic anywhere. The new
assembler rejects the bare form outright, which is the better of the two failures.

This is **not** a difference in where the two engines keep declared data. It is not
a data-segment difference at all: the legacy does lay a `DATA SEGMENT` out, at
`0100h`, and the new engine packs its segments elsewhere. `MOV SI, OFFSET values`
finds the array correctly on both and both sum it to the same total. Use `OFFSET`.

## Bugs that are fixed, and how each was found

- **The engine toggle did not reach Run, and switching left the old result on
  screen.** Two bugs that compounded into one report. `runAssemblySource` in
  `App.tsx` was a `useCallback` with an empty dependency list that read `engine`, so
  it kept the engine selected when the editor loaded for the life of the page: the
  toggle set the state, the address bar updated, and Run went on using the old
  engine. `handleRun` had the same omission for the frontend-compiler path.

  Fixing the dispatch was not enough on its own. `changeEngine` cleared the Output
  panel only when a debug session was open, so with dispatch fixed a switch still
  left the previous engine's text in the panel under a toggle reading the other way,
  with nothing on screen to say so — the panel and the control disagreed even when
  the run was right. The panel is now cleared on every switch, with the note saying
  so, and the rule lives in `src/lab/engine-switch.ts` so it can be tested rather
  than only clicked.

  A third, quieter one: the asm editor's Debug button built a session from the
  selected engine — so v2 did execute — but it *also* ran the legacy assembler over
  the same source and handed that second, differently-parsed program to the debug
  layer. The unused state it fed has been removed.

  `run-output.test.ts` runs the reported program through the whole path to the
  panel's text; `engine-switch.test.ts` covers the switch.
- **A single-quoted `DB` string assembled to one byte and printed nothing.** The v2
  lexer used `"` as its only string delimiter and read `'` as a character literal, so
  `msg DB 'Hello 8086$'` became a single byte holding the *last* character — `$`. Since
  `$` is a DOS string terminator, `INT 21h AH=09h` read the message's first byte, found
  the terminator, and correctly printed nothing. The program ran to `INT 21h AH=4Ch`,
  so the panel said `Program completed successfully` over an empty output section. The
  lexer also emitted a warning about the discarded characters, and nothing surfaced
  warnings, so the one clue was invisible. MASM accepts either quote character, and
  does; the lexer now decides by length rather than by which quote was used, so
  `'A'` is still a character and `DB 'AB'` is the two bytes it looks like.

  Found by running the program that ships in no sample and appears in no test, and
  only visible in a browser. `run-output.test.ts` now tests the string the Output panel
  renders, and iterates every shipped sample asserting that a run, a step-by-step walk
  and the panel all agree.
- **`.MODEL SMALL` with `.DATA`/`.CODE` assembled to nothing, silently.** The most
  consequential bug in this list, and the one that made the engine toggle look
  broken. `.DATA` and `.CODE` each create their own named buffer (`_DATA`, `_CODE`),
  but the layout asked only whether the program had used the `SEGMENT` *directive*.
  A textbook `.MODEL` program uses the directives and no `SEGMENT` blocks, so it took
  the flat path, which reports the implicit `_COM` buffer — one nothing had written
  to. The result was an empty image, no entry point, and **no diagnostic**: the
  program assembled cleanly and ran nothing.

  Two things had to change, and only fixing one of them leaves the bug half alive:

  1. The layout now asks whether the program *has* named segments, rather than
     whether it spelled them a particular way.
  2. The implicit `_COM` buffer is first in source order and carries class `CODE`,
     so it won code-segment detection on a `.MODEL` program and claimed an empty
     image. It is now excluded unless it actually holds bytes — with the existing
     `!foundCode` fallback still putting it back for a program that declares data and
     no code.

  The test that pins this is `the shipped .MODEL hello world, on both engines` in
  `test/compatibility.test.ts`, and it runs on *both* engines: the legacy handles
  `.MODEL`, `.STACK`, `.DATA`, `@DATA` and a bare `LEA reg, label` correctly, so the
  first version of this fix could easily have looked like the new assembler had
  gained support the legacy never had. It had not.
- **`@DATA`, `@CODE` and `@STACK` were undefined symbols.** `MOV AX, @DATA` — the
  load paragraph of the data segment, and the first line of most real 8086 programs —
  reported `undefined symbol @DATA`. MASM names a segment by class the same way it
  names one by label in a `SEGMENT` block; the new assembler only had the latter.

  These cannot be known while the code that reads them is being laid out, because the
  load paragraphs are only assigned once every segment has been sized. They are
  therefore defined as zero for the discovery passes, and one more pass is run
  afterwards if the real bases differ. One is provably enough: an instruction's size
  never depends on the *value* of an immediate, so giving `MOV AX, @DATA` its real
  load address cannot resize it or move a label, and the layout the second run
  produces is the layout that produced its own bases.
- **`LEA DX, msg` was rejected.** `LEA` takes a memory operand, and a bare label
  parsed to an immediate, so the encoder refused it with `no encoding of LEA accepts
  DX, msg`. But a bare label in `LEA`'s operand slot *is* the address — MASM spells
  that the same way `[msg]` and `OFFSET msg` do, and all three must produce the same
  bytes.

  The fix is deliberately narrow. A bare label becomes a direct address (no base, no
  index, which ModR/M can only express as `mod=00, rm=110` with a full 16-bit
  displacement), and nothing else changed: `LEA AX, BX` is still refused, because
  `findCandidates` rejects any non-memory operand so that the register-direct `LEA`
  form — which computes nothing — cannot be encoded. A new label rule that loosened
  that would be a different bug. `assemble.test.ts` asserts both directions, and the
  direct-address test carries a second program with a non-zero displacement so that a
  passing assertion cannot mean "the displacement was dropped".
- **Direct-offset stores were dropped.** `MOV [0200h], AX` is opcode `A3`, a direct
  memory offset rather than a ModR/M form, and the new engine used to discard it,
  leaving `0200h` empty.
- **Segment-register `MOV` was not decoded.** `MOV AX, DS` and its relatives.
- **The legacy's step diagnostics dropped DOS output.** The debugger kept its own
  capture of what an instruction printed, which knew about `OUT` and `OUTC`, while the
  emulator beside it also knew about `INT 21h`. Run asked the emulator; Step asked the
  debugger. So a DOS print showed after a Run and not while stepping, on the legacy
  only. One function answers for both now. The golden trace did not move: every output
  line in it comes from `OUT` or `OUTC`, and no traced program prints through DOS.

The first two were found by `compatibility.test.ts`, which runs the shipped samples on
both engines and compares the data they leave behind. The samples had been passing
while the new engine silently discarded a store, because nothing had compared the two
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

## Raising an interrupt by hand

The debugger's interrupt control asks for `INT n` at wherever the program is
stopped. It used to be the lab's own doing -- build an `INT` instruction that is
not in the program and step it through the legacy -- so it only ever worked on
the legacy. It is a session method now, and the interesting part is how far the
two interrupt policies agree.

They agree on the vectors that end a program. `INT 21h` with `AH`=`4Ch` terminates
on both, and so does `INT 20h`, whatever `AH` says.

They disagree past that, and the disagreement is a property of the engines rather
than of the adapter that raised it:

| Raised | Legacy | New engine |
| --- | --- | --- |
| `21h`, `AH`=`02h`/`09h` | accepted, steps over, prints nothing | prints the character (`02h`) or the `$`-terminated string (`09h`) |
| `21h`, `AH` not served | pushes a return frame and runs on | halts, `unsupported INT 21h service ...` |
| any other vector | pushes a return frame and runs on | halts, `unhandled interrupt ...` |
| cycles reported | the count for the instruction it ran | `0` |

The last row is the one to be careful about. The legacy runs a synthesized `INT n`
through its own step, so it fetches, advances `IP` and has a cycle count. The new
engine raises the interrupt in place: no fetch, no bytes read, `IP` unchanged, no
time. Both are honest about what they did, so this is not a number that can be
made to agree -- it is a difference in what the button does.

A panel that shows stack movement after pressing the interrupt button on the legacy
is therefore showing the legacy's frame push, not a fault in the new engine.

`AH`=`09h` is worth calling out for a different reason: it prints a `$`-terminated
string out of memory, so in a zeroed segment it runs to the end of the segment and
emits 65536 NUL characters. That is correct, and it is why the tests use `02h` to
check that a print service ran.

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

**Stepping already runs on the selected engine.** What remains legacy-only is the
panels' *reading* of the program, not the execution. This section used to say the
debugger "still assembles and steps through the legacy, on both engines", which was
half true in a way that mattered: the asm editor's Debug button built a session from
the selected engine — so v2 did execute — but it *also* ran the legacy assembler over
the same source and handed that second, differently-parsed program to the debug
layer. For v2-only source that was a second opinion nobody asked for, on an assembler
that had already rejected the program. The unused `debugProgram` state it fed has
been removed, so the session is the program.

### The engine a debug session runs on

The Debug button in the assembly editor now follows the toggle, like Run. It did
before too, through `createSession(engine, source)`; what was wrong was the second
assembly described above, not the choice of session.

The frontend-compiler path is deliberately different and still legacy-only: those
programs are produced without going through either assembler, so there is no source
to hand the new engine, and `initializeDebugSession` falls back to a legacy session
from the compiler's own `AssembledProgram`.

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
npm test          # 2077 tests, 28 files
npm run build     # vite build
npm run typecheck # the one accepted error above
```

The divergences above are not all pinned by a test — the `PUSH ES` row in
particular is asserted only indirectly, by the encoder fixtures' `NOT_8086` set. If
you change either engine, the places that will catch you are:

- `src/lab/execution-engine.test.ts` — the interface, the switch, and the deliberate
  differences in the `where the engines genuinely differ` block
- `src/lab/run-output.test.ts` — what the Output panel renders, and which engine
  produced it
- `src/lab/engine-switch.test.ts` — what an engine switch does to a panel
- `src/engine/assembler/assemble.test.ts` — `@DATA`/`@CODE`/`@STACK`, `LEA` addressing
- `src/engine/cpu/executable-coverage.test.ts` — every table entry executes
- `src/engine/cpu/operand-coverage.test.ts` — every operand kind resolves, and the
  shadowed entries stay shadowed
- `src/engine/cpu/flags-conformance.test.ts` — flags against the 8086, not the legacy
- `test/compatibility.test.ts` — every shipped compiler sample and lab demo on both
  engines
