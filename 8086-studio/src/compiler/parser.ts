// High-Level Language Parser
import { Token, ASTNode, CompilerError } from '../types/cpu';

export interface ParseResult {
  ast: ASTNode | null;
  errors: CompilerError[];
}

class Parser {
  private tokens: Token[];
  private pos: number = 0;
  private errors: CompilerError[] = [];

  constructor(tokens: Token[]) {
    this.tokens = tokens.filter(t => t.type !== 'NEWLINE');
  }

  private current(): Token {
    return this.tokens[this.pos] || { type: 'EOF', value: '', line: 0, column: 0 };
  }

  private advance(): Token {
    const token = this.current();
    if (this.pos < this.tokens.length) this.pos++;
    return token;
  }

  private skipNewlines(): void {
    while (this.current().type === 'NEWLINE') {
      this.advance();
    }
  }

  parse(): ParseResult {
    const ast = this.parseProgram();
    return { ast, errors: this.errors };
  }

  private parseProgram(): ASTNode {
    const node: ASTNode = {
      type: 'Program',
      line: this.current().line,
      children: []
    };

    // Optional 'program' declaration - not required!
    if (this.current().value === 'program') {
      this.advance();
      if (this.current().type === 'IDENTIFIER') {
        node.value = this.advance().value;
      }
    }

    this.skipNewlines();

    // Parse statements
    while (this.current().type !== 'EOF') {
      this.skipNewlines();
      if (this.current().type === 'EOF') break;

      const stmt = this.parseStatement();
      if (stmt) {
        node.children!.push(stmt);
      } else {
        // Error recovery: skip to next line
        while (this.current().type !== 'NEWLINE' && this.current().type !== 'EOF') {
          this.advance();
        }
      }
      this.skipNewlines();
    }

    return node;
  }

  private parseStatement(): ASTNode | null {
    const token = this.current();

    switch (token.value) {
      case 'if':
        return this.parseIf();
      case 'while':
        return this.parseWhile();
      case 'for':
        return this.parseFor();
      case 'print':
        return this.parsePrint();
      case 'input':
        return this.parseInput();
      case 'var':
        return this.parseVarDecl();
      case 'end':
      case 'else':
        // End of a block - handle in parent
        return null;
      default:
        // Assignment or expression
        if (token.type === 'IDENTIFIER') {
          return this.parseAssignment();
        }
        this.errors.push({
          line: token.line,
          message: `Unexpected token: ${token.value}`,
          type: 'error'
        });
        return null;
    }
  }

  private parseAssignment(): ASTNode {
    const identifier = this.advance();
    const node: ASTNode = {
      type: 'Assignment',
      line: identifier.line,
      value: identifier.value,
      children: []
    };

    if (this.current().value !== '=') {
      this.errors.push({
        line: this.current().line,
        message: `Expected '=' after identifier '${identifier.value}'`,
        type: 'error'
      });
      return node;
    }
    this.advance(); // consume '='

    const expr = this.parseExpression();
    if (expr) {
      node.children!.push(expr);
    }

    return node;
  }

  private parseIf(): ASTNode {
    const ifToken = this.advance(); // consume 'if'
    const node: ASTNode = {
      type: 'If',
      line: ifToken.line,
      children: []
    };

    // Parse condition
    const condition = this.parseExpression();
    if (condition) {
      node.children!.push(condition);
    }

    // Optional 'then'
    if (this.current().value === 'then') {
      this.advance();
    }

    this.skipNewlines();

    // Parse if body
    const ifBody: ASTNode = {
      type: 'Block',
      line: this.current().line,
      children: []
    };

    while (this.current().type !== 'EOF' && this.current().value !== 'end' && this.current().value !== 'else') {
      this.skipNewlines();
      if (this.current().value === 'end' || this.current().value === 'else') break;

      const stmt = this.parseStatement();
      if (stmt) {
        ifBody.children!.push(stmt);
      } else if (this.current().value !== 'end' && this.current().value !== 'else') {
        this.advance(); // Skip problematic token
      }
      this.skipNewlines();
    }

    node.children!.push(ifBody);

    // Check for else
    if (this.current().value === 'else') {
      this.advance(); // consume 'else'
      this.skipNewlines();

      const elseBody: ASTNode = {
        type: 'Block',
        line: this.current().line,
        children: []
      };

      while (this.current().type !== 'EOF' && this.current().value !== 'end') {
        this.skipNewlines();
        if (this.current().value === 'end') break;

        const stmt = this.parseStatement();
        if (stmt) {
          elseBody.children!.push(stmt);
        } else if (this.current().value !== 'end') {
          this.advance();
        }
        this.skipNewlines();
      }

      node.children!.push(elseBody);
    }

    // Consume 'end'
    if (this.current().value === 'end') {
      this.advance();
    } else {
      this.errors.push({
        line: this.current().line,
        message: "Expected 'end' to close 'if' block",
        type: 'error'
      });
    }

    return node;
  }

