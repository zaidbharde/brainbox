/**
 * The Output panel, tested as the panel gets it.
 *
 * `runSourceToPanelText` returns the string that `<pre>{runOutput}</pre>` renders
 * in the Output panel, verbatim. That makes it the level worth testing at: not
 * the emulator (which is covered), and not the component (which would need a DOM
 * to assert a string the component does not modify), but the function that
 * decides what a person reads after pressing Run.
 *
 * This file exists because of a bug that every lower-level test agreed was
 * impossible. The v2 assembler read a single-quoted `DB 'text'` as a character
 * literal, collapsed it to its last byte, and emitted a warning that nothing
 * surfaced. The emulator was asked to print a string that was not in memory, and
 * it correctly printed nothing. The suite was green, the run reported success,
 * and the panel was empty -- and the only way to see that was to open a browser.
 */

import { describe, expect, it } from 'vitest';
import type { EngineId } from '@/lab/execution-engine';
import { formatProgramOutput, panelEngineLabel, runSourceToPanel, runSourceToPanelText } from '@/lab/run-output';
import { createSession } from '@/lab/execution-engine';
import { ASSEMBLY_DEMOS } from '@/lab/demos';
import type { ProgramOutput } from '@/emulator/cpu';

const ENGINES: EngineId[] = ['legacy', 'v2'];

/** The program as it was reported: single-quoted, and it is how people write it. */
const REPORTED_HELLO_WORLD = [
  'MOV DX, OFFSET msg',
  'MOV AH, 09h',
  'INT 21h',
  'MOV AH, 4Ch',
  'INT 21h',
  "msg DB 'Hello 8086$'",
].join('\n');

/**
 * The reported program, in the shape a lab exercise is written: a real
 * `.MODEL SMALL` program with its own data segment, loading DS from `@DATA` and
 * taking the message's address with `LEA`.
 *
 * This is the one that produced the confusing report, and it is here as a
 * constant rather than only as a shipped demo so that a failure names the
 * program rather than whatever a demo happens to be called this month.
 */
const LAB_STYLE_HELLO_WORLD = [
  '    .MODEL SMALL',
  '    .STACK 100H',
  '    .DATA',
  "        msg DB 'Hello World!$'",
  '    .CODE',
  '    MAIN PROC',
  '        MOV AX, @DATA',
  '        MOV DS, AX',
  '        LEA DX, msg',
  '        MOV AH, 09H',
  '        INT 21H',
  '        MOV AH, 4CH',
  '        INT 21H',
  '    MAIN ENDP',
  '    END MAIN',
].join('\n');

/** The same program with double quotes, which is the spelling MASM documents. */
const DOUBLE_QUOTED_HELLO_WORLD = REPORTED_HELLO_WORLD.replace(
  "'Hello 8086$'",
  '"Hello 8086$"',
);

/** What the panel says when a run finished with nothing to show. */
const SUCCESS = 'Program completed successfully';

/**
 * The part of the panel before its trailing status line: what the program
 * printed, as opposed to what the run reported about itself.
 *
 * The status is stripped rather than looked for because it comes in two shapes.
 * A run that ends cleanly is followed by "Program completed successfully" and one
 * that traps is followed by "Error: ...", and a panel is only comparable to a run
 * once both have had their own verdict removed. Anchored at the end on a blank
 * line so that text the program printed which happens to contain those words is
 * left alone.
 */
const printed = (panel: string): string =>
  panel.replace(/\n\n(?:Program completed successfully|Error: [^\n]*)$/, '');

describe('the Output panel, for a DOS print', () => {
  it('shows the text of a single-quoted hello world on v2', () => {
    // The reported bug. Before the fix this returned
    // "\n\nProgram completed successfully": the string assembled, the label
    // resolved, INT 21h ran, and nothing was printed.
    const panel = runSourceToPanelText('v2', REPORTED_HELLO_WORLD);
    expect(panel).toContain('Hello 8086');
  });

  it('puts the message in the printed section, not only past the status line', () => {
    // The shape of the bug, stated separately so it cannot come back as a
    // program that assembles and silently prints nothing. Before the fix the
    // whole printed section was the empty string and only the status line said
    // anything, which is what made it read as a UI problem rather than a
    // program problem. A run that legitimately prints nothing is fine -- a
    // program that only computes has no output -- so this is scoped to a program
    // that is supposed to print.
    expect(printed(runSourceToPanelText('v2', REPORTED_HELLO_WORLD))).toBe('Hello 8086');
  });

  it('shows the same text for the double-quoted spelling on v2', () => {
    expect(runSourceToPanelText('v2', DOUBLE_QUOTED_HELLO_WORLD)).toContain('Hello 8086');
  });

  it('shows the same text on the legacy, which rejects single quotes', () => {
    // The legacy has no single-quoted string support and is not getting any; it
    // says so rather than printing nothing. `docs/engine-v2-divergences.md`
    // records it. What matters here is that the rejection is visible in the
    // panel, which is the contrast with the v2 behaviour above.
    const legacy = runSourceToPanelText('legacy', REPORTED_HELLO_WORLD);
    expect(legacy).toContain('Error:');
    expect(legacy).toContain('Invalid data initializer');
    expect(legacy).not.toContain(SUCCESS);
  });

  it('shows the text of a double-quoted hello world on the legacy too', () => {
    expect(runSourceToPanelText('legacy', DOUBLE_QUOTED_HELLO_WORLD)).toContain('Hello 8086');
  });
});

