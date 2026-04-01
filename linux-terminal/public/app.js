(function () {
  const terminalElement = document.getElementById("terminal");
  const statusElement = document.getElementById("status");
  const shellInfoElement = document.getElementById("shell-info");
  const learningPanel = document.getElementById("learning-panel");
  const helpPanel = document.getElementById("help-panel");
  const learningLessonsEl = document.getElementById("learning-lessons");

  const socket = io({
    transports: ["websocket"]
  });

  let sessionId = null;
  let lessons = [];

  const fitAddon = new FitAddon.FitAddon();
  const term = new Terminal({
    cursorBlink: true,
    cursorStyle: "block",
    fontFamily: 'Consolas, "Cascadia Mono", "Courier New", monospace',
    fontSize: 15,
    lineHeight: 1.25,
    allowTransparency: true,
    theme: {
      background: "#050505",
      foreground: "#f3fff2",
      cursor: "#78ff72",
      selectionBackground: "#214a27",
      black: "#050505",
      red: "#ff7a7a",
      green: "#78ff72",
      yellow: "#f2f18d",
      blue: "#6ca6ff",
      magenta: "#ec9eff",
      cyan: "#90fff7",
      white: "#ffffff",
      brightBlack: "#66806b",
      brightRed: "#ff9d9d",
      brightGreen: "#b2ffab",
      brightYellow: "#fff8af",
      brightBlue: "#8fbcff",
      brightMagenta: "#f2b6ff",
      brightCyan: "#b4fff9",
      brightWhite: "#ffffff"
    }
  });

  term.loadAddon(fitAddon);
  term.open(terminalElement);
  fitTerminal();
  term.focus();

  window.addEventListener("resize", debounce(() => {
    fitTerminal();
    sendResize();
  }, 100));

  term.onData((data) => {
    socket.emit("terminal:input", data);
  });

  let lastPasteTime = 0;

  term.attachCustomKeyEventHandler((e) => {
    if (e.ctrlKey && e.key === "c" && e.type === "keydown") {
      const selection = term.getSelection();
      if (selection && selection.length > 0) {
        navigator.clipboard.writeText(selection);
        return false;
      }
      return true;
    }

    if (e.ctrlKey && e.key === "v" && e.type === "keydown") {
      e.preventDefault();
      e.stopPropagation();
      
      const now = Date.now();
      if (now - lastPasteTime < 200) return false;
      lastPasteTime = now;
      
      navigator.clipboard.readText().then(text => {
        if (text && text.length > 0) {
          text = text.replace(/\r\n/g, "\n");
          socket.emit("terminal:input", text);
        }
      }).catch(() => {
        const textarea = document.createElement("textarea");
        textarea.value = "";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("paste");
        const text = textarea.value;
        document.body.removeChild(textarea);
        if (text) {
          text = text.replace(/\r\n/g, "\n");
          socket.emit("terminal:input", text);
        }
      });
      return false;
    }

    if (e.ctrlKey && e.key === "a" && e.type === "keydown") {
      term.selectAll();
      return false;
    }

    return true;
  });

  socket.on("connect", () => {
    setStatus("Connecting...", "connecting");
    socket.emit("session:init", {
      sessionId: getSessionId(),
      cols: term.cols,
      rows: term.rows
    });
  });

  socket.on("disconnect", () => {
    setStatus("Disconnected", "error");
    term.write("\r\n[Connection lost]\r\n");
  });

  socket.on("terminal:output", (data) => {
    term.write(data);
  });

  socket.on("session:ready", ({ sessionId: sid, shell, platform, fullAccess }) => {
    sessionId = sid;
    localStorage.setItem("ver-linux-session-id", sessionId);
    setStatus(fullAccess ? "Full System Access" : "Sandboxed", "normal");
    shellInfoElement.textContent = `${shell} on ${platform} | Full Access`;
    term.focus();
    sendResize();
    loadLearningMode();
  });

  socket.on("terminal:error", ({ message }) => {
    setStatus("Error", "error");
    term.writeln("");
    term.writeln(`Error: ${message}`);
  });

  document.getElementById("btn-learning").addEventListener("click", () => {
    togglePanel(learningPanel);
  });

  document.getElementById("btn-help").addEventListener("click", () => {
    togglePanel(helpPanel);
  });

  document.getElementById("close-learning").addEventListener("click", () => {
    learningPanel.classList.add("hidden");
  });

  document.getElementById("close-help").addEventListener("click", () => {
    helpPanel.classList.add("hidden");
  });

  function togglePanel(panel) {
    const wasHidden = panel.classList.contains("hidden");
    learningPanel.classList.add("hidden");
    helpPanel.classList.add("hidden");
    if (wasHidden) {
      panel.classList.remove("hidden");
    } else {
      panel.classList.add("hidden");
    }
  }

  async function loadLearningMode() {
    try {
      const response = await fetch("/api/learning/lessons");
      lessons = await response.json();

      const progressResponse = await fetch(`/api/learning/progress/${sessionId}`);
      const progress = await progressResponse.json();

      renderLessons(lessons, progress);
    } catch (err) {
      console.error("Failed to load learning mode:", err);
    }
  }

  function renderLessons(lessons, progress) {
    learningLessonsEl.innerHTML = "";

    lessons.forEach((lesson, index) => {
      const isCompleted = progress.completedLessons.includes(lesson.id);
      const isCurrent = index === progress.currentLesson || (!isCompleted && index === 0);

      const item = document.createElement("div");
      item.className = "lesson-item" +
        (isCompleted ? " completed" : "") +
        (isCurrent ? " current" : "");
      item.innerHTML = `
        <div class="lesson-title">
          <span class="lesson-order">${index + 1}</span>
          ${lesson.title}
        </div>
        <div class="lesson-desc">${lesson.description}</div>
        <div class="lesson-hint">
          <strong>Hint:</strong> ${lesson.hint}
        </div>
      `;

      item.addEventListener("click", () => {
        item.classList.toggle("expanded");
        if (!isCompleted) {
          socket.emit("learning:hint", { lessonId: lesson.id });
        }
      });

      learningLessonsEl.appendChild(item);
    });
  }

  function fitTerminal() {
    fitAddon.fit();
  }

  function sendResize() {
    socket.emit("terminal:resize", {
      cols: term.cols,
      rows: term.rows
    });
  }

  function setStatus(message, type = "normal") {
    statusElement.textContent = message;
    statusElement.className = "status";
    if (type === "connecting") {
      statusElement.classList.add("connecting");
    } else if (type === "error") {
      statusElement.classList.add("error");
    }
  }

  function getSessionId() {
    return localStorage.getItem("ver-linux-session-id");
  }

  function debounce(fn, wait) {
    let timeoutId;
    return function debounced() {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(fn, wait);
    };
  }
})();
