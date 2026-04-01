import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pickAvailableCommand } from './runners/systemRunner.js';

const SESSION_IDLE_MS = 10 * 60 * 1000;
const COMMAND_TIMEOUT_MS = 7000;
const MAX_OUTPUT_CHARS = 12000;
const PROMPT_AT_LINE_START_REGEX = /(^|\n)(>>> |\.\.\. )/g;
const PROMPT_ANYWHERE_REGEX = /(>>> ?|\.\.\. ?)/g;

function clipOutput(text) {
  if (!text) {
    return '';
  }
  if (text.length <= MAX_OUTPUT_CHARS) {
    return text;
  }
  return `${text.slice(0, MAX_OUTPUT_CHARS)}\n...[output truncated]`;
}

function normalizeReplOutput(text) {
  return text
    .replace(PROMPT_AT_LINE_START_REGEX, '$1')
    .replace(PROMPT_ANYWHERE_REGEX, '')
    .trim();
}

class PythonIdleSessionManager {
  constructor() {
    this.sessions = new Map();
    this.pythonCommandPromise = null;
  }

  async resolvePythonCommand() {
    if (!this.pythonCommandPromise) {
      this.pythonCommandPromise = this.findUsablePythonCommand();
    }
    return this.pythonCommandPromise;
  }

  async findUsablePythonCommand() {
    const homeDir = os.homedir();
    const candidates = process.platform === 'win32'
      ? [
          path.join(homeDir, 'AppData', 'Local', 'Programs', 'Python', 'Python312', 'python.exe'),
          path.join(homeDir, 'AppData', 'Local', 'Programs', 'Python', 'Python313', 'python.exe'),
          path.join(homeDir, 'AppData', 'Local', 'Programs', 'Python', 'Python311', 'python.exe'),
          'python3',
          'python',
        ]
      : ['python3', 'python'];

    for (const candidate of candidates) {
      if (candidate.includes(path.sep) && !fs.existsSync(candidate)) {
        continue;
      }

      const resolved = await pickAvailableCommand([candidate]);
      if (resolved) {
        return resolved;
      }
    }

    return null;
  }

  async createSession() {
    const python = await this.resolvePythonCommand();
    if (!python) {
      throw new Error('Python runtime not found. Install python3 and ensure it is in PATH.');
    }

    const sessionId = randomUUID();
    const child = spawn(python, ['-u', '-i', '-q'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const session = {
      id: sessionId,
      child,
      queue: Promise.resolve(),
      timeoutHandle: null,
      activeCommand: null,
      stdoutSinceLastCommand: '',
      stderrSinceLastCommand: '',
    };

    child.stdout.on('data', (chunk) => {
      this.handleStdout(sessionId, chunk.toString());
    });

    child.stderr.on('data', (chunk) => {
      this.handleStderr(sessionId, chunk.toString());
    });

    child.on('close', () => {
      const existing = this.sessions.get(sessionId);
      if (existing?.activeCommand) {
        existing.activeCommand.resolve({
          success: false,
          output: normalizeReplOutput(existing.activeCommand.stdout),
          error: 'Python session ended unexpectedly.',
        });
      }
      this.destroySession(sessionId);
    });

    child.on('error', () => {
      const existing = this.sessions.get(sessionId);
      if (existing?.activeCommand) {
        existing.activeCommand.resolve({
          success: false,
          output: normalizeReplOutput(existing.activeCommand.stdout),
          error: 'Python session encountered a process error.',
        });
      }
      this.destroySession(sessionId);
    });

    this.sessions.set(sessionId, session);
    this.refreshIdleTimeout(sessionId);

    return { sessionId };
  }

  async executeLine(sessionId, line) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return {
        success: false,
        output: '',
        error: 'Session not found. Restart your Python session.',
      };
    }

    if (typeof line !== 'string') {
      return { success: false, output: '', error: 'line must be a string' };
    }

    const trimmed = line.replace(/\r?\n/g, '');
    if (!trimmed.trim()) {
      return { success: true, output: '', error: '' };
    }

    this.refreshIdleTimeout(sessionId);
    session.queue = session.queue.then(() => this.runQueuedCommand(sessionId, trimmed));
    return session.queue;
  }

