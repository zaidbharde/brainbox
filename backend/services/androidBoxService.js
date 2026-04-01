import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, '..');
const ANDROID_BOX_ROOT = path.join(ROOT, 'android-box');
const TEMPLATE_DIR = path.join(ANDROID_BOX_ROOT, 'template');
const PROJECTS_DIR = path.join(ANDROID_BOX_ROOT, 'projects');
const DATA_DIR = path.join(ANDROID_BOX_ROOT, 'data');
const DEFAULT_PROJECT = 'DefaultApp';
const STATE_FILENAME = '.androidbox-state.json';
const DEFAULT_ANDROID_API = 34;
const DEFAULT_GRADLE_VERSION = '8.10.2';
const DEFAULT_AGP_VERSION = '8.8.0';
const BINARY_FILE_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'ico', 'ttf', 'otf', 'woff', 'woff2', 'jar', 'aar', 'jks', 'keystore',
]);

const builds = new Map();

function ensureDir(targetPath) {
  fs.mkdirSync(targetPath, { recursive: true });
}

function removeDir(targetPath) {
  fs.rmSync(targetPath, { recursive: true, force: true });
}

function copyDir(sourceDir, targetDir) {
  ensureDir(targetDir);
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      copyDir(sourcePath, targetPath);
    } else {
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}

function getProjectPath() {
  return path.join(PROJECTS_DIR, DEFAULT_PROJECT);
}

function getProjectStatePath(projectPath = getProjectPath()) {
  return path.join(projectPath, STATE_FILENAME);
}

function getFileExtension(filePath) {
  return path.extname(filePath || '').replace(/^\./, '').toLowerCase();
}

function isBinaryPath(filePath) {
  return BINARY_FILE_EXTENSIONS.has(getFileExtension(filePath));
}

function isBinaryPayload(value) {
  return Boolean(value && typeof value === 'object' && value.encoding === 'base64' && typeof value.content === 'string');
}

function isKotlinDslProject(projectPath) {
  return (
    fs.existsSync(path.join(projectPath, 'build.gradle.kts')) ||
    fs.existsSync(path.join(projectPath, 'settings.gradle.kts')) ||
    fs.existsSync(path.join(projectPath, 'app', 'build.gradle.kts'))
  );
}

function readWrapperGradleVersion(projectPath = getProjectPath()) {
  const wrapperPropertiesPath = path.join(projectPath, 'gradle', 'wrapper', 'gradle-wrapper.properties');
  if (!fs.existsSync(wrapperPropertiesPath)) {
    return null;
  }

  const wrapperProperties = fs.readFileSync(wrapperPropertiesPath, 'utf8');
  const match = wrapperProperties.match(/distributionUrl=.*gradle-([0-9.]+)-bin\.zip/i);
  return match ? match[1] : null;
}

function findGradleCommand(projectPath = getProjectPath()) {
  const homeDir = process.env.USERPROFILE || process.env.HOME || '';
  const candidateVersions = [
    readWrapperGradleVersion(projectPath),
    DEFAULT_GRADLE_VERSION,
  ].filter(Boolean);

  for (const gradleVersion of candidateVersions) {
    const cachedGradleBin = path.join(
      homeDir,
      '.gradle',
      'wrapper',
      'dists',
      `gradle-${gradleVersion}-bin`
    );

    if (fs.existsSync(cachedGradleBin)) {
      const firstLevel = fs.readdirSync(cachedGradleBin, { withFileTypes: true }).find((entry) => entry.isDirectory());
      if (firstLevel) {
        const gradleBat = path.join(cachedGradleBin, firstLevel.name, `gradle-${gradleVersion}`, 'bin', 'gradle.bat');
        if (fs.existsSync(gradleBat)) {
          return { command: gradleBat, usesWrapper: false, version: gradleVersion };
        }
      }
    }
  }

  return null;
}

function findAndroidSdk() {
  if (process.env.ANDROID_SDK_ROOT) {
    return process.env.ANDROID_SDK_ROOT;
  }

  const localAppData = process.env.LOCALAPPDATA || '';
  const candidate = path.join(localAppData, 'Android', 'Sdk');
  return fs.existsSync(candidate) ? candidate : null;
}

