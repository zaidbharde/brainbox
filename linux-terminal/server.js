const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const pty = require("node-pty");
const { Server } = require("socket.io");

const PORT = process.env.PORT || 4300;
const HOST = process.env.HOST || "0.0.0.0";
const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const LEARNING_DATA_DIR = path.join(ROOT_DIR, "learning_data");
const SESSION_TTL_MS = 1000 * 60 * 60;

fs.mkdirSync(LEARNING_DATA_DIR, { recursive: true });

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*"
  }
});

app.use(express.static(PUBLIC_DIR));
app.use(
  "/vendor/xterm",
  express.static(path.join(ROOT_DIR, "node_modules", "@xterm", "xterm"))
);
app.use(
  "/vendor/xterm/addon-fit",
  express.static(path.join(ROOT_DIR, "node_modules", "@xterm", "addon-fit"))
);

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    platform: os.platform(),
    shell: detectShell().label,
    fullAccess: true
  });
});

app.get("/api/learning/progress/:sessionId", (req, res) => {
  const progressFile = path.join(LEARNING_DATA_DIR, `${req.params.sessionId}_progress.json`);
  if (fs.existsSync(progressFile)) {
    res.json(JSON.parse(fs.readFileSync(progressFile, "utf8")));
  } else {
    res.json({ completedLessons: [], currentLesson: 0 });
  }
});

app.post("/api/learning/progress/:sessionId", (req, res) => {
  let body = "";
  req.on("data", chunk => body += chunk);
  req.on("end", () => {
    const progressFile = path.join(LEARNING_DATA_DIR, `${req.params.sessionId}_progress.json`);
    fs.writeFileSync(progressFile, JSON.stringify(JSON.parse(body), null, 2));
    res.json({ ok: true });
  });
});

app.get("/api/learning/lessons", (_req, res) => {
  res.json(LEARNING_LESSONS);
});

const sessions = new Map();

