import {
  cleanupWorkspace,
  createTempWorkspace,
  formatRuntimeResult,
  missingCommandResult,
  pickAvailableCommand,
  runCommand,
  writeWorkspaceFile,
} from './systemRunner.js';

export async function runJavaScript({ code, stdin = '' }) {
  const nodeCmd = await pickAvailableCommand(['node']);
  if (!nodeCmd) {
    return missingCommandResult('JavaScript', 'Install Node.js and ensure it is in PATH.');
  }

  const workspace = await createTempWorkspace('brainbox-js-');
  try {
    const sourceFile = await writeWorkspaceFile(workspace, 'main.js', code);
    const runResult = await runCommand(nodeCmd, [sourceFile], {
      cwd: workspace,
      timeoutMs: 6000,
      input: stdin,
    });
    return formatRuntimeResult(runResult);
  } finally {
    await cleanupWorkspace(workspace);
  }
}
