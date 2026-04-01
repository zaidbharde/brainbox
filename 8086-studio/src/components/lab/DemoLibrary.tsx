import { DemoProgram } from '@/lab/types';
import { Button } from '@/components/ui/Button';

interface DemoLibraryProps {
  demos: DemoProgram[];
  onLoad: (demo: DemoProgram) => void;
  onLoadAndRun: (demo: DemoProgram) => void;
  onLoadAndDebug: (demo: DemoProgram) => void;
}

export function DemoLibrary({
  demos,
  onLoad,
  onLoadAndRun,
  onLoadAndDebug,
}: DemoLibraryProps) {
  return (
    <div className="space-y-3">
      {demos.map((demo) => (
        <div key={demo.id} className="rounded-lg border border-[#1f2b29] bg-[#0f1716] p-3">
          <h4 className="text-sm font-semibold text-white mb-1">{demo.title}</h4>
          <p className="text-xs text-gray-500 mb-3">{demo.description}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => onLoad(demo)}>
              Load
            </Button>
            <Button size="sm" variant="success" onClick={() => onLoadAndRun(demo)}>
              Load + Run
            </Button>
            <Button size="sm" variant="secondary" onClick={() => onLoadAndDebug(demo)}>
              Load + Debug
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
