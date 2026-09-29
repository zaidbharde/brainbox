# Engine v2 handoff

Where the 8086 lab's engine work stands, what is in place, and what is left.

## The short version

The lab can run programs on either of two engines, chosen by a URL parameter. The
new engine in `src/engine/` is complete enough to assemble and run everything the
shipped compiler produces, and is more accurate than the legacy in several places.
The legacy in `src/emulator/` is the default and is **unchanged**.

The Run button is wired to both engines. The debugger is still legacy-only, for a
structural reason explained below.

```bash
cd 8086-studio
npm test          # 1357 tests, 14 files
npm run dev       # then open http://localhost:5173/?engine=v2
```

## Choosing an engine

`src/lab/execution-engine.ts` is the only place that knows which engine is running.

| URL | Engine |
| --- | --- |
| `?engine=v2` | the new engine |
| anything else, including no parameter | the legacy |

An unrecognised value falls back to the legacy rather than guessing. The lab has
always run the legacy, so a mistyped parameter must not silently change what
executes. `withEngineInQuery` is the counterpart for building a URL.

There is no engine picker in the UI. That is deliberate: a switch in the toolbar
would invite anyone to click it without knowing which engine they are about to get,
and the two do not produce identical results. The URL says it explicitly.

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
  text — and it is also why the debug view is not yet wired up.
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
  debugger.ts          the legacy's step diagnostics
src/emulator/         the legacy, untouched
```

No file in `src/engine/` imports from `src/emulator/` except the two *test* files
that compare the two engines against each other, which is the point of them. The
production code of the two engines is independent, which is what makes those
comparisons mean something: a shared helper would make them agree by construction.

## What is verified, and by what

```
1357 tests, 14 files
  cpu.test.ts                   171   instruction behaviour
  decode.test.ts                229   every encoding decodes
  executable-coverage.test.ts   333   every table entry assembles and executes
  encoder-fixtures.test.ts      200   every instruction has a source spelling
  table.test.ts                 139   the table itself
  compatibility.test.ts          94   every shipped compiler sample, both engines
  lexer.test.ts                  24
  memory.test.ts                 21
  execution-engine.test.ts       43   the interface, the switch, the differences
  assemble.test.ts               61
  engine-v2.test.ts              17
  differential.test.ts           11
  flags-conformance.test.ts       8   flags against the 8086, at both widths
  operand-coverage.test.ts        6   every operand kind resolves
```

Four of these are worth knowing about, because they are what make the rest
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
- **`flags-conformance.test.ts`** computes the 8086's expected flags for every ALU
  operation at both widths from the specification, then asserts two separate things:
  the new CPU matches, and the legacy does not in the cases named there. Where the
  legacy is right, the new engine matches it.
- **`execution-engine.test.ts`** checks the two implementations are interchangeable
  from outside, and pins the places they deliberately are not in a
  `where the engines genuinely differ` block.

## The commits, in the order they were meant to be read

| Commit | What it did |
| --- | --- |
| `946aadf` | Match the legacy where it is right, and be right where it is not — the flags decision |
| `5a2aea0` | Read an instruction operand as a symbol, not as a directive |
| `056bbbd` | Repeat string instructions properly, and implement MOD |
| `14fe4e5` | Store through a direct offset, and load a segment register at all |
| `8a4be04` | Run the lab through either engine, chosen by a URL parameter — the adapter and the switch |
| `e398c3a` | Run the shipped programs, and fix what running them found |
| `337b571` | Run programs on the engine the URL asks for — the Run button wiring |

The order matters: the adapter landed before the Run button used it, and the shipped
programs were run on both engines before the UI was pointed at either. Wiring the
UI first would have shown differences nobody could yet tell apart from adapter bugs.

## What is deliberately unchanged

- **The legacy engine.** Not one behaviour of it was altered. Where it is wrong, the
  new engine is right and the difference is documented; the legacy keeps its
  behaviour so that programs already written against it keep working. This is also
  why the one `typecheck` error is still there (below).
- **The default engine.** Legacy unless asked.
- **The register display and the instruction inspector.** They read `CPUState`, which
  the adapter already produces for both engines.
- **The step limit.** 10000, as it always was.
- **The output panel's formatting.** NULs included, so the legacy's print-string
  padding is visible rather than filtered away.

## Remaining work

### The debug view

`?engine=v2` changes what **Run** does. It does not change what **Debug** does — the
debugger still assembles and steps through the legacy on both engines.

This needs a rewrite of the panels, not an adaptation. They read
`debugProgram.instructions[ip]` in about a dozen places, and that is only correct
while `IP` is an instruction index. The new engine numbers `IP` as an address and
`V2Session` deliberately holds no instruction list, so there is nothing to index.

Concretely:

- express instruction lookup as *decode at an address* rather than *index a list*,
  for both engines
- make the selected instruction, step-over and the program length address-based
- route stepping through `DebugSession.step`, which both engines already implement

The interface is ready for this. What is not ready is the panels.

### A real input stream for the new engine

`inputPrompts()` returning an empty list is safe, not working. The Run button cannot
give the new engine input. The engine's input is a character queue behind the DOS
read services, so the prompt needs to collect text and feed character codes rather
than numbers per `IN`. This belongs with the debug view work.

### The one accepted `typecheck` error

```
src/emulator/assembler.ts(126,10): error TS6133: 'isByteRegister' is declared but its value is never read.
```

`isByteRegister` is genuinely unused. It stays because removing it means editing the
legacy assembler with no test asking for it, and this work left the legacy alone.
`npm test` and `npm run build` are green.

### The two far pointer forms

`CALLF ptr16` and `JMP ptr16` execute and decode, but no source spelling produces
them. Tracked in `NOT_ASSEMBLABLE`, asserted to still be unreachable.

## Reading further

- `docs/engine-v2-divergences.md` — every place the two engines differ, which of
  them is which engine's fault, and what to run to check any of it still holds.
- The comments in `src/lab/execution-engine.ts` and `src/lab/engine-v2.ts` explain
  why the adapter has the shape it does. They are load-bearing: the reasons are not
  recoverable from the code.
