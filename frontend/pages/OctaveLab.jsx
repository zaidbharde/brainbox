import { useCallback, useMemo, useState } from 'react';
import Editor from '@monaco-editor/react';
import { Eraser, Home, Play, Sigma, SquareTerminal } from 'lucide-react';
import { Link } from 'react-router-dom';

const starterCode = `% MATLAB Lab (GNU Octave backend)
% Example: plot a damped signal

x = linspace(0, 4*pi, 200);
y = exp(-0.15*x) .* sin(3*x);

printf('Generated %d samples\\n', length(x));
plot(x, y, 'LineWidth', 2);
grid on;
title('Damped Sine Wave');
xlabel('x');
ylabel('y');`;

export default function OctaveLab() {
  const [code, setCode] = useState(starterCode);
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState('Ready. Write MATLAB/Octave code and click Run.');
  const [errorText, setErrorText] = useState('');
  const [plotUrl, setPlotUrl] = useState('');
  const [engineLabel, setEngineLabel] = useState('Waiting');

  const status = useMemo(() => {
    if (busy) {
      return 'Running...';
    }
    return errorText ? 'Error' : 'Ready';
  }, [busy, errorText]);

  const runCode = useCallback(async () => {
    if (!code.trim()) {
      setErrorText('Code is empty.');
      setOutput('');
      setPlotUrl('');
      return;
    }

    setBusy(true);
    setErrorText('');
    setOutput('Running Octave...');
    setPlotUrl('');

    try {
      const response = await fetch('/api/run-octave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });

      const result = await response.json();
      setEngineLabel(result.engine || 'Unknown');

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Octave execution failed.');
      }

      setOutput(result.output?.trim() ? result.output : 'Execution finished with no console output.');
      setErrorText('');
      setPlotUrl(result.plotPath ? `${result.plotPath}?t=${Date.now()}` : '');
    } catch (error) {
      setOutput('');
      setErrorText(error.message);
      setPlotUrl('');
    } finally {
      setBusy(false);
    }
  }, [code]);

  const clearAll = useCallback(() => {
    setCode('');
    setOutput('Editor cleared.');
    setErrorText('');
    setPlotUrl('');
    setEngineLabel('Waiting');
  }, []);

  return (
    <div className="h-screen w-screen overflow-hidden bg-[#0f172a] text-slate-100">
      <div className="mx-auto flex h-full max-w-[1700px] flex-col px-4 py-4 sm:px-6">
        <header className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-200/20 bg-white/5 px-4 py-3 shadow-[0_16px_45px_rgba(0,0,0,0.45)] backdrop-blur">
          <div className="flex items-center gap-3">
            <Sigma className="h-5 w-5 text-emerald-200" />
            <h1 className="text-lg font-semibold text-white">MATLAB Lab (GNU Octave)</h1>
            <span className="rounded-md border border-emerald-300/40 bg-emerald-300/15 px-2 py-1 text-xs text-emerald-100">
              {status}
            </span>
            <span className="rounded-md border border-slate-300/30 bg-slate-300/10 px-2 py-1 text-xs text-slate-200">
              Engine: {engineLabel}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={runCode}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-md border border-emerald-300/60 bg-emerald-400/15 px-3 py-2 text-sm font-medium text-emerald-100 transition hover:bg-emerald-300/25 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Play className="h-4 w-4" />
              Run
            </button>
            <button
              type="button"
              onClick={clearAll}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-md border border-slate-400/45 bg-slate-400/10 px-3 py-2 text-sm text-slate-100 transition hover:border-slate-300/70 disabled:opacity-60"
            >
              <Eraser className="h-4 w-4" />
              Clear
            </button>
            <Link
              to="/"
              className="inline-flex items-center gap-2 rounded-md border border-slate-400/45 bg-slate-400/10 px-3 py-2 text-sm text-slate-100 transition hover:border-slate-300/70"
            >
              <Home className="h-4 w-4" />
              Home
            </Link>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[1.15fr_0.85fr]">
          <section className="min-h-0 overflow-hidden rounded-2xl border border-emerald-200/20 bg-white/5 shadow-[0_14px_45px_rgba(0,0,0,0.36)] backdrop-blur">
            <div className="border-b border-emerald-200/15 bg-black/20 px-4 py-2 text-sm text-slate-300">Octave Editor</div>
            <div className="h-[calc(100%-41px)] min-h-[320px]">
              <Editor
                height="100%"
                defaultLanguage="matlab"
                value={code}
                theme="vs-dark"
                onChange={(value) => setCode(value || '')}
                options={{
                  minimap: { enabled: false },
                  automaticLayout: true,
                  fontSize: 14,
                  wordWrap: 'on',
                  scrollBeyondLastLine: false,
                }}
              />
            </div>
          </section>

          <section className="grid min-h-0 gap-4 md:grid-rows-[0.95fr_1.05fr]">
            <article className="min-h-0 overflow-hidden rounded-2xl border border-emerald-200/20 bg-white/5 shadow-[0_14px_45px_rgba(0,0,0,0.36)] backdrop-blur">
              <div className="border-b border-emerald-200/15 bg-black/20 px-4 py-2 text-sm text-slate-300">Output Console</div>
              <div className="h-[calc(100%-41px)] overflow-auto p-4 font-mono text-sm">
                {errorText ? (
                  <div className="rounded-md border border-rose-300/45 bg-rose-400/10 p-3 text-rose-100">
                    <p className="mb-1 inline-flex items-center gap-2 font-semibold">
                      <SquareTerminal className="h-4 w-4" />
                      Octave Error
                    </p>
                    <pre className="whitespace-pre-wrap break-words text-xs text-rose-100/90">{errorText}</pre>
                  </div>
                ) : (
                  <pre className="whitespace-pre-wrap break-words text-slate-200">{output}</pre>
                )}
              </div>
            </article>

            <article className="min-h-0 overflow-hidden rounded-2xl border border-emerald-200/20 bg-white/5 shadow-[0_14px_45px_rgba(0,0,0,0.36)] backdrop-blur">
              <div className="border-b border-emerald-200/15 bg-black/20 px-4 py-2 text-sm text-slate-300">Plot Preview</div>
              <div className="flex h-[calc(100%-41px)] items-center justify-center p-4">
                {plotUrl ? (
                  <img
                    src={plotUrl}
                    alt="Generated GNU Octave plot"
                    className="max-h-full w-full rounded-lg border border-emerald-200/25 bg-slate-950/60 object-contain"
                  />
                ) : (
                  <p className="text-center text-sm text-slate-400">
                    Run a script that creates a figure to render plot output here.
                  </p>
                )}
              </div>
            </article>
          </section>
        </div>
      </div>
    </div>
  );
}
