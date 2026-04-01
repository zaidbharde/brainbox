import { ArrowRight, Binary, Braces, Cpu, ServerCog, Smartphone, TerminalSquare } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Header from '../components/Header';

const features = [
  {
    icon: <Braces className="h-5 w-5" />,
    title: 'Universal Compiler',
    body: 'Compile and run C, C++, Python, Java, and JavaScript in one place.',
  },
  {
    icon: <Cpu className="h-5 w-5" />,
    title: 'x86 / 8086 Studio',
    body: 'Open the full x86 simulator directly inside the BrainBox ecosystem.',
  },
  {
    icon: <Smartphone className="h-5 w-5" />,
    title: 'Android Box IDE',
    body: 'Open the Android Box workspace for project browsing, Gradle builds, and device run flows inside BrainBox.',
  },
  {
    icon: <TerminalSquare className="h-5 w-5" />,
    title: 'Linux Virtual Terminal',
    body: 'Open a browser-based Linux terminal with learning mode, real shell sessions, and command practice.',
  },
  {
    icon: <ServerCog className="h-5 w-5" />,
    title: 'Scalable Execution Layer',
    body: 'Clean `/api/compile` architecture with pluggable runtime runners.',
  },
  {
    icon: <Binary className="h-5 w-5" />,
    title: 'Engineering-first UX',
    body: 'Focused coding UX with grid-driven layouts and IDE-level ergonomics.',
  },
];

export default function Landing() {
  const studioUrl = import.meta.env.VITE_X86_STUDIO_URL || 'http://localhost:5173';
  const androidBoxUrl = '/android-box/index.html';
  const linuxTerminalUrl = import.meta.env.VITE_LINUX_TERMINAL_URL || 'http://localhost:4300';
  const backgroundVideoUrl = '/website-animation-4k.mp4';
  const [scrollY, setScrollY] = useState(0);

  useEffect(() => {
    const handleScroll = () => {
      setScrollY(window.scrollY || 0);
    };

    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  const videoTransform = `translate3d(0, ${scrollY * 0.22}px, 0) scale(${1 + Math.min(scrollY * 0.00008, 0.08)})`;
  const heroTransform = `translate3d(0, ${scrollY * 0.1}px, 0)`;
  const featuresTransform = `translate3d(0, ${Math.max(0, 30 - scrollY * 0.04)}px, 0)`;

  return (
    <div className="min-h-screen bg-[#04070d] text-slate-100">
      <Header />
      <main className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <video
            className="h-full w-full object-cover opacity-70 saturate-[1.18] contrast-[1.12] brightness-[1.18]"
            style={{ transform: videoTransform, transformOrigin: 'center center' }}
            autoPlay
            loop
            muted
            playsInline
          >
            <source src={backgroundVideoUrl} type="video/mp4" />
          </video>
        </div>
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(110,208,255,0.22),transparent_35%),radial-gradient(circle_at_90%_20%,rgba(139,255,190,0.12),transparent_30%)]" />
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(4,7,13,0.12)_0%,rgba(4,7,13,0.42)_55%,rgba(4,7,13,0.72)_100%)]" />
        <div className="pointer-events-none absolute inset-0 opacity-12 [background-image:linear-gradient(rgba(107,114,128,0.14)_1px,transparent_1px),linear-gradient(90deg,rgba(107,114,128,0.14)_1px,transparent_1px)] [background-size:42px_42px]" />

        <section
          className="relative mx-auto flex max-w-7xl flex-col items-center gap-10 px-6 pb-16 pt-20 text-center transition-transform duration-150 md:pt-24"
          style={{ transform: heroTransform }}
        >
          <div className="max-w-4xl">
            <h1 className="text-balance text-4xl font-bold leading-tight text-white md:text-7xl font-sans">
              BrainBox: One Platform, Every Language.
            </h1>
            <p className="mx-auto mt-6 max-w-3xl text-xl text-slate-300">
              BrainBox is the main platform to code, compile, and learn systems programming in one place.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link
                to="/start-coding"
                className="brainbox-cta-button brainbox-cta-start"
              >
                Language Complier
                <ArrowRight className="h-4 w-4" />
              </Link>
              <a
                href={studioUrl}
                className="brainbox-cta-button brainbox-cta-studio"
              >
                x86 Studio
              </a>
              <a
                href={androidBoxUrl}
                target="_blank"
                rel="noreferrer"
                className="brainbox-cta-button brainbox-cta-android"
              >
                Android Box
              </a>
              <a
                href={linuxTerminalUrl}
                target="_blank"
                rel="noreferrer"
                className="brainbox-cta-button brainbox-cta-linux"
              >
                🐧 Linux Terminal
              </a>
              <Link
                to="/python-idle"
                className="brainbox-cta-button brainbox-cta-python"
              >
                🟨 Python IDLE
              </Link>
              <Link
                to="/sql-lab"
                className="brainbox-cta-button brainbox-cta-sql"
              >
                🟦 SQL Lab
              </Link>
              <Link
                to="/octave"
                className="brainbox-cta-button brainbox-cta-octave"
              >
                📈 MATLAB Lab
              </Link>
            </div>
          </div>
        </section>

        <section
          id="features"
          className="relative mx-auto max-w-7xl px-6 pb-24 transition-transform duration-200"
          style={{ transform: featuresTransform }}
        >
          <div className="grid gap-4 md:grid-cols-2">
            {features.map((feature) => (
              <article
                key={feature.title}
                className="rounded-xl border border-border bg-panel/80 p-6 shadow-panel transition hover:-translate-y-0.5 hover:border-accent/60"
              >
                <div className="mb-4 inline-flex rounded-lg border border-accent/30 bg-[#102136] p-2 text-accent">
                  {feature.icon}
                </div>
                <h2 className="text-xl font-semibold text-white">{feature.title}</h2>
                <p className="mt-2 text-slate-300">{feature.body}</p>
              </article>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
