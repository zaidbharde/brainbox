// Code Generator - Compiles AST to 8086 Assembly
import { ASTNode, CompilerError, SymbolTable } from '../types/cpu';

interface CodeGenContext {
  output: string[];
  symbols: SymbolTable;
  labelCounter: number;
  errors: CompilerError[];
  stringTable: Map<string, number>;
  nextStringId: number;
}

const VAR_BASE = 0x0100;
const MEMORY_SIZE = 4096;

export function generateCode(ast: ASTNode): { assembly: string; errors: CompilerError[] } {
  const ctx: CodeGenContext = {
    output: [],
    symbols: {
      variables: new Map(),
      nextOffset: 0
    },
    labelCounter: 0,
    errors: [],
    stringTable: new Map(),
    nextStringId: 0
  };

  // Generate header
  ctx.output.push('; Generated 8086 Assembly Code');
  ctx.output.push('; =============================');
  ctx.output.push('');

  // First pass: collect all variables and strings
  collectSymbols(ast, ctx);

  // Generate code for the program
  generateNode(ast, ctx);

  // Add halt instruction
  ctx.output.push('');
  ctx.output.push('    HLT');

  return {
    assembly: ctx.output.join('\n'),
    errors: ctx.errors
  };
}

function collectSymbols(node: ASTNode, ctx: CodeGenContext): void {
  if (node.type === 'VarDecl' || node.type === 'Assignment' || node.type === 'Input') {
    const name = node.value as string;
    if (!ctx.symbols.variables.has(name)) {
      ctx.symbols.variables.set(name, {
        name,
        offset: ctx.symbols.nextOffset,
        size: 2 // 16-bit integers
      });
      ctx.symbols.nextOffset += 2;
      if (VAR_BASE + ctx.symbols.nextOffset >= MEMORY_SIZE - 1) {
        ctx.errors.push({
          line: node.line,
          message: 'Program uses too many variables for available memory',
          type: 'error'
        });
      }
    }
  }

  if (node.type === 'String') {
    const str = node.value as string;
    if (!ctx.stringTable.has(str)) {
      ctx.stringTable.set(str, ctx.nextStringId++);
    }
  }

  if (node.children) {
    for (const child of node.children) {
      collectSymbols(child, ctx);
    }
  }
}

function generateNode(node: ASTNode, ctx: CodeGenContext): void {
  switch (node.type) {
    case 'Program':
      if (node.children) {
        for (const child of node.children) {
          generateNode(child, ctx);
        }
      }
      break;

    case 'Block':
      if (node.children) {
        for (const child of node.children) {
          generateNode(child, ctx);
        }
      }
      break;

    case 'VarDecl':
      emitSourceMarker(node, ctx);
      // Variable declaration with optional initialization
      if (node.children && node.children.length > 0) {
        generateExpression(node.children[0], ctx, 'AX');
        const varName = node.value as string;
        ctx.output.push(`    ; ${varName} = expression`);
        const addr = getVarAddress(varName, ctx);
        ctx.output.push(`    MOV ${formatMem(addr)}, AX`);
      }
      break;

    case 'Assignment':
      emitSourceMarker(node, ctx);
      if (node.children && node.children.length > 0) {
        const varName = node.value as string;
        generateExpression(node.children[0], ctx, 'AX');
        ctx.output.push(`    ; ${varName} = expression`);
        const addr = getVarAddress(varName, ctx);
        ctx.output.push(`    MOV ${formatMem(addr)}, AX`);
      }
      break;

    case 'If':
      emitSourceMarker(node, ctx);
      generateIf(node, ctx);
      break;

    case 'While':
      emitSourceMarker(node, ctx);
      generateWhile(node, ctx);
      break;

    case 'For':
      emitSourceMarker(node, ctx);
      generateFor(node, ctx);
      break;

    case 'Print':
      emitSourceMarker(node, ctx);
      if (node.children && node.children.length > 0) {
        const child = node.children[0];
        if (child.type === 'String') {
          // String printing - output each character code
          const str = child.value as string;
          ctx.output.push(`    ; Print string: "${str}"`);
          for (let i = 0; i < str.length; i++) {
            ctx.output.push(`    MOV AX, ${str.charCodeAt(i)}`);
            ctx.output.push('    OUTC AX  ; Print char');
          }
        } else {
          generateExpression(child, ctx, 'AX');
          ctx.output.push('    OUT AX  ; Print value');
        }
      }
      break;

    case 'Input':
      emitSourceMarker(node, ctx);
      // Input not fully implemented in virtual CPU
      ctx.output.push(`    ; Input ${node.value} (simulated)`);
      break;

    default:
      ctx.errors.push({
        line: node.line,
        message: `Unknown node type: ${node.type}`,
        type: 'error'
      });
  }
}

