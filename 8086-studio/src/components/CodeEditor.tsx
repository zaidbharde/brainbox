import { useRef, useEffect, useState, useCallback } from 'react';
import { cn } from '@/utils/cn';

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  language?: 'simple' | 'python' | 'javascript' | 'java' | 'c' | 'assembly';
  readOnly?: boolean;
  className?: string;
}

const KEYWORDS_SIMPLE = ['program', 'end', 'if', 'else', 'while', 'for', 'print', 'input', 'var', 'then', 'do', 'to', 'step', 'and', 'or', 'not', 'true', 'false'];
const KEYWORDS_PYTHON = ['if', 'elif', 'else', 'while', 'for', 'in', 'range', 'print', 'input', 'and', 'or', 'not', 'True', 'False', 'None', 'pass', 'break', 'continue', 'return'];
const KEYWORDS_CLIKE = [
  'if', 'else', 'while', 'for', 'return', 'break', 'continue',
  'let', 'const', 'var', 'function', 'class', 'new',
  'public', 'private', 'protected', 'static', 'void',
  'int', 'long', 'short', 'byte', 'float', 'double', 'char', 'boolean', 'string',
  'true', 'false', 'null'
];
const KEYWORDS_ASM = [
  'MOV', 'ADD', 'ADC', 'SUB', 'SBB', 'MUL', 'DIV', 'MOD', 'CMP',
  'JMP', 'JE', 'JZ', 'JNE', 'JNZ', 'JL', 'JG', 'JLE', 'JGE', 'JNGE', 'JNLE', 'JNG', 'JNL',
  'JC', 'JNC', 'JB', 'JNB', 'JAE', 'JNAE', 'JS', 'JNS', 'JO', 'JNO',
  'INC', 'DEC', 'NEG', 'NOT',
  'AND', 'OR', 'XOR',
  'SHL', 'SAL', 'SHR', 'SAR',
  'PUSH', 'POP',
  'CALL', 'RET', 'INT', 'IRET',
  'IN', 'OUTP',
  'HLT', 'NOP', 'OUT', 'OUTC',
  'CLC', 'STC', 'CMC'
];
const REGISTERS = ['AX', 'BX', 'CX', 'DX', 'SI', 'DI', 'SP', 'BP'];

interface Token {
  type: 'keyword' | 'number' | 'operator' | 'register' | 'label' | 'comment' | 'identifier' | 'whitespace' | 'string' | 'other';
  value: string;
}