function findJavaHome() {
  if (process.env.JAVA_HOME && fs.existsSync(path.join(process.env.JAVA_HOME, 'bin', 'java.exe'))) {
    return process.env.JAVA_HOME;
  }

  const candidates = [
    path.join('C:', 'Program Files', 'Android', 'Android Studio', 'jbr'),
    path.join('C:', 'Program Files', 'Android', 'Android Studio', 'jre'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'bin', 'java.exe'))) {
      return candidate;
    }
  }

  return null;
}

function getAdbPath() {
  const sdk = findAndroidSdk();
  if (!sdk) {
    return null;
  }

  const adbPath = path.join(sdk, 'platform-tools', 'adb.exe');
  return fs.existsSync(adbPath) ? adbPath : null;
}

function getEmulatorPath() {
  const sdk = findAndroidSdk();
  if (!sdk) {
    return null;
  }

  const emulatorPath = path.join(sdk, 'emulator', 'emulator.exe');
  return fs.existsSync(emulatorPath) ? emulatorPath : null;
}

function readApplicationId(projectPath) {
  const gradlePath = path.join(projectPath, 'app', 'build.gradle');
  const gradleKtsPath = path.join(projectPath, 'app', 'build.gradle.kts');

  if (fs.existsSync(gradleKtsPath)) {
    const gradleContent = fs.readFileSync(gradleKtsPath, 'utf8');
    const match = gradleContent.match(/applicationId\s*=\s*"([^"]+)"/);
    return match ? match[1] : 'com.example.myfirstapp';
  }

  if (!fs.existsSync(gradlePath)) {
    return 'com.example.myfirstapp';
  }

  const gradleContent = fs.readFileSync(gradlePath, 'utf8');
  const match = gradleContent.match(/applicationId\s+"([^"]+)"/);
  return match ? match[1] : 'com.example.myfirstapp';
}

function readLaunchActivity(projectPath, packageName = readApplicationId(projectPath)) {
  const manifestPath = path.join(projectPath, 'app', 'src', 'main', 'AndroidManifest.xml');
  if (!fs.existsSync(manifestPath)) {
    return `${packageName}/.MainActivity`;
  }

  const manifest = fs.readFileSync(manifestPath, 'utf8');
  const launcherMatch = manifest.match(/<activity\b[\s\S]*?android:name="([^"]+)"[\s\S]*?<intent-filter>[\s\S]*?android\.intent\.action\.MAIN[\s\S]*?android\.intent\.category\.LAUNCHER[\s\S]*?<\/intent-filter>/i);
  const activityName = launcherMatch?.[1] || '.MainActivity';
  const normalizedActivity = activityName.startsWith('.')
    ? `${packageName}/${activityName}`
    : activityName.includes('/')
      ? activityName
      : `${packageName}/${activityName}`;

  return normalizedActivity;
}

function findApk(projectPath) {
  const outputRoot = path.join(projectPath, 'app', 'build', 'outputs', 'apk');
  if (!fs.existsSync(outputRoot)) {
    return null;
  }

  const stack = [outputRoot];
  let fallback = null;

  while (stack.length > 0) {
    const currentDir = stack.pop();
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (entry.isFile() && entry.name.endsWith('.apk')) {
        if (entry.name.includes('debug')) {
          return fullPath;
        }
        fallback = fallback || fullPath;
      }
    }
  }

  return fallback;
}

function listFiles(dirPath, basePath = dirPath) {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  return fs.readdirSync(dirPath, { withFileTypes: true }).map((entry) => {
    const fullPath = path.join(dirPath, entry.name);
    const relPath = path.relative(basePath, fullPath).replace(/\\/g, '/');

    if (entry.isDirectory()) {
      return {
        type: 'dir',
        path: relPath,
        children: listFiles(fullPath, basePath),
      };
    }

    return {
      type: 'file',
      path: relPath,
    };
  });
}