function emitSourceMarker(node: ASTNode, ctx: CodeGenContext): void {
  if (node.line <= 0) {
    return;
  }
  // Embedded mapping label for source <-> assembly/runtime navigation.
  ctx.output.push(`_SRC_${node.line}_${ctx.labelCounter++}:`);
}

function generateIf(node: ASTNode, ctx: CodeGenContext): void {
  if (!node.children || node.children.length < 2) {
    ctx.errors.push({
      line: node.line,
      message: 'Invalid if statement structure',
      type: 'error'
    });
    return;
  }

  const condition = node.children[0];
  const ifBody = node.children[1];
  const elseBody = node.children.length > 2 ? node.children[2] : null;
  
  const elseLabel = `_else_${ctx.labelCounter}`;
  const endLabel = `_endif_${ctx.labelCounter}`;
  ctx.labelCounter++;

  ctx.output.push('');
  ctx.output.push('    ; if condition');

  // Generate comparison
  generateCondition(condition, ctx, elseBody ? elseLabel : endLabel);

  // Generate if body
  ctx.output.push('    ; if body');
  generateNode(ifBody, ctx);

  if (elseBody) {
    ctx.output.push(`    JMP ${endLabel}`);
    ctx.output.push(`${elseLabel}:`);
    ctx.output.push('    ; else body');
    generateNode(elseBody, ctx);
  }

  ctx.output.push(`${endLabel}:`);
  ctx.output.push('    NOP');
}

function generateCondition(condition: ASTNode, ctx: CodeGenContext, falseLabel: string): void {
  if (condition.type === 'BinaryOp' && condition.children) {
    const left = condition.children[0];
    const right = condition.children[1];
    const op = condition.value as string;

    // Handle logical operators
    if (op === 'and') {
      generateCondition(left, ctx, falseLabel);
      generateCondition(right, ctx, falseLabel);
      return;
    }

    if (op === 'or') {
      const nextLabel = `_or_${ctx.labelCounter++}`;
      generateConditionTrue(left, ctx, nextLabel);
      generateCondition(right, ctx, falseLabel);
      ctx.output.push(`${nextLabel}:`);
      return;
    }

    // Comparison operators
    generateExpression(left, ctx, 'AX');
    ctx.output.push('    PUSH AX  ; save left operand');
    generateExpression(right, ctx, 'BX');
    ctx.output.push('    POP AX   ; restore left operand');
    ctx.output.push('    CMP AX, BX');

    // Generate appropriate jump
    switch (op) {
      case '<':
        ctx.output.push(`    JGE ${falseLabel}`);
        break;
      case '>':
        ctx.output.push(`    JLE ${falseLabel}`);
        break;
      case '<=':
        ctx.output.push(`    JG ${falseLabel}`);
        break;
      case '>=':
        ctx.output.push(`    JL ${falseLabel}`);
        break;
      case '==':
        ctx.output.push(`    JNE ${falseLabel}`);
        break;
      case '!=':
        ctx.output.push(`    JE ${falseLabel}`);
        break;
    }
  } else {
    // Boolean expression (non-zero = true)
    generateExpression(condition, ctx, 'AX');
    ctx.output.push('    CMP AX, 0');
    ctx.output.push(`    JE ${falseLabel}`);
  }
}