/**
 * The program from the report, on both engines.
 *
 * Its whole point is that the two engines must not be confused for one another.
 * On v2 it is the standard textbook program and it prints. On the legacy it is
 * rejected for the one documented reason -- no single-quoted strings -- and the
 * rejection is named rather than swallowed. Before the v2 assembler learned
 * `@DATA` and `LEA reg, label`, this block failed on v2 with
 * `undefined symbol @DATA` and `no encoding of LEA accepts DX, msg`.
 */
describe('the Output panel, for the reported .MODEL SMALL lab program', () => {
  it('assembles and prints on v2', () => {
    const panel = runSourceToPanelText('v2', LAB_STYLE_HELLO_WORLD);
    expect(panel).toContain('Hello World!');
    expect(printed(panel)).toBe('Hello World!');
    expect(panel).toContain(SUCCESS);
  });

  it('does not report an assembler error on v2', () => {
    // Narrower than the line above on purpose: `@DATA` and `LEA DX, msg` were
    // the two failures, and a program that prints the right text while also
    // carrying an error would otherwise be able to satisfy the first test.
    const panel = runSourceToPanelText('v2', LAB_STYLE_HELLO_WORLD);
    expect(panel).not.toContain('undefined symbol');
    expect(panel).not.toContain('no encoding of LEA');
  });

  it('reports the legacy limitation on legacy, and says which engine said it', () => {
    const result = runSourceToPanel('legacy', LAB_STYLE_HELLO_WORLD);
    expect(result.text).toContain('Invalid data initializer');
    expect(result.text).not.toContain(SUCCESS);
    // Provenance is what stops this being mistaken for the v2 result. It lives on
    // the result and in the panel header rather than inside `text`, because
    // `text` is the program's output and gets copied out of the panel.
    expect(result.engine).toBe('legacy');
    expect(panelEngineLabel(result.engine)).toBe('ran on legacy');
  });

  it('prints the same text on v2 whichever way the label is spelled', () => {
    // Single or double quotes, `@DATA` or a plain address: all the spellings a
    // person might type have to reach the same string, or "it works" depends on
    // which example was copied.
    const doubleQuoted = LAB_STYLE_HELLO_WORLD.replace("'Hello World!$'", '"Hello World!$"');
    expect(printed(runSourceToPanelText('v2', doubleQuoted))).toBe('Hello World!');
  });
});

describe('the Output panel reports which engine produced the result', () => {
  /**
   * The confusion this pins down.
   *
   * A run result has to name the engine that produced it, because the two
   * engines disagree about which programs assemble at all. The reported bug was
   * not that a program printed the wrong thing -- it was that a person could not
   * tell whose answer they were reading. So the engine travels with the text
   * rather than being read separately out of a control somewhere else, which is
   * what let the label and the result drift apart in the first place.
   */
  it('carries the engine that ran the program', () => {
    for (const engine of ENGINES) {
      const result = runSourceToPanel(engine, REPORTED_HELLO_WORLD);
      expect(result.engine, engine).toBe(engine);
    }
  });

  it('carries the engine on a failed assembly too', () => {
    // The case that mattered: an error message with no engine on it is the thing
    // a person cannot act on, because the fix differs per engine.
    const result = runSourceToPanel('v2', "msg DB 'Hello World!$'");
    expect(result.engine).toBe('v2');
  });

  it('distinguishes a diagnostic from a run that produced output', () => {
    expect(runSourceToPanel('legacy', "msg DB 'x'").kind).toBe('diagnostics');
    expect(runSourceToPanel('v2', "msg DB 'x'").kind).toBe('output');
  });

  it('reports the legacy limitation as a diagnostic and not as a successful run', () => {
    const result = runSourceToPanel('legacy', LAB_STYLE_HELLO_WORLD);
    expect(result.kind).toBe('diagnostics');
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.text).not.toContain(SUCCESS);
  });

  it('names each engine in the label the panel header shows', () => {
    expect(panelEngineLabel('v2')).toBe('ran on v2');
    expect(panelEngineLabel('legacy')).toBe('ran on legacy');
  });

  it('gives the two engines different labels', () => {
    // If these were ever the same string the header would stop answering the
    // only question it exists to answer.
    expect(panelEngineLabel('v2')).not.toBe(panelEngineLabel('legacy'));
  });
});

