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

### A single-quoted string used to be a data initializer on the new engine only — now both

The legacy used to accept only the double-quoted spelling:

```asm
msg DB 'Hello 8086$'
```

failed to assemble with `Invalid data initializer: 'Hello 8086$'`, while
`msg DB "Hello 8086$"` worked. The error named the right line and the wrong cause:
the string was not invalid, it was spelled with the quote character the assembler
did not recognise. Since single quotes are what most people type and what textbooks
print, a valid program assembled on one engine and not on the other, decided by the
toggle.

**This is fixed.** Both engines now read either quote, as MASM does, and the two
spellings of one declaration assemble to the same bytes. The fix was in three places
in `src/emulator/assembler.ts`, all of which were checking for `"` only:
`parseStringLiteral` (what a string was), `splitOperands` (what a comma separated),
and `stripInlineComment` (what a `;` started). Fixing only the first would have made
the reported program work and left `DB 'a,b'` assembled as two strings and
`DB 'x ; y'` truncated at the semicolon.

The closing character now has to match the opening one, so a stray apostrophe inside
a double-quoted string does not end it early. An unterminated or mismatched string is
still an error, with the line number.

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

### A bare memory store defaults to word width on the legacy

Discovered while writing the `arrays-strings-reverse` example, which printed nothing
and then printed garbage. On the legacy, a store whose width is not stated writes two
bytes:

```asm
buf DB 255, 255, 255, 255
MOV BX, 0100h
MOV AL, 90
MOV [BX], AL        ; writes 5A 00 — the second byte clobbers buf+1
MOV BYTE PTR [BX], AL ; writes 5A    — one byte, correct
```

The same happens for `[SI]`, `[DI]` and a direct offset, and for any byte register
(`MOV [SI], BL` has the same problem). Reads are unaffected, and a word store is
correct: `MOV [SI], AX` writes two bytes as it should.

**The new engine is right.** MASM requires the size to be known at the point of the
store, and a register operand is the usual way to supply it; the legacy is inferring
word width from the absence of information and then zero-filling the extra byte.

Why it survived in the suite until now: it is nearly silent in the common case. A copy
loop that walks a buffer forwards gets **every byte it copied** right, because each
iteration overwrites the byte the previous one clobbered — so the buffer looks
correct. What it still gets wrong is the single byte immediately past the end, which
is zeroed rather than left alone. That byte matters as soon as something else lives
there, and it is exactly what `arrays-strings-reverse` does: its terminator is the
byte after the buffer. A loop that walks *backwards* fails outright, since the stray
zeros land on data that has already been written.

`src/engine/cpu/store-width.test.ts` covers all of this: `BYTE PTR` and `WORD PTR` on
both engines as requirements, and the bare store pinned at its current legacy
behaviour so a change there gets noticed rather than discovered later.

Not fixed, for the same reason as everything else in this section: it changes what
existing legacy programs do.

### The engines disagree about `[SP+n]`

The legacy reads a procedure argument off the stack at `[SP+4]`; the new engine
will not assemble the spelling at all. `[SP+n]` is not an 8086 effective
address — the r/m field spells BX, BP, SI and DI, alone or paired, and there is
no encoding that names SP — so the new assembler reports `SP cannot be used in
an 8086 effective address; use BX, BP, SI, or DI` and no session loads. There is
no spelling of a stack argument that works on both. The example library's
procedure example therefore demonstrates `CALL`/`RET` and callee-saved
registers instead of parameters, which is honest about the difference rather
than picking the engine that happens to work.

The legacy is left exactly as it was: its assembler interprets operand text
rather than encoding bytes, so `SP+4` computes like any other register
expression and reads as a flat address. Both halves are pinned —
`src/lab/execution-engine.test.ts` reads the word on the legacy and refuses the
source on the new engine, and `src/engine/assembler/assemble.test.ts` covers
the refusal on its own.

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
- **The legacy assembler read only the double-quoted spelling of a string.** The one
  bug in this list that was in the *old* engine rather than the new one, and the one
  that made the engine toggle look like the deciding factor in a hello-world bug
  report: `msg DB 'Hello World!$'` failed with
  `Invalid data initializer: 'Hello World!$'` on legacy and worked on v2, so the same
  valid program ran or did not depending on which engine was selected.

  Three checks in `src/emulator/assembler.ts` were comparing against `"` only:
  `parseStringLiteral`, `splitOperands` and `stripInlineComment`. All three had to
  change, and that is the part worth remembering — fixing only `parseStringLiteral`
  makes the reported program work while leaving `DB 'a,b'` assembled as two separate
  strings and `DB 'x ; y'` truncated at the semicolon. The scanners now track the
  *opening* quote character instead of toggling on any quote, so an apostrophe inside
  a double-quoted string does not end it early, and a closing character that does not
  match the opening one is an error rather than a silently truncated string.

  Found by reading the error message instead of the code: it named the line and was
  accurate about it, but "invalid" was wrong, and the reason it was wrong was a single
  character comparison. `src/emulator/legacy-strings.test.ts` covers all three sites.

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

The Run button gives the new engine input, in the shape its engine expects.
`inputPrompts()` returns one prompt — `input` — when the assembled program uses a
read service (`INT 21h` `01h`/`07h`/`08h`/`0Ah`, or `INT 16h` `00h`/`01h`),
found by walking the code from the entry point with AH tracked along each path,
and nothing when it does not — which is every program the frontend compiler
produces, since its `input` statement emits no instruction. The legacy, which has
no DOS read services at all, keeps its own answer: one number per `IN`, named for
the port.

The new engine's dialog collects a line of text rather than a number: its
characters, plus the CR that confirming the dialog stands for, become the queue
the DOS and BIOS services read — one stream, however many calls draw from it. A
number handed to the same prompt is one raw byte, the shape tests use. Deliberate
differences from real DOS, each recorded where it happens:

- Every read returns zero when the queue runs dry instead of blocking. DOS would
  wait for a keystroke; a browser cannot.
- Nothing echoes. Real DOS echoes `01h`/`07h` reads back to the terminal; input
  here arrives from a dialog, and the output panel shows what the program prints.
- The BIOS scan code is not modeled, so `INT 16h` reports 0 in AH — the queue
  holds character codes only.
- A line whose input ends before a CR stores what arrived and no terminator.

Still unwired is the stepping session: the debug view reads a queue no one has
filled, because the session exists before any prompt could be answered. A program
that reads input runs correctly under Run and reads zero under Step.

### A known, accepted `typecheck` failure

`npm run typecheck` reports one error, and it is in the legacy:

```
src/emulator/assembler.ts(148,10): error TS6133: 'isByteRegister' is declared but its value is never read.
```

`isByteRegister` is genuinely unused. It is left in place because deleting it is a
change to the legacy assembler with no test demanding it, and this work has left the
legacy alone on principle. `npm test` and `npm run build` are both green.

## How to check any of this still holds

```bash
npm test          # 2112 tests, 29 files
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