function safeJoinProject(projectPath, relativePath) {
  const fullPath = path.resolve(projectPath, relativePath);
  if (!fullPath.startsWith(projectPath)) {
    throw new Error(`Invalid project path: ${relativePath}`);
  }
  return fullPath;
}

function isManagedSourcePath(relativePath) {
  const normalized = relativePath.replace(/\\/g, '/');
  const segments = normalized.split('/');
  if (!normalized || normalized.startsWith('.') || normalized.includes('/.')) {
    return false;
  }

  return !segments.includes('build') && !segments.includes('.gradle');
}

function collectProjectFilesMap(projectPath, currentDir = projectPath, filesMap = {}) {
  if (!fs.existsSync(currentDir)) {
    return filesMap;
  }

  const entries = fs.readdirSync(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    const relPath = path.relative(projectPath, fullPath).replace(/\\/g, '/');

    if (entry.isDirectory()) {
      if (relPath === '.gradle' || relPath.startsWith('.gradle/') || relPath === 'build' || relPath.startsWith('build/')) {
        continue;
      }
      collectProjectFilesMap(projectPath, fullPath, filesMap);
      continue;
    }

    if (!isManagedSourcePath(relPath)) {
      continue;
    }

    try {
      if (isBinaryPath(relPath)) {
        filesMap[relPath] = {
          encoding: 'base64',
          content: fs.readFileSync(fullPath).toString('base64'),
        };
      } else {
        filesMap[relPath] = fs.readFileSync(fullPath, 'utf8');
      }
    } catch {
      // Ignore unreadable/binary files in the editable file map.
    }
  }

  return filesMap;
}

