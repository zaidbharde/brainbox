import { runJavaScript } from './javascriptRunner.js';
import { runPython } from './pythonRunner.js';
import { runJava } from './javaRunner.js';
import { runC } from './cRunner.js';
import { runCpp } from './cppRunner.js';

export const runnerRegistry = {
  javascript: runJavaScript,
  python: runPython,
  java: runJava,
  c: runC,
  cpp: runCpp,
};
