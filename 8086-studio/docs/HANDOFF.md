# Engine v2 handoff

Where the 8086 lab's engine work stands, what is in place, and what is left.

## The short version

The lab can run programs on either of two engines, chosen by a control in the top
bar. The new engine in `src/engine/` is complete enough to assemble and run
everything the shipped compiler produces, and is more accurate than the legacy in
several places. The legacy in `src/emulator/` is the default and is **unchanged**.

Both Run and Debug work on both engines, on both the source editor and the assembly
editor. A debug session's panels, stepping and DOS output are all engine-agnostic;
the gaps that remain are listed at the end, and none of them is the debugger.

```bash
cd 8086-studio
npm test          # 2138 tests, 31 files
npm run dev       # then open http://localhost:5173
```

## Choosing an engine

`src/lab/engine-choice.ts` decides which engine runs, and `src/components/EngineToggle.tsx`
is the control. The Legacy / v2 buttons sit in the top bar of the source editor, the
assembly editor and the debugger, because the difference between the two is not a
matter of taste — the two engines disagree about flags, about addresses, and about
which instructions they will assemble at all — and a person cannot pick correctly
without being told.

The choice is resolved from three sources, in this order:

| Source | Example | Engine |
| --- | --- | --- |
| `?engine=` in the URL, if the parameter is present at all | `?engine=v2` | the one named |
| the saved choice, `localStorage['x86-studio:engine']` | — | the one remembered |
| nothing | — | the legacy |

The URL is first so a link still decides: a link is a stronger statement of intent
than a remembered preference, and someone who picked v2 once and then follows a link
to the default must get the default. An unrecognised value falls back to the legacy
rather than to the saved choice — a mistyped parameter must not silently change what
executes, which is the behaviour `engineFromQuery` always had. Storage that throws
(site data blocked, a full quota) is treated as no saved choice, because the studio
has to open either way.

Pressing the control writes both the URL and `localStorage`, and switches in place
rather than reloading. A debug session is **not** carried across the switch: its
panels are one engine's machine, so it is closed and the view it was opened from is
restored with a note, rather than left on screen relabelled.

The Output panel is cleared on **every** switch, not only when a session was open.
That was the second half of the same bug, and the half that survived fixing the
first: the Run button had captured the engine at load time, so it ran the engine
selected when the editor opened. With that fixed, a switch still left the previous
engine's text sitting in the panel under a toggle reading the other way, with
nothing on screen to say so — so the panel and the control disagreed even when the
run was right. The rule lives in `src/lab/engine-switch.ts` rather than in `App`, so
it is testable; `engine-switch.test.ts` covers it.

## Which engine produced what the Output panel shows

The panel names the engine that produced its contents, next to its title:
`ran on legacy` or `ran on v2`. This is not decoration. The two engines disagree
about which programs assemble at all — `msg DB 'text'` is rejected outright by the
legacy and accepted by v2 — so "which engine ran this" is not answerable from the
program, and a diagnostic without an engine on it leaves a person unable to tell a
real mistake from having picked the other one.

The engine travels **with the result** (`PanelResult.engine`, from
`runSourceToPanel` in `src/lab/run-output.ts`) rather than being read back out of the
URL or the toggle by whatever renders it. That indirection is what let the label and
the result drift apart in the first place. `App` keeps the text and the provenance in
one `setPanel(text, engine)` setter for the same reason: two `useState` calls meant
any writer could update one and forget the other.

The label deliberately does **not** appear inside the panel text. `<pre>` content is
what a person copies out, and a line of UI chrome in the middle of a program's output
is worse than a missing one.

Three kinds of text can be in the panel and only two have an engine behind them:

| Panel contents | Provenance |
| --- | --- |
| a run's output | the engine that ran it |
| an engine's assembler rejecting the program | that engine |
| a frontend compilation failure | none — no engine was asked |
| the note an engine switch leaves behind | none — the lab wrote it, not an engine |

`null` is rendered as no label at all, rather than guessed at.

BrainBox does not embed the studio in an iframe — it hands the whole window over to
it with `location.replace` (`frontend/pages/X86Studio.jsx`) — which means a redirect
was dropping the query string, so `?engine=v2` on a BrainBox URL never arrived. It is
forwarded now. It is also why `localStorage` is load-bearing: it is the only place
the studio's own origin can keep the choice, and a reload is the only thing a
redirecting host can do.


## How the two engines meet

The lab was built against the legacy emulator and reads its shapes throughout: a
`CPUState` with a nested register object, an `AssembledProgram` with a parsed
instruction list, `StepDiagnostics` describing a step, `ProgramOutput`. Rewriting
every panel against the new engine's own shapes would have touched all of them and
left the lab unable to show either engine at once.

So the new engine is adapted *into* those shapes, and `DebugSession` is the
interface both implement:

```ts
interface DebugSession {
  readonly state: CPUState;
  readonly diagnostics: readonly { line: number; message: string }[];
  step(stepNumber: number, stepStartedAtMs: number): StepDiagnostics;
  sourceLineAt(ip: number): number | null;
  isFinished(): boolean;
  inputPrompts(): readonly string[];
  runToCompletion(inputs: readonly number[], maxSteps: number): RunResult;
}
```

`createSession(engine, source)` assembles and returns one; `src/lab/engine-v2.ts`
holds `V2Session`, and `LegacySession` is in the same file as the interface.

Three things genuinely needed translating in `V2Session`, and each is a real
difference rather than a renaming:

- **Memory.** The legacy's is a flat 4 KB array the UI indexes directly. The new
  engine's is 1 MB and segmented, so there is no array to hand over. `V2Session`
  mirrors the segment the program is running in, which is what makes the lab's
  existing Stack and Data Segment views show the same addresses they always have.
- **Instructions.** The legacy debugger steps a parsed `Instruction` and treats IP
  as an instruction index. The new engine has bytes at addresses, so the instruction
  at IP is decoded on demand. This is better than what it replaces — effective
  addresses and branch targets come back resolved rather than guessed from operand
  text — and it is why the panels asked the session to decode rather than indexing
  the legacy's list.
- **Changed memory.** The legacy works it out by diffing two whole memory arrays.
  The new engine has watchers, so the addresses written during a step are known
  exactly instead of by difference.

## Layout

```
src/engine/           the new engine, ~7,300 lines, no dependency on the legacy
  isa/                instruction table, flags, ModR/M
  assembler/          lexer, symbols, layout, encoder, macros
  cpu/                decode, Cpu
  memory.ts           1 MB segmented memory with watchers
src/lab/
  execution-engine.ts  the interface, the switch, LegacySession
  engine-v2.ts         V2Session
  engine-choice.ts     resolving, remembering and publishing the engine choice
  engine-switch.ts     what an engine switch does to the Output panel
  run-output.ts        the one path from source to the Output panel's text
  debugger.ts          the legacy's step diagnostics
src/components/
  EngineToggle.tsx     the Legacy / v2 control
  FlagsPanel.tsx       all 16 flags, on both engines
  RegisterDisplay.tsx  editable registers, on both engines
src/emulator/         the legacy, untouched
```

No file in `src/engine/` imports from `src/emulator/` except the two *test* files
that compare the two engines against each other, which is the point of them. The
production code of the two engines is independent, which is what makes those
comparisons mean something: a shared helper would make them agree by construction.

## What is verified, and by what

```
2138 tests, 31 files
  effects.test.ts                326   every instruction's memory and register effect
  executable-coverage.test.ts   320   every table entry assembles and executes
  isa-boundary.test.ts          172
  cpu.test.ts                   169   instruction behaviour
  table.test.ts                 137   the table itself
  compatibility.test.ts         101   every shipped compiler sample and lab demo, both engines
  legacy-strings.test.ts         33   the legacy's string literals, at both quote characters
  examples.test.ts               18   every program in the example library, on both engines
  store-width.test.ts              8   how wide a store is, and the one place it is wrong
  decoder / encoder fixtures    431   231 decoding every encoding, 200 source spellings
  assembler + assembler tests    69   assemble, lexer, legacy differential
  segment-ops / return-forms      54   segment PUSH/POP, far returns
  run-output.test.ts             33   the Run path and the Output panel
  engine-switch.test.ts           9   what an engine switch does to the panel
  memory / segments / session     55
  engine-choice.test.ts          12   resolution order, invalid values, blocked storage
  engine-v2.test.ts              17   the adapter
  differential.test.ts           11   the two CPUs against each other
  flags-panel / register-input   15   the two panels that had to be rewritten
  debug-controls.test.ts          6
  flags-conformance.test.ts       8   flags against the 8086, at both widths
  golden-legacy.test.ts           2   the legacy's stepping, pinned before the refactor
  smoke.test.ts                  10   whole programs, end to end, both engines
```

Several of these are worth knowing about, because they are what make the rest
trustworthy:

- **`executable-coverage.test.ts`** walks the whole instruction table, spells each
  entry as a line of source, assembles it and runs it, failing on
  `unimplemented instruction`. Two entries are listed in `NOT_ASSEMBLABLE` by name,
  with the test asserting they *still* fail to assemble, so a gap cannot quietly
  stop being a gap.
- **`compatibility.test.ts`** compiles and runs every sample the compiler ships, on
  both engines, comparing data, output, completion and flags. This is the test that
  actually found most of the bugs fixed in the second commit below: the samples
  were passing while the new engine silently dropped a store, computed the wrong
  width, or printed nothing.