  async runQueuedCommand(sessionId, commandLine) {
    const session = this.sessions.get(sessionId);
    if (!session || session.child.killed || session.child.exitCode !== null) {
      return {
        success: false,
        output: '',
        error: 'Session not active. Restart your Python session.',
      };
    }

    // Each line is sent to a long-lived `python -i` process, then we emit a unique marker.
    // The marker lets us delimit output for exactly one REPL command while preserving state.
    const marker = `__BRAINBOX_REPL_DONE_${Date.now()}_${Math.floor(Math.random() * 1e6)}__`;

    return new Promise((resolve) => {
      const timeoutHandle = setTimeout(() => {
        const current = this.sessions.get(sessionId);
        if (!current?.activeCommand) {
          return;
        }

        current.activeCommand.resolve({
          success: false,
          output: normalizeReplOutput(current.activeCommand.stdout),
          error: 'Command timed out. Session terminated for safety.',
        });
        this.terminateSession(sessionId);
      }, COMMAND_TIMEOUT_MS);

      session.activeCommand = {
        marker,
        stdout: session.stdoutSinceLastCommand,
        stderr: session.stderrSinceLastCommand,
        resolve: (result) => {
          clearTimeout(timeoutHandle);
          session.activeCommand = null;
          session.stdoutSinceLastCommand = '';
          session.stderrSinceLastCommand = '';
          this.refreshIdleTimeout(sessionId);
          resolve({
            success: result.success,
            output: clipOutput(result.output),
            error: clipOutput(result.error),
          });
        },
      };

      session.stdoutSinceLastCommand = '';
      session.stderrSinceLastCommand = '';

      const markerLine = `print(\"${marker}\")`;
      session.child.stdin.write(`${commandLine}\n`);
      session.child.stdin.write(`${markerLine}\n`);
    });
  }

  handleStdout(sessionId, chunk) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    const active = session.activeCommand;
    if (!active) {
      session.stdoutSinceLastCommand += chunk;
      return;
    }

    active.stdout += chunk;
    const markerIndex = active.stdout.indexOf(active.marker);
    if (markerIndex === -1) {
      return;
    }

    const beforeMarker = active.stdout.slice(0, markerIndex);
    const afterMarker = active.stdout.slice(markerIndex + active.marker.length);

    // Keep any trailing prompt data out of current command output.
    session.stdoutSinceLastCommand = afterMarker;

    active.resolve({
      success: true,
      output: normalizeReplOutput(beforeMarker),
      error: normalizeReplOutput(active.stderr),
    });
  }

  handleStderr(sessionId, chunk) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    const active = session.activeCommand;
    if (!active) {
      session.stderrSinceLastCommand += chunk;
      return;
    }
    active.stderr += chunk;
  }

  refreshIdleTimeout(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    if (session.timeoutHandle) {
      clearTimeout(session.timeoutHandle);
    }

    session.timeoutHandle = setTimeout(() => {
      this.terminateSession(sessionId);
    }, SESSION_IDLE_MS);
  }

  terminateSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    if (session.timeoutHandle) {
      clearTimeout(session.timeoutHandle);
    }

    if (session.activeCommand) {
      session.activeCommand.resolve({
        success: false,
        output: normalizeReplOutput(session.activeCommand.stdout),
        error: 'Session terminated.',
      });
    }

    if (session.child && !session.child.killed && session.child.exitCode === null) {
      session.child.kill('SIGKILL');
    }

    this.sessions.delete(sessionId);
  }

  destroySession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    if (session.timeoutHandle) {
      clearTimeout(session.timeoutHandle);
    }
    this.sessions.delete(sessionId);
  }

  async restartSession(sessionId) {
    if (sessionId) {
      this.terminateSession(sessionId);
    }
    return this.createSession();
  }

  shutdownAll() {
    for (const sessionId of this.sessions.keys()) {
      this.terminateSession(sessionId);
    }
  }
}

export const pythonIdleSessionManager = new PythonIdleSessionManager();