function generateConditionTrue(condition: ASTNode, ctx: CodeGenContext, trueLabel: string): void {
  if (condition.type === 'BinaryOp' && condition.children) {
    const left = condition.children[0];
    const right = condition.children[1];
    const op = condition.value as string;

    generateExpression(left, ctx, 'AX');
    ctx.output.push('    PUSH AX');
    generateExpression(right, ctx, 'BX');
    ctx.output.push('    POP AX');
    ctx.output.push('    CMP AX, BX');

    switch (op) {
      case '<':
        ctx.output.push(`    JL ${trueLabel}`);
        break;
      case '>':
        ctx.output.push(`    JG ${trueLabel}`);
        break;
      case '<=':
        ctx.output.push(`    JLE ${trueLabel}`);
        break;
      case '>=':
        ctx.output.push(`    JGE ${trueLabel}`);
        break;
      case '==':
        ctx.output.push(`    JE ${trueLabel}`);
        break;
      case '!=':
        ctx.output.push(`    JNE ${trueLabel}`);
        break;
    }
  } else {
    generateExpression(condition, ctx, 'AX');
    ctx.output.push('    CMP AX, 0');
    ctx.output.push(`    JNE ${trueLabel}`);
  }
}

function generateWhile(node: ASTNode, ctx: CodeGenContext): void {
  if (!node.children || node.children.length < 2) {
    ctx.errors.push({
      line: node.line,
      message: 'Invalid while statement structure',
      type: 'error'
    });
    return;
  }

  const condition = node.children[0];
  const body = node.children[1];
  const startLabel = `_while_${ctx.labelCounter}`;
  const endLabel = `_endwhile_${ctx.labelCounter}`;
  ctx.labelCounter++;

  ctx.output.push('');
  ctx.output.push(`${startLabel}:`);
  ctx.output.push('    ; while condition');

  // Generate condition check
  generateCondition(condition, ctx, endLabel);

  // Generate body
  ctx.output.push('    ; while body');
  generateNode(body, ctx);

  ctx.output.push(`    JMP ${startLabel}`);
  ctx.output.push(`${endLabel}:`);
  ctx.output.push('    NOP');
}

function generateFor(node: ASTNode, ctx: CodeGenContext): void {
  if (!node.children || node.children.length < 4) {
    ctx.errors.push({
      line: node.line,
      message: 'Invalid for statement structure',
      type: 'error'
    });
    return;
  }

  const varName = node.value as string;
  const startVal = node.children[0];
  const endVal = node.children[1];
  const stepVal = node.children[2];
  const body = node.children[3];
  const addr = getVarAddress(varName, ctx);
  const stepIsNegative = stepVal.type === 'Number' && typeof stepVal.value === 'number' && stepVal.value < 0;
  const endJump = stepIsNegative ? 'JL' : 'JG';

  const startLabel = `_for_${ctx.labelCounter}`;
  const endLabel = `_endfor_${ctx.labelCounter}`;
  ctx.labelCounter++;

  // Initialize counter
  ctx.output.push('');
  ctx.output.push(`    ; for ${varName} = start to end`);
  generateExpression(startVal, ctx, 'AX');
  ctx.output.push(`    MOV ${formatMem(addr)}, AX`);

  ctx.output.push(`${startLabel}:`);
  
  // Check condition
  ctx.output.push('    ; check for loop end');
  generateExpression(endVal, ctx, 'AX');
  ctx.output.push(`    MOV BX, ${formatMem(addr)}`);
  ctx.output.push(`    CMP BX, AX`);
  ctx.output.push(`    ${endJump} ${endLabel}`);

  // Generate body
  ctx.output.push('    ; for body');
  generateNode(body, ctx);

  // Increment
  if (stepVal.type === 'Number' && stepVal.value === 1) {
    ctx.output.push(`    MOV AX, ${formatMem(addr)}`);
    ctx.output.push(`    INC AX`);
    ctx.output.push(`    MOV ${formatMem(addr)}, AX`);
  } else {
    generateExpression(stepVal, ctx, 'AX');
    ctx.output.push(`    MOV BX, AX`);
    ctx.output.push(`    MOV AX, ${formatMem(addr)}`);
    ctx.output.push(`    ADD AX, BX`);
    ctx.output.push(`    MOV ${formatMem(addr)}, AX`);
  }

  ctx.output.push(`    JMP ${startLabel}`);
  ctx.output.push(`${endLabel}:`);
  ctx.output.push('    NOP');
}