- **`golden-legacy.test.ts`** records the legacy debug path's stepping and
  interrupts from the commit *before* the debugger was routed through the session,
  then asserts it still matches. The legacy is meant to be untouched, and a trace
  is the only thing that can say so without asserting it in prose.
- **`run-output.test.ts`** is the one that caught the reported bug. It calls the
  same `runSourceToPanelText` the Run button calls and asserts the Output panel
  shows the concatenated step output, for both engines, over every shipped sample
  and the exact program from the report. See "Where a program was dropped" below.
- **`flags-conformance.test.ts`** computes the 8086's expected flags for every ALU
  operation at both widths from the specification, then asserts two separate things:
  the new CPU matches, and the legacy does not in the cases named there. Where the
  legacy is right, the new engine matches it.
- **`engine-choice.test.ts`** pins the resolution order above, including the cases
  that are easy to get wrong: an unrecognised value in the URL resolving to legacy
  rather than to the saved choice, a junk value in storage, and `localStorage` that
  throws on every call.
- **`execution-engine.test.ts`** checks the two implementations are interchangeable
  from outside, and pins the places they deliberately are not in a
  `where the engines genuinely differ` block.

## Where a program was dropped

The v2 lexer treated any single-quoted literal as one character, keeping only the
last, so `DB 'Hello 8086', 0` assembled to `$` and DOS `INT 21h AH=09h` saw an
immediate terminator and printed nothing. The Output panel was not at fault: it
faithfully rendered an empty output array, which is why the symptom was a silent
one. `DB` now emits every byte of a longer single-quoted string, and string-as-value
is a clear error rather than a phantom symbol reference.

The reason this belonged in `run-output.test.ts` and not in a lexer test is that a
lexer test passes happily while the program prints nothing. That test now asserts,
for both engines: the Output panel's text is exactly the concatenated step output,
Run and single-step agree, `AH=02h` and `AH=09h` agree, and `OUT`/`OUTC` agree.

The legacy used to reject `DB '...'` with `Invalid data initializer` while v2 accepted
it. **That is now fixed**: both engines read either quote character, as MASM does, so
the quote someone typed no longer decides whether their program assembles. Three
`"`-only checks in `src/emulator/assembler.ts` were responsible -- what a string was,
what a comma separated, and what a `;` started -- and all three had to change or
`DB 'a,b'` and `DB 'x ; y'` stayed broken behind a fixed hello world. See
`src/emulator/legacy-strings.test.ts`.

The legacy otherwise means to keep its behaviour; this one was a bug in it, not a
design difference.


## The example library

`src/lab/examples.ts` is a catalog of verified programs, organised by category, with
`src/lab/examples.test.ts` running every one of them. There is no backend to put it
in: the app has no server, no API client and no network calls at all, which is why
`demos.ts` is a static array in the same directory. The convention it follows is the
one already there — a typed module beside the emulator, imported by a panel.
`src/components/lab/ExampleLibrary.tsx` renders it and takes the same three callbacks
`DemoLibrary` does, so both panels behave the same way in the editor. Where a program
already existed as a demo its source is imported rather than copied, so the two lists
cannot drift apart.

Each entry carries a stable ID, title, category, description, source, the engines it
is verified on, and the exact text it must print. The test assembles and runs it on
each engine it claims and checks the output, so an entry that stopped compiling or
that only works on one engine fails there rather than in front of somebody trying to
learn from it.

Building it turned up two engine bugs that the existing suite had not reached, both
found by writing an example and having it produce the wrong answer:

- **The legacy defaults a bare memory store to word width.** `MOV [SI], AL` writes the
  byte *and* a zero over the following byte; only `MOV BYTE PTR [SI], AL` stores one
  byte. Reads are unaffected, and a word store (`MOV [SI], AX`) is correct. Nearly
  silent: a forward copy loop still gets every byte it copied right, because each
  iteration overwrites the byte the last one clobbered — what it breaks is the single
  byte past the end, and any backward loop. `src/engine/cpu/store-width.test.ts` covers
  it. Left unfixed and documented rather than fixed in passing, since it is a behaviour
  change to the engine the brief said to preserve.
- **The two engines disagree about `[SP+n]`.** Legacy reads a parameter off the stack;
  v2 will not assemble the spelling at all — no 8086 encoding can name SP in an
  effective address — and reports `SP cannot be used in an 8086 effective address`.
  The library's procedure example uses `CALL`/`RET` and a callee-saved register
  instead, which is honest about the difference rather than quietly picking the
  engine that works.


## The commits, in the order they were meant to be read

