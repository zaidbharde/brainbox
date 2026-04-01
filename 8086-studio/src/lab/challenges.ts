import { AssembledProgram, CPUState } from '@/types/cpu';
import { ProgramOutput } from '@/emulator/cpu';

export interface Challenge {
  id: string;
  title: string;
  description: string;
  starter: string;
  validator: (result: { finalState: CPUState; output: ProgramOutput[]; program: AssembledProgram }) => string | null;
}

function getNumericOutputs(output: ProgramOutput[]): number[] {
  return output.filter((item) => item.type === 'number').map((item) => item.value & 0xFFFF);
}

function getLastNumericOutput(output: ProgramOutput[]): number | null {
  const values = getNumericOutputs(output);
  return values.length > 0 ? values[values.length - 1] : null;
}

function readWord(state: CPUState, address: number): number {
  return state.memory[address] | (state.memory[address + 1] << 8);
}

export const CHALLENGES: Challenge[] = [
  {
    id: 'sum1to10',
    title: 'L1: Sum 1..10',
    description: 'Goal: loop use karke 1 se 10 ka sum nikaalo aur 55 output karo. Focus: ADD + DEC + JNZ.',
    starter: `; L1 Challenge: output sum of 1..10 => 55
    MOV AX, 10      ; counter
    MOV BX, 0       ; accumulator
LOOP_SUM:
    ; TODO: BX me AX add karo
    ; TODO: AX decrement karo
    ; TODO: loop repeat until AX == 0
    OUT BX
    HLT`,
    validator: ({ output }) => {
      const last = getLastNumericOutput(output);
      return last === 55 ? null : 'Expected last numeric output = 55.';
    },
  },
  {
    id: 'memoryswap',
    title: 'L2: Swap Memory Words',
    description: 'Goal: [0100h] aur [0102h] ke values swap karo. Focus: MOV with memory operands + temp register.',
    starter: `; L2 Challenge: swap two words in memory
    MOV AX, 3
    MOV [0100h], AX
    MOV AX, 9
    MOV [0102h], AX
    ; TODO: swap values at [0100h] and [0102h]
    HLT`,
    validator: ({ finalState }) => {
      const a = readWord(finalState, 0x0100);
      const b = readWord(finalState, 0x0102);
      return a === 9 && b === 3 ? null : 'Expected [0100h]=9 and [0102h]=3 after swap.';
    },
  },
  {
    id: 'max_of_two',
    title: 'L3: Max of Two',
    description: 'Goal: AX=27 aur BX=41 me se maximum output karo. Focus: CMP + conditional jump.',
    starter: `; L3 Challenge: print max(27, 41) => 41
    MOV AX, 27
    MOV BX, 41
    ; TODO: compare AX and BX
    ; TODO: output maximum value via OUT
    HLT`,
    validator: ({ output }) => {
      const last = getLastNumericOutput(output);
      return last === 41 ? null : 'Expected last numeric output = 41.';
    },
  },
  {
    id: 'count_even_1_to_10',
    title: 'L4: Count Evens 1..10',
    description: 'Goal: 1..10 me kitne even numbers hain, wo output karo (answer 5). Focus: loop + MOD + branch.',
    starter: `; L4 Challenge: count evens from 1..10 => 5
    MOV AX, 1       ; i
    MOV BX, 0       ; even count
LOOP_EVEN:
    ; TODO: if AX % 2 == 0 then BX = BX + 1
    ; TODO: AX = AX + 1
    ; TODO: continue while AX <= 10
    OUT BX
    HLT`,
    validator: ({ output }) => {
      const last = getLastNumericOutput(output);
      return last === 5 ? null : 'Expected last numeric output = 5.';
    },
  },
  {
    id: 'factorial_5',
    title: 'L5: Factorial of 5',
    description: 'Goal: 5! compute karke 120 output karo. Focus: MUL + loop control.',
    starter: `; L5 Challenge: factorial(5) => 120
    MOV AX, 1       ; result
    MOV BX, 5       ; n
LOOP_FACT:
    ; TODO: AX = AX * BX
    ; TODO: BX = BX - 1
    ; TODO: loop until BX == 0
    OUT AX
    HLT`,
    validator: ({ output }) => {
      const last = getLastNumericOutput(output);
      return last === 120 ? null : 'Expected last numeric output = 120.';
    },
  },
  {
    id: 'fibonacci_7th',
    title: 'L6: Fibonacci 7th (0-indexed)',
    description: 'Goal: Fibonacci ka 7th term output karo (13). Focus: multi-register state update.',
    starter: `; L6 Challenge: F(7) with F(0)=0, F(1)=1 => 13
    MOV AX, 0       ; a
    MOV BX, 1       ; b
    MOV CX, 7       ; remaining steps
LOOP_FIB:
    ; TODO: iterate Fibonacci and finally output AX as F(7)
    OUT AX
    HLT`,
    validator: ({ output }) => {
      const last = getLastNumericOutput(output);
      return last === 13 ? null : 'Expected last numeric output = 13.';
    },
  },
  {
    id: 'interrupt_roundtrip',
    title: 'L7: Interrupt Roundtrip',
    description: 'Goal: INT 1 call karke ISR me AX=123 set karo, IRET se return, then output 123.',
    starter: `; L7 Challenge: interrupt roundtrip
    MOV AX, ISR
    MOV [0002h], AX ; vector table entry for INT 1
    INT 1
    OUT AX
    HLT

ISR:
    MOV AX, 123
    IRET`,
    validator: ({ output }) => {
      const last = getLastNumericOutput(output);
      return last === 123 ? null : 'Expected last numeric output = 123 after returning from interrupt.';
    },
  },
  {
    id: 'stack_roundtrip',
    title: 'L8: Stack Roundtrip',
    description: 'Goal: AX=34 aur BX=89 ko PUSH/POP use karke swap karo, then AX output 89 hona chahiye.',
    starter: `; L8 Challenge: swap AX and BX using stack only
    MOV AX, 34
    MOV BX, 89
    ; TODO: use PUSH/POP to swap AX and BX
    OUT AX
    HLT`,
    validator: ({ output, finalState }) => {
      const last = getLastNumericOutput(output);
      if (last !== 89) {
        return 'Expected AX output 89 after swap.';
      }
      if (finalState.registers.BX !== 34) {
        return 'Expected BX = 34 after swap.';
      }
      return null;
    },
  },
];

export function getChallengeById(id: string): Challenge | null {
  return CHALLENGES.find((item) => item.id === id) ?? null;
}
