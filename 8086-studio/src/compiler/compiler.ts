// Main Compiler Pipeline
import { tokenize } from './lexer';
import { parse, formatAST } from './parser';
import { generateCode, resetCodeGen } from './codegen';
import { detectFrontendLanguage, FrontendLanguage, transpileToHighLevel } from './transpiler';
import { transpilePythonToHighLevel } from './pythonTranspiler';
import { assemble } from '../emulator/assembler';
import { CompilerError, AssembledProgram, ASTNode } from '../types/cpu';

export type SourceLanguage = FrontendLanguage | 'auto';

export interface CompilationResult {
  success: boolean;
  sourceLanguage: FrontendLanguage;
  translatedSource: string;
  tokens: string;
  ast: string;
  assembly: string;
  program: AssembledProgram | null;
  errors: CompilerError[];
  stages: CompilationStage[];
}

export interface CompilationStage {
  name: string;
  success: boolean;
  output: string;
  errors: CompilerError[];
}

export function compile(source: string, sourceLanguage: SourceLanguage = 'auto'): CompilationResult {
  const stages: CompilationStage[] = [];
  const allErrors: CompilerError[] = [];
  const resolvedLanguage = sourceLanguage === 'auto'
    ? detectFrontendLanguage(source)
    : sourceLanguage;
  let translatedSource = source;

  // Reset code generator state
  resetCodeGen();

  // Stage 0: Front-end translation
  if (resolvedLanguage === 'python') {
    const transpileResult = transpilePythonToHighLevel(source);
    translatedSource = transpileResult.output;
    allErrors.push(...transpileResult.errors);

    stages.push({
      name: 'PYTHON to High-Level Translation',
      success: transpileResult.errors.filter(e => e.type === 'error').length === 0,
      output: translatedSource,
      errors: transpileResult.errors
    });

    if (transpileResult.errors.filter(e => e.type === 'error').length > 0) {
      return {
        success: false,
        sourceLanguage: resolvedLanguage,
        translatedSource,
        tokens: '',
        ast: '',
        assembly: '',
        program: null,
        errors: allErrors,
        stages
      };
    }
  } else if (resolvedLanguage !== 'simple') {
    const transpileResult = transpileToHighLevel(source, resolvedLanguage);
    translatedSource = transpileResult.output;
    allErrors.push(...transpileResult.errors);

    stages.push({
      name: `${resolvedLanguage.toUpperCase()} to High-Level Translation`,
      success: transpileResult.errors.filter(e => e.type === 'error').length === 0,
      output: translatedSource,
      errors: transpileResult.errors
    });

    if (transpileResult.errors.filter(e => e.type === 'error').length > 0) {
      return {
        success: false,
        sourceLanguage: resolvedLanguage,
        translatedSource,
        tokens: '',
        ast: '',
        assembly: '',
        program: null,
        errors: allErrors,
        stages
      };
    }
  }

  // Stage 1: Lexical Analysis
  const { tokens, errors: lexerErrors } = tokenize(translatedSource);
  allErrors.push(...lexerErrors);

  const tokenStr = tokens
    .filter(t => t.type !== 'NEWLINE' && t.type !== 'EOF')
    .map(t => `[${t.type}: "${t.value}"]`)
    .join(' ');

  stages.push({
    name: 'Lexical Analysis',
    success: lexerErrors.filter(e => e.type === 'error').length === 0,
    output: tokenStr,
    errors: lexerErrors
  });

  if (lexerErrors.filter(e => e.type === 'error').length > 0) {
    return {
      success: false,
      sourceLanguage: resolvedLanguage,
      translatedSource,
      tokens: tokenStr,
      ast: '',
      assembly: '',
      program: null,
      errors: allErrors,
      stages
    };
  }

  // Stage 2: Parsing
  const { ast, errors: parseErrors } = parse(tokens);
  allErrors.push(...parseErrors);

  const astStr = ast ? formatAST(ast) : '';

  stages.push({
    name: 'Parsing',
    success: parseErrors.filter(e => e.type === 'error').length === 0 && ast !== null,
    output: astStr,
    errors: parseErrors
  });

  if (parseErrors.filter(e => e.type === 'error').length > 0 || !ast) {
    return {
      success: false,
      sourceLanguage: resolvedLanguage,
      translatedSource,
      tokens: tokenStr,
      ast: astStr,
      assembly: '',
      program: null,
      errors: allErrors,
      stages
    };
  }

  // Stage 3: Code Generation
  const { assembly, errors: codegenErrors } = generateCode(ast as ASTNode);
  allErrors.push(...codegenErrors);

  stages.push({
    name: 'Code Generation',
    success: codegenErrors.filter(e => e.type === 'error').length === 0,
    output: assembly,
    errors: codegenErrors
  });

  if (codegenErrors.filter(e => e.type === 'error').length > 0) {
    return {
      success: false,
      sourceLanguage: resolvedLanguage,
      translatedSource,
      tokens: tokenStr,
      ast: astStr,
      assembly,
      program: null,
      errors: allErrors,
      stages
    };
  }

  // Stage 4: Assembly
  const program = assemble(assembly);
  allErrors.push(...program.errors);

  const asmOutput = program.instructions
    .map((instr, i) => `${i.toString().padStart(4, '0')}: ${instr.raw}`)
    .join('\n');

  stages.push({
    name: 'Assembly',
    success: program.errors.filter(e => e.type === 'error').length === 0,
    output: asmOutput,
    errors: program.errors
  });

  const hasErrors = allErrors.filter(e => e.type === 'error').length > 0;

  return {
    success: !hasErrors,
    sourceLanguage: resolvedLanguage,
    translatedSource,
    tokens: tokenStr,
    ast: astStr,
    assembly,
    program: hasErrors ? null : program,
    errors: allErrors,
    stages
  };
}

