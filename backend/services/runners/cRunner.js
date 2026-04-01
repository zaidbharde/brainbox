import path from 'node:path';
import {
  cleanupWorkspace,
  createTempWorkspace,
  formatCompileError,
  formatRuntimeResult,
  missingCommandResult,
  pickAvailableCommand,
  runCommand,
  writeWorkspaceFile,
} from './systemRunner.js';
import { writeTurboCompatHeaders } from './turboCompatHeaders.js';

const WINLIBS_BIN = 'C:\\Users\\skaif\\Downloads\\BrainBox (2)\\winlibs-gcc\\mingw64\\bin';

export async function runC({ code, stdin = '' }) {
  const compiler = await pickAvailableCommand([
    'gcc',
    `${WINLIBS_BIN}\\gcc.exe`,
    'clang',
    'C:\\Program Files\\LLVM\\bin\\clang.exe',
  ]);
  if (!compiler) {
    return missingCommandResult('C', 'Install gcc or clang and ensure it is in PATH.');
  }

  const workspace = await createTempWorkspace('brainbox-c-');
  try {
    const compilerEnv = { PATH: `${WINLIBS_BIN};${process.env.PATH || ''}` };
    const includeDir = await writeTurboCompatHeaders(workspace);
    const sourceFile = await writeWorkspaceFile(workspace, 'main.c', code);
    const outputFile = path.join(workspace, 'main');

    const compileResult = await runCommand(
      compiler,
      ['-std=c11', '-I', includeDir, sourceFile, '-o', outputFile],
      { cwd: workspace, timeoutMs: 8000, env: compilerEnv }
    );

    if (compileResult.code !== 0) {
      return formatCompileError(compileResult);
    }

    const runResult = await runCommand(outputFile, [], {
      cwd: workspace,
      timeoutMs: 6000,
      input: stdin,
      env: compilerEnv,
    });
    return formatRuntimeResult(runResult);
  } finally {
    await cleanupWorkspace(workspace);
  }
}
