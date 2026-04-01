import { BranchPredictorMode, BranchPredictorStats } from '@/lab/types';

interface BranchPredictorPanelProps {
  mode: BranchPredictorMode;
  stats: BranchPredictorStats;
  onModeChange: (mode: BranchPredictorMode) => void;
}

export function BranchPredictorPanel({ mode, stats, onModeChange }: BranchPredictorPanelProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-500 uppercase tracking-wider">Branch Predictor</span>
        <select
          value={mode}
          onChange={(event) => onModeChange(event.target.value as BranchPredictorMode)}
          className="bg-[#0f1716] border border-[#1f2b29] rounded px-2 py-1 text-xs text-gray-200"
        >
          <option value="always_taken">Always Taken</option>
          <option value="always_not_taken">Always Not Taken</option>
          <option value="one_bit">1-Bit Predictor</option>
          <option value="two_bit">2-Bit Saturating</option>
        </select>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <Metric label="Branches" value={stats.evaluatedBranches.toString()} />
        <Metric label="Accuracy" value={`${stats.accuracy.toFixed(1)}%`} />
        <Metric label="Correct" value={stats.correctPredictions.toString()} />
        <Metric label="Mispredict" value={stats.incorrectPredictions.toString()} />
      </div>

      <div className="space-y-1 max-h-40 overflow-auto pr-1">
        {stats.byOpcode.length === 0 && (
          <div className="text-xs text-gray-500">No conditional branches observed.</div>
        )}
        {stats.byOpcode.map((row) => (
          <div key={row.opcode} className="text-[11px] rounded border border-[#1f2b29] bg-[#0f1716] px-2 py-1">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[#e0b56a]">{row.opcode}</span>
              <span className="text-gray-400">{row.correct}/{row.total}</span>
            </div>
            <div className="text-gray-500">Accuracy {row.accuracy.toFixed(1)}%</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-[#1f2b29] bg-[#0f1716] px-2 py-1.5">
      <div className="text-gray-500">{label}</div>
      <div className="font-mono text-white">{value}</div>
    </div>
  );
}