function readProjectState(projectPath) {
  const statePath = getProjectStatePath(projectPath);
  if (!fs.existsSync(statePath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeProjectState(projectPath, state) {
  fs.writeFileSync(getProjectStatePath(projectPath), JSON.stringify(state, null, 2), 'utf8');
}

function getInstalledAndroidApis() {
  const sdk = findAndroidSdk();
  if (!sdk) {
    return [];
  }

  const platformsDir = path.join(sdk, 'platforms');
  if (!fs.existsSync(platformsDir)) {
    return [];
  }

  return fs.readdirSync(platformsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const match = entry.name.match(/^android-(\d+)/);
      return match ? Number(match[1]) : null;
    })
    .filter((value) => Number.isInteger(value));
}

function pickPreferredAndroidApi() {
  const apis = getInstalledAndroidApis();
  if (apis.includes(DEFAULT_ANDROID_API)) {
    return DEFAULT_ANDROID_API;
  }
  return apis.length ? Math.max(...apis) : DEFAULT_ANDROID_API;
}

function normalizeProjectSdkVersions(projectPath) {
  if (isKotlinDslProject(projectPath)) {
    return;
  }

  const buildGradlePath = path.join(projectPath, 'app', 'build.gradle');
  if (!fs.existsSync(buildGradlePath)) {
    return;
  }

  const desiredApi = pickPreferredAndroidApi();
  const content = fs.readFileSync(buildGradlePath, 'utf8');

  const updated = content
    .replace(/compileSdk\s+\d+/g, `compileSdk ${desiredApi}`)
    .replace(/targetSdk\s+\d+/g, `targetSdk ${desiredApi}`);

  if (updated !== content) {
    fs.writeFileSync(buildGradlePath, updated, 'utf8');
  }
}

function normalizeProjectSettingsGradle(projectPath) {
  if (isKotlinDslProject(projectPath)) {
    return;
  }

  const settingsPath = path.join(projectPath, 'settings.gradle');
  const current = fs.existsSync(settingsPath) ? fs.readFileSync(settingsPath, 'utf8') : '';
  const rootProjectNameMatch = current.match(/rootProject\.name\s*=\s*"([^"]+)"/);
  const rootProjectName = rootProjectNameMatch ? rootProjectNameMatch[1] : DEFAULT_PROJECT;

  const normalized = `pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "${rootProjectName}"
include ':app'
`;

  if (current.trim() !== normalized.trim()) {
    fs.writeFileSync(settingsPath, normalized, 'utf8');
  }
}

function normalizeGradleInfrastructure(projectPath) {
  if (isKotlinDslProject(projectPath)) {
    return;
  }

  const rootBuildGradlePath = path.join(projectPath, 'build.gradle');
  const gradleWrapperPropertiesPath = path.join(projectPath, 'gradle', 'wrapper', 'gradle-wrapper.properties');

  fs.writeFileSync(
    rootBuildGradlePath,
    `plugins {
    id 'com.android.application' version '${DEFAULT_AGP_VERSION}' apply false
}

task clean(type: Delete) {
    delete rootProject.buildDir
}
`,
    'utf8'
  );

  fs.writeFileSync(
    gradleWrapperPropertiesPath,
    `distributionUrl=https\\://services.gradle.org/distributions/gradle-${DEFAULT_GRADLE_VERSION}-bin.zip
`,
    'utf8'
  );
}

function ensureLocalProperties(projectPath) {
  const sdk = findAndroidSdk();
  if (!sdk) {
    return;
  }

  const localProperties = `sdk.dir=${sdk.replace(/\\/g, '\\\\')}`;
  fs.writeFileSync(path.join(projectPath, 'local.properties'), localProperties, 'utf8');
}

export function ensureAndroidBoxProject() {
  ensureDir(PROJECTS_DIR);
  ensureDir(DATA_DIR);

  const projectPath = getProjectPath();
  if (!fs.existsSync(projectPath) && fs.existsSync(TEMPLATE_DIR)) {
    copyDir(TEMPLATE_DIR, projectPath);
  }

  ensureLocalProperties(projectPath);
  normalizeGradleInfrastructure(projectPath);
  normalizeProjectSettingsGradle(projectPath);
  normalizeProjectSdkVersions(projectPath);
  return projectPath;
}

function createBuildRecord() {
  const id = crypto.randomUUID();
  const record = {
    id,
    status: 'running',
    logs: [],
    startedAt: Date.now(),
    finishedAt: null,
    code: null,
    artifactPath: '',
  };

  builds.set(id, record);
  return record;
}

function getGradleCommand(projectPath) {
  const installedGradle = findGradleCommand(projectPath);
  if (installedGradle) {
    return {
      command: 'cmd.exe',
      args: ['/c', installedGradle.command, 'assembleDebug', '--stacktrace'],
      usesWrapper: false,
    };
  }

  const gradlew = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
  const command = process.platform === 'win32' ? 'cmd.exe' : gradlew;
  const args =
    process.platform === 'win32'
      ? ['/c', gradlew, 'assembleDebug', '--stacktrace']
      : ['assembleDebug', '--stacktrace'];

  return { command, args, usesWrapper: true };
}

function createBuildEnv() {
  const env = { ...process.env };
  const sdk = findAndroidSdk();
  if (sdk) {
    env.ANDROID_SDK_ROOT = sdk;
    env.ANDROID_HOME = sdk;
  }

  const javaHome = findJavaHome();
  if (javaHome) {
    env.JAVA_HOME = javaHome;
    env.PATH = `${path.join(javaHome, 'bin')}${path.delimiter}${env.PATH || ''}`;
  }
  return env;
}

export function startAndroidBoxBuild(projectPath) {
  const record = createBuildRecord();
  normalizeProjectSdkVersions(projectPath);
  const { command, args, usesWrapper } = getGradleCommand(projectPath);
  const wrapperPath = path.join(projectPath, 'gradle', 'wrapper', 'gradle-wrapper.jar');

  if (usesWrapper && !fs.existsSync(wrapperPath)) {
    record.status = 'failed';
    record.finishedAt = Date.now();
    record.code = 1;
    record.logs.push('gradle wrapper jar missing\n');
    return record;
  }

  const child = spawn(command, args, {
    cwd: projectPath,
    env: createBuildEnv(),
  });

  child.stdout.on('data', (chunk) => {
    record.logs.push(String(chunk));
  });

  child.stderr.on('data', (chunk) => {
    record.logs.push(String(chunk));
  });

  child.on('close', (code) => {
    record.status = code === 0 ? 'success' : 'failed';
    record.finishedAt = Date.now();
    record.code = code;
    if (code === 0) {
      const apkPath = findApk(projectPath);
      if (apkPath) {
        record.artifactPath = apkPath;
      }
    }
  });

  child.on('error', (error) => {
    record.status = 'failed';
    record.finishedAt = Date.now();
    record.code = 1;
    record.logs.push(`${error.message}\n`);
  });

  return record;
}

export function getAndroidBoxStatus() {
  const projectPath = ensureAndroidBoxProject();
  const selectedGradle = findGradleCommand(projectPath);

  return {
    ok: true,
    project: DEFAULT_PROJECT,
    javaHome: findJavaHome(),
    androidSdk: findAndroidSdk(),
    gradleWrapper: fs.existsSync(path.join(projectPath, 'gradle', 'wrapper', 'gradle-wrapper.jar')),
    adb: getAdbPath(),
    emulator: getEmulatorPath(),
    compileSdk: pickPreferredAndroidApi(),
    wrapperGradleVersion: readWrapperGradleVersion(projectPath),
    selectedGradleVersion: selectedGradle?.version || null,
  };
}

export function getAndroidBoxTree() {
  const projectPath = ensureAndroidBoxProject();
  return {
    project: DEFAULT_PROJECT,
    tree: listFiles(projectPath),
  };
}

export function getAndroidBoxBuild(buildId) {
  return builds.get(buildId) || null;
}

export function getAndroidBoxBuildSummary(buildId) {
  const record = builds.get(buildId);
  if (!record) {
    return null;
  }

  const apkPath = record.artifactPath && fs.existsSync(record.artifactPath) ? record.artifactPath : '';
  const relativeArtifactPath = apkPath
    ? `/api/android-lab/api/artifacts/${path.basename(apkPath)}`
    : '';

  return {
    id: record.id,
    status: record.status,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
    code: record.code,
    artifactPath: relativeArtifactPath,
    logs: record.logs.join(''),
  };
}

export function getAndroidBoxArtifactPath(filename) {
  for (const record of builds.values()) {
    if (record.artifactPath && path.basename(record.artifactPath) === filename && fs.existsSync(record.artifactPath)) {
      return record.artifactPath;
    }
  }

  return null;
}

export function getAndroidBoxProjectPayload() {
  const projectPath = ensureAndroidBoxProject();
  const files = collectProjectFilesMap(projectPath);
  const state = readProjectState(projectPath);

  return {
    project: state?.project || {
      name: DEFAULT_PROJECT,
      package: readApplicationId(projectPath),
      language: 'java',
      minSdk: 29,
      branch: 'main',
    },
    files,
  };
}

export function syncAndroidBoxProject(project) {
  const projectPath = ensureAndroidBoxProject();
  const previousState = readProjectState(projectPath);
  const previousFiles = new Set(previousState?.trackedFiles || []);

  const nextProject = {
    name: project?.name || DEFAULT_PROJECT,
    package: project?.package || readApplicationId(projectPath),
    language: project?.language || 'java',
    minSdk: Number.isInteger(project?.minSdk) ? project.minSdk : 29,
    branch: project?.branch || 'main',
  };

  const files = project?.files && typeof project.files === 'object' ? project.files : {};
  const nextPaths = new Set();

  for (const relativePath of previousFiles) {
    if (files[relativePath] !== undefined) {
      continue;
    }

    const targetPath = safeJoinProject(projectPath, relativePath);
    fs.rmSync(targetPath, { force: true, recursive: true });
  }

  for (const [relativePath, content] of Object.entries(files)) {
    if (!isManagedSourcePath(relativePath)) {
      continue;
    }

    const targetPath = safeJoinProject(projectPath, relativePath);
    ensureDir(path.dirname(targetPath));
    if (isBinaryPayload(content)) {
      fs.writeFileSync(targetPath, Buffer.from(content.content, 'base64'));
    } else {
      fs.writeFileSync(targetPath, typeof content === 'string' ? content : String(content ?? ''), 'utf8');
    }
    nextPaths.add(relativePath);
  }

  ensureLocalProperties(projectPath);
  normalizeGradleInfrastructure(projectPath);
  normalizeProjectSettingsGradle(projectPath);
  normalizeProjectSdkVersions(projectPath);
  writeProjectState(projectPath, {
    project: nextProject,
    trackedFiles: Array.from(nextPaths).sort(),
    updatedAt: new Date().toISOString(),
  });

  return {
    ok: true,
    project: nextProject,
    tree: listFiles(projectPath),
  };
}

export function listAndroidDevices() {
  return new Promise((resolve) => {
    const adbPath = getAdbPath();
    if (!adbPath) {
      resolve({ devices: [], error: 'adb not found' });
      return;
    }

    const child = spawn(adbPath, ['devices']);
    let output = '';

    child.stdout.on('data', (chunk) => {
      output += chunk;
    });

    child.stderr.on('data', (chunk) => {
      output += chunk;
    });

    child.on('close', () => {
      const devices = output
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(1)
        .map((line) => line.trim().split(/\s+/))
        .filter((parts) => parts.length >= 2)
        .map(([id, state]) => ({ id, state }));

      resolve({ devices });
    });

    child.on('error', () => {
      resolve({ devices: [], error: 'adb not found' });
    });
  });
}

export function runAndroidBoxProject(deviceId) {
  return new Promise((resolve, reject) => {
    const adbPath = getAdbPath();
    if (!adbPath) {
      reject(new Error('adb not found'));
      return;
    }

    const projectPath = ensureAndroidBoxProject();
    normalizeProjectSdkVersions(projectPath);
    const { command, args, usesWrapper } = getGradleCommand(projectPath);
    const wrapperPath = path.join(projectPath, 'gradle', 'wrapper', 'gradle-wrapper.jar');
    if (usesWrapper && !fs.existsSync(wrapperPath)) {
      reject(new Error('gradle wrapper jar missing'));
      return;
    }

    const packageName = readApplicationId(projectPath);
    const buildProcess = spawn(command, args, {
      cwd: projectPath,
      env: createBuildEnv(),
    });

    let logs = '';

    buildProcess.stdout.on('data', (chunk) => {
      logs += chunk;
    });

    buildProcess.stderr.on('data', (chunk) => {
      logs += chunk;
    });

    buildProcess.on('error', (error) => {
      reject(error);
    });

    buildProcess.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`build failed\n${logs}`));
        return;
      }

      const apkPath = findApk(projectPath);
      if (!apkPath) {
        reject(new Error(`apk not found\n${logs}`));
        return;
      }

      const installArgs = deviceId ? ['-s', deviceId, 'install', '-r', apkPath] : ['install', '-r', apkPath];
      const installProcess = spawn(adbPath, installArgs);
      let installOutput = '';

      installProcess.stdout.on('data', (chunk) => {
        installOutput += chunk;
      });

      installProcess.stderr.on('data', (chunk) => {
        installOutput += chunk;
      });

      installProcess.on('error', (error) => {
        reject(error);
      });

      installProcess.on('close', () => {
        const launcherActivity = readLaunchActivity(projectPath, packageName);
        const launchArgs = deviceId
          ? ['-s', deviceId, 'shell', 'am', 'start', '-n', launcherActivity]
          : ['shell', 'am', 'start', '-n', launcherActivity];
        const launchProcess = spawn(adbPath, launchArgs);
        let launchOutput = '';

        launchProcess.stdout.on('data', (chunk) => {
          launchOutput += chunk;
        });

        launchProcess.stderr.on('data', (chunk) => {
          launchOutput += chunk;
        });

        launchProcess.on('error', (error) => {
          reject(error);
        });

        launchProcess.on('close', () => {
          resolve({
            ok: true,
            logs: logs + installOutput + launchOutput,
          });
        });
      });
    });
  });
}
