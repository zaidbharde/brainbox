import {
  cleanupWorkspace,
  createTempWorkspace,
  formatRuntimeResult,
  missingCommandResult,
  pickAvailableCommand,
  runCommand,
  writeWorkspaceFile,
} from './systemRunner.js';

export async function runPython({ code, stdin = '' }) {
  const python = await pickAvailableCommand(['python3', 'python']);
  if (!python) {
    return missingCommandResult('Python', 'Install python3 and ensure it is in PATH.');
  }

  const workspace = await createTempWorkspace('brainbox-python-');
  try {
    const sourceFile = await writeWorkspaceFile(workspace, 'main.py', code);
    const result = await runCommand(python, [sourceFile], { cwd: workspace, timeoutMs: 6000, input: stdin });
    return formatRuntimeResult(result);
  } finally {
    await cleanupWorkspace(workspace);
  }
}
