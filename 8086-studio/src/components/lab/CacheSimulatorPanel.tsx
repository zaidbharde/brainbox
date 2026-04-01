import { CacheConfig, CachePolicy, CacheStats } from '@/lab/types';

interface CacheSimulatorPanelProps {
  config: CacheConfig;
  stats: CacheStats;
  onConfigChange: (config: CacheConfig) => void;
}

export function CacheSimulatorPanel({ config, stats, onConfigChange }: CacheSimulatorPanelProps) {
  const setPolicy = (policy: CachePolicy) => {
    onConfigChange({ ...config, policy });
  };

  const setLineCount = (lineCount: number) => {
    onConfigChange({ ...config, lineCount: Math.max(2, lineCount) });
  };

  const setLineSize = (lineSizeBytes: number) => {
    onConfigChange({ ...config, lineSizeBytes: Math.max(2, lineSizeBytes) });
  };

  return (
    <div className="space-y-3">
      <div className="text-xs text-gray-500 uppercase tracking-wider">Cache Simulator</div>
      <div className="grid grid-cols-1 gap-2">
        <select
          value={config.policy}
          onChange={(event) => setPolicy(event.target.value as CachePolicy)}
          className="bg-[#0f1716] border border-[#1f2b29] rounded px-2 py-1.5 text-xs text-gray-200"
        >
          <option value="direct_mapped">Direct Mapped</option>
          <option value="set_associative_2way">2-Way Set Associative</option>
        </select>
        <div className="grid grid-cols-2 gap-2">
          <input
            type="number"
            min={2}
            value={config.lineCount}
            onChange={(event) => setLineCount(parseInt(event.target.value, 10) || 2)}
            className="bg-[#0f1716] border border-[#1f2b29] rounded px-2 py-1.5 text-xs text-gray-200"
            placeholder="Lines"
          />
          <input
            type="number"
            min={2}
            value={config.lineSizeBytes}
            onChange={(event) => setLineSize(parseInt(event.target.value, 10) || 2)}
            className="bg-[#0f1716] border border-[#1f2b29] rounded px-2 py-1.5 text-xs text-gray-200"
            placeholder="Line size"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <Metric label="Accesses" value={stats.accesses.toString()} />
        <Metric label="Hit Rate" value={`${stats.hitRate.toFixed(1)}%`} />
        <Metric label="Hits" value={stats.hits.toString()} />
        <Metric label="Misses" value={stats.misses.toString()} />
      </div>
      <div className="text-[11px] text-gray-500">
        Miss breakdown: read {stats.missesByType.read}, write {stats.missesByType.write}
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
