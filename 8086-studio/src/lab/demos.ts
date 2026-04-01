import { DemoProgram } from '@/lab/types';

export const ASSEMBLY_DEMOS: DemoProgram[] = [
  {
    id: 'sorting',
    title: 'Sorting Demo',
    description: 'Stores three numbers in memory, bubble-sorts them, then outputs sorted values.',
    source: `; Sorting demo: bubble sort three memory words
    MOV AX, 9
    MOV [0100h], AX
    MOV AX, 2
    MOV [0102h], AX
    MOV AX, 5
    MOV [0104h], AX

    MOV CX, 2
OUTER_LOOP:
    MOV SI, 0100h
    MOV DX, 2
INNER_LOOP:
    MOV AX, [SI]
    MOV BX, [SI+2]
    CMP AX, BX
    JLE NO_SWAP
    MOV [SI], BX
    MOV [SI+2], AX
NO_SWAP:
    ADD SI, 2
    DEC DX
    JNZ INNER_LOOP
    DEC CX
    JNZ OUTER_LOOP

    MOV AX, [0100h]
    OUT AX
    MOV AX, [0102h]
    OUT AX
    MOV AX, [0104h]
    OUT AX
    HLT`,
  },
  {
    id: 'calculator',
    title: 'Calculator Demo',
    description: 'Runs ADD, SUB, MUL, DIV, and MOD style arithmetic and prints each result.',
    source: `; Calculator demo
    MOV AX, 50
    MOV BX, 7

    ADD AX, BX
    OUT AX

    SUB AX, 10
    OUT AX

    MUL BX
    OUT AX

    MOV AX, 100
    MOV DX, 0
    DIV BX
    OUT AX

    MOD BX
    OUT AX
    HLT`,
  },
  {
    id: 'memory-test',
    title: 'Memory Test Demo',
    description: 'Writes a pattern to RAM, verifies it, and outputs mismatch count.',
    source: `; Memory test demo
    MOV SI, 0200h
    MOV CX, 8
    MOV AX, 1111h
WRITE_LOOP:
    MOV [SI], AX
    ADD AX, 1111h
    ADD SI, 2
    DEC CX
    JNZ WRITE_LOOP

    MOV SI, 0200h
    MOV CX, 8
    MOV AX, 1111h
    MOV BX, 0
VERIFY_LOOP:
    MOV DX, [SI]
    CMP DX, AX
    JE MATCH
    INC BX
MATCH:
    ADD AX, 1111h
    ADD SI, 2
    DEC CX
    JNZ VERIFY_LOOP

    OUT BX
    HLT`,
  },
  {
    id: 'call-stack',
    title: 'CALL/RET Demo',
    description: 'Demonstrates procedural call stack behavior and return flow.',
    source: `; CALL/RET demo
    MOV AX, 5
    CALL DOUBLE_VALUE
    OUT AX
    HLT

DOUBLE_VALUE:
    ADD AX, AX
    RET`,
  },
  {
    id: 'interrupt-io',
    title: 'Interrupt + I/O Demo',
    description: 'Configures interrupt vector and performs memory-mapped port I/O.',
    source: `; Interrupt + I/O demo
    MOV AX, ISR_1
    MOV [0002h], AX      ; vector table entry for INT 1

    MOV AX, 77
    OUTP 1, AX           ; write to port 1
    IN BX, 1             ; read from port 1
    OUT BX

    INT 1
    OUT AX
    HLT

ISR_1:
    MOV AX, 1234h
    IRET`,
  },
];

export const DEFAULT_DEMO = ASSEMBLY_DEMOS[0];
