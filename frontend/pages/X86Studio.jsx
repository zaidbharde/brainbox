import { useEffect } from 'react';
import { ExternalLink } from 'lucide-react';

const studioUrl = import.meta.env.VITE_X86_STUDIO_URL || 'http://localhost:5173';

export default function X86Studio() {
  useEffect(() => {
    window.location.replace(studioUrl);
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#04070d] text-slate-100">
      <a
        href={studioUrl}
        className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-3 text-sm font-semibold text-[#031120] hover:bg-[#78d2ff]"
      >
        Open x86 Studio
        <ExternalLink className="h-4 w-4" />
      </a>
    </div>
  );
}
