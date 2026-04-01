import { SourceMapEntry } from '@/lab/types';
import { cn } from '@/utils/cn';

interface SourceRuntimeMapPanelProps {
  sourceCode: string;
  sourceMap: SourceMapEntry[];
  activeSourceLine: number | null;
  onSelectSourceLine: (line: number) => void;
}

export function SourceRuntimeMapPanel({
  sourceCode,
  sourceMap,
  activeSourceLine,
  onSelectSourceLine,
}: SourceRuntimeMapPanelProps) {
  const lines = sourceCode.split('\n');
  const mappedLines = new Set(sourceMap.map((entry) => entry.sourceLine));

  return (
    <div className="space-y-2">
      <div className="text-xs text-gray-500 uppercase tracking-wider">Source &lt;-&gt; Runtime Mapping</div>
      {sourceMap.length === 0 ? (
        <div className="text-xs text-gray-500">No source map labels found for this debug session.</div>
      ) : (
        <div className="max-h-56 overflow-auto border border-[#1f2b29] rounded bg-[#0f1716]">
          {lines.map((line, index) => {
            const lineNumber = index + 1;
            const mapped = mappedLines.has(lineNumber);
            const active = activeSourceLine === lineNumber;
            return (
              <button
                key={`src-line-${lineNumber}`}
                type="button"
                onClick={() => mapped && onSelectSourceLine(lineNumber)}
                className={cn(
                  'w-full text-left px-2 py-1 text-xs font-mono border-l-2',
                  active ? 'border-[#45d1a3] bg-[#45d1a3]/10 text-[#7adfb1]' : 'border-transparent text-gray-400',
                  mapped ? 'hover:bg-[#13201e]' : 'opacity-50 cursor-default'
                )}
                disabled={!mapped}
              >
                <span className="inline-block w-8 text-gray-600">{lineNumber.toString().padStart(2, '0')}</span>
                <span>{line || ' '}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
