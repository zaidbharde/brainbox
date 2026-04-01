import { cn } from '@/utils/cn';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'error' | 'info';
  size?: 'sm' | 'md';
  dot?: boolean;
}

export function Badge({ children, variant = 'default', size = 'sm', dot }: BadgeProps) {
  const variants = {
    default: 'bg-[linear-gradient(160deg,rgba(41,55,79,0.7),rgba(26,35,53,0.6))] text-[#d0ddf6] border-[#435d88]/55',
    success: 'bg-[linear-gradient(160deg,rgba(28,79,57,0.58),rgba(25,58,48,0.45))] text-[#8ce6bf] border-[#4bcf89]/42',
    warning: 'bg-[linear-gradient(160deg,rgba(96,69,31,0.55),rgba(73,56,28,0.4))] text-[#f9d294] border-[#f1bf63]/46',
    error: 'bg-[linear-gradient(160deg,rgba(108,43,43,0.55),rgba(83,33,33,0.4))] text-[#ffb6b6] border-[#e57b7b]/46',
    info: 'bg-[linear-gradient(160deg,rgba(40,73,122,0.62),rgba(31,55,93,0.42))] text-[#a9c6ff] border-[#6e95df]/46',
  };

  const sizes = {
    sm: 'px-2 py-0.5 text-xs',
    md: 'px-3 py-1 text-sm',
  };

  const dotColors = {
    default: 'bg-gray-300',
    success: 'bg-[#5de6a0]',
    warning: 'bg-[#f3c37c]',
    error: 'bg-[#f38b8b]',
    info: 'bg-[#7ab6ff]',
  };

  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 font-medium border rounded-full backdrop-blur-sm',
      variants[variant],
      sizes[size]
    )}>
      {dot && (
        <span className={cn('w-1.5 h-1.5 rounded-full animate-pulse-slow', dotColors[variant])} />
      )}
      {children}
    </span>
  );
}
