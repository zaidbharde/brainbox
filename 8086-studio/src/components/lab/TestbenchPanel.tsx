import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { AssertionResult } from '@/lab/testbench';

interface TestbenchPanelProps {
  script: string;
  onScriptChange: (script: string) => void;
  onRun: () => AssertionResult[];
}

export function TestbenchPanel({ script, onScriptChange, onRun }: TestbenchPanelProps) {
  const [results, setResults] = useState<AssertionResult[]>([]);

  const run = () => {
    setResults(onRun());
  };

  const passedCount = results.filter((result) => result.passed).length;

  return (
    <div className="space-y-3">
      <textarea
        value={script}
        onChange={(event) => onScriptChange(event.target.value)}
        className="w-full min-h-28 bg-[#0f1716] border border-[#1f2b29] rounded px-2 py-2 text-xs font-mono text-gray-200"
      />
      <Button size="sm" variant="secondary" onClick={run}>
        Run Assertions
      </Button>

      {results.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs text-gray-500">
            Passed {passedCount}/{results.length}
          </div>
          <div className="max-h-44 overflow-auto space-y-1 pr-1">
            {results.map((result) => (
              <div
                key={`${result.line}-${result.expression}`}
                className={`rounded border px-2 py-1 text-[11px] ${result.passed ? 'border-[#2fbf71]/40 bg-[#2fbf71]/10 text-[#7adfb1]' : 'border-[#e05d5d]/40 bg-[#e05d5d]/10 text-[#f38b8b]'}`}
              >
                L{result.line}: {result.expression} - {result.message}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
