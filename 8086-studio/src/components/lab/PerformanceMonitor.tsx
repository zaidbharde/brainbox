import { Activity, Gauge, Timer, Waves } from 'lucide-react';
import { PerformanceMetrics } from '@/lab/types';

interface PerformanceMonitorProps {
  metrics: PerformanceMetrics;
}

function formatElapsed(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)} ms`;
  }
  return `${(ms / 1000).toFixed(2)} s`;
}

export function PerformanceMonitor({ metrics }: PerformanceMonitorProps) {
  const avgCycles = metrics.instructionsExecuted === 0
    ? 0
    : metrics.totalCycles / metrics.instructionsExecuted;

  return (
    <div className="space-y-3">
      <MetricRow
        icon={<Activity className="w-4 h-4" />}
        label="Instruction Count"
        value={metrics.instructionsExecuted.toString()}
      />
      <MetricRow
        icon={<Gauge className="w-4 h-4" />}
        label="Cycle Counter"
        value={metrics.totalCycles.toString()}
      />
      <MetricRow
        icon={<Timer className="w-4 h-4" />}
        label="Execution Time"
        value={formatElapsed(metrics.elapsedMs)}
      />
      <MetricRow
        icon={<Waves className="w-4 h-4" />}
        label="Avg Cycles/Instr"
        value={avgCycles.toFixed(2)}
      />

      <div>
        <div className="flex items-center justify-between text-xs mb-1">
          <span className="text-gray-500 uppercase tracking-wider">Simulated CPU Load</span>
          <span className="font-mono text-[#e0b56a]">{metrics.simulatedLoad}%</span>
        </div>
        <div className="h-2 rounded-full bg-[#0d1513] border border-[#1f2b29] overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-[#45d1a3] via-[#e0b56a] to-[#f0b45b] transition-all duration-300"
            style={{ width: `${metrics.simulatedLoad}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function MetricRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-[#1f2b29] bg-[#0f1716] px-3 py-2">
      <div className="flex items-center gap-2">
        <div className="text-[#45d1a3]">{icon}</div>
        <span className="text-xs text-gray-400">{label}</span>
      </div>
      <span className="font-mono text-sm text-white">{value}</span>
    </div>
  );
}