  private parseWhile(): ASTNode {
    const whileToken = this.advance(); // consume 'while'
    const node: ASTNode = {
      type: 'While',
      line: whileToken.line,
      children: []
    };

    // Parse condition
    const condition = this.parseExpression();
    if (condition) {
      node.children!.push(condition);
    }

    // Optional 'do'
    if (this.current().value === 'do') {
      this.advance();
    }

    this.skipNewlines();

    // Parse body
    const body: ASTNode = {
      type: 'Block',
      line: this.current().line,
      children: []
    };

    while (this.current().type !== 'EOF' && this.current().value !== 'end') {
      this.skipNewlines();
      if (this.current().value === 'end') break;

      const stmt = this.parseStatement();
      if (stmt) {
        body.children!.push(stmt);
      } else if (this.current().value !== 'end') {
        this.advance();
      }
      this.skipNewlines();
    }

    node.children!.push(body);

    // Consume 'end'
    if (this.current().value === 'end') {
      this.advance();
    } else {
      this.errors.push({
        line: this.current().line,
        message: "Expected 'end' to close 'while' block",
        type: 'error'
      });
    }

    return node;
  }

  private parseFor(): ASTNode {
    const forToken = this.advance(); // consume 'for'
    const node: ASTNode = {
      type: 'For',
      line: forToken.line,
      children: []
    };

    // Parse variable
    if (this.current().type !== 'IDENTIFIER') {
      this.errors.push({
        line: this.current().line,
        message: "Expected variable name after 'for'",
        type: 'error'
      });
      return node;
    }
    node.value = this.advance().value;

    // Expect '='
    if (this.current().value !== '=') {
      this.errors.push({
        line: this.current().line,
        message: "Expected '=' in for loop",
        type: 'error'
      });
      return node;
    }
    this.advance();

    // Parse start value
    const startVal = this.parseExpression();
    if (startVal) node.children!.push(startVal);

    // Expect 'to'
    if (this.current().value !== 'to') {
      this.errors.push({
        line: this.current().line,
        message: "Expected 'to' in for loop",
        type: 'error'
      });
      return node;
    }
    this.advance();

    // Parse end value
    const endVal = this.parseExpression();
    if (endVal) node.children!.push(endVal);

    // Optional 'step'
    let stepVal: ASTNode = { type: 'Number', line: this.current().line, value: 1 };
    if (this.current().value === 'step') {
      this.advance();
      const s = this.parseExpression();
      if (s) stepVal = s;
    }
    node.children!.push(stepVal);

    this.skipNewlines();

    // Parse body
    const body: ASTNode = {
      type: 'Block',
      line: this.current().line,
      children: []
    };

    while (this.current().type !== 'EOF' && this.current().value !== 'end') {
      this.skipNewlines();
      if (this.current().value === 'end') break;

      const stmt = this.parseStatement();
      if (stmt) {
        body.children!.push(stmt);
      } else if (this.current().value !== 'end') {
        this.advance();
      }
      this.skipNewlines();
    }

    node.children!.push(body);

    // Consume 'end'
    if (this.current().value === 'end') {
      this.advance();
    } else {
      this.errors.push({
        line: this.current().line,
        message: "Expected 'end' to close 'for' block",
        type: 'error'
      });
    }

    return node;
  }

