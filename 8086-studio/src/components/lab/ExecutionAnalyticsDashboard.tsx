import { ExecutionAnalytics } from '@/lab/types';
import { cn } from '@/utils/cn';

interface ExecutionAnalyticsDashboardProps {
  analytics: ExecutionAnalytics;
  activeStep: number;
  onSeekStep: (step: number) => void;
}

export function ExecutionAnalyticsDashboard({
  analytics,
  activeStep,
  onSeekStep,
}: ExecutionAnalyticsDashboardProps) {
  const topFrequency = analytics.instructionFrequency.slice(0, 8);
  const timelineWindow = analytics.timeline.slice(-70);
  const maxCycles = Math.max(1, ...timelineWindow.map((point) => point.cycles));

  if (analytics.totalSteps === 0) {
    return <div className="text-xs text-gray-500">Run or step program to populate analytics.</div>;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 text-xs">
        <Metric label="Total Steps" value={analytics.totalSteps.toString()} />
        <Metric label="Total Cycles" value={analytics.totalCycles.toString()} />
        <Metric label="Avg Cycles" value={analytics.averageCycles.toFixed(2)} />
        <Metric label="Cycle Range" value={`${analytics.minCycles} - ${analytics.maxCycles}`} />
      </div>

      <div className="rounded-lg border border-[#1f2b29] bg-[#0f1716] p-3">
        <div className="text-xs text-gray-500 uppercase tracking-wider mb-2">Instruction Frequency</div>
        <div className="space-y-1">
          {topFrequency.map((row) => (
            <div key={row.opcode} className="text-[11px]">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[#e0b56a]">{row.opcode}</span>
                <span className="text-gray-400">{row.count} ({row.percentage.toFixed(1)}%)</span>
              </div>
              <div className="h-1.5 rounded bg-[#13201e] overflow-hidden">
                <div
                  className="h-full bg-[#45d1a3]"
                  style={{ width: `${Math.max(4, row.percentage)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-[#1f2b29] bg-[#0f1716] p-3">
        <div className="flex items-center justify-between text-xs text-gray-500 uppercase tracking-wider mb-2">
          <span>Execution Timeline</span>
          <span className="font-mono text-gray-400">Step {activeStep}</span>
        </div>
        <div className="flex items-end gap-1 h-20">
          {timelineWindow.map((point) => {
            const barHeight = Math.max(8, Math.round((point.cycles / maxCycles) * 72));
            const isActive = point.step === activeStep;
            return (
              <button
                key={`timeline-${point.step}`}
                type="button"
                onClick={() => onSeekStep(point.step)}
                title={`Step ${point.step}: ${point.opcode}, ${point.cycles} cycles`}
                className={cn(
                  'flex-1 rounded-sm transition-colors',
                  isActive ? 'bg-[#e0b56a]' : 'bg-[#45d1a3]/40 hover:bg-[#45d1a3]/70'
                )}
                style={{ height: barHeight }}
              />
            );
          })}
        </div>
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