function generateExpression(node: ASTNode, ctx: CodeGenContext, targetReg: string): void {
  switch (node.type) {
    case 'Number':
      ctx.output.push(`    MOV ${targetReg}, ${node.value}`);
      break;

    case 'Identifier':
      {
        const varName = node.value as string;
        const addr = getVarAddress(varName, ctx);
        ctx.output.push(`    MOV ${targetReg}, ${formatMem(addr)}`);
      }
      break;

    case 'UnaryOp':
      if (node.children && node.children.length > 0) {
        generateExpression(node.children[0], ctx, targetReg);
        const op = node.value as string;
        if (op === '-') {
          ctx.output.push(`    NEG ${targetReg}`);
        } else if (op === 'not') {
          ctx.output.push(`    CMP ${targetReg}, 0`);
          ctx.output.push(`    MOV ${targetReg}, 0`);
          ctx.output.push(`    JNE _notnot_${ctx.labelCounter}`);
          ctx.output.push(`    MOV ${targetReg}, 1`);
          ctx.output.push(`_notnot_${ctx.labelCounter++}:`);
        }
      }
      break;

    case 'BinaryOp':
      if (!node.children || node.children.length !== 2) {
        ctx.errors.push({
          line: node.line,
          message: 'Invalid binary operation',
          type: 'error'
        });
        return;
      }

      const left = node.children[0];
      const right = node.children[1];
      const op = node.value as string;

      // Generate left operand
      generateExpression(left, ctx, 'AX');
      
      // Push left operand onto stack to save it
      ctx.output.push('    PUSH AX  ; save left operand');
      
      // Generate right operand into AX
      generateExpression(right, ctx, 'AX');
      
      // Move right operand to BX, restore left to AX
      ctx.output.push('    MOV BX, AX  ; right operand');
      ctx.output.push('    POP AX      ; restore left operand');

      switch (op) {
        case '+':
          ctx.output.push('    ADD AX, BX');
          break;
        case '-':
          ctx.output.push('    SUB AX, BX');
          break;
        case '*':
          ctx.output.push('    MUL BX');
          break;
        case '/':
          ctx.output.push('    MOV DX, 0');
          ctx.output.push('    DIV BX');
          break;
        case '%':
          ctx.output.push('    MOV DX, 0');
          ctx.output.push('    MOD BX');
          break;
        case 'and':
          ctx.output.push('    AND AX, BX');
          break;
        case 'or':
          ctx.output.push('    OR AX, BX');
          break;
        // Comparison operators - result is 0 or 1
        case '<':
        case '>':
        case '<=':
        case '>=':
        case '==':
        case '!=':
          ctx.output.push('    CMP AX, BX');
          const trueLabel = `_cmp_true_${ctx.labelCounter}`;
          const endLabel = `_cmp_end_${ctx.labelCounter}`;
          ctx.labelCounter++;
          
          switch (op) {
            case '<': ctx.output.push(`    JL ${trueLabel}`); break;
            case '>': ctx.output.push(`    JG ${trueLabel}`); break;
            case '<=': ctx.output.push(`    JLE ${trueLabel}`); break;
            case '>=': ctx.output.push(`    JGE ${trueLabel}`); break;
            case '==': ctx.output.push(`    JE ${trueLabel}`); break;
            case '!=': ctx.output.push(`    JNE ${trueLabel}`); break;
          }
          ctx.output.push('    MOV AX, 0');
          ctx.output.push(`    JMP ${endLabel}`);
          ctx.output.push(`${trueLabel}:`);
          ctx.output.push('    MOV AX, 1');
          ctx.output.push(`${endLabel}:`);
          break;
      }

      if (targetReg !== 'AX') {
        ctx.output.push(`    MOV ${targetReg}, AX`);
      }
      break;

    default:
      ctx.errors.push({
        line: node.line,
        message: `Cannot generate expression for: ${node.type}`,
        type: 'error'
      });
  }
}

function getVarAddress(name: string, ctx: CodeGenContext): number {
  const variable = ctx.symbols.variables.get(name);
  if (!variable) {
    ctx.errors.push({
      line: 0,
      message: `Undefined variable: ${name}`,
      type: 'error'
    });
    return VAR_BASE;
  }
  return VAR_BASE + variable.offset;
}

function formatHexWord(value: number): string {
  return `0x${value.toString(16).toUpperCase().padStart(4, '0')}`;
}

function formatMem(address: number): string {
  return `[${formatHexWord(address)}]`;
}

// Reset codegen state for new compilation (kept for API compatibility)
export function resetCodeGen(): void {
  // No global state to reset with memory-backed variables.
}