| Commit | What it did |
| --- | --- |
| `0b20a72` | Match the legacy where it is right, and be right where it is not — the flags decision |
| `0ca8b49` | Read an instruction operand as a symbol, not as a directive |
| `4adf836` | Repeat string instructions properly, and implement MOD |
| `b70242c` | Store through a direct offset, and load a segment register at all |
| `226d15a` | Run the lab through either engine, chosen by a URL parameter — the adapter and the switch |
| `d4ab21e` | Run the shipped programs, and fix what running them found |
| `125e793` | Run programs on the engine the URL asks for — the Run button wiring |
| `dd6ae68` | Write down what the two engines do, and where they differ |
| `13c9042` | Ask the engine what is at an address instead of indexing a list |
| `c326ff6` | Let a rewound timeline put the engine back where it was |
| `a144ace` | Carry the mnemonic and operands, not just the line |
| `0ebd74e` | Raise an interrupt through the session, and record that the two disagree |
| `25fb6ad` | Debug through the session instead of indexing a legacy program |
| `c28ac58` | Let the register panel be typed into, on both engines |
| `23b8be3` | Give the far return its immediate back, which is 8086 |
| `17735eb` | Ask the session which segment to draw, not which array |
| `c9329f0` | Draw each memory view from the segment it names |
| `528b623` | Draw FLAGS as the word it is, and lock the controls a step is using |
| `2195f13` | Take an IP address as an address, not as a register value |
| `23afc66` | Pin the legacy debug path to how it stepped before the session refactor |
| `dda909c` | Show DOS output while stepping, not only after a whole run |
| `5e076d7` | Smoke-test two whole programs, on both engines, end to end |
| `2e1ac58` | Print a single-quoted DB string instead of silently dropping it |
| `4506791` | Choose the engine in the studio, instead of by editing the URL |
| `269698e` | Step the selected engine when debugging from the source editor |

The order matters in three places, and each of them is a mistake that was available
to make: the adapter landed before the Run button used it, and the shipped programs
were run on both engines before the UI was pointed at either, so a difference could
not be mistaken for an adapter bug. The legacy trace was recorded from the commit
*before* the debugger moved to the session, so it is a record rather than a
restatement of the new behaviour. And the output panel's formatting was extracted
into `run-output.ts` and tested before the bug it would have caught was fixed, so
the test and the fix are separate and the test still describes the panel rather
than the bug.


## What is deliberately unchanged

- **The legacy engine.** Not one behaviour of it was altered. Where it is wrong, the
  new engine is right and the difference is documented; the legacy keeps its
  behaviour so that programs already written against it keep working. This is also
  why the one `typecheck` error is still there (below).
- **The default engine.** Legacy unless asked.
- **The register display and the instruction inspector.** They read `CPUState`, which
  the adapter already produces for both engines. They were extended — registers are
  editable, FLAGS shows all sixteen — but nothing was removed and no value was
  reinterpreted.
- **The legacy's assembler.** Including its rejection of `DB '...'`. The single-quote
  fix was to the v2 lexer.
- **The step limit.** 10000, as it always was.
- **The output panel's formatting.** NULs included, so the legacy's print-string
  padding is visible rather than filtered away.

## Remaining work

### A real input stream for the new engine

The Run half is done. `inputPrompts()` returns one prompt — `input` — when the
assembled program uses a read service: `INT 21h` `01h`, `07h`, `08h` or `0Ah`, or
`INT 16h` `00h`/`01h`. The answer is found by walking the code from the entry
point with AH tracked along each path, so a program that only prints or exits is
not asked. The prompt collects a line of text; its characters and the trailing CR
become the queue the services read. A number handed to the same prompt is one raw
byte, which is what tests use. On the legacy nothing changed: it still takes one
number per `IN`.

What is not wired is the stepping session. The debug view's queue is built empty,
because the session exists before any prompt could be answered, so a program that
reads input runs correctly under Run and reads zero under Step. That is the
remaining half, and it belongs with the debug view.

### The one accepted `typecheck` error

```
src/emulator/assembler.ts(148,10): error TS6133: 'isByteRegister' is declared but its value is never read.
```

`isByteRegister` is genuinely unused. It stays because removing it means editing the
legacy assembler with no test asking for it, and this work left the legacy alone.
`npm test` and `npm run build` are green.

### The two far pointer forms

`CALLF ptr16` and `JMP ptr16` execute and decode, but no source spelling produces
them. Tracked in `NOT_ASSEMBLABLE`, asserted to still be unreachable.

### Things that look like gaps but are the legacy's behaviour

Recorded here so nobody spends the time re-deriving them. Each is in
`docs/engine-v2-divergences.md` with a test that says so.

- A bare label in a data directive is ambiguous and both engines pick an address for
  it; the NUL padding in some samples is that, not an engine difference. `OFFSET
  label` is the portable spelling and both engines assemble it.


## Reading further

- `docs/engine-v2-divergences.md` — every place the two engines differ, which of
  them is which engine's fault, and what to run to check any of it still holds.
- The comments in `src/lab/execution-engine.ts` and `src/lab/engine-v2.ts` explain
  why the adapter has the shape it does. They are load-bearing: the reasons are not
  recoverable from the code.
