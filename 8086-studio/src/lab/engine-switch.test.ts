/**
 * What an engine switch does to the Output panel.
 *
 * These are the assertions for the second half of the reported bug. The dispatch
 * half — the Run button using the engine captured at load — is covered by
 * `run-output.test.ts`; this file covers the half where the panel kept showing
 * one engine's result after the control had been moved to the other.
 */

import { describe, expect, it } from 'vitest';
import { panelEngineLabel, runSourceToPanel } from '@/lab/run-output';
import {
  engineSwitchedNote,
  isStaleForEngine,
  panelAfterEngineSwitch,
} from '@/lab/engine-switch';
import type { EngineId } from '@/lab/execution-engine';

/** The program from the report: it prints on v2 and is rejected by the legacy. */
const LAB_STYLE_HELLO_WORLD = [
  '.MODEL SMALL',
  '.STACK 100H',
  '.DATA',
  "msg DB 'Hello World!$'",
  '.CODE',
  'MAIN PROC',
  'MOV AX, @DATA',
  'MOV DS, AX',
  'LEA DX, msg',
  'MOV AH, 09H',
  'INT 21H',
  'MOV AH, 4CH',
  'INT 21H',
  'MAIN ENDP',
  'END MAIN',
].join('\n');

describe('switching the engine does not leave the old engine output on screen', () => {
  it('replaces the panel text rather than keeping it', () => {
    const before = runSourceToPanel('legacy', LAB_STYLE_HELLO_WORLD);
    const after = panelAfterEngineSwitch('v2', false);

    // The failure this pins: the legacy's diagnostic was still readable after the
    // control moved to v2, which is what made a stale closure look like an
    // impossible "the URL says v2 but this is a legacy error".
    expect(before.text).not.toBe(after.text);
    expect(after.text).not.toContain('Invalid data initializer');
    expect(after.text).toContain('cleared');
  });

  it('forgets which engine produced the text it just cleared', () => {
    // Provenance is null rather than the new engine. Claiming the panel belongs to
    // v2 would be asserting something nobody established.
    expect(panelAfterEngineSwitch('v2', false).provenance).toBeNull();
    expect(panelAfterEngineSwitch('legacy', true).provenance).toBeNull();
  });

  it('clears the panel whether or not a debug session was open', () => {
    // The distinction used to be the whole behaviour: with no debug session the
    // function returned early and the stale text stayed. Both paths clear now.
    const withSession = panelAfterEngineSwitch('v2', true);
    const without = panelAfterEngineSwitch('v2', false);
    expect(withSession.text).toContain('cleared');
    expect(without.text).toContain('cleared');
    expect(withSession.provenance).toBeNull();
    expect(without.provenance).toBeNull();
  });

  it('names the engine now selected, so the note is not a bare "cleared"', () => {
    expect(engineSwitchedNote('v2')).toContain('v2');
    expect(engineSwitchedNote('legacy')).toContain('Legacy');
    expect(engineSwitchedNote('v2')).not.toBe(engineSwitchedNote('legacy'));
  });

  it('mentions the closed debug session only when there was one', () => {
    expect(panelAfterEngineSwitch('v2', true).text).toContain('debug session');
    expect(panelAfterEngineSwitch('v2', false).text).not.toContain('debug session');
  });
});

describe('a panel knows whether it is describing the selected engine', () => {
  it('calls a result stale once the engine moves away from it', () => {
    expect(isStaleForEngine('legacy said this', 'legacy', 'v2')).toBe(true);
    expect(isStaleForEngine('v2 said this', 'v2', 'v2')).toBe(false);
  });

  it('does not call an empty or unprovenanced panel stale', () => {
    // Nothing to be stale about. Reporting these as stale would put a warning on
    // a panel that has never held anything.
    expect(isStaleForEngine('', null, 'v2')).toBe(false);
    expect(isStaleForEngine('anything', null, 'v2')).toBe(false);
    expect(isStaleForEngine('', 'legacy', 'v2')).toBe(false);
  });

  it('follows one program across a switch and back', () => {
    // The full sequence a person performs: run on legacy, switch to v2, run
    // again. The second run must be the v2 answer, and the panel must not still
    // be holding the first one.
    const legacyResult = runSourceToPanel('legacy', LAB_STYLE_HELLO_WORLD);
    expect(legacyResult.engine).toBe('legacy');
    expect(isStaleForEngine(legacyResult.text, legacyResult.engine, 'v2')).toBe(true);

    const v2Result = runSourceToPanel('v2', LAB_STYLE_HELLO_WORLD);
    expect(v2Result.engine).toBe('v2');
    expect(v2Result.text).toContain('Hello World!');
    expect(isStaleForEngine(v2Result.text, v2Result.engine, 'v2')).toBe(false);
  });

  it('needs no page reload for the new engine to answer', () => {
    // Both engines are asked in one turn, with nothing reloaded or re-created in
    // between. Before the dispatch fix the answer depended on which engine had
    // been selected when the page loaded, which is what "without a page reload"
    // is here to exclude.
    //
    // This used to prove it by watching the two engines disagree: the legacy
    // refused the single-quoted string the v2 engine accepted, so identical text
    // would have meant the call was ignored. They agree now that the legacy has
    // been taught single quotes, so the proof has to come from the provenance --
    // each answer names the engine that was asked for it.
    const engines: EngineId[] = ['legacy', 'v2'];
    const results = engines.map((engine) => runSourceToPanel(engine, LAB_STYLE_HELLO_WORLD));
    for (const [index, result] of results.entries()) {
      expect(result.engine).toBe(engines[index]);
      expect(result.text).toContain('Hello World!');
    }
    // The one thing the panel shows that is per-engine, and would differ if the
    // stale-closure bug were back.
    expect(panelEngineLabel(results[0].engine)).not.toBe(panelEngineLabel(results[1].engine));
  });
});