import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import Header from '../components/Header';

const linuxTerminalUrl = import.meta.env.VITE_LINUX_TERMINAL_URL || 'http://localhost:4300';

export default function LinuxTerminal() {
  useEffect(() => {
    window.open(linuxTerminalUrl, '_blank', 'noopener,noreferrer');
  }, []);

  return (
    <div className="min-h-screen bg-[#04070d] text-slate-100">
      <Header />
      <main className="mx-auto flex min-h-[calc(100vh-73px)] max-w-3xl flex-col items-center justify-center px-6 py-16 text-center">
        <div className="rounded-2xl border border-border bg-panel/80 p-8 shadow-panel">
          <h1 className="text-3xl font-semibold text-white">Linux Terminal opens in a new tab</h1>
          <p className="mt-3 text-slate-300">
            If the browser blocked the popup, use the button below to open the Linux virtual terminal manually.
          </p>
          <div className="mt-6 flex items-center justify-center gap-3">
            <a
              href={linuxTerminalUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center rounded-lg border border-accent/40 bg-[#102136] px-4 py-2 text-sm font-medium text-accent transition hover:border-accent hover:text-white"
            >
              Open Linux Terminal
            </a>
            <Link
              to="/"
              className="inline-flex items-center justify-center rounded-lg border border-border px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-slate-500 hover:text-white"
            >
              Back Home
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