export const SAMPLE_PROGRAMS_BY_LANGUAGE: Record<FrontendLanguage, Record<string, string>> = {
  simple: {
    simple: `# Simple variables
x = 10
y = 20
print x
print y
`,

    addition: `# Addition example
a = 99
b = 20
c = a + b
print c
`,

    conditional: `# Conditional example
x = 10
y = 20

if x < y
  print x
end

if y > x
  print y
end
`,

    loop: `# While loop
x = 0

while x < 5
  print x
  x = x + 1
end
`,

    countdown: `# Countdown from 10
x = 10

while x > 0
  print x
  x = x - 1
end
print 0
`,

    fibonacci: `# Fibonacci sequence
a = 0
b = 1
print a
print b

i = 0
while i < 8
  c = a + b
  print c
  a = b
  b = c
  i = i + 1
end
`,

    math: `# Math operations
a = 100
b = 25

sum = a + b
diff = a - b

print sum
print diff
`,

    strings: `# String printing
print "Hello World!"
x = 42
print x
print "Done!"
`
  },
  python: {
    simple: `# Real Python variables
x = 10
y = 20
print(x)
print(y)
`,

    addition: `# Python addition example
a = 99
b = 20
c = a + b
print(c)
`,

    conditional: `# Python conditional example
x = 10
y = 20

if x < y:
    print(x)

if y > x:
    print(y)
`,

    loop: `# Python while loop
x = 0

while x < 5:
    print(x)
    x += 1
`,

    countdown: `# Countdown from 10 in Python
x = 10

while x > 0:
    print(x)
    x -= 1
print(0)
`,

    fibonacci: `# Python Fibonacci sequence
a = 0
b = 1
print(a)
print(b)

i = 0
while i < 8:
    c = a + b
    print(c)
    a = b
    b = c
    i += 1
`,

    forRange: `# Python range() loop
for i in range(0, 5):
    print(i)
`,

    math: `# Python math operations
a = 100
b = 25

sum = a + b
diff = a - b

print(sum)
print(diff)
`,

    strings: `# Python string printing
print("Hello World!")
x = 42
print(x)
print("Done!")
`
  },
  javascript: {
    countdown: `let x = 10;
while (x > 0) {
  console.log(x);
  x = x - 1;
}
console.log(0);`,
    addition: `let a = 12;
let b = 30;
let c = a + b;
console.log(c);`,
    loop: `let i = 0;
while (i < 5) {
  console.log(i);
  i++;
}`
  },
  java: {
    countdown: `public class Main {
  public static void main(String[] args) {
    int x = 10;
    while (x > 0) {
      System.out.println(x);
      x = x - 1;
    }
    System.out.println(0);
  }
}`,
    addition: `public class Main {
  public static void main(String[] args) {
    int a = 25;
    int b = 17;
    int c = a + b;
    System.out.println(c);
  }
}`,
    conditional: `public class Main {
  public static void main(String[] args) {
    int x = 5;
    if (x > 3) {
      System.out.println(x);
    } else {
      System.out.println(0);
    }
  }
}`
  },
  c: {
    countdown: `#include <stdio.h>
int main() {
  int x = 10;
  while (x > 0) {
    printf("%d", x);
    x--;
  }
  printf("%d", 0);
  return 0;
}`,
    addition: `#include <stdio.h>
int main() {
  int a = 9;
  int b = 4;
  int c = a + b;
  printf("%d", c);
  return 0;
}`,
    forLoop: `#include <stdio.h>
int main() {
  for (int i = 0; i < 5; i++) {
    printf("%d", i);
  }
  return 0;
}`
  }
};

export const SAMPLE_PROGRAMS = SAMPLE_PROGRAMS_BY_LANGUAGE.simple;
