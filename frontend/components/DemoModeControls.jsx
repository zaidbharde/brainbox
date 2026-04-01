import { Cast, Presentation, UserRound } from 'lucide-react';

export default function DemoModeControls({ demo }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[#3a4860] bg-[#101827] px-3 py-2 text-xs text-slate-200">
      <button
        type="button"
        onClick={demo.startTeacher}
        disabled={demo.isTeacher}
        className="inline-flex items-center gap-1 rounded-md border border-emerald-400/40 bg-emerald-500/10 px-2 py-1 hover:bg-emerald-500/20 disabled:opacity-50"
      >
        <Presentation className="h-3.5 w-3.5" />
        Enable Teacher Demo Mode
      </button>
      <button
        type="button"
        onClick={() => {
          const ip = window.prompt('Enter teacher IP (LAN):', demo.teacherIp || '');
          if (ip) {
            demo.joinTeacher(ip);
          }
        }}
        disabled={demo.isStudent}
        className="inline-flex items-center gap-1 rounded-md border border-sky-400/40 bg-sky-500/10 px-2 py-1 hover:bg-sky-500/20 disabled:opacity-50"
      >
        <UserRound className="h-3.5 w-3.5" />
        Join Teacher Demo
      </button>
      {demo.mode !== 'off' && (
        <button
          type="button"
          onClick={demo.stopDemo}
          className="rounded-md border border-rose-400/40 bg-rose-500/10 px-2 py-1 hover:bg-rose-500/20"
        >
          Leave Demo
        </button>
      )}
      <span className="inline-flex items-center gap-1 rounded-md border border-[#3a4860] bg-[#1a2435] px-2 py-1">
        <Cast className="h-3.5 w-3.5" />
        {demo.mode === 'teacher' ? 'Teacher' : demo.mode === 'student' ? 'Student' : 'Off'} / {demo.connectionStatus}
      </span>
      {demo.isTeacher && demo.localIp ? (
        <span className="rounded-md border border-[#3a4860] bg-[#1a2435] px-2 py-1">IP: {demo.localIp}:4100</span>
      ) : null}
      {demo.isStudent && demo.teacherIp ? (
        <span className="rounded-md border border-amber-400/40 bg-amber-500/10 px-2 py-1">
          Read-only student view ({demo.teacherIp})
        </span>
      ) : null}
      {demo.error ? <span className="text-rose-300">{demo.error}</span> : null}
    </div>
  );
}
