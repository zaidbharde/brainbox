import { useState, useCallback, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Play, Bug, Code2, FileCode, Terminal, Cpu, 
  ChevronRight, Zap, Layers, BookOpen,
  RotateCcw, StepForward, ArrowLeft, Sparkles,
  Check, X, SlidersHorizontal, Microscope, ChartColumn, GraduationCap, Camera, Link2, MonitorCog
} from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Tabs } from '@/components/ui/Tabs';
import { CodeEditor } from '@/components/CodeEditor';
import { RegisterDisplay } from '@/components/RegisterDisplay';
import { InstructionPipeline } from '@/components/lab/InstructionPipeline';
import { PerformanceMonitor } from '@/components/lab/PerformanceMonitor';
import { TraceLog } from '@/components/lab/TraceLog';
import { DemoLibrary } from '@/components/lab/DemoLibrary';
import { TimeTravelTimeline } from '@/components/lab/TimeTravelTimeline';
import { SnapshotManager } from '@/components/lab/SnapshotManager';
import { InstructionInspector } from '@/components/lab/InstructionInspector';
import { ExecutionAnalyticsDashboard } from '@/components/lab/ExecutionAnalyticsDashboard';
import { GuidedLearningPanel } from '@/components/lab/GuidedLearningPanel';
import { WatchPanel } from '@/components/lab/WatchPanel';
import { WatchpointPanel } from '@/components/lab/WatchpointPanel';
import { BranchPredictorPanel } from '@/components/lab/BranchPredictorPanel';
import { CacheSimulatorPanel } from '@/components/lab/CacheSimulatorPanel';
import { HazardPanel } from '@/components/lab/HazardPanel';
import { SourceRuntimeMapPanel } from '@/components/lab/SourceRuntimeMapPanel';
import { ReplayPanel } from '@/components/lab/ReplayPanel';
import { TestbenchPanel } from '@/components/lab/TestbenchPanel';
import { StackFramePanel } from '@/components/lab/StackFramePanel';
import { InterruptIOPanel } from '@/components/lab/InterruptIOPanel';
import { compile, CompilationResult, SourceLanguage, SAMPLE_PROGRAMS_BY_LANGUAGE } from '@/compiler/compiler';
import { detectFrontendLanguage } from '@/compiler/transpiler';
import { runProgram, createInitialState, ProgramOutput } from '@/emulator/cpu';
import { assemble } from '@/emulator/assembler';
import { AssembledProgram, CPUState, Instruction } from '@/types/cpu';
import { executeStepWithDiagnostics } from '@/lab/debugger';
import { ASSEMBLY_DEMOS } from '@/lab/demos';
import { createInitialPerformanceMetrics, updatePerformanceMetrics } from '@/lab/performance';
import {
  BranchPredictorMode,
  BranchPredictorStats,
  CacheConfig,
  CacheStats,
  ExecutionAnalytics,
  GuidedLearningContent,
  HazardStats,
  InstructionInspectorData,
  MemoryWatchpoint,
  PerformanceMetrics,
  PipelineState,
  ReplaySession,
  SavedSnapshot,
  SourceMapEntry,
  SnapshotComparison,
  TraceEntry,
  WatchExpression,
  WatchValue,
} from '@/lab/types';
import { buildInstructionInspectorData } from '@/lab/instruction-inspector';
import { buildExecutionAnalytics } from '@/lab/analytics';
import { buildGuidedLearningContent } from '@/lab/guided-learning';
import { evaluateWatchExpressions } from '@/lab/watch';
import { analyzeBranchPrediction } from '@/lab/branch-predictor';
import { simulateCache } from '@/lab/cache-simulator';
import { analyzePipelineHazards } from '@/lab/hazards';
import { buildSourceMapEntries, findInstructionForSourceLine, findSourceLineForInstruction } from '@/lab/source-map';
import { buildSymbolicHints } from '@/lab/symbolic-hints';
import { AssertionResult, runTestbenchAssertions } from '@/lab/testbench';
import { createReplaySession, parseReplaySession, serializeReplaySession } from '@/lab/replay';
import {
  compareCPUStates,
  createExecutionSnapshot,
  createSavedSnapshot,
  restoreExecutionSnapshot,
} from '@/lab/snapshots';
import { cn } from '@/utils/cn';

type ViewMode = 'home' | 'editor' | 'asm-editor' | 'debug';
type EditorTab = 'source' | 'assembly' | 'output';
type DebugOrigin = 'editor' | 'asm-editor';
type DebugPanelTab = 'observe' | 'inspector' | 'snapshots' | 'analytics' | 'learn' | 'tools';
type SourceEditorLanguage = Exclude<SourceLanguage, 'auto'>;
type AssistantLanguage = SourceEditorLanguage | 'assembly';

const PIPELINE_STAGE_DELAY_MS = 120;
const MAX_DEBUG_STEPS = 10000;
const MAX_TRACE_FOR_REPLAY = 5000;
const DEFAULT_CACHE_CONFIG: CacheConfig = {
  policy: 'direct_mapped',
  lineCount: 16,
  lineSizeBytes: 2,
};
const DEFAULT_TESTBENCH_SCRIPT = `# Example assertions
REG AX = 0
HALTED true`;
const SIMPLE_LANGUAGE_GUIDE = `// SIMPLE LANGUAGE GUIDE (for this 8086 compiler)
// ======================================================
// 1) What is Simple Language?
//    - It is a beginner-friendly syntax that compiles to 8086 assembly.
//    - It is NOT full Python/JS/Java/C.
//
// 2) Do you need to define a program/function?
//    - No. Directly write statements.
//    - 'program <name>' is optional.
//
// 3) Variables
//    - You can assign directly: x = 10
//    - Or declare explicitly: var x = 10
//    - Types are implicit (16-bit integer oriented execution model).
//
// 4) Input / Output
//    - Input:  input x
//    - Output: print x
//    - String output: print "Hello"
//
// 5) Conditions
//    - if x < y
//        print x
//      else
//        print y
//      end
//
// 6) Loops
//    - while x > 0
//        x = x - 1
//      end
//
// 7) Supported operators
//    - Arithmetic: + - * / %
//    - Compare:   < > <= >= == !=
//    - Logical:   and or not
//
// 8) Very important syntax rules
//    - Block must end with 'end' (if/while/for).
//    - Use assignment with '=' only.
//    - Keep identifiers like: myVar, total_1
//    - Comments can be //, #, or ;
//
// 9) Common errors (and why)
//    - "Expected 'end'"         -> block not closed.
//    - "Undefined variable"     -> used before assignment/declaration/input.
//    - "Unexpected token"       -> invalid keyword/symbol/order.
//    - "Invalid expression"     -> broken math/condition syntax.
//
// 10) Minimal runnable example
// var n = 5
// while n > 0
//   print n
//   n = n - 1
// end
// print 0
`;
const DEFAULT_PIPELINE_STATE: PipelineState = {
  stage: 'idle',
  instructionIndex: null,
  tick: 0,
};
const SOURCE_LANGUAGE_OPTIONS: Array<{ id: SourceEditorLanguage; label: string }> = [
  { id: 'simple', label: 'Simple Language' },
  { id: 'python', label: 'Python' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'java', label: 'Java' },
  { id: 'c', label: 'C' },
];

function normalizeSource(source: string): string {
  return source.replace(/\s+/g, ' ').trim();
}

function resolveDemoIdFromSource(source: string): string | null {
  const normalized = normalizeSource(source);
  const match = ASSEMBLY_DEMOS.find((demo) => normalizeSource(demo.source) === normalized);
  return match?.id ?? null;
}

function overlapsWordRange(wordAddress: number, watchAddress: number, watchSize: number): boolean {
  const wordStart = wordAddress;
  const wordEnd = wordAddress + 2;
  const rangeStart = watchAddress;
  const rangeEnd = watchAddress + Math.max(1, watchSize);
  return wordStart < rangeEnd && wordEnd > rangeStart;
}

function buildErrorAssistantTips(messages: string[], language: AssistantLanguage): string[] {
  const tips: string[] = [];
  const addTip = (tip: string): void => {
    if (!tips.includes(tip)) {
      tips.push(tip);
    }
  };

  for (const message of messages) {
    const text = message.toLowerCase();
    const undefinedVar = message.match(/undefined variable:\s*([A-Za-z_][A-Za-z0-9_]*)/i);
    if (undefinedVar) {
      addTip(`Declare or initialize variable \`${undefinedVar[1]}\` before using it (e.g. \`${undefinedVar[1]} = 0\` or \`input ${undefinedVar[1]}\`).`);
    }
    if (text.includes("expected 'end'")) {
      addTip('Close every `if` / `while` / `for` block with `end`.');
    }
    if (text.includes('unexpected token')) {
      addTip('Check statement syntax near this line: misplaced token, missing operator, or wrong keyword order.');
    }
    if (text.includes('unsupported python syntax')) {
      addTip('Python mode currently supports core syntax only: `if/elif/else:`, `while:`, `for ... in range(...)`, assignments, `print(...)`, `input()`.');
    }
    if (text.includes('unsupported') && text.includes('syntax')) {
      addTip('Rewrite unsupported syntax into simpler statements; avoid complex one-liners.');
    }
    if (text.includes('invalid numeric input')) {
      addTip('Provide a valid integer input (for example: `42` or `-7`).');
    }
    if (text.includes('ip out of bounds')) {
      addTip('Execution pointer left valid instruction range. Verify jump/call targets and labels.');
    }
    if (text.includes('unknown label')) {
      addTip('Jump targets must reference a defined label (for example: `LOOP:`).');
    }
    if (text.includes('maximum steps exceeded')) {
      addTip('Possible infinite loop detected. Re-check loop condition and state update logic.');
    }
    if (text.includes('unterminated string')) {
      addTip('Terminate all string literals with a matching closing quote.');
    }
    if (text.includes('memory') && text.includes('out of bounds')) {
      addTip('Memory access is outside valid range. Verify address calculations and stack operations.');
    }
    if (text.includes('invalid expression')) {
      addTip('Use valid operands/operators in expressions, e.g. `a = b + 2`.');
    }
  }

  if (tips.length === 0 && messages.length > 0) {
    if (language === 'simple') {
      addTip('In Simple Language, close blocks with `end` and initialize variables before use.');
    } else if (language === 'python') {
      addTip('In Python mode, keep indentation and `:` block syntax (`if/while/for`) correct.');
    } else if (language === 'assembly') {
      addTip('In Assembly mode, verify labels, operands, and instruction format (`OP DEST, SRC`).');
    } else {
      addTip('Isolate the failing line, simplify syntax, then rebuild incrementally.');
    }
  }

  return tips.slice(0, 5);
}

type ErrorAssistantReport = {
  summary: string;
  location: string | null;
  causes: string[];
  fixes: string[];
};

function buildErrorAssistantReport(messages: string[], language: AssistantLanguage): ErrorAssistantReport | null {
  if (messages.length === 0) {
    return null;
  }

  const merged = messages.join(' | ');
  const findSourceLine = (): string | null => {
    for (const rawLine of messages) {
      const line = rawLine.trim();
      let match = line.match(/\bLine\s+(\d+)\b/i);
      if (match) {
        return match[1];
      }

      match = line.match(/\b(?:main\.(?:c|cpp|py|js)|Main\.java):(\d+)(?::\d+)?\b/);
      if (match) {
        return match[1];
      }

      match = line.match(/\bline\s+(\d+)\b/i);
      if (match && !/node:internal|internal\/modules|node_modules/i.test(line)) {
        return match[1];
      }
    }
    return null;
  };
  const sourceLine = findSourceLine();
  const location = sourceLine ? `Line ${sourceLine}` : null;

  let summary = 'The program failed due to a syntax or runtime error.';
  const causes: string[] = [];
  const fixes = buildErrorAssistantTips(messages, language);
  const lower = merged.toLowerCase();

  if (lower.includes("expected 'end'")) {
    summary = 'A block was not properly closed.';
    causes.push('A control block (`if` / `while` / `for`) is missing `end`.');
  } else if (lower.includes('undefined variable')) {
    summary = 'A variable is used before declaration or assignment.';
    causes.push('The referenced variable does not exist in current scope.');
  } else if (lower.includes('unexpected token') || lower.includes('invalid expression')) {
    summary = 'There is a syntax-level expression error.';
    causes.push('An operator, token, or statement structure is invalid.');
  } else if (lower.includes('ip out of bounds') || lower.includes('memory') && lower.includes('out of bounds')) {
    summary = 'Program execution reached an invalid address or memory range.';
    causes.push('A jump/address calculation produced an invalid destination.');
  } else if (lower.includes('maximum steps exceeded')) {
    summary = 'Execution likely entered an infinite loop.';
    causes.push('Loop termination condition may never become true.');
  } else if (lower.includes('unknown label')) {
    summary = 'A jump references a label that does not exist.';
    causes.push('Label spelling or declaration is missing/mismatched.');
  }

  if (causes.length === 0) {
    causes.push('The first reported error is usually the root cause; later ones can be cascading.');
  }

  return { summary, location, causes, fixes };
}