  private parsePrint(): ASTNode {
    const printToken = this.advance(); // consume 'print'
    const node: ASTNode = {
      type: 'Print',
      line: printToken.line,
      children: []
    };

    // Check for string literal
    if (this.current().type === 'STRING') {
      const strToken = this.advance();
      node.children!.push({
        type: 'String',
        line: strToken.line,
        value: strToken.value
      });
    } else {
      const expr = this.parseExpression();
      if (expr) {
        node.children!.push(expr);
      }
    }

    return node;
  }

  private parseInput(): ASTNode {
    const inputToken = this.advance(); // consume 'input'
    const node: ASTNode = {
      type: 'Input',
      line: inputToken.line,
      children: []
    };

    if (this.current().type === 'IDENTIFIER') {
      node.value = this.advance().value;
    } else {
      this.errors.push({
        line: this.current().line,
        message: "Expected variable name after 'input'",
        type: 'error'
      });
    }

    return node;
  }

  private parseVarDecl(): ASTNode {
    const varToken = this.advance(); // consume 'var'
    const node: ASTNode = {
      type: 'VarDecl',
      line: varToken.line,
      children: []
    };

    if (this.current().type === 'IDENTIFIER') {
      node.value = this.advance().value;
    } else {
      this.errors.push({
        line: this.current().line,
        message: "Expected variable name after 'var'",
        type: 'error'
      });
    }

    // Optional initialization
    if (this.current().value === '=') {
      this.advance();
      const expr = this.parseExpression();
      if (expr) {
        node.children!.push(expr);
      }
    }

    return node;
  }

  private parseExpression(): ASTNode | null {
    return this.parseOr();
  }

  private parseOr(): ASTNode | null {
    let left = this.parseAnd();
    if (!left) return null;

    while (this.current().value === 'or') {
      const op = this.advance();
      const right = this.parseAnd();
      if (!right) {
        this.errors.push({
          line: op.line,
          message: `Expected expression after 'or'`,
          type: 'error'
        });
        return left;
      }
      left = {
        type: 'BinaryOp',
        line: op.line,
        value: 'or',
        children: [left, right]
      };
    }

    return left;
  }

  private parseAnd(): ASTNode | null {
    let left = this.parseComparison();
    if (!left) return null;

    while (this.current().value === 'and') {
      const op = this.advance();
      const right = this.parseComparison();
      if (!right) {
        this.errors.push({
          line: op.line,
          message: `Expected expression after 'and'`,
          type: 'error'
        });
        return left;
      }
      left = {
        type: 'BinaryOp',
        line: op.line,
        value: 'and',
        children: [left, right]
      };
    }

    return left;
  }

  private parseComparison(): ASTNode | null {
    let left = this.parseAddSub();
    if (!left) return null;

    const compOps = ['<', '>', '<=', '>=', '==', '!='];
    while (compOps.includes(this.current().value)) {
      const op = this.advance();
      const right = this.parseAddSub();
      if (!right) {
        this.errors.push({
          line: op.line,
          message: `Expected expression after '${op.value}'`,
          type: 'error'
        });
        return left;
      }
      left = {
        type: 'BinaryOp',
        line: op.line,
        value: op.value,
        children: [left, right]
      };
    }

    return left;
  }

  private parseAddSub(): ASTNode | null {
    let left = this.parseMulDiv();
    if (!left) return null;

    while (this.current().value === '+' || this.current().value === '-') {
      const op = this.advance();
      const right = this.parseMulDiv();
      if (!right) {
        this.errors.push({
          line: op.line,
          message: `Expected expression after '${op.value}'`,
          type: 'error'
        });
        return left;
      }
      left = {
        type: 'BinaryOp',
        line: op.line,
        value: op.value,
        children: [left, right]
      };
    }

    return left;
  }

