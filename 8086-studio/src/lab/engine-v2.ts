/**
 * The new engine, presented in the shapes the lab already uses.
 *
 * The lab was built against the legacy emulator, and it consumes that emulator's
 * shapes everywhere: a nested `CPUState` whose `memory` is a flat `Uint8Array`,
 * an `Instruction` parsed out of the source text, and a `StepDiagnostics` full of
 * what changed. Rewriting `App.tsx`, the register display, the snapshots and the
 * inspector against the new engine's own shapes would touch every one of them and
 * would leave the lab unable to show either engine at once.
 *
 * So the new engine is adapted *into* those shapes here instead. Everything above
 * this file keeps working unchanged and gains a second implementation to choose
 * between, which is what makes the engine switch in the debug toolbar a one-line
 * decision rather than a fork.
 *
 * Three things needed translating, and each is a real difference rather than a
 * renaming:
 *
 * - **Memory.** The legacy's is a flat 4 KB array that the UI indexes directly.
 *   The new engine's is 1 MB and segmented, so there is no array to hand over.
 *   This mirrors the segment the program is running in, which is what makes the
 *   lab's existing "Stack" and "Data Segment" views show the same addresses they
 *   always have.
 * - **Instructions.** The legacy debugger steps a parsed `Instruction` and treats
 *   IP as an instruction index. The new engine has bytes and real addresses, so
 *   the instruction at IP is decoded here. The decoded form is better than what
 *   it replaces: effective addresses and branch targets come back resolved rather
 *   than guessed from the operand text.
 * - **Changed memory.** The legacy works it out by comparing two whole memory
 *   arrays. The new engine can be asked, because `Memory` has watchers, so the
 *   addresses written during the step are known exactly instead of by difference.
 */

import { Cpu, createInitialState as createEngineState } from '@/engine/cpu/cpu';
import { Memory, SEGMENT_SIZE, physicalAddress } from '@/engine/memory';
import { assemble } from '@/engine/assembler/assemble';
import { decode, type DecodedInstruction } from '@/engine/cpu/decode';
import { getFlags, type ProgramOutput } from '@/emulator/cpu';
import type { CPUState, Registers } from '@/types/cpu';
import type { StepDiagnostics, TraceEntry } from '@/lab/types';

/** Where a .COM program starts, and the default the lab has always used. */
const COM_ORIGIN = 0x100;

/** The registers the lab diffs, in the order it shows them. */
const REGISTER_NAMES: (keyof Registers)[] = [
  'AX', 'BX', 'CX', 'DX', 'CS', 'DS', 'ES', 'SS', 'SI', 'DI', 'SP', 'BP', 'IP', 'FLAGS',
];
const FLAG_NAMES = ['CF', 'PF', 'AF', 'ZF', 'SF', 'OF'] as const;

/**
 * A source line, and the span of bytes it produced.
 *
 * The segment is part of the entry because a program can have more than one:
 * two lines both at offset 0 are different code if they were assembled into
 * different segments, and a flat offset would conflate them.
 */
export interface V2SourceMapEntry {
  sourceLine: number;
  segment: string;
  instructionStart: number;
  instructionEnd: number;
}

/**
 * The result of assembling with the new engine, in the lab's terms.
 *
 * `diagnostics` are the new assembler's, which are richer than the legacy's:
 * they carry line and column, so the editor can point at the problem rather
 * than quoting a line number.
 */
export interface V2Assembly {
  /** Segment images with their load addresses, ready to be written to memory. */
  segments: readonly { name: string; base: number; origin: number; bytes: Uint8Array }[];
  /** Where execution starts, which is not always the first thing emitted. */
  entry: { codeBase: number; ip: number; dataBase: number; stackBase: number; sp: number };
  /** 1-based source line, then the message. Empty when the source assembled. */
  diagnostics: { line: number; message: string }[];
  sourceMap: V2SourceMapEntry[];
}

