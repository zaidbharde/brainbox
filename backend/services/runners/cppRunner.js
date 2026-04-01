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

export async function runCpp({ code, stdin = '' }) {
  const compiler = await pickAvailableCommand([
    'g++',
    `${WINLIBS_BIN}\\g++.exe`,
    'clang++',
    'C:\\Program Files\\LLVM\\bin\\clang++.exe',
  ]);
  if (!compiler) {
    return missingCommandResult('C++', 'Install g++ or clang++ and ensure it is in PATH.');
  }

  const workspace = await createTempWorkspace('brainbox-cpp-');
  try {
    const compilerEnv = { PATH: `${WINLIBS_BIN};${process.env.PATH || ''}` };
    const includeDir = await writeTurboCompatHeaders(workspace);
    const sourceFile = await writeWorkspaceFile(workspace, 'main.cpp', code);
    const outputFile = path.join(workspace, 'main');

    const compileResult = await runCommand(
      compiler,
      ['-std=c++17', '-I', includeDir, sourceFile, '-o', outputFile],
      { cwd: workspace, timeoutMs: 10000, env: compilerEnv }
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
