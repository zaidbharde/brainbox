// Virtual 8086 CPU Types

export interface Registers {
  AX: number;
  BX: number;
  CX: number;
  DX: number;
  CS: number;
  DS: number;
  ES: number;
  SS: number;
  SI: number;  // Source Index
  DI: number;  // Destination Index
  SP: number;  // Stack Pointer
  BP: number;  // Base Pointer
  IP: number;  // Instruction Pointer
  FLAGS: number;
}

export interface Flags {
  CF: boolean; // Carry Flag
  PF: boolean; // Parity Flag
  AF: boolean; // Auxiliary Carry Flag
  ZF: boolean; // Zero Flag
  SF: boolean; // Sign Flag
  OF: boolean; // Overflow Flag
}

export interface CPUState {
  registers: Registers;
  memory: Uint8Array;
  halted: boolean;
  error: string | null;
}

export interface Instruction {
  opcode: string;
  operands: string[];
  address: number;
  raw: string;
}

export interface AssembledProgram {
  bytecode: number[];
  labels: Map<string, number>;
  initialMemory: Uint8Array;
  instructions: Instruction[];
  errors: CompilerError[];
}

export interface CompilerError {
  line: number;
  message: string;
  type: 'error' | 'warning';
}

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  column: number;
}

export type TokenType = 
  | 'KEYWORD'
  | 'IDENTIFIER'
  | 'NUMBER'
  | 'OPERATOR'
  | 'STRING'
  | 'NEWLINE'
  | 'EOF';

export interface ASTNode {
  type: string;
  line: number;
  children?: ASTNode[];
  value?: string | number;
}

export interface Variable {
  name: string;
  offset: number;
  size: number;
}

export interface SymbolTable {
  variables: Map<string, Variable>;
  nextOffset: number;
}
