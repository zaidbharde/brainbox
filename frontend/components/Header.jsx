import { Link, useLocation } from 'react-router-dom';

const studioUrl = import.meta.env.VITE_X86_STUDIO_URL || 'http://localhost:5173';
const androidBoxUrl = '/android-box/index.html';
const linuxTerminalUrl = import.meta.env.VITE_LINUX_TERMINAL_URL || 'http://localhost:4300';

const navItems = [
  { label: 'Home', to: '/' },
  { label: 'Features', to: '/#features' },
  { label: 'Language Complier', to: '/start-coding' },
  { label: 'Android Box', to: androidBoxUrl, newTab: true },
  { label: 'Linux Terminal', to: linuxTerminalUrl, newTab: true },
  { label: 'Python IDLE', to: '/python-idle' },
  { label: 'SQL Lab', to: '/sql-lab' },
  { label: 'MATLAB Lab', to: '/octave' },
  { label: 'x86 Studio', to: studioUrl },
];

export default function Header() {
  const location = useLocation();

  return (
    <header className="sticky top-0 z-50 border-b border-border/80 bg-[#070b12]/85 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <Link className="text-xl font-bold text-white font-sans" to="/">
          Brain<span className="text-accent">Box</span>
        </Link>
        <nav className="flex items-center gap-2 md:gap-4">
          {navItems.map((item) => {
            const isActive = location.pathname === item.to;
            const isHash = item.to.includes('#');
            return (
              <a
                key={item.label}
                href={item.to}
                target={item.newTab ? '_blank' : undefined}
                rel={item.newTab ? 'noreferrer' : undefined}
                className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                  isActive && !isHash
                    ? 'bg-[#132238] text-white'
                    : 'text-slate-300 hover:bg-[#132238] hover:text-white'
                }`}
              >
                {item.label}
              </a>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
