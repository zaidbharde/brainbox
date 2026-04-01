const CANVAS_WIDTH = 640;
const CANVAS_HEIGHT = 420;
const MAX_LOOP_ITERATIONS = 12000;

const BGI_PALETTE = [
  '#000000',
  '#0000aa',
  '#00aa00',
  '#00aaaa',
  '#aa0000',
  '#aa00aa',
  '#aa5500',
  '#aaaaaa',
  '#555555',
  '#5555ff',
  '#55ff55',
  '#55ffff',
  '#ff5555',
  '#ff55ff',
  '#ffff55',
  '#ffffff',
];

const BGI_COLORS = {
  BLACK: 0,
  BLUE: 1,
  GREEN: 2,
  CYAN: 3,
  RED: 4,
  MAGENTA: 5,
  BROWN: 6,
  LIGHTGRAY: 7,
  DARKGRAY: 8,
  LIGHTBLUE: 9,
  LIGHTGREEN: 10,
  LIGHTCYAN: 11,
  LIGHTRED: 12,
  LIGHTMAGENTA: 13,
  YELLOW: 14,
  WHITE: 15,
};

const BGI_FILL_STYLES = {
  EMPTY_FILL: 0,
  SOLID_FILL: 1,
  LINE_FILL: 2,
  LTSLASH_FILL: 3,
  SLASH_FILL: 4,
  BKSLASH_FILL: 5,
  LTBKSLASH_FILL: 6,
  HATCH_FILL: 7,
  XHATCH_FILL: 8,
  INTERLEAVE_FILL: 9,
  WIDE_DOT_FILL: 10,
  CLOSE_DOT_FILL: 11,
  USER_FILL: 12,
};