  private parseMulDiv(): ASTNode | null {
    let left = this.parseUnary();
    if (!left) return null;

    while (this.current().value === '*' || this.current().value === '/' || this.current().value === '%') {
      const op = this.advance();
      const right = this.parseUnary();
      if (!right) {
        this.errors.push({
          line: op.line,
          message: `Expected expression after '${op.value}'`,
          type: 'error'
        });
        return left;
      }
      left = {
        type: 'BinaryOp',
        line: op.line,
        value: op.value,
        children: [left, right]
      };
    }

    return left;
  }

  private parseUnary(): ASTNode | null {
    if (this.current().value === '-') {
      const op = this.advance();
      const operand = this.parsePrimary();
      if (!operand) {
        this.errors.push({
          line: op.line,
          message: "Expected expression after '-'",
          type: 'error'
        });
        return null;
      }
      return {
        type: 'UnaryOp',
        line: op.line,
        value: '-',
        children: [operand]
      };
    }

    if (this.current().value === 'not') {
      const op = this.advance();
      const operand = this.parsePrimary();
      if (!operand) {
        this.errors.push({
          line: op.line,
          message: "Expected expression after 'not'",
          type: 'error'
        });
        return null;
      }
      return {
        type: 'UnaryOp',
        line: op.line,
        value: 'not',
        children: [operand]
      };
    }

    return this.parsePrimary();
  }

  private parsePrimary(): ASTNode | null {
    const token = this.current();

    if (token.type === 'NUMBER') {
      this.advance();
      return {
        type: 'Number',
        line: token.line,
        value: parseNumberLiteral(token.value)
      };
    }

    if (token.type === 'STRING') {
      this.advance();
      return {
        type: 'String',
        line: token.line,
        value: token.value
      };
    }

    if (token.value === 'true') {
      this.advance();
      return {
        type: 'Number',
        line: token.line,
        value: 1
      };
    }

    if (token.value === 'false') {
      this.advance();
      return {
        type: 'Number',
        line: token.line,
        value: 0
      };
    }

    if (token.type === 'IDENTIFIER') {
      this.advance();
      return {
        type: 'Identifier',
        line: token.line,
        value: token.value
      };
    }

    if (token.value === '(') {
      this.advance(); // consume '('
      const expr = this.parseExpression();
      if (this.current().value !== ')') {
        this.errors.push({
          line: this.current().line,
          message: "Expected ')' to close parenthesized expression",
          type: 'error'
        });
      } else {
        this.advance(); // consume ')'
      }
      return expr;
    }

    if (token.type === 'EOF' || token.value === 'end' || token.value === 'then' || token.value === 'do' || token.value === 'else' || token.value === 'to' || token.value === 'step') {
      return null;
    }

    this.errors.push({
      line: token.line,
      message: `Unexpected token in expression: '${token.value}'`,
      type: 'error'
    });
    return null;
  }
}

export function parse(tokens: Token[]): ParseResult {
  const parser = new Parser(tokens);
  return parser.parse();
}

function parseNumberLiteral(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) return 0;

  const sign = trimmed.startsWith('-') ? -1 : 1;
  const normalized = trimmed.replace(/^[+-]/, '');

  if (/^0x[0-9A-Fa-f]+$/i.test(normalized)) {
    return sign * parseInt(normalized.slice(2), 16);
  }
  if (/^[0-9A-Fa-f]+h$/i.test(normalized)) {
    return sign * parseInt(normalized.slice(0, -1), 16);
  }
  if (/^0b[01]+$/i.test(normalized)) {
    return sign * parseInt(normalized.slice(2), 2);
  }
  return sign * parseInt(normalized, 10);
}

export function formatAST(node: ASTNode, indent: number = 0): string {
  const prefix = '  '.repeat(indent);
  let result = `${prefix}${node.type}`;
  if (node.value !== undefined) {
    result += `: ${node.value}`;
  }
  result += '\n';
  
  if (node.children) {
    for (const child of node.children) {
      result += formatAST(child, indent + 1);
    }
  }
  
  return result;
}
