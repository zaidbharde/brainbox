import { forwardRef } from 'react';
import { motion, HTMLMotionProps } from 'framer-motion';
import { cn } from '@/utils/cn';

interface ButtonProps extends Omit<HTMLMotionProps<"button">, "children"> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
  size?: 'sm' | 'md' | 'lg';
  icon?: React.ReactNode;
  iconPosition?: 'left' | 'right';
  children?: React.ReactNode;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({
  variant = 'primary',
  size = 'md',
  icon,
  iconPosition = 'left',
  children,
  className,
  disabled,
  loading,
  ...props
}, ref) => {
  const variants = {
    primary: 'bg-gradient-to-r from-[#4ed8c9] via-[#74b2ff] to-[#f4b65f] text-[#08101b] shadow-[0_10px_28px_rgba(78,216,201,0.3)] border border-white/20',
    secondary: 'bg-[linear-gradient(160deg,rgba(22,35,57,0.95),rgba(17,28,45,0.85))] text-[#e4ecff] border border-[#365079]/70 hover:border-[#4f74ad]',
    ghost: 'bg-transparent hover:bg-[#ffffff0e] text-[#b9c9e5] border border-transparent hover:border-[#334c74]',
    danger: 'bg-[linear-gradient(160deg,rgba(121,42,42,0.42),rgba(81,27,27,0.34))] text-[#ffb3b3] border border-[#bf6969]/45',
    success: 'bg-[linear-gradient(160deg,rgba(24,74,53,0.55),rgba(23,57,47,0.35))] text-[#8ce6bf] border border-[#4bcf89]/40',
  };

  const sizes = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2 text-sm',
    lg: 'px-6 py-3 text-base',
  };
  const iconGap = size === 'sm' ? 'gap-1.5' : size === 'lg' ? 'gap-2.5' : 'gap-2';

  return (
    <motion.button
      ref={ref}
      whileHover={{ scale: disabled ? 1 : 1.02, y: disabled ? 0 : -1 }}
      whileTap={{ scale: disabled ? 1 : 0.98 }}
      className={cn(
        'btn-modern inline-flex items-center justify-center font-medium rounded-xl transition-all duration-200',
        'focus:outline-none focus:ring-2 focus:ring-[#4ed8c9]/45 focus:ring-offset-2 focus:ring-offset-[#0a1220]',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        variants[variant],
        sizes[size],
        className
      )}
      disabled={disabled || loading}
      {...props}
    >
      <span className="btn-shine" />
      {loading ? (
        <svg className="relative z-10 animate-spin h-4 w-4" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
      ) : (
        <span className={cn('relative z-10 inline-flex max-w-full flex-wrap items-center justify-center', iconGap)}>
          {icon && iconPosition === 'left' && icon}
          {children ? (
            <span className="min-w-0 whitespace-normal break-words text-center">
              {children}
            </span>
          ) : null}
          {icon && iconPosition === 'right' && icon}
        </span>
      )}
    </motion.button>
  );
});

Button.displayName = 'Button';
