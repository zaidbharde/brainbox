import { copyFile, mkdir, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  cleanupWorkspace,
  createTempWorkspace,
  pickAvailableCommand,
  runCommand,
  writeWorkspaceFile,
} from './runners/systemRunner.js';

const BUILD_TIMEOUT_MS = 180000;
const ANDROID_ARTIFACT_PUBLIC_DIR = path.join(os.tmpdir(), 'brainbox-android-artifacts');
const SUPPORTED_LANGUAGES = new Set(['java', 'kotlin']);
const APP_NAMESPACE = 'com.brainbox.androidlab';

export const androidArtifactPublicDir = ANDROID_ARTIFACT_PUBLIC_DIR;

function buildResultBase() {
  return {
    success: false,
    logs: '',
    error: '',
    artifactPath: '',
  };
}

function normalizeLineEndings(text = '') {
  return String(text).replace(/\r\n/g, '\n');
}

function ensurePackageDeclaration(code, language) {
  const normalized = normalizeLineEndings(code).trim();
  if (!normalized) {
    return language === 'kotlin' ? kotlinStarterCode : javaStarterCode;
  }

  if (/^\s*package\s+/m.test(normalized)) {
    return normalized;
  }

  return `package ${APP_NAMESPACE}\n\n${normalized}`;
}

function buildGradleProperties() {
  return `org.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8
android.useAndroidX=true
kotlin.code.style=official
android.nonTransitiveRClass=true
`;
}

function buildSettingsGradle() {
  return `rootProject.name = "BrainBoxAndroidLab"
include(":app")
`;
}

function buildRootGradle() {
  return `buildscript {
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        classpath("com.android.tools.build:gradle:8.5.2")
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:1.9.24")
    }
}

allprojects {
    repositories {
        google()
        mavenCentral()
    }
}

tasks.register("clean", Delete) {
    delete(rootProject.buildDir)
}
`;
}

function buildAppGradle() {
  return `apply plugin: "com.android.application"
apply plugin: "org.jetbrains.kotlin.android"

android {
    namespace "${APP_NAMESPACE}"
    compileSdk 34

    defaultConfig {
        applicationId "${APP_NAMESPACE}"
        minSdk 24
        targetSdk 34
        versionCode 1
        versionName "1.0"

        testInstrumentationRunner "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        release {
            minifyEnabled false
            proguardFiles getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro"
        }
    }

    compileOptions {
        sourceCompatibility JavaVersion.VERSION_17
        targetCompatibility JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        viewBinding true
    }
}

dependencies {
    implementation "androidx.core:core-ktx:1.13.1"
    implementation "androidx.appcompat:appcompat:1.7.0"
    implementation "com.google.android.material:material:1.12.0"
    implementation "androidx.constraintlayout:constraintlayout:2.1.4"
}
`;
}

function buildManifest() {
  return `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <application
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:label="@string/app_name"
        android:supportsRtl="true"
        android:theme="@style/Theme.BrainBoxAndroidLab">
        <activity
            android:name=".MainActivity"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>

</manifest>
`;
}

function buildStringsXml() {
  return `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">BrainBox Android Lab</string>
</resources>
`;
}

function buildColorsXml() {
  return `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="android_lab_primary">#0E7490</color>
    <color name="android_lab_on_primary">#FFFFFF</color>
    <color name="android_lab_surface">#F4FBFF</color>
    <color name="android_lab_on_surface">#0F172A</color>
</resources>
`;
}

function buildThemesXml() {
  return `<?xml version="1.0" encoding="utf-8"?>
<resources xmlns:tools="http://schemas.android.com/tools">
    <style name="Theme.BrainBoxAndroidLab" parent="Theme.Material3.Light.NoActionBar">
        <item name="colorPrimary">@color/android_lab_primary</item>
        <item name="colorOnPrimary">@color/android_lab_on_primary</item>
        <item name="android:statusBarColor">@color/android_lab_primary</item>
        <item name="android:navigationBarColor">@color/android_lab_surface</item>
        <item name="android:windowBackground">@color/android_lab_surface</item>
        <item name="android:textColorPrimary">@color/android_lab_on_surface</item>
    </style>
</resources>
`;
}

function buildWrapperScriptWindows() {
  return `@echo off
setlocal
gradle %*
`;
}

function buildWrapperScriptUnix() {
  return `#!/usr/bin/env sh
gradle "$@"
`;
}

function buildLocalProperties() {
  const sdkDir = process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME || '';
  if (!sdkDir) {
    return '';
  }

  return `sdk.dir=${sdkDir.replace(/\\/g, '\\\\')}
`;
}

function collectLogSections(stdout, stderr) {
  const chunks = [
    'Build Started',
    'Packaging Sources',
    'Compiling Sources',
    'Generating APK',
  ];

  if (stdout?.trim()) {
    chunks.push('', stdout.trim());
  }
  if (stderr?.trim()) {
    chunks.push('', stderr.trim());
  }

  return chunks.join('\n');
}

async function cleanupOldArtifacts() {
  await mkdir(androidArtifactPublicDir, { recursive: true });
  const entries = await readdir(androidArtifactPublicDir, { withFileTypes: true });
  const cutoff = Date.now() - (6 * 60 * 60 * 1000);

  await Promise.all(entries.map(async (entry) => {
    const targetPath = path.join(androidArtifactPublicDir, entry.name);
    const info = await stat(targetPath);
    if (info.mtimeMs < cutoff) {
      await rm(targetPath, { recursive: true, force: true });
    }
  }));
}

