import { BookOpen } from 'lucide-react';

import {
  ASM_EXAMPLES,
  EXAMPLE_CATEGORIES,
  type AssemblyExample,
  type ExampleCategory,
} from '@/lab/examples';
import { Button } from '@/components/ui/Button';

/**
 * The example library panel.
 *
 * This is the same shape as `DemoLibrary` and deliberately reuses its class
 * strings rather than introducing a look of its own: a panel in this app that
 * looks like a different panel is a bug report waiting to happen, and the point
 * of this one is the grouping and the category blurbs rather than the furniture.
 *
 * The difference from `DemoLibrary` is that this list is organised. `demos.ts` is
 * a flat handful of programs to poke at; this catalog is arranged by category so
 * somebody can start at "Basic programs and output" and work outwards, which is
 * why the categories are rendered as headings and the examples sit underneath
 * them rather than as one long undifferentiated list.
 */

interface ExampleLibraryProps {
  examples?: readonly AssemblyExample[];
  onLoad: (example: AssemblyExample) => void;
  onLoadAndRun: (example: AssemblyExample) => void;
  onLoadAndDebug: (example: AssemblyExample) => void;
}

export function ExampleLibrary({
  examples = ASM_EXAMPLES,
  onLoad,
  onLoadAndRun,
  onLoadAndDebug,
}: ExampleLibraryProps) {
  const byCategory = (category: ExampleCategory): AssemblyExample[] =>
    examples.filter((example) => example.category === category);

  return (
    <div className="space-y-4">
      {EXAMPLE_CATEGORIES.map((category) => {
        const entries = byCategory(category.id);
        if (entries.length === 0) return null;

        return (
          <div key={category.id}>
            <div className="flex items-center gap-2 mb-1">
              <BookOpen className="w-3 h-3 text-gray-500" />
              <h4 className="text-sm font-semibold text-white">{category.label}</h4>
            </div>
            <p className="text-xs text-gray-500 mb-2">{category.blurb}</p>

            <div className="space-y-3">
              {entries.map((example) => (
                <div
                  key={example.id}
                  className="rounded-lg border border-[#1f2b29] bg-[#0f1716] p-3"
                >
                  <h5 className="text-sm font-semibold text-white mb-1">{example.title}</h5>
                  <p className="text-xs text-gray-500 mb-3">{example.description}</p>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" onClick={() => onLoad(example)}>
                      Load
                    </Button>
                    <Button size="sm" variant="success" onClick={() => onLoadAndRun(example)}>
                      Load + Run
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => onLoadAndDebug(example)}>
                      Load + Debug
                    </Button>
                  </div>
                  <div className="mt-2 text-[11px] text-gray-500 font-mono">
                    {example.engines.map((engine) => (engine === 'v2' ? 'v2' : 'legacy')).join(' + ')}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}