const TYPE_PREFIX_RE = /^(?:(?:unsigned|signed|short|long|int|float|double|char|const|static)\s+)+/;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripComments(code) {
  return (code || '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

function skipWhitespace(code, index) {
  let cursor = index;
  while (cursor < code.length && /\s/.test(code[cursor])) {
    cursor += 1;
  }
  return cursor;
}

function isWordChar(ch) {
  return /[A-Za-z0-9_]/.test(ch || '');
}

function isKeywordAt(code, index, keyword) {
  if (!code.startsWith(keyword, index)) {
    return false;
  }
  const left = code[index - 1];
  const right = code[index + keyword.length];
  return !isWordChar(left) && !isWordChar(right);
}

function findMatchingPair(code, openIndex, openChar, closeChar) {
  let depth = 0;
  let quote = '';

  for (let i = openIndex; i < code.length; i += 1) {
    const ch = code[i];
    const prev = code[i - 1];

    if (quote) {
      if (ch === quote && prev !== '\\') {
        quote = '';
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }

    if (ch === openChar) {
      depth += 1;
      continue;
    }

    if (ch === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }

  return -1;
}

function splitTopLevel(input = '', separator = ',') {
  const parts = [];
  let current = '';
  let quote = '';
  let depthParen = 0;
  let depthBrace = 0;
  let depthBracket = 0;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    const prev = input[i - 1];

    if (quote) {
      current += ch;
      if (ch === quote && prev !== '\\') {
        quote = '';
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }

    if (ch === '(') {
      depthParen += 1;
      current += ch;
      continue;
    }
    if (ch === ')') {
      depthParen = Math.max(0, depthParen - 1);
      current += ch;
      continue;
    }
    if (ch === '{') {
      depthBrace += 1;
      current += ch;
      continue;
    }
    if (ch === '}') {
      depthBrace = Math.max(0, depthBrace - 1);
      current += ch;
      continue;
    }
    if (ch === '[') {
      depthBracket += 1;
      current += ch;
      continue;
    }
    if (ch === ']') {
      depthBracket = Math.max(0, depthBracket - 1);
      current += ch;
      continue;
    }

    if (ch === separator && depthParen === 0 && depthBrace === 0 && depthBracket === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }

    current += ch;
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts;
}

function parseCString(raw = '') {
  const text = raw.trim();
  if (text.startsWith('"') && text.endsWith('"')) {
    return text
      .slice(1, -1)
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }
  return text;
}

function toCanvasColor(value) {
  if (!Number.isFinite(value)) {
    return BGI_PALETTE[15];
  }
  const normalized = Math.abs(Math.round(value)) % BGI_PALETTE.length;
  return BGI_PALETTE[normalized];
}

function hexToRgb(hex) {
  const clean = (hex || '#000000').replace('#', '').toLowerCase();
  if (clean.length !== 6) {
    return { r: 0, g: 0, b: 0 };
  }
  return {
    r: Number.parseInt(clean.slice(0, 2), 16),
    g: Number.parseInt(clean.slice(2, 4), 16),
    b: Number.parseInt(clean.slice(4, 6), 16),
  };
}

function colorsNear(a, b, tolerance = 12) {
  return (
    Math.abs(a.r - b.r) <= tolerance
    && Math.abs(a.g - b.g) <= tolerance
    && Math.abs(a.b - b.b) <= tolerance
  );
}

export function clearGraphicsCanvas(canvas, fillColor = '#000000') {
  if (!canvas) {
    return;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }

  ctx.fillStyle = fillColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function extractMainBody(code) {
  const mainMatch = code.match(/\bmain\s*\([^\)]*\)\s*\{/);
  if (!mainMatch) {
    return code;
  }

  const openBraceIndex = code.indexOf('{', mainMatch.index);
  if (openBraceIndex < 0) {
    return code;
  }

  const closeBraceIndex = findMatchingPair(code, openBraceIndex, '{', '}');
  if (closeBraceIndex < 0) {
    return code;
  }

  return code.slice(openBraceIndex + 1, closeBraceIndex);
}

function collectDefines(code) {
  const symbols = {};
  const defineRegex = /^\s*#\s*define\s+([A-Za-z_]\w*)\s+(.+)$/gm;

  for (const match of code.matchAll(defineRegex)) {
    symbols[match[1]] = match[2].trim();
  }

  return symbols;
}

function replaceTokensForEval(expression, symbols) {
  return (expression || '').replace(/\b[A-Za-z_]\w*\b/g, (token) => {
    if (Object.hasOwn(symbols, token) && Number.isFinite(Number(symbols[token]))) {
      return String(symbols[token]);
    }

    const upper = token.toUpperCase();
    if (Object.hasOwn(BGI_COLORS, upper)) {
      return String(BGI_COLORS[upper]);
    }
    if (Object.hasOwn(BGI_FILL_STYLES, upper)) {
      return String(BGI_FILL_STYLES[upper]);
    }
    if (upper === 'DETECT') {
      return '0';
    }

    return '0';
  });
}

function evaluateExpression(expression, symbols) {
  const replaced = replaceTokensForEval(expression, symbols);
  if (!replaced.trim()) {
    return 0;
  }

  if (!/^[\d+\-*/%.()\s<>=!&|?:]+$/.test(replaced)) {
    return 0;
  }

  try {
    return Function(`"use strict"; return (${replaced});`)();
  } catch {
    return 0;
  }
}

function evaluateNumeric(expression, symbols) {
  const value = evaluateExpression(expression, symbols);
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function evaluateCondition(expression, symbols) {
  const value = evaluateExpression(expression, symbols);
  return Boolean(value);
}

function applyScalarMutation(statement, symbols, declarationMode = false) {
  const trimmed = statement.trim();
  if (!trimmed) {
    return;
  }

  let segment = trimmed;

  if (declarationMode) {
    if (TYPE_PREFIX_RE.test(segment)) {
      segment = segment.replace(TYPE_PREFIX_RE, '').trim();
    }

    if (!segment) {
      return;
    }
  }

  const preIncMatch = segment.match(/^(\+\+|--)\s*([A-Za-z_]\w*)$/);
  if (preIncMatch) {
    const variable = preIncMatch[2];
    const step = preIncMatch[1] === '++' ? 1 : -1;
    symbols[variable] = Number(symbols[variable] || 0) + step;
    return;
  }

  const postIncMatch = segment.match(/^([A-Za-z_]\w*)\s*(\+\+|--)$/);
  if (postIncMatch) {
    const variable = postIncMatch[1];
    const step = postIncMatch[2] === '++' ? 1 : -1;
    symbols[variable] = Number(symbols[variable] || 0) + step;
    return;
  }

  const compoundMatch = segment.match(/^([A-Za-z_]\w*)\s*([+\-*/%]=)\s*(.+)$/);
  if (compoundMatch) {
    const variable = compoundMatch[1];
    const operator = compoundMatch[2];
    const operand = evaluateNumeric(compoundMatch[3], symbols);
    const current = Number(symbols[variable] || 0);

    if (operator === '+=') {
      symbols[variable] = current + operand;
      return;
    }
    if (operator === '-=') {
      symbols[variable] = current - operand;
      return;
    }
    if (operator === '*=') {
      symbols[variable] = current * operand;
      return;
    }
    if (operator === '/=') {
      symbols[variable] = operand === 0 ? current : current / operand;
      return;
    }
    if (operator === '%=') {
      symbols[variable] = operand === 0 ? current : current % operand;
      return;
    }
  }

  const assignmentMatch = segment.match(/^([A-Za-z_]\w*)\s*=\s*(.+)$/);
  if (assignmentMatch) {
    const variable = assignmentMatch[1];
    const value = evaluateNumeric(assignmentMatch[2], symbols);
    symbols[variable] = value;
    return;
  }

  if (declarationMode) {
    const declarationOnlyMatch = segment.match(/^([A-Za-z_]\w*)$/);
    if (declarationOnlyMatch) {
      const variable = declarationOnlyMatch[1];
      if (!Object.hasOwn(symbols, variable)) {
        symbols[variable] = 0;
      }
    }
  }
}

function executeScalarStatement(rawStatement, symbols) {
  const statement = rawStatement.trim().replace(/;$/, '').trim();
  if (!statement) {
    return;
  }

  const declarationMode = TYPE_PREFIX_RE.test(statement);
  const normalized = declarationMode ? statement.replace(TYPE_PREFIX_RE, '').trim() : statement;
  const parts = splitTopLevel(normalized, ',');

  for (const part of parts) {
    applyScalarMutation(part, symbols, declarationMode);
  }
}

function splitFunctionArguments(raw = '') {
  return splitTopLevel(raw, ',');
}

function readStatement(code, index) {
  let cursor = index;
  let quote = '';
  let depthParen = 0;

  while (cursor < code.length) {
    const ch = code[cursor];
    const prev = code[cursor - 1];

    if (quote) {
      if (ch === quote && prev !== '\\') {
        quote = '';
      }
      cursor += 1;
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      cursor += 1;
      continue;
    }

    if (ch === '(') {
      depthParen += 1;
      cursor += 1;
      continue;
    }

    if (ch === ')' && depthParen > 0) {
      depthParen -= 1;
      cursor += 1;
      continue;
    }

    if (ch === ';' && depthParen === 0) {
      return {
        text: code.slice(index, cursor).trim(),
        nextIndex: cursor + 1,
      };
    }

    cursor += 1;
  }

  return {
    text: code.slice(index).trim(),
    nextIndex: code.length,
  };
}

function readBlockOrStatement(code, index) {
  const start = skipWhitespace(code, index);
  if (start >= code.length) {
    return { text: '', nextIndex: start };
  }

  if (code[start] === '{') {
    const close = findMatchingPair(code, start, '{', '}');
    if (close < 0) {
      return { text: code.slice(start + 1), nextIndex: code.length };
    }

    return {
      text: code.slice(start + 1, close),
      nextIndex: close + 1,
    };
  }

  return readStatement(code, start);
}

function shapeContainsPoint(shape, x, y) {
  if (shape.type === 'circle') {
    const dx = x - shape.cx;
    const dy = y - shape.cy;
    return (dx * dx) + (dy * dy) <= shape.r * shape.r;
  }

  if (shape.type === 'rect') {
    const minX = Math.min(shape.x1, shape.x2);
    const maxX = Math.max(shape.x1, shape.x2);
    const minY = Math.min(shape.y1, shape.y2);
    const maxY = Math.max(shape.y1, shape.y2);
    return x > minX && x < maxX && y > minY && y < maxY;
  }

  if (shape.type === 'ellipse') {
    const dx = x - shape.cx;
    const dy = y - shape.cy;
    if (shape.rx === 0 || shape.ry === 0) {
      return false;
    }
    const value = ((dx * dx) / (shape.rx * shape.rx)) + ((dy * dy) / (shape.ry * shape.ry));
    return value <= 1;
  }

  return false;
}

function fillShape(ctx, shape, color) {
  ctx.fillStyle = color;

  if (shape.type === 'circle') {
    ctx.beginPath();
    ctx.arc(shape.cx, shape.cy, shape.r, 0, Math.PI * 2);
    ctx.fill();
    return true;
  }

  if (shape.type === 'rect') {
    const minX = Math.min(shape.x1, shape.x2) + 1;
    const minY = Math.min(shape.y1, shape.y2) + 1;
    const width = Math.abs(shape.x2 - shape.x1) - 2;
    const height = Math.abs(shape.y2 - shape.y1) - 2;
    if (width > 0 && height > 0) {
      ctx.fillRect(minX, minY, width, height);
    }
    return true;
  }

  if (shape.type === 'ellipse') {
    ctx.beginPath();
    ctx.ellipse(shape.cx, shape.cy, shape.rx, shape.ry, 0, 0, Math.PI * 2);
    ctx.fill();
    return true;
  }

  return false;
}

function pixelFloodFill(canvas, x, y, fillHex, boundaryHex) {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return false;
  }

  const clampedX = Math.max(0, Math.min(canvas.width - 1, Math.round(x)));
  const clampedY = Math.max(0, Math.min(canvas.height - 1, Math.round(y)));

  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = image.data;
  const width = canvas.width;
  const height = canvas.height;

  const fillRgb = hexToRgb(fillHex);
  const boundaryRgb = hexToRgb(boundaryHex);

  const startIndex = (clampedY * width + clampedX) * 4;
  const target = {
    r: data[startIndex],
    g: data[startIndex + 1],
    b: data[startIndex + 2],
  };

  if (colorsNear(target, fillRgb) || colorsNear(target, boundaryRgb)) {
    return false;
  }

  const stack = [[clampedX, clampedY]];
  let touched = false;
  let guard = 0;

  while (stack.length > 0 && guard < 800000) {
    guard += 1;
    const [cx, cy] = stack.pop();

    if (cx < 0 || cy < 0 || cx >= width || cy >= height) {
      continue;
    }

    const idx = (cy * width + cx) * 4;
    const current = {
      r: data[idx],
      g: data[idx + 1],
      b: data[idx + 2],
    };

    if (!colorsNear(current, target, 16) || colorsNear(current, boundaryRgb, 16)) {
      continue;
    }

    data[idx] = fillRgb.r;
    data[idx + 1] = fillRgb.g;
    data[idx + 2] = fillRgb.b;
    data[idx + 3] = 255;
    touched = true;

    stack.push([cx + 1, cy]);
    stack.push([cx - 1, cy]);
    stack.push([cx, cy + 1]);
    stack.push([cx, cy - 1]);
  }

  if (touched) {
    ctx.putImageData(image, 0, 0);
  }

  return touched;
}

function setupGraphicsState(canvas) {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return null;
  }

  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;

  ctx.imageSmoothingEnabled = false;
  ctx.lineWidth = 1;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  return {
    canvas,
    ctx,
    symbols: {},
    shapes: [],
    warnings: [],
    stdout: [],
    commandCount: 0,
    state: {
      color: BGI_PALETTE[15],
      fillColor: BGI_PALETTE[7],
      background: BGI_PALETTE[0],
      cursorX: 0,
      cursorY: 0,
      textScale: 1,
    },
  };
}

function applyDefinesToSymbols(sourceCode, symbols) {
  const rawDefines = collectDefines(sourceCode);

  for (const [name, expression] of Object.entries(rawDefines)) {
    symbols[name] = evaluateNumeric(expression, symbols);
  }
}

async function executeGraphicsCall(functionName, rawArgs, exec) {
  const fn = functionName.toLowerCase();
  const args = splitFunctionArguments(rawArgs);
  const { ctx, canvas, state, symbols, shapes } = exec;

  if (fn === 'initgraph') {
    clearGraphicsCanvas(canvas, state.background);
    shapes.length = 0;
    exec.commandCount += 1;
    return;
  }

  if (fn === 'closegraph' || fn === 'getch') {
    exec.commandCount += 1;
    return;
  }

  if (fn === 'delay') {
    const wait = Math.max(0, Math.min(1200, Math.round(evaluateNumeric(args[0], symbols))));
    exec.commandCount += 1;
    if (wait > 0) {
      await sleep(wait);
    }
    return;
  }

  if (fn === 'cleardevice') {
    clearGraphicsCanvas(canvas, state.background);
    shapes.length = 0;
    exec.commandCount += 1;
    return;
  }

  if (fn === 'setbkcolor') {
    state.background = toCanvasColor(evaluateNumeric(args[0], symbols));
    exec.commandCount += 1;
    return;
  }

  if (fn === 'setcolor') {
    state.color = toCanvasColor(evaluateNumeric(args[0], symbols));
    exec.commandCount += 1;
    return;
  }

  if (fn === 'setfillstyle') {
    state.fillColor = toCanvasColor(evaluateNumeric(args[1], symbols));
    exec.commandCount += 1;
    return;
  }

  if (fn === 'settextstyle') {
    const size = evaluateNumeric(args[2], symbols);
    state.textScale = Number.isFinite(size) && size > 0 ? Math.max(0.5, Math.min(6, size)) : 1;
    exec.commandCount += 1;
    return;
  }

  if (fn === 'moveto') {
    state.cursorX = evaluateNumeric(args[0], symbols);
    state.cursorY = evaluateNumeric(args[1], symbols);
    exec.commandCount += 1;
    return;
  }

  if (fn === 'lineto') {
    const x = evaluateNumeric(args[0], symbols);
    const y = evaluateNumeric(args[1], symbols);
    ctx.beginPath();
    ctx.strokeStyle = state.color;
    ctx.moveTo(state.cursorX, state.cursorY);
    ctx.lineTo(x, y);
    ctx.stroke();
    state.cursorX = x;
    state.cursorY = y;
    exec.commandCount += 1;
    return;
  }

  if (fn === 'line') {
    const x1 = evaluateNumeric(args[0], symbols);
    const y1 = evaluateNumeric(args[1], symbols);
    const x2 = evaluateNumeric(args[2], symbols);
    const y2 = evaluateNumeric(args[3], symbols);
    ctx.beginPath();
    ctx.strokeStyle = state.color;
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    exec.commandCount += 1;
    return;
  }

  if (fn === 'rectangle') {
    const x1 = evaluateNumeric(args[0], symbols);
    const y1 = evaluateNumeric(args[1], symbols);
    const x2 = evaluateNumeric(args[2], symbols);
    const y2 = evaluateNumeric(args[3], symbols);
    ctx.strokeStyle = state.color;
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    shapes.push({ type: 'rect', x1, y1, x2, y2, strokeColor: state.color });
    exec.commandCount += 1;
    return;
  }

  if (fn === 'bar') {
    const x1 = evaluateNumeric(args[0], symbols);
    const y1 = evaluateNumeric(args[1], symbols);
    const x2 = evaluateNumeric(args[2], symbols);
    const y2 = evaluateNumeric(args[3], symbols);
    ctx.fillStyle = state.fillColor;
    ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
    shapes.push({ type: 'rect', x1, y1, x2, y2, strokeColor: state.color });
    exec.commandCount += 1;
    return;
  }

  if (fn === 'circle') {
    const cx = evaluateNumeric(args[0], symbols);
    const cy = evaluateNumeric(args[1], symbols);
    const r = Math.abs(evaluateNumeric(args[2], symbols));
    ctx.beginPath();
    ctx.strokeStyle = state.color;
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    shapes.push({ type: 'circle', cx, cy, r, strokeColor: state.color });
    exec.commandCount += 1;
    return;
  }

  if (fn === 'fillellipse') {
    const cx = evaluateNumeric(args[0], symbols);
    const cy = evaluateNumeric(args[1], symbols);
    const rx = Math.abs(evaluateNumeric(args[2], symbols));
    const ry = Math.abs(evaluateNumeric(args[3], symbols));
    ctx.beginPath();
    ctx.fillStyle = state.fillColor;
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    shapes.push({ type: 'ellipse', cx, cy, rx, ry, strokeColor: state.color });
    exec.commandCount += 1;
    return;
  }

  if (fn === 'ellipse') {
    const cx = evaluateNumeric(args[0], symbols);
    const cy = evaluateNumeric(args[1], symbols);
    const startDeg = evaluateNumeric(args[2], symbols);
    const endDeg = evaluateNumeric(args[3], symbols);
    const rx = Math.abs(evaluateNumeric(args[4], symbols));
    const ry = Math.abs(evaluateNumeric(args[5], symbols));
    ctx.beginPath();
    ctx.strokeStyle = state.color;
    ctx.ellipse(cx, cy, rx, ry, 0, (startDeg * Math.PI) / 180, (endDeg * Math.PI) / 180);
    ctx.stroke();
    if (Math.abs(endDeg - startDeg) >= 359) {
      shapes.push({ type: 'ellipse', cx, cy, rx, ry, strokeColor: state.color });
    }
    exec.commandCount += 1;
    return;
  }

  if (fn === 'arc') {
    const cx = evaluateNumeric(args[0], symbols);
    const cy = evaluateNumeric(args[1], symbols);
    const startDeg = evaluateNumeric(args[2], symbols);
    const endDeg = evaluateNumeric(args[3], symbols);
    const r = Math.abs(evaluateNumeric(args[4], symbols));
    ctx.beginPath();
    ctx.strokeStyle = state.color;
    ctx.arc(cx, cy, r, (startDeg * Math.PI) / 180, (endDeg * Math.PI) / 180);
    ctx.stroke();
    exec.commandCount += 1;
    return;
  }

  if (fn === 'putpixel') {
    const x = Math.round(evaluateNumeric(args[0], symbols));
    const y = Math.round(evaluateNumeric(args[1], symbols));
    const color = toCanvasColor(evaluateNumeric(args[2], symbols));
    ctx.fillStyle = color;
    ctx.fillRect(x, y, 1, 1);
    exec.commandCount += 1;
    return;
  }

  if (fn === 'outtextxy') {
    const x = evaluateNumeric(args[0], symbols);
    const y = evaluateNumeric(args[1], symbols);
    const text = parseCString(args[2] || '""');
    const fontSize = Math.round(16 * state.textScale);
    ctx.fillStyle = state.color;
    ctx.font = `${fontSize}px "IBM Plex Mono", monospace`;
    ctx.fillText(text, x, y);
    exec.commandCount += 1;
    return;
  }

  if (fn === 'floodfill') {
    const x = evaluateNumeric(args[0], symbols);
    const y = evaluateNumeric(args[1], symbols);
    const borderColor = toCanvasColor(evaluateNumeric(args[2], symbols));
    let filled = false;

    for (let i = shapes.length - 1; i >= 0; i -= 1) {
      const shape = shapes[i];
      if (shape.strokeColor !== borderColor) {
        continue;
      }
      if (!shapeContainsPoint(shape, x, y)) {
        continue;
      }
      filled = fillShape(ctx, shape, state.fillColor);
      if (filled) {
        break;
      }
    }

    if (!filled) {
      filled = pixelFloodFill(canvas, x, y, state.fillColor, borderColor);
    }

    exec.commandCount += 1;
    if (!filled) {
      exec.warnings.push('`floodfill` could not find a closed boundary at the given point.');
    }
    return;
  }

  if (fn === 'printf' || fn === 'puts') {
    const text = parseCString(args[0] || '""');
    if (text) {
      exec.stdout.push(text);
    }
    exec.commandCount += 1;
    return;
  }

  if (fn !== 'main') {
    exec.warnings.push(`Unsupported graphics call skipped: ${functionName}()`);
  }
}

async function executeStatement(statement, exec) {
  if (exec.shouldStop()) {
    return 'return';
  }

  const trimmed = statement.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed === 'break') {
    return 'break';
  }
  if (trimmed === 'continue') {
    return 'continue';
  }
  if (trimmed.startsWith('return')) {
    return 'return';
  }

  const callMatch = trimmed.match(/^([A-Za-z_]\w*)\s*\((.*)\)$/s);
  if (callMatch) {
    await executeGraphicsCall(callMatch[1], callMatch[2], exec);
    return null;
  }

  executeScalarStatement(trimmed, exec.symbols);
  return null;
}

async function executeForLoop(header, body, exec) {
  const headerParts = splitTopLevel(header, ';');
  const initExpr = headerParts[0] || '';
  const conditionExpr = headerParts[1] || '';
  const stepExpr = headerParts[2] || '';

  executeScalarStatement(initExpr, exec.symbols);

  let iterations = 0;
  while (iterations < MAX_LOOP_ITERATIONS) {
    if (exec.shouldStop()) {
      return 'return';
    }

    if (conditionExpr.trim() && !evaluateCondition(conditionExpr, exec.symbols)) {
      break;
    }

    const control = await executeCodeBlock(body, exec);
    if (control === 'return') {
      return 'return';
    }
    if (control === 'break') {
      break;
    }

    if (stepExpr.trim()) {
      const stepParts = splitTopLevel(stepExpr, ',');
      for (const step of stepParts) {
        executeScalarStatement(step, exec.symbols);
      }
    }

    iterations += 1;
  }

  if (iterations >= MAX_LOOP_ITERATIONS) {
    exec.warnings.push(`Loop execution capped at ${MAX_LOOP_ITERATIONS} iterations for safety.`);
  }

  return null;
}

async function executeWhileLoop(conditionExpr, body, exec) {
  let iterations = 0;

  while (iterations < MAX_LOOP_ITERATIONS) {
    if (exec.shouldStop()) {
      return 'return';
    }

    if (!evaluateCondition(conditionExpr, exec.symbols)) {
      break;
    }

    const control = await executeCodeBlock(body, exec);
    if (control === 'return') {
      return 'return';
    }
    if (control === 'break') {
      break;
    }

    iterations += 1;
  }

  if (iterations >= MAX_LOOP_ITERATIONS) {
    exec.warnings.push(`Loop execution capped at ${MAX_LOOP_ITERATIONS} iterations for safety.`);
  }

  return null;
}

async function executeIfBlock(condition, thenBody, elseBody, exec) {
  const pass = evaluateCondition(condition, exec.symbols);
  const activeBody = pass ? thenBody : elseBody;
  if (!activeBody) {
    return null;
  }
  return executeCodeBlock(activeBody, exec);
}

async function executeCodeBlock(code, exec) {
  let cursor = 0;

  while (cursor < code.length) {
    if (exec.shouldStop()) {
      return 'return';
    }

    cursor = skipWhitespace(code, cursor);
    if (cursor >= code.length) {
      break;
    }

    if (code[cursor] === ';') {
      cursor += 1;
      continue;
    }

    if (isKeywordAt(code, cursor, 'for')) {
      let headStart = skipWhitespace(code, cursor + 3);
      if (code[headStart] !== '(') {
        const statement = readStatement(code, cursor);
        cursor = statement.nextIndex;
        continue;
      }

      const headEnd = findMatchingPair(code, headStart, '(', ')');
      if (headEnd < 0) {
        break;
      }

      const header = code.slice(headStart + 1, headEnd);
      const loopBody = readBlockOrStatement(code, headEnd + 1);
      const control = await executeForLoop(header, loopBody.text, exec);
      if (control === 'return') {
        return 'return';
      }

      cursor = loopBody.nextIndex;
      continue;
    }

    if (isKeywordAt(code, cursor, 'if')) {
      let conditionStart = skipWhitespace(code, cursor + 2);
      if (code[conditionStart] !== '(') {
        const statement = readStatement(code, cursor);
        cursor = statement.nextIndex;
        continue;
      }

      const conditionEnd = findMatchingPair(code, conditionStart, '(', ')');
      if (conditionEnd < 0) {
        break;
      }

      const condition = code.slice(conditionStart + 1, conditionEnd);
      const thenBlock = readBlockOrStatement(code, conditionEnd + 1);
      let nextCursor = thenBlock.nextIndex;
      let elseBody = '';

      const maybeElse = skipWhitespace(code, nextCursor);
      if (isKeywordAt(code, maybeElse, 'else')) {
        const elseBlock = readBlockOrStatement(code, maybeElse + 4);
        elseBody = elseBlock.text;
        nextCursor = elseBlock.nextIndex;
      }

      const control = await executeIfBlock(condition, thenBlock.text, elseBody, exec);
      if (control) {
        return control;
      }

      cursor = nextCursor;
      continue;
    }

    if (isKeywordAt(code, cursor, 'while')) {
      let conditionStart = skipWhitespace(code, cursor + 5);
      if (code[conditionStart] !== '(') {
        const statement = readStatement(code, cursor);
        cursor = statement.nextIndex;
        continue;
      }

      const conditionEnd = findMatchingPair(code, conditionStart, '(', ')');
      if (conditionEnd < 0) {
        break;
      }

      const condition = code.slice(conditionStart + 1, conditionEnd);
      const loopBody = readBlockOrStatement(code, conditionEnd + 1);
      const control = await executeWhileLoop(condition, loopBody.text, exec);
      if (control === 'return') {
        return 'return';
      }

      cursor = loopBody.nextIndex;
      continue;
    }

    const statement = readStatement(code, cursor);
    if (!statement.text) {
      cursor = statement.nextIndex;
      continue;
    }

    const control = await executeStatement(statement.text, exec);
    if (control) {
      return control;
    }

    cursor = statement.nextIndex;
  }

  return null;
}

export function detectGraphicsCode(code = '') {
  return (
    /#\s*include\s*<graphics\.h>/i.test(code)
    || /\b(initgraph|line|lineto|rectangle|circle|bar|fillellipse|ellipse|arc|outtextxy|setcolor|setfillstyle|setbkcolor|floodfill|cleardevice|putpixel|delay)\s*\(/i.test(code)
  );
}

export async function renderGraphicsProgram(code, canvas, shouldStop = () => false) {
  if (!canvas) {
    return { ok: false, message: '[error] Graphics canvas is unavailable.' };
  }

  const exec = setupGraphicsState(canvas);
  if (!exec) {
    return { ok: false, message: '[error] Could not initialize graphics canvas.' };
  }

  exec.shouldStop = shouldStop;

  clearGraphicsCanvas(canvas, exec.state.background);
  applyDefinesToSymbols(code, exec.symbols);

  const stripped = stripComments(code);
  const mainBody = extractMainBody(stripped);
  const executableCode = mainBody.replace(/^\s*#.*$/gm, '');

  const control = await executeCodeBlock(executableCode, exec);
  if (control === 'return' && shouldStop()) {
    return { ok: false, cancelled: true, message: '[info] Render cancelled.' };
  }

  if (exec.commandCount === 0) {
    return {
      ok: false,
      message:
        '[error] Graphics mode detected, but no supported commands were executed. Supported: line, rectangle, bar, circle, ellipse, arc, floodfill, outtextxy, setcolor, setfillstyle, setbkcolor, cleardevice, for-loop, delay.',
    };
  }

  const warningText = exec.warnings.length > 0
    ? `\n[warn] ${Array.from(new Set(exec.warnings)).join(' | ')}`
    : '';

  const stdoutText = exec.stdout.length > 0
    ? `\n${exec.stdout.join('\n')}`
    : '';

  return {
    ok: true,
    message: `[ok] Graphics rendered. Commands executed: ${exec.commandCount}${stdoutText}${warningText}`,
  };
}

export const graphicsCanvasSize = {
  width: CANVAS_WIDTH,
  height: CANVAS_HEIGHT,
};
