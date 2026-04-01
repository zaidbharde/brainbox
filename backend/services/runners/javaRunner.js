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

function buildJavaSource(code) {
  const classMatch = code.match(/(?:public\s+)?class\s+([A-Za-z_][A-Za-z0-9_]*)/);
  const className = classMatch?.[1] || 'Main';

  if (classMatch) {
    return { className, source: code };
  }

  const wrapped = `public class ${className} {\n  public static void main(String[] args) {\n${code
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n')}\n  }\n}\n`;

  return { className, source: wrapped };
}

export async function runJava({ code, stdin = '' }) {
  const javac = await pickAvailableCommand(['javac']);
  const java = await pickAvailableCommand(['java']);

  if (!javac || !java) {
    return missingCommandResult('Java', 'Install JDK (javac + java) and ensure it is in PATH.');
  }

  const workspace = await createTempWorkspace('brainbox-java-');
  try {
    const { className, source } = buildJavaSource(code);
    const sourceFile = await writeWorkspaceFile(workspace, `${className}.java`, source);

    const compileResult = await runCommand(javac, [sourceFile], { cwd: workspace, timeoutMs: 12000 });
    if (compileResult.code !== 0) {
      return formatCompileError(compileResult);
    }

    const runResult = await runCommand(java, ['-cp', workspace, className], {
      cwd: workspace,
      timeoutMs: 6000,
      input: stdin,
    });
    return formatRuntimeResult(runResult);
  } finally {
    await cleanupWorkspace(workspace);
  }
}
