import { Instruction } from '@/types/cpu';
import { GuidedLearningContent, InstructionInspectorData } from '@/lab/types';

interface TutorialCheckpoint {
  maxStep: number;
  message: string;
}

interface TutorialPlan {
  id: string;
  title: string;
  checkpoints: TutorialCheckpoint[];
}

const TUTORIALS: TutorialPlan[] = [
  {
    id: 'sorting',
    title: 'Sorting Walkthrough',
    checkpoints: [
      { maxStep: 6, message: 'Phase 1: Values are initialized in memory.' },
      { maxStep: 18, message: 'Phase 2: Inner loop compares adjacent values.' },
      { maxStep: 32, message: 'Phase 3: Swaps complete and sorted output is emitted.' },
    ],
  },
  {
    id: 'calculator',
    title: 'Calculator Walkthrough',
    checkpoints: [
      { maxStep: 5, message: 'Phase 1: Setup of operands and first arithmetic operation.' },
      { maxStep: 12, message: 'Phase 2: Sequential arithmetic evaluation and output.' },
    ],
  },
  {
    id: 'memory-test',
    title: 'Memory Test Walkthrough',
    checkpoints: [
      { maxStep: 10, message: 'Phase 1: Pattern write loop populates RAM.' },
      { maxStep: 24, message: 'Phase 2: Verify loop checks each stored word.' },
      { maxStep: 40, message: 'Phase 3: Error count is reported.' },
    ],
  },
];

function resolveTutorialCheckpoint(activeDemoId: string | null, stepNumber: number): string | undefined {
  if (!activeDemoId) {
    return undefined;
  }
  const tutorial = TUTORIALS.find((item) => item.id === activeDemoId);
  if (!tutorial) {
    return undefined;
  }

  const checkpoint = tutorial.checkpoints.find((point) => stepNumber <= point.maxStep)
    ?? tutorial.checkpoints[tutorial.checkpoints.length - 1];
  if (!checkpoint) {
    return undefined;
  }

  return `${tutorial.title}: ${checkpoint.message}`;
}

export function buildGuidedLearningContent(
  instruction: Instruction | null | undefined,
  inspector: InstructionInspectorData | null,
  stepNumber: number,
  activeDemoId: string | null
): GuidedLearningContent {
  if (!instruction || !inspector) {
    return {
      title: 'Guided Mode',
      explanation: 'Select an instruction or step execution to receive contextual explanations.',
      hints: [
        'Use Step Into to inspect how each instruction mutates state.',
        'Compare register and flag highlights to validate your mental model.',
      ],
      tutorialCheckpoint: resolveTutorialCheckpoint(activeDemoId, stepNumber),
    };
  }

  const hints = [
    `Observe ${inspector.opcode}: ${inspector.flagBehavior}`,
    'Watch changed values highlighted in registers, flags, and memory panels.',
    'Use timeline slider to rewind and replay this step.',
  ];

  return {
    title: `${inspector.opcode} Learning Focus`,
    explanation: `${inspector.summary} ${inspector.educationalNote}`,
    hints,
    tutorialCheckpoint: resolveTutorialCheckpoint(activeDemoId, stepNumber),
  };
}