export function CodeEditor({ value, onChange, language = 'simple', readOnly = false, className }: CodeEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);
  const [cursorLine, setCursorLine] = useState(0);

  const lines = value.split('\n');

  const syncScroll = useCallback(() => {
    if (textareaRef.current && highlightRef.current && lineNumbersRef.current) {
      highlightRef.current.scrollTop = textareaRef.current.scrollTop;
      highlightRef.current.scrollLeft = textareaRef.current.scrollLeft;
      lineNumbersRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  }, []);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.addEventListener('scroll', syncScroll);
      return () => textarea.removeEventListener('scroll', syncScroll);
    }
  }, [syncScroll]);

  const updateCursorLine = () => {
    if (textareaRef.current) {
      const pos = textareaRef.current.selectionStart;
      const beforeCursor = value.substring(0, pos);
      const line = beforeCursor.split('\n').length - 1;
      setCursorLine(line);
    }
  };

  // Tokenize a line into separate tokens
  const tokenizeLine = (line: string, lang: 'simple' | 'python' | 'javascript' | 'java' | 'c' | 'assembly'): Token[] => {
    const tokens: Token[] = [];
    const keywords = lang === 'assembly'
      ? KEYWORDS_ASM
      : lang === 'simple'
        ? KEYWORDS_SIMPLE
      : lang === 'python'
        ? KEYWORDS_PYTHON
        : KEYWORDS_CLIKE;
    
    // Check for comment first
    const commentTokens = lang === 'assembly'
      ? [';']
      : lang === 'simple'
        ? ['#', '//', ';']
      : lang === 'python'
        ? ['#']
        : ['//'];
    let commentIndex = -1;
    for (const token of commentTokens) {
      const idx = line.indexOf(token);
      if (idx !== -1 && (commentIndex === -1 || idx < commentIndex)) {
        commentIndex = idx;
      }
    }

    let codePart = line;
    let commentPart = '';
    if (commentIndex !== -1) {
      codePart = line.substring(0, commentIndex);
      commentPart = line.substring(commentIndex);
    }
    
    // Tokenize the code part
    let remaining = codePart;
    
    while (remaining.length > 0) {
      // Whitespace
      const wsMatch = remaining.match(/^(\s+)/);
      if (wsMatch) {
        tokens.push({ type: 'whitespace', value: wsMatch[1] });
        remaining = remaining.substring(wsMatch[1].length);
        continue;
      }
      
      // String literals
      if (remaining[0] === '"' || remaining[0] === "'") {
        const quote = remaining[0];
        let str = quote;
        let i = 1;
        while (i < remaining.length && remaining[i] !== quote) {
          str += remaining[i];
          i++;
        }
        if (i < remaining.length) {
          str += remaining[i];
          i++;
        }
        tokens.push({ type: 'string', value: str });
        remaining = remaining.substring(i);
        continue;
      }
      
      // Label (for assembly) - must be at start of line and we're at position 0
      if (lang === 'assembly' && tokens.filter(t => t.type !== 'whitespace').length === 0) {
        const labelMatch = remaining.match(/^(\w+):/);
        if (labelMatch) {
          tokens.push({ type: 'label', value: labelMatch[0] });
          remaining = remaining.substring(labelMatch[0].length);
          continue;
        }
      }
      
      // Number
      const numMatch = remaining.match(/^(0x[0-9A-Fa-f]+|0b[01]+|[0-9A-Fa-f]+h|\d+)/);
      if (numMatch) {
        tokens.push({ type: 'number', value: numMatch[1] });
        remaining = remaining.substring(numMatch[1].length);
        continue;
      }
      
      // Word (keyword, register, or identifier)
      const wordMatch = remaining.match(/^([a-zA-Z_][a-zA-Z0-9_]*)/);
      if (wordMatch) {
        const word = wordMatch[1];
        const upperWord = word.toUpperCase();
        
        if (keywords.some(k => k.toUpperCase() === upperWord)) {
          tokens.push({ type: 'keyword', value: word });
        } else if (lang === 'assembly' && REGISTERS.includes(upperWord)) {
          tokens.push({ type: 'register', value: word });
        } else {
          tokens.push({ type: 'identifier', value: word });
        }
        remaining = remaining.substring(word.length);
        continue;
      }
      
      // Operators (multi-char first, then single char)
      const opMatch = remaining.match(/^(==|!=|<=|>=|\+|\-|\*|\/|%|<|>|=)/);
      if (opMatch) {
        tokens.push({ type: 'operator', value: opMatch[1] });
        remaining = remaining.substring(opMatch[1].length);
        continue;
      }
      
      // Any other single character
      tokens.push({ type: 'other', value: remaining[0] });
      remaining = remaining.substring(1);
    }
    
    // Add comment if present
    if (commentPart) {
      tokens.push({ type: 'comment', value: commentPart });
    }
    
    return tokens;
  };

  // Convert tokens to highlighted JSX - NO HTML escaping needed since we render as text
  const renderTokens = (tokens: Token[]): React.ReactNode[] => {
    return tokens.map((token, i) => {
      // Render the raw value - React handles escaping automatically
      switch (token.type) {
        case 'keyword':
          return <span key={i} className="text-[#4fd1a7] font-semibold">{token.value}</span>;
        case 'number':
          return <span key={i} className="text-[#f0b45b]">{token.value}</span>;
        case 'operator':
          return <span key={i} className="text-[#f38b8b]">{token.value}</span>;
        case 'register':
          return <span key={i} className="text-[#7ab6ff]">{token.value}</span>;
        case 'label':
          return <span key={i} className="text-[#e0b56a]">{token.value}</span>;
        case 'comment':
          return <span key={i} className="text-gray-500">{token.value}</span>;
        case 'identifier':
          return <span key={i} className="text-[#7adfb1]">{token.value}</span>;
        case 'string':
          return <span key={i} className="text-[#f6a972]">{token.value}</span>;
        case 'whitespace':
          return <span key={i}>{token.value}</span>;
        default:
          return <span key={i} className="text-gray-300">{token.value}</span>;
      }
    });
  };

  const highlightCode = (code: string) => {
    return code.split('\n').map((line, lineIndex) => {
      const tokens = tokenizeLine(line, language);
      const highlighted = renderTokens(tokens);
      
      return (
        <div key={lineIndex} className="leading-6 h-6">
          {highlighted.length > 0 ? highlighted : <span>&nbsp;</span>}
        </div>
      );
    });
  };

  return (
    <div className={cn('relative panel-glass rounded-2xl border border-[#2a3c5d]/60 overflow-hidden shadow-[0_16px_40px_rgba(6,12,25,0.35)]', className)}>
      <div className="flex h-full">
        {/* Line Numbers */}
        <div
          ref={lineNumbersRef}
          className="flex-shrink-0 w-12 bg-[linear-gradient(180deg,rgba(8,14,24,0.95),rgba(10,16,28,0.88))] border-r border-[#2a3c5d]/55 overflow-hidden select-none"
        >
          <div className="py-3 px-2">
            {lines.map((_, i) => (
              <div
                key={i}
                className={cn(
                  'text-right text-xs leading-6 h-6 font-mono',
                  cursorLine === i ? 'text-[#6edfd2]' : 'text-[#4e668c]'
                )}
              >
                {i + 1}
              </div>
            ))}
          </div>
        </div>

        {/* Editor Area */}
        <div className="relative flex-1 overflow-hidden">
          {/* Syntax Highlighted Layer */}
          <div
            ref={highlightRef}
            className="absolute inset-x-0 top-0 bottom-6 py-3 px-4 font-mono text-sm overflow-auto pointer-events-none whitespace-pre"
            style={{ tabSize: 2 }}
          >
            {highlightCode(value)}
          </div>

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyUp={updateCursorLine}
            onClick={updateCursorLine}
            readOnly={readOnly}
            className={cn(
              'absolute inset-x-0 top-0 bottom-6 w-full py-3 px-4 bg-transparent text-transparent caret-white',
              'resize-none outline-none font-mono text-sm leading-6',
              'selection:bg-[#4ed8c9]/30 code-editor'
            )}
            spellCheck={false}
            style={{ tabSize: 2 }}
          />
        </div>
      </div>

      {/* Status Bar */}
      <div className="absolute bottom-0 left-0 right-0 h-6 bg-[linear-gradient(180deg,rgba(18,29,46,0.96),rgba(14,23,39,0.9))] border-t border-[#2a3c5d]/55 flex items-center justify-between px-3 text-xs text-[#88a0c5]">
        <span>Line {cursorLine + 1}, Column 1</span>
        <span className="uppercase tracking-wide">{language}</span>
      </div>
    </div>
  );
}
