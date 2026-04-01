import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_TIMEOUT_MS = 5000;
const MAX_OUTPUT_CHARS = 12000;

function clipOutput(text) {
  if (!text) {
    return '';
  }
  if (text.length <= MAX_OUTPUT_CHARS) {
    return text;
  }
  return `${text.slice(0, MAX_OUTPUT_CHARS)}\n...[output truncated]`;
}

export async function createTempWorkspace(prefix = 'brainbox-') {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

export async function cleanupWorkspace(dir) {
  if (!dir) {
    return;
  }
  await rm(dir, { recursive: true, force: true });
}

export async function writeWorkspaceFile(dir, filename, content) {
  const filepath = path.join(dir, filename);
  await mkdir(path.dirname(filepath), { recursive: true });
  await writeFile(filepath, content, 'utf8');
  return filepath;
}

export async function pickAvailableCommand(candidates) {
  for (const candidate of candidates) {
    const result = await runCommand(candidate, ['--version'], { timeoutMs: 1500 });
    if (result.spawnError === null) {
      return candidate;
    }
  }
  return null;
}

export function formatRuntimeResult(result) {
  return {
    success: result.code === 0,
    output: clipOutput(result.stdout),
    error: result.code === 0 ? '' : clipOutput(result.stderr || 'Execution failed'),
  };
}

export function formatCompileError(result) {
  return {
    success: false,
    output: clipOutput(result.stdout),
    error: clipOutput(result.stderr || 'Compilation failed'),
  };
}

export function missingCommandResult(languageName, installHint) {
  return {
    success: false,
    output: '',
    error: `${languageName} runtime/compiler not found. ${installHint}`,
  };
}

export async function runCommand(command, args = [], options = {}) {
  const {
    cwd,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    env,
    input = '',
  } = options;

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let finished = false;
    let timedOut = false;

    const child = spawn(command, args, {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let spawnError = null;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    if (input && child.stdin.writable) {
      child.stdin.write(input);
    }
    if (child.stdin.writable) {
      child.stdin.end();
    }

    child.on('error', (error) => {
      spawnError = error;
    });

    child.on('close', (code) => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timer);

      resolve({
        code: timedOut ? 124 : (code ?? 1),
        stdout,
        stderr: timedOut ? `${stderr}\nProcess timed out after ${timeoutMs}ms` : stderr,
        timedOut,
        spawnError,
      });
    });
  });
}