describe('the Output panel, for the other two ways a program prints', () => {
  it('shows one character from INT 21h AH=02h on both engines', () => {
    // A different branch of the interrupt's output handling from AH=09h, and the
    // one a program uses to echo a keystroke. Both are here because both were
    // broken by the same missing bytes and could have been half-fixed.
    const echo = 'MOV DL, 5Ah\nMOV AH, 02h\nINT 21h\nHLT';
    for (const engine of ENGINES) {
      expect(runSourceToPanelText(engine, echo), engine).toContain('Z');
    }
  });

  it('shows a number from OUT and a character from OUTC, on both engines', () => {
    // The pseudo-ops, which are the lab's own output channel and predate the DOS
    // services. They are the reason a program that prints nothing looks broken
    // even on the engine that has no DOS support at all.
    // 7 rather than 1234h because `OUT` writes the register's value, and the
    // panel shows that value in decimal -- 1234h is 4660, which is correct and
    // would have made this test fail for the wrong reason.
    const mixed = 'MOV AX, 7\nOUT AX\nMOV DL, 2Ah\nOUTC DL\nHLT';
    for (const engine of ENGINES) {
      const panel = runSourceToPanelText(engine, mixed);
      expect(printed(panel), `${engine} number`).toBe('7\n*');
      expect(panel, `${engine} finished`).toContain(SUCCESS);
    }
  });
});

describe('the Output panel, when a run cannot start', () => {
  it('shows the assembly error instead of a successful run', () => {
    const panel = runSourceToPanelText('v2', 'MOV AX, nonsense\nHLT');
    expect(panel).toContain('Error:');
    expect(panel).not.toContain(SUCCESS);
  });

  it('says so when the run was cancelled at an input prompt', () => {
    const panel = runSourceToPanelText(
      'legacy',
      'IN AL, 30h\nHLT',
      () => ({ kind: 'cancelled' }),
    );
    expect(panel).toBe('Run cancelled by user.');
  });

  it('shows the typed text back when an input is not a number', () => {
    const panel = runSourceToPanelText('legacy', 'IN AL, 30h\nHLT', () => ({
      kind: 'invalid',
      text: 'abc',
    }));
    expect(panel).toContain('Invalid numeric input');
    expect(panel).toContain('abc');
  });
});

/**
 * The invariant that ties the two halves of the lab together.
 *
 * There are two ways to watch a program here. Run takes it to the end and fills
 * the Output panel; Step walks it an instruction at a time and fills the debug
 * output pane. Both read the same engine, but they are different code paths --
 * `runToCompletion` and `step` -- and nothing forced them to agree. They did not:
 * a program could print correctly after a Run and print nothing while stepping,
 * which is precisely the confusion that made the single-quote bug hard to see
 * from the suite.
 *
 * So the property is asserted directly, over every sample that ships with the
 * lab rather than over one program chosen to demonstrate it. A fix that repairs
 * one program and breaks the other does not pass here.
 */
describe('Run and Step report the same output, for every sample that ships', () => {
  /** The samples, plus the program from the bug report, which is not one of them. */
  const PROGRAMS: readonly { name: string; source: string }[] = [
    ...ASSEMBLY_DEMOS.map((demo) => ({ name: demo.id, source: demo.source })),
    { name: 'reported hello world', source: REPORTED_HELLO_WORLD },
  ];

  /** What a whole run prints, in the panel's own text. */
  const viaRun = (source: string): string => {
    const { session, diagnostics } = createSession('v2', source);
    if (session === null) {
      throw new Error(`assembly failed: ${JSON.stringify(diagnostics)}`);
    }
    const inputs = session.inputPrompts().map(() => 0);
    return formatProgramOutput(session.runToCompletion(inputs, 10_000).output);
  };

  /** What stepping it one instruction at a time prints, in the same text. */
  const viaStep = (source: string): string => {
    const { session, diagnostics } = createSession('v2', source);
    if (session === null) {
      throw new Error(`assembly failed: ${JSON.stringify(diagnostics)}`);
    }
    const printed: ProgramOutput[] = [];
    // Generous, because a sample is a loop and the step path is one instruction
    // at a time. Hitting the ceiling is itself a failure: the two must both be
    // looking at a finished program.
    for (let step = 1; step <= 10_000 && !session.isFinished(); step += 1) {
      printed.push(...session.step(step, 0).output);
    }
    expect(session.isFinished(), 'the sample halts rather than running away').toBe(true);
    return formatProgramOutput(printed);
  };

  it.each(PROGRAMS.map((program) => [program.name, program.source] as const))(
    '%s prints the same stepped as run',
    (_name, source) => {
      expect(viaStep(source), 'step vs run').toBe(viaRun(source));
    },
  );

  it.each(PROGRAMS.map((program) => [program.name, program.source] as const))(
    '%s prints what the panel shows',
    (_name, source) => {
      expect(printed(runSourceToPanelText('v2', source)), 'panel vs run').toBe(viaRun(source));
    },
  );

  it('at least one sample actually prints, so the comparisons above mean something', () => {
    // Without this the whole block would pass on a corpus of silent programs.
    // Two of them do print -- the interrupt demo writes to a port and the DOS
    // hello world writes a string -- and an empty comparison is not a check.
    const printing = PROGRAMS.filter((program) => viaRun(program.source) !== '');
    expect(printing.length, 'samples that produce output').toBeGreaterThan(0);
  });
});
