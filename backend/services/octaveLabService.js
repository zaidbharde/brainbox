import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readdir, rm, stat } from 'node:fs/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  cleanupWorkspace,
  createTempWorkspace,
  pickAvailableCommand,
  runCommand,
  writeWorkspaceFile,
} from './runners/systemRunner.js';

const MAX_CODE_CHARS = 30000;
const OCTAVE_TIMEOUT_MS = 12000;
const PLOT_RETENTION_MS = 6 * 60 * 60 * 1000;
const DEFAULT_DOCKER_IMAGE = process.env.OCTAVE_DOCKER_IMAGE || 'gnuoctave/octave:latest';

const blockedPatterns = [
  { regex: /\bsystem\s*\(/i, label: 'system()' },
  { regex: /\bunix\s*\(/i, label: 'unix()' },
  { regex: /\bdos\s*\(/i, label: 'dos()' },
  { regex: /\bpopen\s*\(/i, label: 'popen()' },
  { regex: /(^|\n)\s*!/m, label: 'shell escape' },
];

export const octavePlotPublicDir = path.join(os.tmpdir(), 'brainbox-octave-plots');

function validateUserCode(code) {
  if (typeof code !== 'string') {
    return 'code must be a string';
  }
  if (!code.trim()) {
    return 'code is required';
  }
  if (code.length > MAX_CODE_CHARS) {
    return `code is too long (max ${MAX_CODE_CHARS} characters)`;
  }

  for (const rule of blockedPatterns) {
    if (rule.regex.test(code)) {
      return `disallowed Octave command detected: ${rule.label}`;
    }
  }

  return '';
}

function buildExecutionScript(userCode, plotOutputPath) {
  const normalizedCode = userCode.replace(/\r\n?/g, '\n');
  const escapedPlotPath = plotOutputPath.replace(/\\/g, '/').replace(/'/g, "''");

  return [
    'close all;',
    'warning("off", "all");',
    'set(0, "defaultfigurevisible", "off");',
    'try',
    '  __brainbox_toolkits = available_graphics_toolkits();',
    '  if (any(strcmp(__brainbox_toolkits, "gnuplot")))',
    '    graphics_toolkit("gnuplot");',
    '    setenv("GNUTERM", "png");',
    '  endif',
    'catch',
    'end_try_catch',
    `__brainbox_plot_file = '${escapedPlotPath}';`,
    '',
    normalizedCode,
    '',
    '__brainbox_figs = get(0, "children");',
    'if (!isempty(__brainbox_figs))',
    '  if (exist("__brainbox_toolkits", "var") && any(strcmp(__brainbox_toolkits, "gnuplot")))',
    '    for __brainbox_idx = 1:numel(__brainbox_figs)',
    '      try',
    '        graphics_toolkit(__brainbox_figs(__brainbox_idx), "gnuplot");',
    '      catch',
    '      end_try_catch',
    '    endfor',
    '  endif',
    '  try',
    '    print(__brainbox_figs(1), __brainbox_plot_file, "-dpngcairo", "-r130");',
    '  catch',
    '    try',
    '      print(__brainbox_figs(1), __brainbox_plot_file, "-dpng", "-r130");',
    '    catch',
    '      try',
    '        print(__brainbox_plot_file, "-dpng", "-r130");',
    '      catch',
    '      end_try_catch',
    '    end_try_catch',
    '  end_try_catch',
    'endif',
    '',
  ].join('\n');
}

function isDockerInfrastructureError(stderrText = '') {
  const text = stderrText.toLowerCase();
  return (
    text.includes('cannot connect to the docker daemon') ||
    text.includes('permission denied while trying to connect') ||
    text.includes('unable to find image') ||
    text.includes('pull access denied') ||
    text.includes('is the docker daemon running')
  );
}

async function runWithDocker(workspaceDir) {
  const dockerCommand = await pickAvailableCommand(['docker']);
  if (!dockerCommand) {
    return null;
  }

  const dockerArgs = [
    'run',
    '--rm',
    '--network',
    'none',
    '--cpus',
    '1',
    '--memory',
    '256m',
    '--pids-limit',
    '128',
    '-v',
    `${workspaceDir}:/work`,
    '-w',
    '/work',
    DEFAULT_DOCKER_IMAGE,
    'octave',
    '--no-gui',
    '--quiet',
    'main.m',
  ];

  const runResult = await runCommand(dockerCommand, dockerArgs, {
    timeoutMs: OCTAVE_TIMEOUT_MS,
    cwd: workspaceDir,
  });

  if (runResult.spawnError) {
    return null;
  }

  if (runResult.code !== 0 && isDockerInfrastructureError(runResult.stderr)) {
    return null;
  }

  return {
    ...runResult,
    engine: 'Docker',
  };
}

async function runWithLocalOctave(workspaceDir) {
  const octaveCandidates = process.platform === 'win32'
    ? [
        'octave-cli',
        'octave',
        ...findWindowsOctaveCandidates(),
      ]
    : ['octave-cli', 'octave'];
  const octaveCommand = await pickAvailableCommand(octaveCandidates);
  if (!octaveCommand) {
    return null;
  }

  const runResult = await runCommand(
    octaveCommand,
    ['--no-gui', '--quiet', 'main.m'],
    {
      timeoutMs: OCTAVE_TIMEOUT_MS,
      cwd: workspaceDir,
    }
  );

  if (runResult.spawnError) {
    return null;
  }

  return {
    ...runResult,
    engine: 'Local Octave',
  };
}

function findWindowsOctaveCandidates() {
  const candidates = [];
  const roots = [
    path.join('C:', 'Program Files', 'GNU Octave'),
    path.join('C:', 'Program Files'),
  ];

  for (const root of roots) {
    if (!fs.existsSync(root)) {
      continue;
    }

    try {
      const entries = fs.readdirSync(root, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || !entry.name.toLowerCase().includes('octave')) {
          continue;
        }

        const directCli = path.join(root, entry.name, 'mingw64', 'bin', 'octave-cli.exe');
        const directGui = path.join(root, entry.name, 'mingw64', 'bin', 'octave.exe');
        const rootCli = path.join(root, entry.name, 'octave-cli.exe');
        const rootGui = path.join(root, entry.name, 'octave.exe');

        for (const candidate of [directCli, directGui, rootCli, rootGui]) {
          if (fs.existsSync(candidate)) {
            candidates.push(candidate);
          }
        }
      }
    } catch {
      // Ignore filesystem probing failures and continue with PATH-based lookup.
    }
  }

  return candidates;
}

async function fileExistsWithData(filepath) {
  try {
    const details = await stat(filepath);
    return details.isFile() && details.size > 0;
  } catch {
    return false;
  }
}

async function ensurePlotDirectory() {
  await mkdir(octavePlotPublicDir, { recursive: true });
}

async function cleanupExpiredPlots() {
  await ensurePlotDirectory();

  const files = await readdir(octavePlotPublicDir, { withFileTypes: true });
  const now = Date.now();

  await Promise.all(
    files
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.png'))
      .map(async (entry) => {
        const filepath = path.join(octavePlotPublicDir, entry.name);
        try {
          const details = await stat(filepath);
          if (now - details.mtimeMs > PLOT_RETENTION_MS) {
            await rm(filepath, { force: true });
          }
        } catch {
          // Ignore per-file cleanup failures.
        }
      })
  );
}

function composeOutput(stdout, stderr, success) {
  const trimmedStdout = (stdout || '').trim();
  const trimmedStderr = (stderr || '').trim();

  if (success) {
    return [trimmedStdout, trimmedStderr].filter(Boolean).join(trimmedStdout && trimmedStderr ? '\n' : '');
  }

  return trimmedStdout;
}

export async function runOctaveCode(code) {
  const validationError = validateUserCode(code);
  if (validationError) {
    return {
      success: false,
      output: '',
      error: validationError,
      plotPath: '',
      engine: 'Validation',
    };
  }

  await cleanupExpiredPlots();

  let workspaceDir = '';

  try {
    workspaceDir = await createTempWorkspace('brainbox-octave-');
    const workspacePlotPath = path.join(workspaceDir, 'plot.png');
    const script = buildExecutionScript(code, workspacePlotPath);

    await writeWorkspaceFile(workspaceDir, 'main.m', script);

    const execution = (await runWithDocker(workspaceDir)) || (await runWithLocalOctave(workspaceDir));

    if (!execution) {
      return {
        success: false,
        output: '',
        error:
          'GNU Octave runtime not found. Install Octave locally or run Docker with the image gnuoctave/octave:latest.',
        plotPath: '',
        engine: 'Unavailable',
      };
    }

    const success = execution.code === 0;
    let plotPath = '';

    if (await fileExistsWithData(workspacePlotPath)) {
      await ensurePlotDirectory();
      const plotFilename = `octave-plot-${Date.now()}-${randomUUID().slice(0, 8)}.png`;
      const publicPlotPath = path.join(octavePlotPublicDir, plotFilename);
      await copyFile(workspacePlotPath, publicPlotPath);
      plotPath = `/api/octave-plots/${plotFilename}`;
    }

    return {
      success,
      output: composeOutput(execution.stdout, execution.stderr, success),
      error: success ? '' : (execution.stderr || 'Octave execution failed').trim(),
      plotPath,
      engine: execution.engine,
    };
  } finally {
    await cleanupWorkspace(workspaceDir);
  }
}