/** Assemble source with the new assembler, or report why it would not. */
export function assembleV2(source: string, origin: number = COM_ORIGIN): V2Assembly {
  const result = assemble(source, { origin });
  const segmentEnds = new Map(
    result.segments.map((segment) => [segment.name, segment.origin + segment.bytes.length - 1]),
  );
  return {
    segments: result.segments.map((segment) => ({
      name: segment.name,
      base: segment.base,
      origin: segment.origin,
      bytes: segment.bytes,
    })),
    entry: {
      codeBase: result.entry.codeBase,
      ip: result.entry.ip,
      dataBase: result.entry.dataBase,
      stackBase: result.entry.stackBase,
      sp: result.entry.sp,
    },
    diagnostics: result.errors.map((error) => ({ line: error.line, message: error.message })),
    sourceMap: buildV2SourceMap(result.sourceLines, segmentEnds),
  };
}

/**
 * Map source lines to the addresses they were assembled at.
 *
 * The lab already has a source map, and it works by having the code generator
 * inject a `_SRC_<line>` label into the assembly and then reading the label back
 * out. That was necessary because the legacy assembler's labels were the only
 * record of where anything went. The new assembler reports every statement's
 * line and offset as it lays them out, so the map is a projection of data it
 * already has -- no labels, no regex, and it covers hand-written assembly too,
 * which the `_SRC_` scheme never did.
 */
export function buildV2SourceMap(
  sourceLines: readonly { line: number; segment: string; offset: number }[],
  /** Highest emitted offset per segment, so the last line's span is not open-ended. */
  segmentEnds?: ReadonlyMap<string, number>,
): V2SourceMapEntry[] {
  // A statement's span runs to the byte before the next statement in the *same*
  // segment starts, so each segment is walked separately. The last statement in
  // a segment runs to the end of what that segment actually emitted, which is
  // known from the segment image -- so an address well past the program belongs
  // to no line, instead of being claimed by the final line of the file.
  const bySegment = new Map<string, { line: number; segment: string; offset: number }[]>();
  for (const statement of sourceLines) {
    const list = bySegment.get(statement.segment);
    if (list) list.push(statement);
    else bySegment.set(statement.segment, [statement]);
  }

  const entries: V2SourceMapEntry[] = [];
  for (const statements of bySegment.values()) {
    statements.sort((a, b) => a.offset - b.offset);
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      const next = statements[i + 1];
      entries.push({
        sourceLine: statement.line,
        segment: statement.segment,
        instructionStart: statement.offset,
        instructionEnd: next ? next.offset - 1 : segmentEnds?.get(statement.segment) ?? 0xffff,
      });
    }
  }
  return entries;
}

/**
 * The source line an address belongs to, or null if the address is not code.
 *
 * The segment is named rather than given as a base address because that is what
 * the map is keyed by: two segments can both start at offset 0, and an address
 * only means something once you say which segment it is an offset *in*.
 */
export function findV2SourceLine(
  sourceMap: readonly V2SourceMapEntry[],
  segment: string,
  address: number,
): number | null {
  for (const entry of sourceMap) {
    if (entry.segment === segment && address >= entry.instructionStart && address <= entry.instructionEnd) {
      return entry.sourceLine;
    }
  }
  return null;
}

/**
 * A program being debugged by the new engine.
 *
 * One of these owns the engine's own state, so a step is a real step: there is no
 * re-assembly between presses, and stepping back is handled by the lab's
 * snapshots rather than by rewinding here.
 */
export class V2Session {
  private readonly cpu: Cpu;
  /** The running segment as a flat array, which is what the lab's views index. */
  private readonly mirror: Uint8Array;
  /** Which segment `mirror` and `sourceLine` are talking about, by name. */
  private readonly codeSegment: string;
  private readonly sourceMap: readonly V2SourceMapEntry[];
  private outputLength = 0;

  private constructor(cpu: Cpu, codeSegment: string, sourceMap: readonly V2SourceMapEntry[]) {
    this.cpu = cpu;
    this.codeSegment = codeSegment;
    this.sourceMap = sourceMap;
    this.mirror = new Uint8Array(SEGMENT_SIZE);
    this.refreshMemory();
  }

