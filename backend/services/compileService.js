import { runnerRegistry } from './runners/index.js';

export async function compileAndRun({ language, code, stdin = '' }) {
  const normalizedLanguage = language.toLowerCase();
  const runner = runnerRegistry[normalizedLanguage];

  if (!runner) {
    return {
      success: false,
      output: '',
      error: `Language '${language}' is not supported yet.`,
    };
  }

  return runner({ code, stdin });
}
