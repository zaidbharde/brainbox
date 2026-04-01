import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eraser, LogOut, RefreshCw, TerminalSquare } from 'lucide-react';

function pushHistory(setHistory, entry) {
  setHistory((prev) => [...prev, { id: `${Date.now()}-${Math.random()}`, ...entry }]);
}

export default function PythonIdle() {
  const navigate = useNavigate();
  const [sessionId, setSessionId] = useState('');
  const [line, setLine] = useState('');
  const [busy, setBusy] = useState(false);
  const [connecting, setConnecting] = useState(true);
  const [history, setHistory] = useState([
    {
      id: 'boot',
      type: 'system',
      text: 'Python Interactive (IDLE Mode) ready. Session starts once connected.',
    },
  ]);

  const inputRef = useRef(null);
  const outputRef = useRef(null);

  const appendSystem = useCallback((text) => {
    pushHistory(setHistory, { type: 'system', text });
  }, []);

  const appendOutput = useCallback((text) => {
    if (!text?.trim()) {
      return;
    }
    pushHistory(setHistory, { type: 'output', text });
  }, []);

  const appendError = useCallback((text) => {
    if (!text?.trim()) {
      return;
    }
    pushHistory(setHistory, { type: 'error', text });
  }, []);

  const createSession = useCallback(async () => {
    setConnecting(true);
    try {
      const response = await fetch('/api/python-idle/session', { method: 'POST' });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'Failed to create session');
      }

      setSessionId(result.sessionId);
      appendSystem('Session connected. Variables persist until restart, exit, refresh, or timeout.');
      return result.sessionId;
    } catch (error) {
      appendError(`[connection error] ${error.message}`);
      return '';
    } finally {
      setConnecting(false);
    }
  }, [appendError, appendSystem]);

  useEffect(() => {
    createSession();
  }, [createSession]);

  useEffect(() => {
    if (!outputRef.current) {
      return;
    }
    outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [history]);

  useEffect(() => {
    if (!inputRef.current || connecting || busy || !sessionId) {
      return;
    }
    inputRef.current.focus();
  }, [busy, connecting, sessionId]);

  useEffect(() => {
    return () => {
      if (!sessionId) {
        return;
      }
      fetch('/api/python-idle/exit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
        keepalive: true,
      }).catch(() => {});
    };
  }, [sessionId]);

  const runLine = useCallback(async () => {
    const currentLine = line;
    if (!currentLine.trim() || !sessionId || busy) {
      return;
    }

    setBusy(true);
    setLine('');
    pushHistory(setHistory, { type: 'input', text: currentLine });

    try {
      const response = await fetch('/api/python-idle/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, line: currentLine }),
      });
      const result = await response.json();

      if (response.status === 410) {
        appendError(result.error || 'Session expired.');
        const newSessionId = await createSession();
        if (newSessionId) {
          appendSystem('Previous session ended. New session created.');
        }
        return;
      }

      if (!response.ok) {
        throw new Error(result.error || 'Execution failed');
      }

      appendOutput(result.output);
      appendError(result.error);
    } catch (error) {
      appendError(`[execution error] ${error.message}`);
    } finally {
      setBusy(false);
    }
  }, [appendError, appendOutput, appendSystem, busy, createSession, line, sessionId]);

  const restartSession = useCallback(async () => {
    setBusy(true);
    try {
      const response = await fetch('/api/python-idle/restart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'Could not restart session');
      }
      setSessionId(result.sessionId);
      appendSystem('Session restarted. Interpreter state has been cleared.');
    } catch (error) {
      appendError(`[restart error] ${error.message}`);
    } finally {
      setBusy(false);
    }
  }, [appendError, appendSystem, sessionId]);

  const exitSession = useCallback(async () => {
    if (!sessionId) {
      navigate('/');
      return;
    }

    setBusy(true);
    try {
      await fetch('/api/python-idle/exit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
    } finally {
      setBusy(false);
      navigate('/');
    }
  }, [navigate, sessionId]);

  const headerStatus = useMemo(() => {
    if (connecting) {
      return 'Connecting...';
    }
    if (!sessionId) {
      return 'Disconnected';
    }
    return busy ? 'Running command...' : 'Connected';
  }, [busy, connecting, sessionId]);

  return (
    <div className="h-screen w-screen overflow-hidden bg-[#06070a] text-slate-100">
      <div className="mx-auto flex h-full w-full max-w-7xl flex-col px-4 py-5 sm:px-6">
        <header className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#293244] bg-[#0b0f17] px-4 py-3">
          <div className="flex items-center gap-2">
            <TerminalSquare className="h-5 w-5 text-amber-300" />
            <h1 className="text-lg font-semibold text-white">Python Interactive (IDLE Mode)</h1>
            <span className="ml-2 rounded-md border border-[#3d4a61] bg-[#151d2a] px-2 py-1 text-xs text-slate-300">
              {headerStatus}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <button
              type="button"
              onClick={() => setHistory([])}
              className="inline-flex items-center gap-2 rounded-md border border-[#364257] bg-[#131b29] px-3 py-2 text-slate-100 transition hover:border-[#4f5e78]"
            >
              <Eraser className="h-4 w-4" />
              Clear Console
            </button>
            <button
              type="button"
              onClick={restartSession}
              disabled={busy || connecting}
              className="inline-flex items-center gap-2 rounded-md border border-[#364257] bg-[#131b29] px-3 py-2 text-slate-100 transition hover:border-[#4f5e78] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw className="h-4 w-4" />
              Restart Session
            </button>
            <button
              type="button"
              onClick={exitSession}
              className="inline-flex items-center gap-2 rounded-md border border-rose-400/50 bg-rose-950/30 px-3 py-2 text-rose-100 transition hover:border-rose-300"
            >
              <LogOut className="h-4 w-4" />
              Exit
            </button>
            <Link
              to="/"
              className="rounded-md border border-[#364257] bg-[#131b29] px-3 py-2 text-slate-200 transition hover:border-[#4f5e78]"
            >
              Home
            </Link>
          </div>
        </header>

        <section className="flex min-h-0 flex-1 flex-col rounded-xl border border-[#2a3140] bg-[#090d15] shadow-[0_18px_50px_rgba(0,0,0,0.45)]">
          <div
            ref={outputRef}
            className="flex-1 overflow-y-auto px-4 py-4 font-mono text-[15px] leading-7 text-slate-100"
          >
            {history.map((entry) => (
              <div key={entry.id} className="whitespace-pre-wrap break-words">
                {entry.type === 'input' && <span className="text-amber-300">&gt;&gt;&gt; </span>}
                <span
                  className={
                    entry.type === 'error'
                      ? 'text-rose-300'
                      : entry.type === 'system'
                        ? 'text-slate-400'
                        : 'text-slate-100'
                  }
                >
                  {entry.text}
                </span>
              </div>
            ))}
          </div>

          <div className="border-t border-[#273040] px-4 py-3 font-mono">
            <label htmlFor="python-idle-input" className="sr-only">Python REPL input</label>
            <div className="flex items-center gap-3">
              <span className="select-none text-amber-300">&gt;&gt;&gt;</span>
              <input
                id="python-idle-input"
                ref={inputRef}
                value={line}
                onChange={(event) => setLine(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    runLine();
                  }
                }}
                disabled={busy || connecting || !sessionId}
                autoComplete="off"
                spellCheck={false}
                className="w-full border-none bg-transparent text-slate-100 outline-none placeholder:text-slate-500"
                placeholder={
                  connecting
                    ? 'Connecting to Python runtime...'
                    : 'Type one Python line and press Enter'
                }
              />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