export function App() {
  const [viewMode, setViewMode] = useState<ViewMode>('home');
  const [sourceLanguage, setSourceLanguage] = useState<SourceEditorLanguage>('simple');
  const [sourceCode, setSourceCode] = useState(SIMPLE_LANGUAGE_GUIDE);
  const [asmCode, setAsmCode] = useState('');
  const [compilationResult, setCompilationResult] = useState<CompilationResult | null>(null);
  const [debugProgram, setDebugProgram] = useState<AssembledProgram | null>(null);
  const [editorTab, setEditorTab] = useState<EditorTab>('source');
  const [runOutput, setRunOutput] = useState<string>('');
  const [isCompiling, setIsCompiling] = useState(false);
  const [debugOrigin, setDebugOrigin] = useState<DebugOrigin>('editor');

  // Debug state
  const [debugState, setDebugState] = useState<CPUState>(createInitialState);
  const [debugOutput, setDebugOutput] = useState<ProgramOutput[]>([]);
  const [debugSnapshots, setDebugSnapshots] = useState<Array<ReturnType<typeof createExecutionSnapshot>>>([]);
  const [timelineCursor, setTimelineCursor] = useState(0);
  const [traceLog, setTraceLog] = useState<TraceEntry[]>([]);
  const [previousDebugState, setPreviousDebugState] = useState<CPUState | null>(null);
  const [pipelineState, setPipelineState] = useState<PipelineState>(DEFAULT_PIPELINE_STATE);
  const [performanceMetrics, setPerformanceMetrics] = useState<PerformanceMetrics>(createInitialPerformanceMetrics);
  const [changedMemoryWords, setChangedMemoryWords] = useState<number[]>([]);
  const [breakpoints, setBreakpoints] = useState<Set<number>>(new Set());
  const [savedSnapshots, setSavedSnapshots] = useState<SavedSnapshot[]>([]);
  const [snapshotCompareAId, setSnapshotCompareAId] = useState<string | null>(null);
  const [snapshotCompareBId, setSnapshotCompareBId] = useState<string | null>(null);
  const [selectedInstructionIndex, setSelectedInstructionIndex] = useState<number | null>(null);
  const [guidedModeEnabled, setGuidedModeEnabled] = useState(true);
  const [activeDemoId, setActiveDemoId] = useState<string | null>(null);
  const [debugPanelTab, setDebugPanelTab] = useState<DebugPanelTab>('observe');
  const [debugStatus, setDebugStatus] = useState<string>('Ready');
  const [isStepping, setIsStepping] = useState(false);
  const [watchExpressions, setWatchExpressions] = useState<WatchExpression[]>([]);
  const [watchpoints, setWatchpoints] = useState<MemoryWatchpoint[]>([]);
  const [branchPredictorMode, setBranchPredictorMode] = useState<BranchPredictorMode>('two_bit');
  const [cacheConfig, setCacheConfig] = useState<CacheConfig>(DEFAULT_CACHE_CONFIG);
  const [testbenchScript, setTestbenchScript] = useState(DEFAULT_TESTBENCH_SCRIPT);
  const [lastReplaySession, setLastReplaySession] = useState<ReplaySession | null>(null);
  const [showErrorAssistant, setShowErrorAssistant] = useState(false);

  const handleSourceLanguageSelection = useCallback((nextLanguage: SourceEditorLanguage) => {
    setSourceLanguage(nextLanguage);
    if (nextLanguage === 'simple') {
      setSourceCode(SIMPLE_LANGUAGE_GUIDE);
    } else {
      const samples = Object.values(SAMPLE_PROGRAMS_BY_LANGUAGE[nextLanguage] || {});
      if (samples.length > 0) {
        setSourceCode(samples[0]);
      }
    }
    setEditorTab('source');
    setCompilationResult(null);
    setRunOutput('');
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && viewMode !== 'home') {
        setViewMode('home');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [viewMode]);

  const formatOutput = (output: ProgramOutput[]): string => {
    let result = '';
    let currentLine = '';
    
    for (const item of output) {
      if (item.type === 'char') {
        if (item.value === 10) { // newline
          result += currentLine + '\n';
          currentLine = '';
        } else {
          currentLine += String.fromCharCode(item.value);
        }
      } else {
        if (currentLine) {
          result += currentLine;
          currentLine = '';
        }
        result += item.value + '\n';
      }
    }
    
    if (currentLine) {
      result += currentLine;
    }
    
    return result;
  };

  const pause = useCallback((ms: number) => new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  }), []);

  const animatePipeline = useCallback(async (instructionIndex: number) => {
    setPipelineState((prev) => ({ stage: 'fetch', instructionIndex, tick: prev.tick + 1 }));
    await pause(PIPELINE_STAGE_DELAY_MS);
    setPipelineState((prev) => ({ ...prev, stage: 'decode' }));
    await pause(PIPELINE_STAGE_DELAY_MS);
    setPipelineState((prev) => ({ ...prev, stage: 'execute' }));
    await pause(Math.floor(PIPELINE_STAGE_DELAY_MS * 0.7));
    setPipelineState((prev) => ({ ...prev, stage: 'idle' }));
  }, [pause]);

  const addWatchExpression = useCallback((expression: string) => {
    const cleaned = expression.trim();
    if (!cleaned) {
      return;
    }
    setWatchExpressions((current) => [
      ...current,
      { id: `watch-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`, expression: cleaned },
    ]);
  }, []);

  const removeWatchExpression = useCallback((id: string) => {
    setWatchExpressions((current) => current.filter((watch) => watch.id !== id));
  }, []);

  const addWatchpoint = useCallback((payload: { label: string; address: number; size: number; type: MemoryWatchpoint['type'] }) => {
    setWatchpoints((current) => [
      ...current,
      {
        id: `watchpoint-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        label: payload.label.trim() || `WP_${formatHex(payload.address)}`,
        address: payload.address & 0xFFFF,
        size: Math.max(1, payload.size),
        type: payload.type,
        enabled: true,
      },
    ]);
  }, []);

  const removeWatchpoint = useCallback((id: string) => {
    setWatchpoints((current) => current.filter((watchpoint) => watchpoint.id !== id));
  }, []);

  const toggleWatchpoint = useCallback((id: string) => {
    setWatchpoints((current) => current.map((watchpoint) => (
      watchpoint.id === id
        ? { ...watchpoint, enabled: !watchpoint.enabled }
        : watchpoint
    )));
  }, []);

  const getTriggeredWatchpoint = useCallback((
    memoryReads: number[],
    memoryWrites: number[],
    changedWords: number[]
  ): MemoryWatchpoint | null => {
    const enabledWatchpoints = watchpoints.filter((watchpoint) => watchpoint.enabled);
    for (const watchpoint of enabledWatchpoints) {
      const addressesToCheck = watchpoint.type === 'read'
        ? memoryReads
        : watchpoint.type === 'write'
          ? memoryWrites
          : changedWords;
      const hit = addressesToCheck.some((address) => overlapsWordRange(address, watchpoint.address, watchpoint.size));
      if (hit) {
        return watchpoint;
      }
    }
    return null;
  }, [watchpoints]);

  const initializeDebugSession = useCallback((program: AssembledProgram, origin: DebugOrigin, demoId: string | null = null) => {
    const initialState = createInitialState(program.initialMemory);
    const initialPerf = createInitialPerformanceMetrics();
    const initialSnapshot = createExecutionSnapshot(initialState, [], 0, initialPerf);

    setDebugProgram(program);
    setDebugOrigin(origin);
    setActiveDemoId(demoId);
    setDebugState(initialState);
    setPreviousDebugState(null);
    setDebugOutput([]);
    setTraceLog([]);
    setPipelineState({ ...DEFAULT_PIPELINE_STATE, instructionIndex: 0 });
    setPerformanceMetrics(initialPerf);
    setChangedMemoryWords([]);
    setBreakpoints(new Set());
    setSavedSnapshots([]);
    setSnapshotCompareAId(null);
    setSnapshotCompareBId(null);
    setSelectedInstructionIndex(0);
    setTimelineCursor(0);
    setDebugPanelTab('observe');
    setDebugSnapshots([initialSnapshot]);
    setWatchpoints([]);
    setLastReplaySession(null);
    setDebugStatus('Ready to step through the program.');
    setViewMode('debug');
  }, []);

  const seekTimelineToIndex = useCallback((targetIndex: number) => {
    if (debugSnapshots.length === 0) {
      return;
    }

    const safeIndex = Math.max(0, Math.min(targetIndex, debugSnapshots.length - 1));
    const restoredSnapshot = restoreExecutionSnapshot(debugSnapshots[safeIndex]);
    const previousSnapshot = safeIndex > 0
      ? restoreExecutionSnapshot(debugSnapshots[safeIndex - 1])
      : null;
    const visibleTrace = traceLog.slice(0, restoredSnapshot.traceLength);
    const lastTraceEntry = visibleTrace[visibleTrace.length - 1];

    setTimelineCursor(safeIndex);
    setDebugState(restoredSnapshot.state);
    setPreviousDebugState(previousSnapshot?.state ?? null);
    setDebugOutput(restoredSnapshot.output);
    setPerformanceMetrics(restoredSnapshot.perf);
    setChangedMemoryWords(lastTraceEntry?.changedMemoryWords ?? []);
    setPipelineState((prev) => ({
      ...prev,
      stage: 'idle',
      instructionIndex: restoredSnapshot.state.registers.IP,
      tick: prev.tick + 1,
    }));
    setSelectedInstructionIndex(restoredSnapshot.state.registers.IP);
    setDebugStatus(`Time-travel restored to step ${safeIndex}.`);
  }, [debugSnapshots, traceLog]);

  const executeCurrentInstruction = useCallback((stepLabel: 'Step Into' | 'Step Over'): boolean => {
    if (!debugProgram || debugState.halted || debugSnapshots.length === 0) {
      return false;
    }

    const safeTimelineIndex = Math.max(0, Math.min(timelineCursor, debugSnapshots.length - 1));
    const activeSnapshot = restoreExecutionSnapshot(debugSnapshots[safeTimelineIndex]);
    const branchSnapshots = debugSnapshots.slice(0, safeTimelineIndex + 1);
    const branchTrace = traceLog.slice(0, activeSnapshot.traceLength);
    const currentState = activeSnapshot.state;
    const currentOutput = activeSnapshot.output;
    const currentPerf = activeSnapshot.perf;

    const ip = currentState.registers.IP;
    if (ip < 0 || ip >= debugProgram.instructions.length) {
      setDebugState((state) => ({ ...state, halted: true, error: 'IP out of bounds' }));
      setDebugStatus('Execution halted: IP out of bounds.');
      return false;
    }

    const instruction = debugProgram.instructions[ip];
    const diagnostics = executeStepWithDiagnostics({
      state: currentState,
      instruction,
      labels: debugProgram.labels,
      stepNumber: branchTrace.length + 1,
      stepStartedAtMs: performance.now(),
    });

    const changedSignalCount = diagnostics.changedRegisters.length
      + diagnostics.changedFlags.length
      + diagnostics.changedMemoryWords.length;

    const nextPerf = updatePerformanceMetrics(
      currentPerf,
      diagnostics.cycles,
      changedSignalCount,
      diagnostics.traceEntry.timestampMs
    );
    const nextTrace = [...branchTrace, diagnostics.traceEntry];
    const nextOutput = diagnostics.output.length > 0
      ? [...currentOutput, ...diagnostics.output]
      : [...currentOutput];
    const nextSnapshots = [
      ...branchSnapshots,
      createExecutionSnapshot(diagnostics.nextState, nextOutput, nextTrace.length, nextPerf),
    ];
    const triggeredWatchpoint = getTriggeredWatchpoint(
      diagnostics.memoryReads,
      diagnostics.memoryWrites,
      diagnostics.changedMemoryWords
    );
    const watchpointSuffix = triggeredWatchpoint
      ? ` | Watchpoint hit: ${triggeredWatchpoint.label}`
      : '';

    setPreviousDebugState(currentState);
    setDebugState(diagnostics.nextState);
    setDebugOutput(nextOutput);
    setTraceLog(nextTrace);
    setPerformanceMetrics(nextPerf);
    setChangedMemoryWords(diagnostics.changedMemoryWords);
    setDebugSnapshots(nextSnapshots);
    setTimelineCursor(nextSnapshots.length - 1);
    setSelectedInstructionIndex(diagnostics.nextState.registers.IP);
    setDebugStatus(`${stepLabel}: ${diagnostics.traceEntry.instructionText}${watchpointSuffix}`);

    return true;
  }, [
    debugProgram,
    debugState,
    getTriggeredWatchpoint,
    traceLog,
    debugSnapshots,
    timelineCursor,
  ]);

  const runDebugStep = useCallback(async (stepLabel: 'Step Into' | 'Step Over') => {
    if (isStepping || !debugProgram || debugState.halted) {
      return;
    }

    const ip = debugState.registers.IP;
    setIsStepping(true);
    try {
      setDebugStatus(`${stepLabel} running...`);
      if (ip >= 0 && ip < debugProgram.instructions.length) {
        await animatePipeline(ip);
      }
      executeCurrentInstruction(stepLabel);
    } finally {
      setIsStepping(false);
    }
  }, [animatePipeline, debugProgram, debugState.halted, debugState.registers.IP, executeCurrentInstruction, isStepping]);

  const debugStepInto = useCallback(() => {
    void runDebugStep('Step Into');
  }, [runDebugStep]);

  const debugStepOver = useCallback(() => {
    const runStepOver = async () => {
      if (isStepping || !debugProgram || debugState.halted || debugSnapshots.length === 0) {
        return;
      }

      const safeTimelineIndex = Math.max(0, Math.min(timelineCursor, debugSnapshots.length - 1));
      const activeSnapshot = restoreExecutionSnapshot(debugSnapshots[safeTimelineIndex]);
      let currentState = activeSnapshot.state;
      const currentIp = currentState.registers.IP;
      const instruction = debugProgram.instructions[currentIp];
      const localSourceMapEntries = buildSourceMapEntries(debugProgram);
      const currentSourceLine = findSourceLineForInstruction(localSourceMapEntries, currentIp);
      const isCallStepOver = instruction?.opcode.toUpperCase() === 'CALL';
      const shouldRunMultiStep = isCallStepOver || currentSourceLine !== null;

      if (!instruction || !shouldRunMultiStep) {
        await runDebugStep('Step Over');
        return;
      }

      setIsStepping(true);
      try {
        setDebugStatus('Step Over running...');
        await animatePipeline(currentIp);

        const returnAddress = currentIp + 1;
        let previousState = safeTimelineIndex > 0
          ? restoreExecutionSnapshot(debugSnapshots[safeTimelineIndex - 1]).state
          : null;
        let currentOutput = [...activeSnapshot.output];
        let currentTrace = traceLog.slice(0, activeSnapshot.traceLength);
        let currentPerf = activeSnapshot.perf;
        const currentSnapshots = debugSnapshots.slice(0, safeTimelineIndex + 1);
        let lastMemoryChanges: number[] = [];
        let steps = 0;
        let callDepth = 0;
        let watchpointStatus: string | null = null;

        while (!currentState.halted && steps < MAX_DEBUG_STEPS) {
          const ip = currentState.registers.IP;
          if (ip < 0 || ip >= debugProgram.instructions.length) {
            currentState = { ...currentState, halted: true, error: 'IP out of bounds' };
            break;
          }

          if (steps > 0 && breakpoints.has(ip)) {
            setDebugStatus(`Paused at breakpoint ${formatHex(ip)} during step-over.`);
            break;
          }

          const currentInstruction = debugProgram.instructions[ip];
          const diagnostics = executeStepWithDiagnostics({
            state: currentState,
            instruction: currentInstruction,
            labels: debugProgram.labels,
            stepNumber: currentTrace.length + 1,
            stepStartedAtMs: performance.now(),
          });
          const changedSignalCount = diagnostics.changedRegisters.length
            + diagnostics.changedFlags.length
            + diagnostics.changedMemoryWords.length;
          currentPerf = updatePerformanceMetrics(
            currentPerf,
            diagnostics.cycles,
            changedSignalCount,
            diagnostics.traceEntry.timestampMs
          );
          currentTrace.push(diagnostics.traceEntry);
          if (diagnostics.output.length > 0) {
            currentOutput = [...currentOutput, ...diagnostics.output];
          }
          previousState = currentState;
          currentState = diagnostics.nextState;
          lastMemoryChanges = diagnostics.changedMemoryWords;
          currentSnapshots.push(createExecutionSnapshot(currentState, currentOutput, currentTrace.length, currentPerf));
          steps++;

          const opcode = currentInstruction.opcode.toUpperCase();
          if (isCallStepOver) {
            if (opcode === 'CALL') {
              callDepth++;
            } else if (opcode === 'RET') {
              callDepth = Math.max(0, callDepth - 1);
            }
          }

          const triggeredWatchpoint = getTriggeredWatchpoint(
            diagnostics.memoryReads,
            diagnostics.memoryWrites,
            diagnostics.changedMemoryWords
          );
          if (triggeredWatchpoint) {
            watchpointStatus = `Paused on watchpoint ${triggeredWatchpoint.label} during step-over.`;
            break;
          }

          if (isCallStepOver) {
            if (callDepth === 0 && currentState.registers.IP === returnAddress) {
              break;
            }
          } else if (currentSourceLine !== null) {
            const nextSourceLine = findSourceLineForInstruction(localSourceMapEntries, currentState.registers.IP);
            if (nextSourceLine !== currentSourceLine) {
              break;
            }
          }
        }

        if (steps >= MAX_DEBUG_STEPS && !currentState.halted) {
          currentState = { ...currentState, halted: true, error: 'Maximum steps exceeded (infinite loop?)' };
        }

        const lastSnapshotState = currentSnapshots[currentSnapshots.length - 1]?.state;
        if (lastSnapshotState !== currentState) {
          currentSnapshots.push(createExecutionSnapshot(currentState, currentOutput, currentTrace.length, currentPerf));
        }

        setPreviousDebugState(previousState);
        setDebugState(currentState);
        setDebugOutput(currentOutput);
        setTraceLog(currentTrace);
        setPerformanceMetrics(currentPerf);
        setChangedMemoryWords(lastMemoryChanges);
        setDebugSnapshots(currentSnapshots);
        setTimelineCursor(currentSnapshots.length - 1);
        setSelectedInstructionIndex(currentState.registers.IP);
        setPipelineState((prev) => ({ ...prev, stage: 'idle', instructionIndex: currentState.registers.IP, tick: prev.tick + 1 }));

        if (currentState.halted) {
          setDebugStatus(currentState.error ? `Execution halted: ${currentState.error}` : 'Program halted during step-over.');
        } else if (watchpointStatus) {
          setDebugStatus(watchpointStatus);
        } else if (breakpoints.has(currentState.registers.IP)) {
          setDebugStatus(`Paused at breakpoint ${formatHex(currentState.registers.IP)} after step-over.`);
        } else if (!isCallStepOver && currentSourceLine !== null) {
          const nextSourceLine = findSourceLineForInstruction(localSourceMapEntries, currentState.registers.IP);
          setDebugStatus(
            nextSourceLine !== null
              ? `Step Over moved from source line ${currentSourceLine} to ${nextSourceLine} in ${steps} instruction(s).`
              : `Step Over moved past source line ${currentSourceLine} in ${steps} instruction(s).`
          );
        } else if (!breakpoints.has(currentState.registers.IP)) {
          setDebugStatus(`Step Over completed ${steps} nested step(s).`);
        }
      } finally {
        setIsStepping(false);
      }
    };

    void runStepOver();
  }, [
    animatePipeline,
    breakpoints,
    debugProgram,
    debugSnapshots,
    debugState.halted,
    getTriggeredWatchpoint,
    isStepping,
    runDebugStep,
    timelineCursor,
    traceLog,
  ]);

  const debugStepBack = useCallback(() => {
    if (timelineCursor <= 0) {
      return;
    }
    seekTimelineToIndex(timelineCursor - 1);
  }, [seekTimelineToIndex, timelineCursor]);

  const debugReset = useCallback(() => {
    const initialState = createInitialState(debugProgram?.initialMemory);
    const initialPerf = createInitialPerformanceMetrics();
    const initialSnapshot = createExecutionSnapshot(initialState, [], 0, initialPerf);
    setDebugState(initialState);
    setPreviousDebugState(null);
    setDebugOutput([]);
    setTraceLog([]);
    setPerformanceMetrics(initialPerf);
    setChangedMemoryWords([]);
    setPipelineState({ ...DEFAULT_PIPELINE_STATE, instructionIndex: 0 });
    setDebugSnapshots([initialSnapshot]);
    setTimelineCursor(0);
    setSelectedInstructionIndex(0);
    setSavedSnapshots([]);
    setSnapshotCompareAId(null);
    setSnapshotCompareBId(null);
    setDebugStatus('CPU state reset.');
  }, [debugProgram]);

  const debugRunToEnd = useCallback(() => {
    if (!debugProgram || debugState.halted || isStepping || debugSnapshots.length === 0) {
      return;
    }

    const safeTimelineIndex = Math.max(0, Math.min(timelineCursor, debugSnapshots.length - 1));
    const activeSnapshot = restoreExecutionSnapshot(debugSnapshots[safeTimelineIndex]);
    let currentState = activeSnapshot.state;
    let previousState = safeTimelineIndex > 0
      ? restoreExecutionSnapshot(debugSnapshots[safeTimelineIndex - 1]).state
      : null;
    let currentOutput = [...activeSnapshot.output];
    let currentTrace = traceLog.slice(0, activeSnapshot.traceLength);
    let currentPerf = activeSnapshot.perf;
    const currentSnapshots = debugSnapshots.slice(0, safeTimelineIndex + 1);
    let lastMemoryChanges: number[] = [];
    let watchpointStatus: string | null = null;
    let steps = 0;

    while (!currentState.halted && steps < MAX_DEBUG_STEPS) {
      const ip = currentState.registers.IP;

      if (ip < 0 || ip >= debugProgram.instructions.length) {
        currentState = { ...currentState, halted: true, error: 'IP out of bounds' };
        break;
      }

      if (breakpoints.has(ip)) {
        if (steps === 0) {
          setDebugStatus(`Paused at breakpoint ${formatHex(ip)}.`);
        }
        break;
      }

      const instruction = debugProgram.instructions[ip];
      const diagnostics = executeStepWithDiagnostics({
        state: currentState,
        instruction,
        labels: debugProgram.labels,
        stepNumber: currentTrace.length + 1,
        stepStartedAtMs: performance.now(),
      });
      const changedSignalCount = diagnostics.changedRegisters.length
        + diagnostics.changedFlags.length
        + diagnostics.changedMemoryWords.length;

      currentPerf = updatePerformanceMetrics(
        currentPerf,
        diagnostics.cycles,
        changedSignalCount,
        diagnostics.traceEntry.timestampMs
      );
      currentTrace.push(diagnostics.traceEntry);
      if (diagnostics.output.length > 0) {
        currentOutput = [...currentOutput, ...diagnostics.output];
      }
      previousState = currentState;
      currentState = diagnostics.nextState;
      lastMemoryChanges = diagnostics.changedMemoryWords;
      currentSnapshots.push(createExecutionSnapshot(currentState, currentOutput, currentTrace.length, currentPerf));
      steps++;

      const triggeredWatchpoint = getTriggeredWatchpoint(
        diagnostics.memoryReads,
        diagnostics.memoryWrites,
        diagnostics.changedMemoryWords
      );
      if (triggeredWatchpoint) {
        watchpointStatus = `Paused on watchpoint ${triggeredWatchpoint.label} after ${steps} step(s).`;
        break;
      }

      if (breakpoints.has(currentState.registers.IP)) {
        setDebugStatus(`Paused at breakpoint ${formatHex(currentState.registers.IP)} after ${steps} step(s).`);
        break;
      }
    }

    if (steps >= MAX_DEBUG_STEPS && !currentState.halted) {
      currentState = { ...currentState, halted: true, error: 'Maximum steps exceeded (infinite loop?)' };
    }

    const lastSnapshotState = currentSnapshots[currentSnapshots.length - 1]?.state;
    if (lastSnapshotState !== currentState) {
      currentSnapshots.push(createExecutionSnapshot(currentState, currentOutput, currentTrace.length, currentPerf));
    }

    setPreviousDebugState(previousState);
    setDebugState(currentState);
    setDebugOutput(currentOutput);
    setTraceLog(currentTrace);
    setPerformanceMetrics(currentPerf);
    setChangedMemoryWords(lastMemoryChanges);
    setDebugSnapshots(currentSnapshots);
    setTimelineCursor(currentSnapshots.length - 1);
    setSelectedInstructionIndex(currentState.registers.IP);
    setPipelineState((prev) => ({ ...prev, stage: 'idle', instructionIndex: currentState.registers.IP, tick: prev.tick + 1 }));

    if (currentState.halted) {
      setDebugStatus(currentState.error ? `Execution halted: ${currentState.error}` : `Program halted after ${steps} step(s).`);
    } else if (watchpointStatus) {
      setDebugStatus(watchpointStatus);
    } else if (!breakpoints.has(currentState.registers.IP)) {
      setDebugStatus(`Run completed ${steps} step(s).`);
    }
  }, [
    breakpoints,
    debugProgram,
    debugSnapshots,
    debugState,
    getTriggeredWatchpoint,
    isStepping,
    traceLog,
    timelineCursor,
  ]);

  const toggleBreakpoint = useCallback((address: number) => {
    setBreakpoints((current) => {
      const next = new Set(current);
      if (next.has(address)) {
        next.delete(address);
      } else {
        next.add(address);
      }
      return next;
    });
  }, []);

  const saveNamedSnapshot = useCallback(() => {
    if (debugSnapshots.length === 0) {
      return;
    }

    const safeIndex = Math.max(0, Math.min(timelineCursor, debugSnapshots.length - 1));
    const baseSnapshot = restoreExecutionSnapshot(debugSnapshots[safeIndex]);
    const label = `Step ${safeIndex} @ IP ${formatHex(baseSnapshot.state.registers.IP)}`;
    const namedSnapshot = createSavedSnapshot(label, safeIndex, baseSnapshot);

    setSavedSnapshots((current) => [namedSnapshot, ...current].slice(0, 32));
    setSnapshotCompareAId((current) => current ?? namedSnapshot.id);
    setSnapshotCompareBId((current) => {
      if (current) {
        return current;
      }
      if (snapshotCompareAId && snapshotCompareAId !== namedSnapshot.id) {
        return namedSnapshot.id;
      }
      return null;
    });
    setDebugStatus(`Saved snapshot "${namedSnapshot.label}".`);
  }, [debugSnapshots, timelineCursor, snapshotCompareAId]);

  const restoreNamedSnapshot = useCallback((snapshotId: string) => {
    const namedSnapshot = savedSnapshots.find((snapshot) => snapshot.id === snapshotId);
    if (!namedSnapshot) {
      return;
    }

    const restored = createExecutionSnapshot(
      namedSnapshot.state,
      namedSnapshot.output,
      namedSnapshot.traceLength,
      namedSnapshot.perf
    );
    const safeIndex = Math.max(0, Math.min(timelineCursor, debugSnapshots.length - 1));
    const branchSnapshots = debugSnapshots.slice(0, safeIndex + 1);
    const previousState = branchSnapshots.length > 0
      ? restoreExecutionSnapshot(branchSnapshots[branchSnapshots.length - 1]).state
      : null;
    const nextSnapshots = [...branchSnapshots, restored];
    const nextTrace = traceLog.slice(0, Math.min(traceLog.length, namedSnapshot.traceLength));

    setDebugSnapshots(nextSnapshots);
    setTraceLog(nextTrace);
    setTimelineCursor(nextSnapshots.length - 1);
    setDebugState(restored.state);
    setPreviousDebugState(previousState);
    setDebugOutput(restored.output);
    setPerformanceMetrics(restored.perf);
    setChangedMemoryWords([]);
    setSelectedInstructionIndex(restored.state.registers.IP);
    setPipelineState((prev) => ({
      ...prev,
      stage: 'idle',
      instructionIndex: restored.state.registers.IP,
      tick: prev.tick + 1,
    }));
    setDebugStatus(`Restored snapshot "${namedSnapshot.label}".`);
  }, [debugSnapshots, savedSnapshots, timelineCursor, traceLog]);

  const visibleTrace = useMemo(() => {
    return traceLog.slice(0, Math.min(timelineCursor, traceLog.length));
  }, [timelineCursor, traceLog]);

  const executionAnalytics = useMemo<ExecutionAnalytics>(() => {
    return buildExecutionAnalytics(visibleTrace);
  }, [visibleTrace]);

  const selectedInstructionAddress = selectedInstructionIndex ?? debugState.registers.IP;
  const selectedInstruction = useMemo(() => {
    if (!debugProgram) {
      return null;
    }
    if (selectedInstructionAddress < 0 || selectedInstructionAddress >= debugProgram.instructions.length) {
      return null;
    }
    return debugProgram.instructions[selectedInstructionAddress];
  }, [debugProgram, selectedInstructionAddress]);

  const selectedInstructionLastTrace = useMemo(() => {
    for (let i = visibleTrace.length - 1; i >= 0; i--) {
      const entry = visibleTrace[i];
      if (entry.instructionAddress === selectedInstructionAddress) {
        return entry;
      }
    }
    return null;
  }, [selectedInstructionAddress, visibleTrace]);

  const inspectorData = useMemo<InstructionInspectorData | null>(() => {
    return buildInstructionInspectorData(selectedInstruction, selectedInstructionLastTrace);
  }, [selectedInstruction, selectedInstructionLastTrace]);

  const guidedLearningContent = useMemo<GuidedLearningContent>(() => {
    const baseContent = buildGuidedLearningContent(
      selectedInstruction,
      inspectorData,
      timelineCursor,
      activeDemoId
    );
    return {
      ...baseContent,
      symbolicHints: buildSymbolicHints(selectedInstruction, debugState),
    };
  }, [activeDemoId, debugState, inspectorData, selectedInstruction, timelineCursor]);

  const snapshotComparison = useMemo<SnapshotComparison | null>(() => {
    if (!snapshotCompareAId || !snapshotCompareBId || snapshotCompareAId === snapshotCompareBId) {
      return null;
    }
    const snapshotA = savedSnapshots.find((item) => item.id === snapshotCompareAId);
    const snapshotB = savedSnapshots.find((item) => item.id === snapshotCompareBId);
    if (!snapshotA || !snapshotB) {
      return null;
    }
    return compareCPUStates(snapshotA.state, snapshotB.state);
  }, [savedSnapshots, snapshotCompareAId, snapshotCompareBId]);

  const watchValues = useMemo<WatchValue[]>(() => {
    return evaluateWatchExpressions(watchExpressions, debugState, previousDebugState);
  }, [debugState, previousDebugState, watchExpressions]);

  const branchPredictorStats = useMemo<BranchPredictorStats>(() => {
    return analyzeBranchPrediction(visibleTrace, branchPredictorMode);
  }, [branchPredictorMode, visibleTrace]);

  const cacheStats = useMemo<CacheStats>(() => {
    return simulateCache(visibleTrace, cacheConfig);
  }, [cacheConfig, visibleTrace]);

  const hazardStats = useMemo<HazardStats>(() => {
    return analyzePipelineHazards(visibleTrace);
  }, [visibleTrace]);

  const sourceMapEntries = useMemo<SourceMapEntry[]>(() => {
    if (!debugProgram) {
      return [];
    }
    return buildSourceMapEntries(debugProgram);
  }, [debugProgram]);

  const debugSourceCodeForMap = useMemo(() => {
    return debugOrigin === 'editor'
      ? sourceCode
      : (asmCode || DEFAULT_ASM);
  }, [asmCode, debugOrigin, sourceCode]);

  const activeSourceLine = useMemo<number | null>(() => {
    return findSourceLineForInstruction(sourceMapEntries, selectedInstructionAddress);
  }, [selectedInstructionAddress, sourceMapEntries]);

  const runTestbench = useCallback((): AssertionResult[] => {
    return runTestbenchAssertions(testbenchScript, debugState, debugOutput);
  }, [debugOutput, debugState, testbenchScript]);

  const selectSourceLine = useCallback((line: number) => {
    const instructionAddress = findInstructionForSourceLine(sourceMapEntries, line);
    if (instructionAddress === null) {
      return;
    }
    setSelectedInstructionIndex(instructionAddress);
    setDebugPanelTab('inspector');
    setDebugStatus(`Mapped source line ${line} to instruction ${formatHex(instructionAddress)}.`);
  }, [sourceMapEntries]);

  const exportReplaySession = useCallback((): string => {
    const traceForReplay = traceLog.slice(-MAX_TRACE_FOR_REPLAY);
    const replayWindowLength = traceForReplay.length + 1;
    const snapshotsForReplay = debugSnapshots.length > replayWindowLength
      ? debugSnapshots.slice(debugSnapshots.length - replayWindowLength)
      : debugSnapshots;
    const session = createReplaySession({
      trace: traceForReplay,
      snapshots: snapshotsForReplay,
      savedSnapshots,
      breakpoints: Array.from(breakpoints).sort((a, b) => a - b),
      sourceCode,
      asmCode: asmCode || compilationResult?.assembly || '',
    });
    setLastReplaySession(session);
    setDebugStatus(`Replay exported (${traceForReplay.length} steps).`);
    return serializeReplaySession(session);
  }, [asmCode, breakpoints, compilationResult?.assembly, debugSnapshots, savedSnapshots, sourceCode, traceLog]);

  const importReplaySession = useCallback((json: string): string | null => {
    try {
      const session = parseReplaySession(json);
      let restoredProgram: AssembledProgram | null = null;
      let restoredOrigin: DebugOrigin = 'asm-editor';
      let nextCompilationResult: CompilationResult | null = null;

      if (session.asmCode.trim()) {
        const assembled = assemble(session.asmCode);
        const hardErrors = assembled.errors.filter((error) => error.type === 'error');
        if (hardErrors.length === 0) {
          restoredProgram = assembled;
        }
      }

      if (!restoredProgram && session.sourceCode.trim()) {
        const compiled = compile(session.sourceCode);
        nextCompilationResult = compiled;
        if (compiled.success && compiled.program) {
          restoredProgram = compiled.program;
          restoredOrigin = 'editor';
        } else {
          const errorMsg = compiled.errors.map((error) => `Line ${error.line}: ${error.message}`).join('; ');
          return `Cannot rebuild replay program from source. ${errorMsg}`;
        }
      }

      if (!restoredProgram) {
        return 'Replay payload does not include a runnable source/assembly program.';
      }

      const importedSnapshots = session.snapshots.length > 0
        ? session.snapshots
        : [createExecutionSnapshot(createInitialState(), [], 0, createInitialPerformanceMetrics(), session.createdAtMs)];
      const safeTimelineIndex = importedSnapshots.length - 1;
      const restoredSnapshot = restoreExecutionSnapshot(importedSnapshots[safeTimelineIndex]);
      const previousSnapshot = safeTimelineIndex > 0
        ? restoreExecutionSnapshot(importedSnapshots[safeTimelineIndex - 1])
        : null;
      const restoredTrace = session.trace.slice(0, Math.min(session.trace.length, restoredSnapshot.traceLength));
      const lastTraceEntry = restoredTrace[restoredTrace.length - 1];

      setSourceCode(session.sourceCode || sourceCode);
      setAsmCode(session.asmCode || asmCode);
      if (nextCompilationResult) {
        setCompilationResult(nextCompilationResult);
      }
      setDebugProgram(restoredProgram);
      setDebugOrigin(restoredOrigin);
      setActiveDemoId(session.asmCode ? resolveDemoIdFromSource(session.asmCode) : null);
      setTraceLog(restoredTrace);
      setDebugSnapshots(importedSnapshots);
      setSavedSnapshots(session.savedSnapshots);
      setBreakpoints(new Set(session.breakpoints));
      setTimelineCursor(safeTimelineIndex);
      setDebugState(restoredSnapshot.state);
      setPreviousDebugState(previousSnapshot?.state ?? null);
      setDebugOutput(restoredSnapshot.output);
      setPerformanceMetrics(restoredSnapshot.perf);
      setChangedMemoryWords(lastTraceEntry?.changedMemoryWords ?? []);
      setSelectedInstructionIndex(restoredSnapshot.state.registers.IP);
      setPipelineState((prev) => ({
        ...prev,
        stage: 'idle',
        instructionIndex: restoredSnapshot.state.registers.IP,
        tick: prev.tick + 1,
      }));
      setLastReplaySession(session);
      setDebugPanelTab('tools');
      setDebugStatus(`Replay imported (${session.trace.length} trace steps).`);
      setViewMode('debug');
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : 'Unknown replay import error';
    }
  }, [asmCode, sourceCode]);

  const triggerSoftwareInterrupt = useCallback((vector: number) => {
    if (!debugProgram || debugState.halted || isStepping || debugSnapshots.length === 0) {
      return;
    }

    const safeTimelineIndex = Math.max(0, Math.min(timelineCursor, debugSnapshots.length - 1));
    const activeSnapshot = restoreExecutionSnapshot(debugSnapshots[safeTimelineIndex]);
    const branchSnapshots = debugSnapshots.slice(0, safeTimelineIndex + 1);
    const branchTrace = traceLog.slice(0, activeSnapshot.traceLength);
    const currentState = activeSnapshot.state;
    const currentOutput = activeSnapshot.output;
    const currentPerf = activeSnapshot.perf;

    const instruction: Instruction = {
      opcode: 'INT',
      operands: [String(vector & 0xFF)],
      address: currentState.registers.IP,
      raw: `INT ${vector & 0xFF}`,
    };
    const diagnostics = executeStepWithDiagnostics({
      state: currentState,
      instruction,
      labels: debugProgram.labels,
      stepNumber: branchTrace.length + 1,
      stepStartedAtMs: performance.now(),
    });
    const changedSignalCount = diagnostics.changedRegisters.length
      + diagnostics.changedFlags.length
      + diagnostics.changedMemoryWords.length;
    const nextPerf = updatePerformanceMetrics(
      currentPerf,
      diagnostics.cycles,
      changedSignalCount,
      diagnostics.traceEntry.timestampMs
    );
    const nextTrace = [...branchTrace, diagnostics.traceEntry];
    const nextOutput = diagnostics.output.length > 0
      ? [...currentOutput, ...diagnostics.output]
      : [...currentOutput];
    const nextSnapshots = [
      ...branchSnapshots,
      createExecutionSnapshot(diagnostics.nextState, nextOutput, nextTrace.length, nextPerf),
    ];
    const triggeredWatchpoint = getTriggeredWatchpoint(
      diagnostics.memoryReads,
      diagnostics.memoryWrites,
      diagnostics.changedMemoryWords
    );
    const watchpointSuffix = triggeredWatchpoint ? ` | Watchpoint hit: ${triggeredWatchpoint.label}` : '';

    setPreviousDebugState(currentState);
    setDebugState(diagnostics.nextState);
    setDebugOutput(nextOutput);
    setTraceLog(nextTrace);
    setPerformanceMetrics(nextPerf);
    setChangedMemoryWords(diagnostics.changedMemoryWords);
    setDebugSnapshots(nextSnapshots);
    setTimelineCursor(nextSnapshots.length - 1);
    setSelectedInstructionIndex(diagnostics.nextState.registers.IP);
    setDebugStatus(`Manual INT ${vector & 0xFF} triggered${watchpointSuffix}.`);
  }, [
    debugProgram,
    debugSnapshots,
    debugState.halted,
    getTriggeredWatchpoint,
    isStepping,
    timelineCursor,
    traceLog,
  ]);

  const runAssemblySource = useCallback((source: string): string => {
    const program = assemble(source);
    const hardErrors = program.errors.filter((error) => error.type === 'error');
    if (hardErrors.length > 0) {
      return `Error:\n${hardErrors.map((error) => `Line ${error.line}: ${error.message}`).join('\n')}`;
    }

    const inInstructions = program.instructions.filter((instruction) => instruction.opcode.toUpperCase() === 'IN');
    const inputs: number[] = [];
    for (let i = 0; i < inInstructions.length; i++) {
      const port = inInstructions[i].operands[1] ?? '?';
      const raw = window.prompt(`Input required for IN port ${port} (#${i + 1})`, '0');
      if (raw === null) {
        return 'Run cancelled by user.';
      }
      const value = Number(raw.trim());
      if (!Number.isFinite(value)) {
        return `Error:\nInvalid numeric input: "${raw}"`;
      }
      inputs.push(Math.trunc(value));
    }

    const { finalState, output } = runProgram(program, 10000, inputs);
    let outputText = formatOutput(output);
    outputText += finalState.error
      ? `\n\nError: ${finalState.error}`
      : '\n\nProgram completed successfully';
    return outputText;
  }, []);

  const outputIsError = runOutput.includes('Error:') || runOutput.includes('Compilation failed');
  const compilationErrorMessages = useMemo<string[]>(() => {
    if (!compilationResult) {
      return [];
    }
    return compilationResult.errors
      .filter((error) => error.type === 'error')
      .map((error) => `Line ${error.line}: ${error.message}`);
  }, [compilationResult]);
  const compilationAssistantTips = useMemo<string[]>(() => {
    return buildErrorAssistantTips(compilationErrorMessages, sourceLanguage);
  }, [compilationErrorMessages, sourceLanguage]);
  const runErrorMessages = useMemo<string[]>(() => {
    if (!outputIsError || !runOutput.trim()) {
      return [];
    }
    return runOutput
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .filter((line) => !/^compilation failed:?$/i.test(line) && !/^error:?$/i.test(line));
  }, [outputIsError, runOutput]);
  const runAssistantTips = useMemo<string[]>(() => {
    const language: AssistantLanguage = viewMode === 'asm-editor' ? 'assembly' : sourceLanguage;
    return buildErrorAssistantTips(runErrorMessages, language);
  }, [runErrorMessages, sourceLanguage, viewMode]);
  const runAssistantReport = useMemo<ErrorAssistantReport | null>(() => {
    const language: AssistantLanguage = viewMode === 'asm-editor' ? 'assembly' : sourceLanguage;
    return buildErrorAssistantReport(runErrorMessages, language);
  }, [runErrorMessages, sourceLanguage, viewMode]);

  const handleCompile = useCallback(() => {
    const runCompile = (): CompilationResult => {
      const selectedResult = compile(sourceCode, sourceLanguage);
      if (selectedResult.success) {
        return selectedResult;
      }

      const detectedLanguage = detectFrontendLanguage(sourceCode);
      if (detectedLanguage === sourceLanguage) {
        return selectedResult;
      }

      const detectedResult = compile(sourceCode, detectedLanguage);
      if (
        detectedResult.success
        || detectedResult.errors.length < selectedResult.errors.length
      ) {
        setSourceLanguage(detectedLanguage);
        return detectedResult;
      }

      return selectedResult;
    };

    setIsCompiling(true);
    setTimeout(() => {
      const result = runCompile();
      setCompilationResult(result);
      if (result.success && result.assembly) {
        setAsmCode(result.assembly);
      }
      setEditorTab('assembly');
      setIsCompiling(false);
    }, 300);
  }, [sourceCode, sourceLanguage]);

  const handleRun = useCallback(() => {
    setShowErrorAssistant(false);
    const selectedResult = compile(sourceCode, sourceLanguage);
    const detectedLanguage = detectFrontendLanguage(sourceCode);
    const result = !selectedResult.success && detectedLanguage !== sourceLanguage
      ? (() => {
        const detectedResult = compile(sourceCode, detectedLanguage);
        if (
          detectedResult.success
          || detectedResult.errors.length < selectedResult.errors.length
        ) {
          setSourceLanguage(detectedLanguage);
          return detectedResult;
        }
        return selectedResult;
      })()
      : selectedResult;

    setCompilationResult(result);
    
    if (result.success && result.program) {
      const sourceInputVars = result.translatedSource
        .split('\n')
        .map((line) => line.trim())
        .map((line) => line.match(/^input\s+([A-Za-z_][A-Za-z0-9_]*)$/)?.[1] ?? null)
        .filter((name): name is string => name !== null);
      const inputPrompts = sourceInputVars.length > 0
        ? sourceInputVars
        : result.program.instructions
            .filter((instruction) => instruction.opcode.toUpperCase() === 'IN')
            .map((_, index) => `input_${index + 1}`);
      const inputs: number[] = [];
      for (const inputName of inputPrompts) {
        const raw = window.prompt(`Enter value for ${inputName}:`, '0');
        if (raw === null) {
          setRunOutput('Run cancelled by user.');
          setEditorTab('output');
          return;
        }
        const value = Number(raw.trim());
        if (!Number.isFinite(value)) {
          setRunOutput(`Error:\nInvalid numeric input for ${inputName}: "${raw}"`);
          setEditorTab('output');
          return;
        }
        inputs.push(Math.trunc(value));
      }

      const { finalState, output } = runProgram(result.program, 10000, inputs);
      let outputStr = formatOutput(output);
      
      if (finalState.error) {
        outputStr += `\n\nError: ${finalState.error}`;
      } else {
        outputStr += '\n\nProgram completed successfully';
      }
      
      setRunOutput(outputStr);
      setEditorTab('output');
    } else {
      // Show compilation errors
      const errorStr = result.errors.map(e => `Line ${e.line}: ${e.message}`).join('\n');
      setRunOutput(`Compilation failed:\n\n${errorStr}`);
      setEditorTab('output');
    }
  }, [sourceCode, sourceLanguage]);

  const handleDebug = useCallback(() => {
    const selectedResult = compile(sourceCode, sourceLanguage);
    const detectedLanguage = detectFrontendLanguage(sourceCode);
    const result = !selectedResult.success && detectedLanguage !== sourceLanguage
      ? (() => {
        const detectedResult = compile(sourceCode, detectedLanguage);
        if (
          detectedResult.success
          || detectedResult.errors.length < selectedResult.errors.length
        ) {
          setSourceLanguage(detectedLanguage);
          return detectedResult;
        }
        return selectedResult;
      })()
      : selectedResult;

    setCompilationResult(result);
    
    if (result.success && result.program) {
      initializeDebugSession(result.program, 'editor', null);
    }
  }, [initializeDebugSession, sourceCode, sourceLanguage]);

  // Home View
  if (viewMode === 'home') {
    return (
      <div className="app-shell min-h-screen bg-grid relative overflow-hidden">
        <div className="noise-overlay" />
        
        {/* Background Effects */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-[#45d1a3]/20 rounded-full blur-3xl animate-pulse-slow" />
          <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-[#e0b56a]/20 rounded-full blur-3xl animate-pulse-slow" style={{ animationDelay: '1s' }} />
          <div
            className="light-pulse-orb w-[24rem] h-[24rem] bg-[radial-gradient(circle,rgba(78,216,201,0.34)_0%,rgba(78,216,201,0.1)_45%,transparent_72%)] top-[16%] left-[8%]"
            style={{ animationDelay: '0s' }}
          />
          <div
            className="light-pulse-orb w-[26rem] h-[26rem] bg-[radial-gradient(circle,rgba(94,155,255,0.3)_0%,rgba(94,155,255,0.1)_46%,transparent_74%)] top-[24%] right-[10%]"
            style={{ animationDelay: '1.9s' }}
          />
          <div
            className="light-pulse-orb w-[25rem] h-[25rem] bg-[radial-gradient(circle,rgba(244,182,95,0.28)_0%,rgba(244,182,95,0.1)_44%,transparent_72%)] bottom-[8%] left-[35%]"
            style={{ animationDelay: '3.2s' }}
          />
        </div>

        <div className="relative z-10 container mx-auto px-6 py-12">
          {/* Header */}
          <motion.header 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-wrap items-center justify-between gap-3 mb-16"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#45d1a3] to-[#e0b56a] flex items-center justify-center">
                <Cpu className="w-6 h-6 text-white" />
              </div>
              <div className="flex flex-col leading-tight">
                <span className="text-xl font-bold text-white">x86 Studio</span>
                <span className="text-xs uppercase tracking-[0.18em] text-[#8fb9ff]">by BrainBox</span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant="info" dot>v3.0</Badge>
            </div>
          </motion.header>

          {/* Hero Section */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-center mb-16"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.2, type: 'spring' }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#45d1a3]/10 border border-[#45d1a3]/20 text-[#7adfb1] text-sm mb-6"
            >
              <Sparkles className="w-4 h-4" />
              <span>Powered by Virtual Intel 8086 CPU</span>
            </motion.div>
            <h1 className="text-5xl md:text-7xl font-bold mb-6">
              <span className="gradient-text">Virtual 8086</span>
              <br />
              <span className="text-white">Programming IDE</span>
            </h1>
            <p className="text-xl text-gray-400 max-w-2xl mx-auto mb-8">
              A complete compiler, assembler, and virtual CPU environment. 
              Write Simple Language, Python, JavaScript, Java, or C and watch it execute on a simulated Intel 8086.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-4">
              <Button 
                size="lg" 
                onClick={() => setViewMode('editor')}
                icon={<Sparkles className="w-5 h-5" />}
              >
                Start Coding
              </Button>
              <Button 
                variant="secondary" 
                size="lg"
                onClick={() => setViewMode('asm-editor')}
                icon={<Code2 className="w-5 h-5" />}
              >
                Assembly Mode
              </Button>
            </div>
          </motion.div>

          {/* Feature Cards */}
          <motion.div 
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16"
          >
            <FeatureCard
              icon={<Layers className="w-6 h-6" />}
              title="Full Compiler Pipeline"
              description="Lexer, Parser, Code Generator, and Assembler working in harmony."
            />
            <FeatureCard
              icon={<Cpu className="w-6 h-6" />}
              title="Virtual 8086 CPU"
              description="Accurate registers, flags, memory addressing, and core instructions."
            />
            <FeatureCard
              icon={<Bug className="w-6 h-6" />}
              title="Step Debugger"
              description="Step through execution, inspect registers, and track program flow."
            />
          </motion.div>

          {/* Sample Programs */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
          >
            <h2 className="text-2xl font-bold text-white mb-6 text-center">Sample Programs</h2>
            <div className="flex flex-wrap items-center justify-center gap-2 mb-4">
              {SOURCE_LANGUAGE_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => handleSourceLanguageSelection(option.id)}
                  className={cn(
                    'px-3 py-1.5 rounded-lg text-sm border transition-all',
                    sourceLanguage === option.id
                      ? 'bg-[#6edfd2]/20 border-[#6edfd2]/60 text-[#b8fff7]'
                      : 'bg-[#16233a]/70 border-[#32486f]/55 text-[#9cb5dc] hover:text-white'
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              {Object.entries(SAMPLE_PROGRAMS_BY_LANGUAGE[sourceLanguage]).map(([name, code]) => (
                <motion.button
                  key={name}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => {
                    setSourceCode(code);
                    setViewMode('editor');
                  }}
                  className="panel-glass p-4 rounded-xl border border-[#32486f]/55 hover:border-[#6edfd2]/50 transition-all text-left"
                >
                  <FileCode className="w-5 h-5 text-[#45d1a3] mb-2" />
                  <span className="text-sm font-medium text-white capitalize">{name}</span>
                </motion.button>
              ))}
            </div>
          </motion.div>
        </div>
      </div>
    );
  }

  // Editor View
  if (viewMode === 'editor') {
    return (
      <div className="app-shell min-h-screen flex flex-col">
        {/* Top Bar */}
        <div className="topbar-glass min-h-14 flex flex-wrap items-center justify-between gap-2 px-4 py-2">
          <div className="flex flex-wrap items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => setViewMode('home')}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
            <div className="h-6 w-px bg-[#31486d]" />
            <div className="flex items-center gap-2">
              <Cpu className="w-5 h-5 text-[#45d1a3]" />
              <span className="font-semibold text-white">{SOURCE_LANGUAGE_OPTIONS.find((option) => option.id === sourceLanguage)?.label} Editor</span>
            </div>
            <div className="flex items-center gap-2 ml-2">
              <span className="text-xs uppercase tracking-wider text-[#8ea6c9]">Language</span>
              <select
                value={sourceLanguage}
                onChange={(event) => handleSourceLanguageSelection(event.target.value as SourceEditorLanguage)}
                className="rounded-lg border border-[#365079]/70 bg-[linear-gradient(160deg,rgba(22,35,57,0.95),rgba(17,28,45,0.85))] px-2 py-1 text-xs text-[#e4ecff] focus:outline-none focus:ring-2 focus:ring-[#4ed8c9]/45"
              >
                {SOURCE_LANGUAGE_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          
          <div className="flex flex-wrap items-center gap-2">
            <Button 
              variant="secondary" 
              size="sm" 
              onClick={handleCompile}
              loading={isCompiling}
              icon={<Code2 className="w-4 h-4" />}
            >
              Compile
            </Button>
            <Button 
              variant="success" 
              size="sm" 
              onClick={handleRun}
              icon={<Play className="w-4 h-4" />}
            >
              Run
            </Button>
            <Button 
              variant="secondary" 
              size="sm" 
              onClick={handleDebug}
              icon={<Bug className="w-4 h-4" />}
            >
              Debug
            </Button>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex overflow-hidden">
          {/* Editor Panel */}
          <div className="flex-1 flex flex-col min-w-0">
            <Tabs
              tabs={[
                { id: 'source', label: 'Source', icon: <FileCode className="w-4 h-4" /> },
                { id: 'assembly', label: 'Assembly', icon: <Code2 className="w-4 h-4" /> },
                { id: 'output', label: 'Output', icon: <Terminal className="w-4 h-4" /> },
              ]}
              activeTab={editorTab}
              onTabChange={(id) => setEditorTab(id as EditorTab)}
              className="m-2"
            />
            
            <div className="flex-1 p-2 pt-0">
              <AnimatePresence mode="wait">
                {editorTab === 'source' && (
                  <motion.div
                    key="source"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="h-full"
                  >
                    <CodeEditor
                      value={sourceCode}
                      onChange={setSourceCode}
                      language={sourceLanguage}
                      className="h-full"
                    />
                  </motion.div>
                )}
                {editorTab === 'assembly' && (
                  <motion.div
                    key="assembly"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="h-full"
                  >
                    <CodeEditor
                      value={compilationResult?.assembly || '; Compile your code to see generated assembly'}
                      onChange={() => {}}
                      language="assembly"
                      readOnly
                      className="h-full"
                    />
                  </motion.div>
                )}
                {editorTab === 'output' && (
                  <motion.div
                    key="output"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="h-full panel-glass rounded-2xl border border-[#2a3d61]/60 p-4 font-mono text-sm overflow-y-auto"
                  >
                    {runOutput ? (
                      <div className="space-y-3">
                        <div className="flex items-center justify-end">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setShowErrorAssistant((current) => !current)}
                            disabled={!outputIsError}
                            icon={<Sparkles className="w-4 h-4" />}
                          >
                            Error Assistant
                          </Button>
                        </div>
                        <pre className={cn('whitespace-pre-wrap', outputIsError ? 'text-[#f38b8b]' : 'text-[#5de6a0]')}>
                          {runOutput}
                        </pre>
                        {outputIsError && showErrorAssistant && runAssistantReport && (
                          <div className="rounded-lg border border-[#5a4d24] bg-[#1f1a0b] p-3">
                            <div className="text-xs font-semibold tracking-wider text-[#f1bf63] mb-2">Error Assistant</div>
                            <p className="text-xs text-[#f6dc9f]">{runAssistantReport.summary}</p>
                            {runAssistantReport.location && (
                              <p className="mt-1 text-[11px] text-[#f6dc9f]">Likely location: {runAssistantReport.location}</p>
                            )}
                            {runAssistantReport.causes.length > 0 && (
                              <ul className="list-disc pl-4 mt-2 space-y-1 text-xs text-[#f9d88f]">
                                {runAssistantReport.causes.map((cause, index) => (
                                  <li key={`run-cause-${index}`}>{cause}</li>
                                ))}
                              </ul>
                            )}
                            <ul className="list-disc pl-4 space-y-1 text-xs text-[#f9d88f]">
                              {runAssistantTips.map((tip, index) => (
                                <li key={`run-assist-${index}`}>{tip}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    ) : (
                      <span className="text-gray-500">Run your program to see output</span>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Side Panel */}
          <div className="side-panel-modern w-80 p-4 overflow-y-auto">
            {/* Compilation Status */}
            {compilationResult && (
              <Card className="mb-4">
                <CardHeader 
                  title="Compilation" 
                  icon={compilationResult.success ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
                />
                <CardContent>
                  <div className="space-y-2">
                    {compilationResult.stages.map((stage, i) => (
                      <div key={i} className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-gray-400">{stage.name}</span>
                          <Badge variant={stage.success ? 'success' : 'error'} size="sm">
                            {stage.success ? 'Pass' : 'Fail'}
                          </Badge>
                        </div>
                        {!stage.success && stage.errors.length > 0 && (
                          <div className="text-[11px] text-[#f38b8b] bg-[#2a1114] border border-[#5b2229] rounded px-2 py-1">
                            Line {stage.errors[0].line}: {stage.errors[0].message}
                          </div>
                        )}
                      </div>
                    ))}
                    {!compilationResult.success && compilationAssistantTips.length > 0 && (
                      <div className="mt-3 rounded-lg border border-[#5a4d24] bg-[#1f1a0b] p-3">
                        <div className="text-xs font-semibold tracking-wider text-[#f1bf63] mb-2">Error Assistant</div>
                        <ul className="list-disc pl-4 space-y-1 text-xs text-[#f9d88f]">
                          {compilationAssistantTips.map((tip, index) => (
                            <li key={`compile-assist-${index}`}>{tip}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Quick Reference */}
            <Card>
              <CardHeader title="Quick Reference" icon={<BookOpen className="w-4 h-4" />} />
              <CardContent>
                <div className="space-y-3 text-xs">
                  <div>
                    <span className="text-gray-500 block mb-1">Simple & Easy Syntax:</span>
                    <pre className="text-[#7adfb1] font-mono bg-[#0b1110] p-2 rounded">{`# No program declaration needed!
x = 10
y = x + 5

if x < y
  print x
end

while x > 0
  x = x - 1
end

print "Hello!"`}</pre>
                  </div>
                  <div>
                    <span className="text-gray-500 block mb-1">Operators:</span>
                    <code className="text-[#e0b56a]">+ - * / % {'<'} {'>'} {'<='} {'>='} == !=</code>
                  </div>
                  <div>
                    <span className="text-gray-500 block mb-1">Keywords:</span>
                    <code className="text-[#e0b56a]">if else end while for print</code>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  // Assembly Editor View
  if (viewMode === 'asm-editor') {
    const activeAsmCode = asmCode || DEFAULT_ASM;

    const handleAsmRun = () => {
      setShowErrorAssistant(false);
      setActiveDemoId(resolveDemoIdFromSource(activeAsmCode));
      setRunOutput(runAssemblySource(activeAsmCode));
    };

    const handleAsmDebug = () => {
      const program = assemble(activeAsmCode);
      const hardErrors = program.errors.filter((error) => error.type === 'error');
      if (hardErrors.length > 0) {
        setRunOutput(`Error:\n${hardErrors.map((error) => `Line ${error.line}: ${error.message}`).join('\n')}`);
        return;
      }
      initializeDebugSession(program, 'asm-editor', resolveDemoIdFromSource(activeAsmCode));
    };

    const loadDemo = (source: string, demoId: string | null) => {
      setAsmCode(source);
      setActiveDemoId(demoId);
    };

    const loadAndRunDemo = (source: string, demoId: string | null) => {
      setAsmCode(source);
      setActiveDemoId(demoId);
      setRunOutput(runAssemblySource(source));
    };

    const loadAndDebugDemo = (source: string, demoId: string | null) => {
      setAsmCode(source);
      setActiveDemoId(demoId);
      const program = assemble(source);
      const hardErrors = program.errors.filter((error) => error.type === 'error');
      if (hardErrors.length > 0) {
        setRunOutput(`Error:\n${hardErrors.map((error) => `Line ${error.line}: ${error.message}`).join('\n')}`);
        return;
      }
      initializeDebugSession(program, 'asm-editor', demoId);
    };

    return (
      <div className="app-shell min-h-screen flex flex-col">
        {/* Top Bar */}
        <div className="topbar-glass min-h-14 flex flex-wrap items-center justify-between gap-2 px-4 py-2">
          <div className="flex flex-wrap items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => setViewMode('home')}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
            <div className="h-6 w-px bg-[#31486d]" />
            <div className="flex items-center gap-2">
              <Code2 className="w-5 h-5 text-[#e0b56a]" />
              <span className="font-semibold text-white">Assembly Editor</span>
            </div>
          </div>
          
          <div className="flex flex-wrap items-center gap-2">
            <Button 
              variant="success" 
              size="sm" 
              onClick={handleAsmRun}
              icon={<Play className="w-4 h-4" />}
            >
              Run
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleAsmDebug}
              icon={<Bug className="w-4 h-4" />}
            >
              Debug
            </Button>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 p-4">
            <CodeEditor
              value={asmCode || DEFAULT_ASM}
              onChange={(value) => {
                setAsmCode(value);
                setActiveDemoId(null);
              }}
              language="assembly"
              className="h-full"
            />
          </div>
          
          <div className="side-panel-modern w-80 p-4 overflow-y-auto">
            <Card className="mb-4">
              <CardHeader title="Output" icon={<Terminal className="w-4 h-4" />} />
              <CardContent>
                <div className="mb-3 flex items-center justify-end">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setShowErrorAssistant((current) => !current)}
                    disabled={!outputIsError}
                    icon={<Sparkles className="w-4 h-4" />}
                  >
                    Error Assistant
                  </Button>
                </div>
                <pre className={cn(
                  'text-xs font-mono whitespace-pre-wrap',
                  outputIsError ? 'text-[#f38b8b]' : 'text-[#5de6a0]'
                )}>
                  {runOutput || 'Run your program to see output'}
                </pre>
                {outputIsError && showErrorAssistant && runAssistantReport && (
                  <div className="mt-3 rounded-lg border border-[#5a4d24] bg-[#1f1a0b] p-3">
                    <div className="text-xs font-semibold tracking-wider text-[#f1bf63] mb-2">Error Assistant</div>
                    <p className="text-xs text-[#f6dc9f]">{runAssistantReport.summary}</p>
                    {runAssistantReport.location && (
                      <p className="mt-1 text-[11px] text-[#f6dc9f]">Likely location: {runAssistantReport.location}</p>
                    )}
                    {runAssistantReport.causes.length > 0 && (
                      <ul className="list-disc pl-4 mt-2 space-y-1 text-xs text-[#f9d88f]">
                        {runAssistantReport.causes.map((cause, index) => (
                          <li key={`asm-cause-${index}`}>{cause}</li>
                        ))}
                      </ul>
                    )}
                    <ul className="list-disc pl-4 mt-2 space-y-1 text-xs text-[#f9d88f]">
                      {runAssistantTips.map((tip, index) => (
                        <li key={`asm-assist-${index}`}>{tip}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="mb-4">
              <CardHeader title="Demo Program Library" icon={<BookOpen className="w-4 h-4" />} />
              <CardContent>
                <DemoLibrary
                  demos={ASSEMBLY_DEMOS}
                  onLoad={(demo) => loadDemo(demo.source, demo.id)}
                  onLoadAndRun={(demo) => loadAndRunDemo(demo.source, demo.id)}
                  onLoadAndDebug={(demo) => loadAndDebugDemo(demo.source, demo.id)}
                />
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader title="Instructions" icon={<BookOpen className="w-4 h-4" />} />
              <CardContent>
                <div className="space-y-2 text-xs font-mono">
                  <div className="text-gray-500">Data Movement:</div>
                  <div className="text-[#7ab6ff]">MOV, PUSH, POP (supports [addr])</div>
                  <div className="text-gray-500 mt-2">Arithmetic:</div>
                  <div className="text-[#7ab6ff]">ADD, ADC, SUB, SBB, MUL, DIV, MOD, INC, DEC, NEG</div>
                  <div className="text-gray-500 mt-2">Logic:</div>
                  <div className="text-[#7ab6ff]">AND, OR, XOR, NOT, SHL, SAL, SHR, SAR</div>
                  <div className="text-gray-500 mt-2">Compare & Jump:</div>
                  <div className="text-[#7ab6ff]">CMP, JMP, JE/JZ, JNE/JNZ, JL/JG, JLE/JGE, JC/JNC, JS/JNS, JO/JNO</div>
                  <div className="text-gray-500 mt-2">Control:</div>
                  <div className="text-[#7ab6ff]">CALL, RET, INT, IRET, HLT, NOP</div>
                  <div className="text-gray-500 mt-2">I/O:</div>
                  <div className="text-[#7ab6ff]">OUT, OUTC, IN, OUTP</div>
                  <div className="text-gray-500 mt-2">Flags:</div>
                  <div className="text-[#7ab6ff]">CLC, STC, CMC</div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  // Debug View
  if (viewMode === 'debug' && debugProgram) {
    const currentIp = debugState.registers.IP;
    const currentInstruction = debugProgram.instructions[currentIp];
    const currentInstructionText = currentInstruction
      ? `${currentInstruction.opcode} ${currentInstruction.operands.join(', ')}`.trim()
      : 'End of program';
    const timelineMax = Math.max(0, debugSnapshots.length - 1);
    const isRewound = timelineCursor < timelineMax;
    const traceForDisplay = visibleTrace;
    const sortedBreakpoints = Array.from(breakpoints).sort((a, b) => a - b);
    const canStep = !debugState.halted && !isStepping;
    
    return (
      <div className="app-shell min-h-screen flex flex-col">
        {/* Top Bar */}
        <div className="topbar-glass h-14 flex items-center justify-between px-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => setViewMode(debugOrigin)}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
            <div className="h-6 w-px bg-[#31486d]" />
            <div className="flex items-center gap-2">
              <Bug className="w-5 h-5 text-[#f0b45b]" />
              <span className="font-semibold text-white">Debugger</span>
            </div>
            <Badge variant={debugState.halted ? 'error' : isStepping ? 'info' : 'success'} dot>
              {debugState.halted ? 'Halted' : isStepping ? 'Stepping' : isRewound ? 'Time-Travel' : 'Ready'}
            </Badge>
          </div>
          
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={saveNamedSnapshot}
              icon={<Camera className="w-4 h-4" />}
            >
              Snapshot
            </Button>
            <Button 
              variant="secondary" 
              size="sm" 
              onClick={debugReset}
              icon={<RotateCcw className="w-4 h-4" />}
            >
              Reset
            </Button>
            <Button 
              variant="secondary" 
              size="sm" 
              onClick={debugStepBack}
              disabled={timelineCursor <= 0 || isStepping}
              icon={<ArrowLeft className="w-4 h-4" />}
            >
              Back
            </Button>
            <Button 
              variant="primary" 
              size="sm" 
              onClick={debugStepInto}
              disabled={!canStep}
              icon={<StepForward className="w-4 h-4" />}
            >
              Step Into
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={debugStepOver}
              disabled={!canStep}
              icon={<ChevronRight className="w-4 h-4" />}
            >
              Step Over
            </Button>
            <Button 
              variant="success" 
              size="sm" 
              onClick={debugRunToEnd}
              disabled={debugState.halted || isStepping}
              icon={<Play className="w-4 h-4" />}
            >
              Continue
            </Button>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex overflow-hidden">
          {/* Instructions */}
          <div className="flex-1 p-4 overflow-hidden flex flex-col gap-4">
            {guidedModeEnabled && (
              <Card className="border-[#45d1a3]/30 bg-[#11312a]">
                <CardContent>
                  <div className="text-xs text-[#7adfb1] uppercase tracking-wider mb-1">Step Explanation Overlay</div>
                  <div className="text-sm text-white mb-1">{guidedLearningContent.title}</div>
                  <div className="text-xs text-gray-300">{guidedLearningContent.explanation}</div>
                  {guidedLearningContent.symbolicHints && guidedLearningContent.symbolicHints.length > 0 && (
                    <div className="text-[11px] text-[#e0b56a] mt-2">
                      Symbolic hint: {guidedLearningContent.symbolicHints[0]}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            <Card className="flex-1 min-h-0">
              <CardHeader title="Instructions" icon={<Code2 className="w-4 h-4" />} />
              <CardContent noPadding className="overflow-auto h-full">
                <div className="font-mono text-sm">
                  {debugProgram.instructions.map((instr, i) => {
                    const isCurrent = i === debugState.registers.IP;
                    const hasBreakpoint = breakpoints.has(i);
                    const isSelected = i === selectedInstructionAddress;
                    return (
                      <motion.div
                        key={i}
                        initial={false}
                        onClick={() => setSelectedInstructionIndex(i)}
                        animate={isCurrent ? { backgroundColor: 'rgba(240, 180, 91, 0.12)' } : { backgroundColor: 'transparent' }}
                        className={cn(
                          'flex items-center px-3 py-1 border-l-2 transition-all cursor-pointer',
                          isCurrent
                            ? 'border-[#f0b45b]'
                            : hasBreakpoint
                              ? 'border-[#e05d5d]/55'
                              : isSelected
                                ? 'border-[#45d1a3]/50 bg-[#45d1a3]/5'
                              : 'border-transparent'
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => toggleBreakpoint(i)}
                          title={hasBreakpoint ? 'Remove breakpoint' : 'Add breakpoint'}
                          className={cn(
                            'w-5 text-center text-xs mr-2 transition-colors',
                            hasBreakpoint ? 'text-[#f38b8b]' : 'text-[#33413e] hover:text-[#f38b8b]'
                          )}
                        >
                          {hasBreakpoint ? '*' : '.'}
                        </button>
                        <span className="w-8 text-gray-600 text-xs">{i.toString().padStart(3, '0')}</span>
                        {isCurrent && <ChevronRight className="w-4 h-4 text-[#f0b45b] mr-2" />}
                        <span className={cn('text-[#e0b56a] font-semibold w-12', !isCurrent && 'ml-6')}>{instr.opcode}</span>
                        <span className="text-gray-300">{instr.operands.join(', ')}</span>
                      </motion.div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            <Card className="h-[38%] min-h-[220px]">
              <CardHeader title="Time Travel + Trace" icon={<SlidersHorizontal className="w-4 h-4" />} />
              <CardContent className="h-[calc(100%-56px)] space-y-3">
                <TimeTravelTimeline
                  snapshots={debugSnapshots}
                  trace={traceLog}
                  activeIndex={timelineCursor}
                  onSeek={seekTimelineToIndex}
                />
                <TraceLog entries={traceForDisplay} maxEntries={40} />
              </CardContent>
            </Card>
          </div>

          {/* Side Panel */}
          <div className="side-panel-modern w-96 p-4 overflow-y-auto space-y-4">
            <div className="tabs-shell rounded-xl p-2 grid grid-cols-2 gap-2">
              {[
                { id: 'observe', label: 'Observe', icon: <Cpu className="w-4 h-4" /> },
                { id: 'inspector', label: 'Inspector', icon: <Microscope className="w-4 h-4" /> },
                { id: 'snapshots', label: 'Snapshots', icon: <Camera className="w-4 h-4" /> },
                { id: 'analytics', label: 'Analytics', icon: <ChartColumn className="w-4 h-4" /> },
                { id: 'learn', label: 'Learn', icon: <GraduationCap className="w-4 h-4" /> },
                { id: 'tools', label: 'Tools', icon: <MonitorCog className="w-4 h-4" /> },
              ].map((tab) => {
                const active = debugPanelTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setDebugPanelTab(tab.id as DebugPanelTab)}
                    className={cn(
                      'relative min-w-0 rounded-lg border px-3 py-2 text-sm transition-colors',
                      'inline-flex items-center justify-center gap-2',
                      active
                        ? 'text-white border-[#6f99d8]/45 bg-[linear-gradient(140deg,rgba(78,216,201,0.24),rgba(94,155,255,0.2),rgba(244,182,95,0.2))]'
                        : 'text-[#9bb0d3] border-[#2f456a]/55 bg-[rgba(11,18,30,0.65)] hover:text-[#d9e3fb]'
                    )}
                  >
                    {tab.icon}
                    <span className="truncate">{tab.label}</span>
                  </button>
                );
              })}
            </div>

            {debugPanelTab === 'observe' && (
              <>
                <Card>
                  <CardHeader title="Current Instruction" icon={<Zap className="w-4 h-4" />} />
                  <CardContent>
                    {currentInstruction ? (
                      <div className="font-mono space-y-2">
                        <div>
                          <span className="text-2xl font-bold text-[#f0b45b]">{currentInstruction.opcode}</span>
                          <span className="text-lg text-gray-300 ml-3">{currentInstruction.operands.join(', ')}</span>
                        </div>
                        <p className="text-xs text-gray-500">IP: {formatHex(currentIp)}</p>
                      </div>
                    ) : (
                      <span className="text-gray-500">End of program</span>
                    )}
                    <p className="text-xs text-[#7adfb1] mt-3">{debugStatus}</p>
                    {sortedBreakpoints.length > 0 && (
                      <div className="mt-3">
                        <span className="text-xs text-gray-500 uppercase tracking-wider">Breakpoints</span>
                        <div className="mt-2 flex flex-wrap gap-1">
                          {sortedBreakpoints.map((bp) => (
                            <span key={bp} className="rounded border border-[#e05d5d]/35 bg-[#e05d5d]/10 px-2 py-0.5 font-mono text-xs text-[#f38b8b]">
                              {formatHex(bp)}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader title="Instruction Pipeline" icon={<Layers className="w-4 h-4" />} />
                  <CardContent>
                    <InstructionPipeline pipeline={pipelineState} instructionText={currentInstructionText} />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader title="Live CPU Visualization" icon={<Cpu className="w-4 h-4" />} />
                  <CardContent>
                    <RegisterDisplay
                      registers={debugState.registers}
                      previousRegisters={previousDebugState?.registers}
                      showAllRegisters={true}
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader title="Performance Monitor" icon={<Cpu className="w-4 h-4" />} />
                  <CardContent>
                    <PerformanceMonitor metrics={performanceMetrics} />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader title="Memory" icon={<Layers className="w-4 h-4" />} />
                  <CardContent>
                    <div className="space-y-4">
                      <div>
                        <span className="text-xs text-gray-500 uppercase tracking-wider">Stack (SP)</span>
                        <div className="mt-2">
                          <MemoryView
                            memory={debugState.memory}
                            start={(Math.max(0, debugState.registers.SP - 10) & ~1)}
                            words={6}
                            highlightAddress={debugState.registers.SP}
                            changedAddresses={changedMemoryWords}
                          />
                        </div>
                      </div>
                      <div>
                        <span className="text-xs text-gray-500 uppercase tracking-wider">Data Segment (0100h)</span>
                        <div className="mt-2">
                          <MemoryView
                            memory={debugState.memory}
                            start={0x0100}
                            words={8}
                            changedAddresses={changedMemoryWords}
                          />
                        </div>
                      </div>
                      <div>
                        <span className="text-xs text-gray-500 uppercase tracking-wider">Recent Writes</span>
                        <div className="mt-2 flex flex-wrap gap-1">
                          {changedMemoryWords.length > 0 ? (
                            changedMemoryWords.map((address) => (
                              <span key={address} className="rounded border border-[#45d1a3]/30 bg-[#45d1a3]/10 px-2 py-0.5 font-mono text-xs text-[#7adfb1]">
                                {formatHex(address)}
                              </span>
                            ))
                          ) : (
                            <span className="text-xs text-gray-500">No memory updates in last step.</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader title="Program Output" icon={<Terminal className="w-4 h-4" />} />
                  <CardContent>
                    <div className="font-mono text-sm">
                      {debugOutput.length > 0 ? (
                        <pre className="text-[#5de6a0] whitespace-pre-wrap">
                          {formatOutput(debugOutput)}
                        </pre>
                      ) : (
                        <span className="text-gray-500">No output yet</span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </>
            )}

            {debugPanelTab === 'inspector' && (
              <Card>
                <CardHeader title="Instruction Inspector Mode" icon={<Microscope className="w-4 h-4" />} />
                <CardContent>
                  <InstructionInspector
                    data={inspectorData}
                    instructionAddress={selectedInstructionAddress}
                  />
                </CardContent>
              </Card>
            )}

            {debugPanelTab === 'snapshots' && (
              <Card>
                <CardHeader title="CPU Snapshot System" icon={<Camera className="w-4 h-4" />} />
                <CardContent>
                  <SnapshotManager
                    snapshots={savedSnapshots}
                    compareAId={snapshotCompareAId}
                    compareBId={snapshotCompareBId}
                    comparison={snapshotComparison}
                    onSaveCurrent={saveNamedSnapshot}
                    onRestoreSnapshot={restoreNamedSnapshot}
                    onCompareAChange={setSnapshotCompareAId}
                    onCompareBChange={setSnapshotCompareBId}
                  />
                </CardContent>
              </Card>
            )}

            {debugPanelTab === 'analytics' && (
              <Card>
                <CardHeader title="Execution Analytics Dashboard" icon={<ChartColumn className="w-4 h-4" />} />
                <CardContent>
                  <ExecutionAnalyticsDashboard
                    analytics={executionAnalytics}
                    activeStep={timelineCursor}
                    onSeekStep={seekTimelineToIndex}
                  />
                </CardContent>
              </Card>
            )}

            {debugPanelTab === 'learn' && (
              <Card>
                <CardHeader title="Guided Learning Mode" icon={<GraduationCap className="w-4 h-4" />} />
                <CardContent>
                  <GuidedLearningPanel
                    enabled={guidedModeEnabled}
                    content={guidedLearningContent}
                    onToggle={setGuidedModeEnabled}
                  />
                </CardContent>
              </Card>
            )}

            {debugPanelTab === 'tools' && (
              <>
                <Card>
                  <CardHeader title="Watch Expressions" icon={<MonitorCog className="w-4 h-4" />} />
                  <CardContent>
                    <WatchPanel
                      watchValues={watchValues}
                      onAddWatch={addWatchExpression}
                      onRemoveWatch={removeWatchExpression}
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader title="Memory Watchpoints" icon={<Bug className="w-4 h-4" />} />
                  <CardContent>
                    <WatchpointPanel
                      watchpoints={watchpoints}
                      onAddWatchpoint={addWatchpoint}
                      onRemoveWatchpoint={removeWatchpoint}
                      onToggleWatchpoint={toggleWatchpoint}
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader title="Branch Predictor Lab" icon={<Zap className="w-4 h-4" />} />
                  <CardContent>
                    <BranchPredictorPanel
                      mode={branchPredictorMode}
                      stats={branchPredictorStats}
                      onModeChange={setBranchPredictorMode}
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader title="Cache Simulator" icon={<Layers className="w-4 h-4" />} />
                  <CardContent>
                    <CacheSimulatorPanel
                      config={cacheConfig}
                      stats={cacheStats}
                      onConfigChange={setCacheConfig}
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader title="Pipeline Hazards" icon={<SlidersHorizontal className="w-4 h-4" />} />
                  <CardContent>
                    <HazardPanel stats={hazardStats} />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader title="Source Runtime Map" icon={<Link2 className="w-4 h-4" />} />
                  <CardContent>
                    <SourceRuntimeMapPanel
                      sourceCode={debugSourceCodeForMap}
                      sourceMap={sourceMapEntries}
                      activeSourceLine={activeSourceLine}
                      onSelectSourceLine={selectSourceLine}
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader title="Replay Session" icon={<RotateCcw className="w-4 h-4" />} />
                  <CardContent>
                    <ReplayPanel
                      onExport={exportReplaySession}
                      onImport={importReplaySession}
                    />
                    {lastReplaySession && (
                      <div className="mt-2 text-[11px] text-gray-500">
                        Last export/import: {new Date(lastReplaySession.createdAtMs).toLocaleString()}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader title="CPU Testbench" icon={<Check className="w-4 h-4" />} />
                  <CardContent>
                    <TestbenchPanel
                      script={testbenchScript}
                      onScriptChange={setTestbenchScript}
                      onRun={runTestbench}
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader title="Call Stack View" icon={<Terminal className="w-4 h-4" />} />
                  <CardContent>
                    <StackFramePanel
                      state={debugState}
                      programLength={debugProgram.instructions.length}
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader title="Interrupt + I/O Console" icon={<MonitorCog className="w-4 h-4" />} />
                  <CardContent>
                    <InterruptIOPanel
                      state={debugState}
                      onTriggerInterrupt={triggerSoftwareInterrupt}
                    />
                  </CardContent>
                </Card>
              </>
            )}

            {debugState.error && (
              <Card className="border-[#e05d5d]/40">
                <CardContent>
                  <div className="flex items-center gap-2 text-[#f38b8b]">
                    <X className="w-4 h-4" />
                    <span className="text-sm">{debugState.error}</span>
                  </div>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardContent>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500">Timeline Position</span>
                  <span className="font-mono text-white">{timelineCursor}/{timelineMax}</span>
                </div>
                <div className="flex items-center justify-between text-sm mt-1">
                  <span className="text-gray-500">Named Snapshots</span>
                  <span className="font-mono text-white">{savedSnapshots.length}</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

function formatHex(value: number, width: number = 4) {
  return value.toString(16).toUpperCase().padStart(width, '0');
}

function MemoryView({
  memory,
  start,
  words,
  highlightAddress,
  changedAddresses = [],
}: {
  memory: Uint8Array;
  start: number;
  words: number;
  highlightAddress?: number;
  changedAddresses?: number[];
}) {
  const changedSet = new Set(changedAddresses);
  const rows = Array.from({ length: words }, (_, i) => {
    const addr = start + i * 2;
    const valid = addr >= 0 && addr + 1 < memory.length;
    const value = valid ? memory[addr] | (memory[addr + 1] << 8) : null;
    return {
      addr,
      value,
      valid,
      highlight: highlightAddress === addr,
      changed: changedSet.has(addr),
    };
  });

  return (
    <div className="grid grid-cols-2 gap-2 font-mono text-xs">
      {rows.map((row) => (
        <div
          key={row.addr}
          className={cn(
            'flex items-center justify-between rounded-md border px-2 py-1',
            row.highlight
              ? 'border-[#f0b45b]/60 bg-[#f0b45b]/10 text-[#f0b45b]'
              : row.changed
                ? 'border-[#45d1a3]/60 bg-[#45d1a3]/10 text-[#7adfb1]'
              : 'border-[#30496d]/55 bg-[rgba(12,20,33,0.82)] text-[#96abc9]'
          )}
        >
          <span>{formatHex(row.addr)}</span>
          <span className={cn(
            'text-gray-200',
            row.highlight && 'text-[#f0b45b]',
            row.changed && !row.highlight && 'text-[#7adfb1]'
          )}>
            {row.value !== null ? formatHex(row.value) : '----'}
          </span>
        </div>
      ))}
    </div>
  );
}

// Feature Card Component
function FeatureCard({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <motion.div
      whileHover={{ y: -5 }}
      className="panel-glass p-6 rounded-2xl border border-[#2f476f]/60 hover:border-[#6adfd1]/45 transition-all shadow-[0_20px_45px_rgba(5,10,22,0.3)]"
    >
      <div className="w-12 h-12 rounded-xl border border-[#3d5a8b]/45 bg-gradient-to-br from-[#4ed8c9]/25 via-[#75b2ff]/15 to-[#f4b65f]/20 flex items-center justify-center text-[#6de0d3] mb-4">
        {icon}
      </div>
      <h3 className="text-lg font-semibold text-white mb-2">{title}</h3>
      <p className="text-[#9db1d1] text-sm">{description}</p>
    </motion.div>
  );
}

const DEFAULT_ASM = `; 8086 Assembly Program
; Simple counter example

    MOV AX, 10    ; Initialize counter
    MOV BX, 0     ; Initialize sum

LOOP:
    ADD BX, AX    ; Add counter to sum
    DEC AX        ; Decrement counter
    CMP AX, 0     ; Check if zero
    JNE LOOP      ; Continue if not

    OUT BX        ; Output the sum
    HLT           ; Halt execution
`;
