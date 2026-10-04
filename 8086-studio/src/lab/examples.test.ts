/**
 * The example library's contract, enforced by running every program in it.
 *
 * The point of these tests is that nothing here is allowed to pass by looking like
 * it works. Each entry is assembled by a real engine, executed for real, and
 * checked against the output it claims -- so a catalog entry that quietly stopped
 * compiling, or that only ever worked on one engine, fails here rather than in
 * front of somebody trying to learn from it.
 *
 * `expectedOutput` is a transcription of observed behaviour, not a definition of
 * it. That distinction matters when a test fails: the honest response is to find
 * out what the engines actually did, decide whether that is right, and only then
 * change the string. Editing the expectation to whatever came out is how a real
 * regression gets filed as a passing test.
 */

import { describe, expect, it } from 'vitest';

import {
  ASM_EXAMPLES,
  EXAMPLE_CATEGORIES,
  examplesByCategory,
  findExample,
  type AssemblyExample,
  type ExampleCategory,
} from '@/lab/examples';
import { runSourceToPanel } from '@/lab/run-output';
import type { EngineId } from '@/lab/execution-engine';

/**
 * The whole of what a completed run prints, before the panel's status line.
 *
 * `runSourceToPanel` deliberately appends `Program completed successfully` so a
 * person can tell a finished program from one that died. An example's expected
 * output is the program's own characters, so the suffix is cut off here rather
 * than being repeated in seventeen `expectedOutput` strings.
 */
function printedText(example: AssemblyExample, engine: EngineId): string {
  const result = runSourceToPanel(engine, example.source);

  expect(
    result.kind,
    `${example.id} was rejected by the ${engine} assembler: ${result.text}`,
  ).toBe('output');

  const suffix = '\n\nProgram completed successfully';
  expect(
    result.text.endsWith(suffix),
    `${example.id} did not finish cleanly on ${engine}. Panel text was ${JSON.stringify(result.text)}`,
  ).toBe(true);

  const body = result.text.slice(0, -suffix.length);
  expect(
    body.includes('\n\nError: '),
    `${example.id} reported a runtime error on ${engine}: ${JSON.stringify(result.text)}`,
  ).toBe(false);

  return body;
}

describe('the example catalog', () => {
  it('is not empty', () => {
    expect(ASM_EXAMPLES.length).toBeGreaterThan(0);
  });

  it('gives every example a unique id', () => {
    const ids = ASM_EXAMPLES.map((example) => example.id);
    const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
    expect(duplicates).toEqual([]);
  });

  it('uses stable, greppable ids rather than titles or numbers', () => {
    for (const example of ASM_EXAMPLES) {
      expect(example.id, 'id should be lower-case words').toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it('gives every example a title and a description worth reading', () => {
    for (const example of ASM_EXAMPLES) {
      expect(example.title.length, `${example.id} has no title`).toBeGreaterThan(0);
      expect(
        example.description.length,
        `${example.id} has no description`,
      ).toBeGreaterThan(40);
    }
  });

  it('only uses declared categories', () => {
    const known = new Set<string>(EXAMPLE_CATEGORIES.map((category) => category.id));
    for (const example of ASM_EXAMPLES) {
      expect(known.has(example.category), `${example.id} uses ${example.category}`).toBe(true);
    }
  });

  it('gives every example at least one engine', () => {
    for (const example of ASM_EXAMPLES) {
      expect(example.engines.length, `${example.id} claims no engine`).toBeGreaterThan(0);
    }
  });

  it('leaves no expected output unfilled', () => {
    for (const example of ASM_EXAMPLES) {
      expect(
        example.expectedOutput.length,
        `${example.id} has no verified expectedOutput`,
      ).toBeGreaterThan(0);
    }
  });

  it('never claims an engine the program does not run on', () => {
    // The claim is the whole value of the `engines` field: a reader deciding
    // whether to copy an example needs to know it will assemble on the engine
    // they have selected. An entry listing an engine it fails on would be worse
    // than one listing neither.
    for (const example of ASM_EXAMPLES) {
      for (const engine of example.engines) {
        const result = runSourceToPanel(engine, example.source);
        expect(
          result.kind,
          `${example.id} claims ${engine} but the assembler rejected it`,
        ).toBe('output');
      }
    }
  });

  it('prints the same thing on every engine it claims', () => {
    for (const example of ASM_EXAMPLES) {
      const outputs = example.engines.map((engine) => printedText(example, engine));
      for (const output of outputs) {
        expect(output, `${example.id} disagrees between its engines`).toBe(outputs[0]);
      }
    }
  });

  it('produces the output each example promises, on every engine it claims', () => {
    for (const example of ASM_EXAMPLES) {
      for (const engine of example.engines) {
        expect(
          printedText(example, engine),
          `${example.id} on ${engine}`,
        ).toBe(example.expectedOutput);
      }
    }
  });
});

describe('the catalog grouped by category', () => {
  it('leaves no example out of the grouping', () => {
    const grouped = ASM_EXAMPLES.map((example) => example.id).sort();
    const fromCategories = examplesByCategory()
      .flatMap((group) => group.examples)
      .map((example) => example.id)
      .sort();
    expect(fromCategories).toEqual(grouped);
  });

  it('has an entry for every category it declares', () => {
    for (const category of EXAMPLE_CATEGORIES) {
      const group = examplesByCategory().find((entry) => entry.info.id === category.id);
      expect(group, `${category.id} is not in the grouping`).toBeDefined();
      expect(
        group?.examples.length ?? 0,
        `${category.id} has no example`,
      ).toBeGreaterThan(0);
    }
  });

  it('keeps the grouping in the declared category order', () => {
    expect(examplesByCategory().map((group) => group.info.id)).toEqual(
      EXAMPLE_CATEGORIES.map((category) => category.id),
    );
  });

  it('gives each category a label and a blurb', () => {
    for (const category of EXAMPLE_CATEGORIES) {
      expect(category.label.length).toBeGreaterThan(0);
      expect(category.blurb.length).toBeGreaterThan(0);
    }
  });
});

describe('finding an example', () => {
  it('finds a known id', () => {
    expect(findExample('basic-hello-world')?.id).toBe('basic-hello-world');
  });

  it('returns nothing for an unknown id rather than throwing', () => {
    expect(findExample('no-such-example')).toBeUndefined();
  });
});

/**
 * The catalog is only worth having if the panels can reach it, so these two are
 * about the shape of the exported data rather than about assembly: every category
 * is reachable from the union type, and every example's `engines` field is a
 * subset of the engines the app actually has. Without these, a typo like
 * `'legacy '` would typecheck and quietly produce an example nobody can run.
 */
describe('the catalog against the app it lives in', () => {
  const allEngines: readonly EngineId[] = ['legacy', 'v2'];

  it('names only engines that exist', () => {
    for (const example of ASM_EXAMPLES) {
      for (const engine of example.engines) {
        expect(allEngines, `${example.id} claims the unknown engine ${engine}`).toContain(engine);
      }
    }
  });

  it('keeps the category union and the category list in step', () => {
    const declared = new Set<ExampleCategory>(EXAMPLE_CATEGORIES.map((category) => category.id));
    for (const example of ASM_EXAMPLES) {
      expect(declared.has(example.category)).toBe(true);
    }
    expect(declared.size).toBe(EXAMPLE_CATEGORIES.length);
  });
});