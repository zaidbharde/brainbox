import { Lightbulb, GraduationCap } from 'lucide-react';
import { GuidedLearningContent } from '@/lab/types';

interface GuidedLearningPanelProps {
  enabled: boolean;
  content: GuidedLearningContent;
  onToggle: (enabled: boolean) => void;
}

export function GuidedLearningPanel({
  enabled,
  content,
  onToggle,
}: GuidedLearningPanelProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GraduationCap className="w-4 h-4 text-[#45d1a3]" />
          <span className="text-xs text-gray-500 uppercase tracking-wider">Guided Learning</span>
        </div>
        <button
          type="button"
          onClick={() => onToggle(!enabled)}
          className="text-xs px-2 py-1 rounded border border-[#1f2b29] bg-[#0f1716] text-gray-300 hover:border-[#45d1a3]/50"
        >
          {enabled ? 'On' : 'Off'}
        </button>
      </div>

      {enabled ? (
        <div className="rounded-lg border border-[#1f2b29] bg-[#0f1716] p-3 space-y-3">
          <div>
            <div className="text-sm font-semibold text-white">{content.title}</div>
            <div className="text-xs text-gray-400 mt-1">{content.explanation}</div>
          </div>
          <div>
            <div className="text-[11px] text-gray-500 uppercase tracking-wider mb-1">Hints</div>
            <div className="space-y-1">
              {content.hints.map((hint, index) => (
                <div key={`${hint}-${index}`} className="flex items-start gap-2 text-xs text-[#7adfb1]">
                  <Lightbulb className="w-3.5 h-3.5 mt-0.5" />
                  <span>{hint}</span>
                </div>
              ))}
            </div>
          </div>
          {content.symbolicHints && content.symbolicHints.length > 0 && (
            <div>
              <div className="text-[11px] text-gray-500 uppercase tracking-wider mb-1">Symbolic Hints</div>
              <div className="space-y-1">
                {content.symbolicHints.map((hint, index) => (
                  <div key={`${hint}-${index}`} className="text-xs text-[#e0b56a]">
                    {hint}
                  </div>
                ))}
              </div>
            </div>
          )}
          {content.tutorialCheckpoint && (
            <div className="text-xs text-[#e0b56a] border border-[#e0b56a]/25 bg-[#e0b56a]/10 rounded px-2 py-1">
              {content.tutorialCheckpoint}
            </div>
          )}
        </div>
      ) : (
        <div className="text-xs text-gray-500">Enable guided mode for step-level explanations and hints.</div>
      )}
    </div>
  );
}