async function writeAndroidProject(workspaceDir, { language, code, layoutXml }) {
  const sourceFilename = language === 'kotlin' ? 'MainActivity.kt' : 'MainActivity.java';
  const sourceDir = language === 'kotlin'
    ? `app/src/main/kotlin/${APP_NAMESPACE.replace(/\./g, '/')}`
    : `app/src/main/java/${APP_NAMESPACE.replace(/\./g, '/')}`;

  await writeWorkspaceFile(workspaceDir, 'settings.gradle', buildSettingsGradle());
  await writeWorkspaceFile(workspaceDir, 'build.gradle', buildRootGradle());
  await writeWorkspaceFile(workspaceDir, 'gradle.properties', buildGradleProperties());
  await writeWorkspaceFile(workspaceDir, 'gradlew.bat', buildWrapperScriptWindows());
  await writeWorkspaceFile(workspaceDir, 'gradlew', buildWrapperScriptUnix());
  await writeWorkspaceFile(workspaceDir, 'app/build.gradle', buildAppGradle());
  await writeWorkspaceFile(workspaceDir, 'app/proguard-rules.pro', '');
  await writeWorkspaceFile(workspaceDir, 'app/src/main/AndroidManifest.xml', buildManifest());
  await writeWorkspaceFile(workspaceDir, `${sourceDir}/${sourceFilename}`, ensurePackageDeclaration(code, language));
  await writeWorkspaceFile(workspaceDir, 'app/src/main/res/layout/activity_main.xml', normalizeLineEndings(layoutXml));
  await writeWorkspaceFile(workspaceDir, 'app/src/main/res/values/strings.xml', buildStringsXml());
  await writeWorkspaceFile(workspaceDir, 'app/src/main/res/values/colors.xml', buildColorsXml());
  await writeWorkspaceFile(workspaceDir, 'app/src/main/res/values/themes.xml', buildThemesXml());

  const localProperties = buildLocalProperties();
  if (localProperties) {
    await writeWorkspaceFile(workspaceDir, 'local.properties', localProperties);
  }
}

function buildDependencyError() {
  return [
    'Android build tools are not available.',
    'Required local dependencies:',
    '- Gradle available on PATH',
    '- Android SDK in ANDROID_SDK_ROOT or ANDROID_HOME',
    '- Android Gradle dependencies already cached for offline use',
  ].join('\n');
}

export async function buildAndroidApk({ language, code, layoutXml }) {
  const result = buildResultBase();
  const normalizedLanguage = String(language || '').toLowerCase();

  if (!SUPPORTED_LANGUAGES.has(normalizedLanguage)) {
    result.error = 'language must be either "java" or "kotlin"';
    return result;
  }

  if (typeof code !== 'string' || !code.trim()) {
    result.error = 'code must be a non-empty string';
    return result;
  }

  if (typeof layoutXml !== 'string' || !layoutXml.trim()) {
    result.error = 'layoutXml must be a non-empty string';
    return result;
  }

  await cleanupOldArtifacts();

  const gradle = await pickAvailableCommand(['gradle']);
  if (!gradle) {
    result.logs = 'Build Started\nDependency check failed';
    result.error = buildDependencyError();
    return result;
  }

  let workspaceDir = '';
  try {
    workspaceDir = await createTempWorkspace('brainbox-android-');
    await writeAndroidProject(workspaceDir, {
      language: normalizedLanguage,
      code,
      layoutXml,
    });

    const command = process.platform === 'win32' ? 'cmd.exe' : './gradlew';
    const args = process.platform === 'win32'
      ? ['/c', 'gradlew.bat', 'assembleDebug']
      : ['assembleDebug'];

    const buildRun = await runCommand(command, args, {
      cwd: workspaceDir,
      timeoutMs: BUILD_TIMEOUT_MS,
    });

    result.logs = collectLogSections(buildRun.stdout, buildRun.stderr);

    if (buildRun.spawnError) {
      result.error = buildDependencyError();
      return result;
    }

    if (buildRun.code !== 0) {
      result.error = (buildRun.stderr || buildRun.stdout || 'APK build failed').trim();
      return result;
    }

    const apkPath = path.join(workspaceDir, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
    await stat(apkPath);

    const artifactName = `brainbox-android-${Date.now()}-${randomUUID().slice(0, 8)}.apk`;
    await copyFile(apkPath, path.join(androidArtifactPublicDir, artifactName));

    result.success = true;
    result.error = '';
    result.logs = `${result.logs}\nBuild Successful`;
    result.artifactPath = `/api/android-lab/artifacts/${artifactName}`;
    return result;
  } catch (error) {
    result.error = error instanceof Error ? error.message : 'Android APK build failed';
    if (!result.logs) {
      result.logs = 'Build Started\nBuild failed before Gradle completed';
    }
    return result;
  } finally {
    await cleanupWorkspace(workspaceDir);
  }
}

export const javaStarterCode = `package ${APP_NAMESPACE};

import android.os.Bundle;

import androidx.appcompat.app.AppCompatActivity;

public class MainActivity extends AppCompatActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);
    }
}
`;

export const kotlinStarterCode = `package ${APP_NAMESPACE}

import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
    }
}
`;

export const xmlStarterLayout = `<LinearLayout
    xmlns:android="http://schemas.android.com/apk/res/android"
    android:orientation="vertical"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:padding="24dp">

    <TextView
        android:text="Hello BrainBox"
        android:textSize="24sp"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"/>

</LinearLayout>
`;