io.on("connection", (socket) => {
  let attachedSession = null;

  socket.on("session:init", ({ sessionId, cols, rows } = {}) => {
    try {
      const normalizedId = normalizeSessionId(sessionId);
      const session = getOrCreateSession(normalizedId, socket);
      attachedSession = session;
      session.attach(socket, cols, rows);
    } catch (error) {
      socket.emit("terminal:error", formatError(error));
    }
  });

  socket.on("terminal:input", (data) => {
    if (!attachedSession) {
      return;
    }
    attachedSession.write(data);
  });

  socket.on("terminal:resize", ({ cols, rows } = {}) => {
    if (!attachedSession) {
      return;
    }
    attachedSession.resize(cols, rows);
  });

  socket.on("learning:hint", ({ lessonId }) => {
    if (!attachedSession) return;
    const hint = LEARNING_LESSONS.find(l => l.id === lessonId);
    if (hint) {
      attachedSession.write(`\r\n\x1b[1;36m[Learning Mode Hint]\x1b[0m ${hint.hint}\r\n`);
    }
  });

  socket.on("learning:complete", ({ lessonId, sessionId }) => {
    const progressFile = path.join(LEARNING_DATA_DIR, `${sessionId}_progress.json`);
    let progress = { completedLessons: [], currentLesson: 0 };
    if (fs.existsSync(progressFile)) {
      progress = JSON.parse(fs.readFileSync(progressFile, "utf8"));
    }
    if (!progress.completedLessons.includes(lessonId)) {
      progress.completedLessons.push(lessonId);
      progress.currentLesson = Math.min(progress.currentLesson + 1, LEARNING_LESSONS.length - 1);
      fs.writeFileSync(progressFile, JSON.stringify(progress, null, 2));
    }
  });

  socket.on("disconnect", () => {
    if (attachedSession) {
      attachedSession.detach(socket.id);
      attachedSession = null;
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`VER Linux Terminal running at http://localhost:${PORT}`);
  console.log(`Platform: ${os.platform()} | Shell: ${detectShell().label}`);
  console.log(`Full System Access: ENABLED`);
});

function normalizeSessionId(sessionId) {
  if (typeof sessionId === "string" && /^[a-zA-Z0-9_-]{8,128}$/.test(sessionId)) {
    return sessionId;
  }
  return crypto.randomUUID().replace(/-/g, "");
}

function getOrCreateSession(sessionId) {
  const existing = sessions.get(sessionId);
  if (existing) {
    existing.cancelCleanup();
    return existing;
  }

  const session = new TerminalSession(sessionId);
  sessions.set(sessionId, session);
  return session;
}

function formatError(error) {
  return {
    message: error instanceof Error ? error.message : String(error)
  };
}

class TerminalSession {
  constructor(sessionId) {
    this.id = sessionId;
    this.clientIds = new Set();
    this.cleanupTimer = null;

    const homeDir = this.getHomeDirectory();
    fs.mkdirSync(homeDir, { recursive: true });

    const shell = detectShell(homeDir);
    this.shellInfo = shell;
    this.homeDir = homeDir;

    this.ptyProcess = pty.spawn(shell.command, shell.args, {
      name: "xterm-256color",
      cols: 120,
      rows: 30,
      cwd: shell.cwd,
      env: shell.env
    });

    this.ptyProcess.onData((data) => {
      this.broadcast("terminal:output", data);
    });

    this.ptyProcess.onExit(({ exitCode, signal }) => {
      this.broadcast(
        "terminal:output",
        `\r\n[Session ended: exit=${exitCode}, signal=${signal}]\r\n`
      );
      this.destroy();
    });
  }

  getHomeDirectory() {
    if (os.platform() === "win32") {
      return process.env.USERPROFILE || process.env.HOME || os.homedir();
    }
    return os.homedir();
  }

  attach(socket, cols, rows) {
    this.clientIds.add(socket.id);

    if (Number.isInteger(cols) && Number.isInteger(rows)) {
      this.resize(cols, rows);
    }

    socket.emit("session:ready", {
      sessionId: this.id,
      homeDir: this.homeDir,
      platform: os.platform(),
      shell: this.shellInfo.label,
      fullAccess: true
    });
  }

  detach(socketId) {
    this.clientIds.delete(socketId);

    if (this.clientIds.size === 0) {
      this.scheduleCleanup();
    }
  }

  write(data) {
    this.cancelCleanup();
    this.ptyProcess.write(data);
  }

  resize(cols, rows) {
    const safeCols = Math.max(80, Number(cols) || 120);
    const safeRows = Math.max(20, Number(rows) || 30);
    this.ptyProcess.resize(safeCols, safeRows);
  }

  broadcast(event, payload) {
    for (const clientId of this.clientIds) {
      io.to(clientId).emit(event, payload);
    }
  }

  scheduleCleanup() {
    this.cancelCleanup();
    this.cleanupTimer = setTimeout(() => {
      this.destroy();
    }, SESSION_TTL_MS);
  }

  cancelCleanup() {
    if (this.cleanupTimer) {
      clearTimeout(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  destroy() {
    this.cancelCleanup();
    sessions.delete(this.id);

    try {
      this.ptyProcess.kill();
    } catch (_error) {
    }
  }
}

function detectShell(homeDir = ROOT_DIR) {
  const platform = os.platform();

  if (platform === "win32") {
    if (commandExists("wsl.exe", ["--status"])) {
      return {
        label: "WSL Bash (Ubuntu)",
        command: "wsl.exe",
        args: ["bash", "-i"],
        cwd: process.env.HOME || os.homedir(),
        env: {
          ...process.env,
          HOME: os.homedir(),
          TERM: "xterm-256color"
        }
      };
    }

    const gitBash = findGitBash();
    if (gitBash) {
      return {
        label: "Git Bash",
        command: gitBash,
        args: ["-i"],
        cwd: os.homedir(),
        env: {
          ...process.env,
          HOME: os.homedir(),
          TERM: "xterm-256color"
        }
      };
    }

    const cmdPrompt = findCmdPrompt();
    if (cmdPrompt) {
      return {
        label: "Windows CMD (WSL recommended)",
        command: cmdPrompt,
        args: [],
        cwd: os.homedir(),
        env: process.env
      };
    }

    throw new Error("No shell found. Install WSL or Git Bash.");
  }

  const shellCommand = process.env.SHELL || "/bin/bash";
  if (!fs.existsSync(shellCommand)) {
    throw new Error("Bash not found.");
  }

  return {
    label: "Bash",
    command: shellCommand,
    args: ["-i"],
    cwd: os.homedir(),
    env: {
      ...process.env,
      HOME: os.homedir(),
      TERM: "xterm-256color"
    }
  };
}

function commandExists(command, args) {
  const result = spawnSync(command, args, {
    stdio: "ignore",
    shell: false
  });
  return !result.error && result.status === 0;
}

function findGitBash() {
  const candidates = [
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
    "C:\\Program Files (x86)\\Git\\bin\\bash.exe"
  ];
  return candidates.find(c => fs.existsSync(c)) || null;
}

function findCmdPrompt() {
  const candidates = [
    "C:\\Windows\\System32\\cmd.exe"
  ];
  return candidates.find(c => fs.existsSync(c)) || null;
}

const LEARNING_LESSONS = [
  {
    id: "intro",
    title: "Welcome to Linux",
    description: "Learn the basics of Linux terminal",
    hint: "Type 'ls' to list files in your current directory",
    order: 1
  },
  {
    id: "navigation",
    title: "File Navigation",
    description: "Learn to navigate using cd and pwd",
    hint: "Use 'cd foldername' to enter a directory, 'cd ..' to go back",
    order: 2
  },
  {
    id: "files",
    title: "Creating & Managing Files",
    description: "Learn touch, mkdir, rm, and more",
    hint: "Use 'touch filename' to create a file, 'mkdir foldername' for directory",
    order: 3
  },
  {
    id: "viewing",
    title: "Viewing File Content",
    description: "Learn cat, less, head, tail",
    hint: "Use 'cat filename' to view entire file, 'head -n 10 file' for first 10 lines",
    order: 4
  },
  {
    id: "searching",
    title: "Search & Find",
    description: "Learn grep, find, and locate",
    hint: "Use 'grep pattern file' to search, 'find . -name \"*.txt\"' to find files",
    order: 5
  },
  {
    id: "permissions",
    title: "File Permissions",
    description: "Understand chmod, chown, ls -l",
    hint: "Use 'ls -l' to see permissions, 'chmod 755 file' to change permissions",
    order: 6
  },
  {
    id: "processes",
    title: "Process Management",
    description: "Learn ps, top, kill, bg, fg",
    hint: "Use 'ps aux' to see processes, 'kill PID' to stop a process",
    order: 7
  },
  {
    id: "networking",
    title: "Networking Basics",
    description: "Learn ping, curl, wget, netstat",
    hint: "Use 'ping google.com' to test connection, 'curl url' to fetch webpage",
    order: 8
  },
  {
    id: "packaging",
    title: "Package Management",
    description: "Learn apt, yum, pacman basics",
    hint: "On Ubuntu: 'sudo apt update' then 'sudo apt install packagename'",
    order: 9
  },
  {
    id: "scripting",
    title: "Bash Scripting",
    description: "Write your first shell script",
    hint: "Create a file with '#!/bin/bash' at top, use 'chmod +x script.sh' then run",
    order: 10
  }
];