  /**
   * Assemble `source` and prepare it to be stepped from its entry point.
   *
   * Diagnostics come back rather than throwing, because the caller is an editor
   * that wants to show them next to the source.
   */
  static create(source: string, origin: number = COM_ORIGIN): { session: V2Session | null; assembly: V2Assembly } {
    const assembly = assembleV2(source, origin);
    if (assembly.diagnostics.length > 0) return { session: null, assembly };

    const memory = new Memory();
    for (const segment of assembly.segments) {
      memory.bytes.set(segment.bytes, physicalAddress(segment.base, segment.origin));
    }

    // The assembler's entry point, not the origin: a program that opens with data
    // has its first instruction somewhere after where it was loaded, and starting
    // execution at the origin would run through the data. Segment registers come
    // from the layout too, so a program with distinct code, data and stack
    // segments is set up the way it asked to be.
    const { entry } = assembly;
    const base = createEngineState();
    const cpu = new Cpu(memory, {
      ...base,
      CS: entry.codeBase,
      DS: entry.dataBase,
      ES: entry.dataBase,
      SS: entry.stackBase,
      IP: entry.ip,
      SP: entry.sp,
      FLAGS: 0x0002,
    });
    const codeSegment = assembly.segments.find((segment) => segment.base === entry.codeBase)?.name ?? '';
    return { session: new V2Session(cpu, codeSegment, assembly.sourceMap), assembly };
  }

  /** The entry point the assembler chose, which the debugger highlights first. */
  get entryIp(): number {
    return this.cpu.state.IP;
  }

  /**
   * Always empty: a session only exists for source that assembled, and the
   * diagnostics were checked before it was built. Kept so a session can be used
   * wherever a legacy session can be, without the caller checking which it has.
   */
  get diagnostics(): readonly { line: number; message: string }[] {
    return [];
  }

  /** True once the program has stopped, whether by HLT, INT 4Ch or an error. */
  isFinished(): boolean {
    return this.cpu.state.halted;
  }

  /**
   * The source line the program is stopped on, or null if the map cannot say.
   *
   * This is what the legacy path gets by parsing `_SRC_` labels out of the
   * assembled text, except that here it is a lookup in a map the assembler built
   * as it went, so it also works for assembly typed straight into the editor.
   */
  sourceLineAt(ip: number): number | null {
    return findV2SourceLine(this.sourceMap, this.codeSegment, ip & 0xffff);
  }

  /** The state, in the shape the lab stores and every component already reads. */
  get state(): CPUState {
    const s = this.cpu.state;
    const registers: Registers = {
      AX: s.AX & 0xffff, BX: s.BX & 0xffff, CX: s.CX & 0xffff, DX: s.DX & 0xffff,
      CS: s.CS & 0xffff, DS: s.DS & 0xffff, ES: s.ES & 0xffff, SS: s.SS & 0xffff,
      SI: s.SI & 0xffff, DI: s.DI & 0xffff, SP: s.SP & 0xffff, BP: s.BP & 0xffff,
      IP: s.IP & 0xffff, FLAGS: s.FLAGS & 0xffff,
    };
    return { registers, memory: this.mirror, halted: s.halted, error: s.error };
  }

  /** Decode the instruction at IP, for the trace and the inspector. */
  decodeAt(ip: number): DecodedInstruction {
    const physical = this.segmentBase() + (ip & 0xffff);
    return decode(this.cpu.memory.bytes.subarray(physical, physical + 16));
  }

  /**
   * Execute one instruction and report everything that changed, in exactly the
   * shape `executeStepWithDiagnostics` produces for the legacy engine.
   */
  step(stepNumber: number, stepStartedAtMs: number): StepDiagnostics {
    const before = this.state;
    const ipBefore = before.registers.IP;
    const decoded = this.decodeAt(ipBefore);
    // Output accumulates on the CPU for the whole run, so each step reports only
    // what this instruction added rather than everything printed so far.
    this.outputLength = this.cpu.output.length;

    this.cpu.step();

    const after = this.state;
    this.refreshMemory();
    const output = this.cpu.output.slice(this.outputLength) as ProgramOutput[];
    const reads = this.readsOf();
    const writes = this.writesOf();
    const changedRegisters = REGISTER_NAMES.filter((name) => before.registers[name] !== after.registers[name]);
    const changedFlags = FLAG_NAMES.filter(
      (flag) => getFlags(before.registers.FLAGS)[flag] !== getFlags(after.registers.FLAGS)[flag],
    );
    const text = decoded.ok ? toLabSyntax(decoded.text) : decoded.error ?? '(undecodable)';

    const traceEntry: TraceEntry = {
      step: stepNumber,
      instructionAddress: ipBefore,
      instructionText: text,
      ipBefore,
      ipAfter: after.registers.IP,
      changedRegisters,
      changedFlags,
      changedMemoryWords: writes,
      memoryReads: reads,
      memoryWrites: writes,
      output,
      cycles: estimateCycles(decoded),
      timestampMs: stepStartedAtMs,
    };

    return {
      nextState: after,
      output,
      changedRegisters,
      changedFlags,
      changedMemoryWords: writes,
      memoryReads: reads,
      memoryWrites: writes,
      cycles: traceEntry.cycles,
      traceEntry,
    };
  }

