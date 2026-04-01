import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { PipelineState } from '@/lab/types';
import { cn } from '@/utils/cn';

const STAGES = [
  { id: 'fetch', label: 'Fetch', description: 'Read instruction from memory at IP' },
  { id: 'decode', label: 'Decode', description: 'Interpret opcode and operands' },
  { id: 'execute', label: 'Execute', description: 'Apply state updates to CPU' },
] as const;

interface InstructionPipelineProps {
  pipeline: PipelineState;
  instructionText: string;
}

export function InstructionPipeline({ pipeline, instructionText }: InstructionPipelineProps) {
  const activeIndex = STAGES.findIndex((stage) => stage.id === pipeline.stage);

  return (
    <div className="space-y-3">
      <div className="text-xs text-gray-500">
        <span className="uppercase tracking-wider">Pipeline Feed</span>
        <span className="ml-2 font-mono text-gray-300">{instructionText || 'Idle'}</span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {STAGES.map((stage, index) => {
          const isActive = index === activeIndex;
          const wasCompleted = activeIndex > index;

          return (
            <div key={stage.id} className="relative">
              <motion.div
                animate={{
                  borderColor: isActive ? 'rgba(69, 209, 163, 0.7)' : wasCompleted ? 'rgba(224, 181, 106, 0.55)' : 'rgba(31, 43, 41, 1)',
                  backgroundColor: isActive ? 'rgba(69, 209, 163, 0.12)' : 'rgba(15, 23, 22, 1)',
                }}
                className="rounded-lg border px-3 py-2 h-full"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-gray-300">{stage.label}</span>
                  <motion.span
                    key={`${pipeline.tick}-${stage.id}-${isActive ? 'active' : 'idle'}`}
                    animate={{ scale: isActive ? [1, 1.2, 1] : 1 }}
                    transition={{ duration: 0.35 }}
                    className={cn(
                      'w-2 h-2 rounded-full',
                      isActive ? 'bg-[#45d1a3]' : wasCompleted ? 'bg-[#e0b56a]' : 'bg-[#2b3b37]'
                    )}
                  />
                </div>
                <p className="text-[11px] text-gray-500 leading-relaxed">{stage.description}</p>
              </motion.div>
              {index < STAGES.length - 1 && (
                <ArrowRight className="absolute -right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#2f4340] z-10" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
