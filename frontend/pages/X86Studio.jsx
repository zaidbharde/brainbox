import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';

const studioUrl = import.meta.env.VITE_X86_STUDIO_URL || 'http://localhost:5173';

/**
 * Carry `?engine=v2` across from this page to the studio.
 *
 * This page does not embed the studio in an iframe -- it hands the whole window
 * over to it -- so there is no iframe URL to build here, and that turns out to
 * matter in both directions. The good part: the studio ends up as a top-level
 * document on its own origin, so the engine it remembers in `localStorage` is
 * reachable by its own control, and a person who picks v2 once keeps it.
 *
 * The bad part is that a redirect drops the query string on the floor, so
 * arriving here with `?engine=v2` and being sent to the studio used to lose the
 * engine and land on the default. Only the non-default is forwarded: the legacy
 * engine is what the studio uses when nothing says otherwise, so a link that
 * names it needs no parameter, and passing anything unrecognised through would
 * only hand the studio a value it has to reject.
 */
export function withEngine(url, search) {
  const engine = new URLSearchParams(search).get('engine');
  if (engine !== 'v2') {
    return url;
  }
  return `${url}${url.includes('?') ? '&' : '?'}engine=v2`;
}

export default function X86Studio() {
  // Resolved on the client, since it reads the address bar. Starting from the bare
  // URL means the first render is the plain studio URL on a server or in a test,
  // and the engine is applied on the first effect.
  const [target, setTarget] = useState(studioUrl);

  useEffect(() => {
    const next = withEngine(studioUrl, window.location.search);
    setTarget(next);
    window.location.replace(next);
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#04070d] text-slate-100">
      <a
        href={target}
        className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-3 text-sm font-semibold text-[#031120] hover:bg-[#78d2ff]"
      >
        Open x86 Studio
        <ExternalLink className="h-4 w-4" />
      </a>
    </div>
  );
}