  /**
   * The paragraph address of the segment being mirrored.
   *
   * The lab's memory views index one flat array, but the new engine has four
   * segments, so one has to be picked and it has to be the code segment: that is
   * the one the debugger reads to highlight the current instruction, and its
   * offsets are the ones the trace reports. For the .COM programs the lab is
   * built around, every segment register holds the same value, so this is the
   * whole program and nothing is lost. A program that deliberately separates its
   * segments gets its code visible and its other segments left out, which is a
   * real limitation of a single flat view rather than a mistake to paper over.
   */
  private segmentBase(): number {
    return (this.cpu.state.CS & 0xffff) << 4;
  }

  private refreshMemory(): void {
    const base = this.segmentBase();
    this.mirror.set(this.cpu.memory.bytes.subarray(base, base + SEGMENT_SIZE));
  }

  /**
   * Addresses the instruction read, as word offsets in the mirrored segment.
   *
   * These come from the CPU rather than from the operand text, so a computed
   * address like `[BX+SI]` is the one that was really used at the time. Two
   * kinds of access the engine performs are not in the list: instruction fetches,
   * which are not data, and the flat byte scan behind DOS print-string, which
   * reads the array directly because it is bounded by the segment.
   */
  private readsOf(): number[] {
    return this.wordsOf(this.cpu.lastReads);
  }

  /** Addresses the instruction wrote, in the same terms as `readsOf`. */
  private writesOf(): number[] {
    return this.wordsOf(this.cpu.lastWrites);
  }

  /**
   * Collapse byte addresses to word offsets in the mirrored segment, dropping
   * anything outside it. A 16-bit access reports two bytes, and the lab counts
   * words, so a word touched at all should appear exactly once.
   */
  private wordsOf(physicalAddresses: readonly number[]): number[] {
    const base = this.segmentBase();
    const found = new Set<number>();
    for (const physical of physicalAddresses) {
      const offset = physical - base;
      if (offset >= 0 && offset < SEGMENT_SIZE) found.add(offset & ~1);
    }
    return [...found].sort((a, b) => a - b);
  }
}

/**
 * A cycle estimate for the trace's timing column.
 *
 * The new engine has no cycle model, and building one is a separate piece of work
 * from executing correctly, so this reports a flat, honest number rather than a
 * guess dressed up as a measurement. The legacy's estimate is not reused: it keys
 * off parsed operand text that does not exist here, and importing it would make
 * two engines disagree about timing for reasons that have nothing to do with the
 * instructions.
 */
function estimateCycles(_decoded: DecodedInstruction): number {
  return 0;
}

/**
 * Render hex the way the rest of the lab does.
 *
 * The decoder prints `0x1234`, which is C, not assembly: the source editor, the
 * disassembly panel and the legacy trace all write `1234h`, and a trace that
 * mixed the two would read as though it came from somewhere else. Only the `0x`
 * forms are rewritten, so `BYTE PTR DS:[BX+SI]` and the like are untouched.
 */
function toLabSyntax(text: string): string {
  return text.replace(/\b0x([0-9a-f]+)\b/gi, (_match, digits: string) => {
    const value = Number.parseInt(digits, 16);
    // Unpadded, and zero stays `0`: the legacy prints `MOV AX, 1` and
    // `ADD AL, 0`, not `MOV AX, 0001h`.
    if (Number.isNaN(value) || value === 0) return value === 0 ? '0' : `${digits}h`;
    return `${value.toString(16).toUpperCase()}h`;
  });
}
