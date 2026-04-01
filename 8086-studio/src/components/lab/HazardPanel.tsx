import { HazardStats } from '@/lab/types';

interface HazardPanelProps {
  stats: HazardStats;
}

export function HazardPanel({ stats }: HazardPanelProps) {
  return (
    <div className="space-y-3">
      <div className="text-xs text-gray-500 uppercase tracking-wider">Pipeline Hazard Lab</div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <Metric label="Data Hazards" value={stats.dataHazards.toString()} />
        <Metric label="Control Hazards" value={stats.controlHazards.toString()} />
        <Metric label="Structural Hazards" value={stats.structuralHazards.toString()} />
        <Metric label="Simulated Stalls" value={stats.simulatedStalls.toString()} />
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
