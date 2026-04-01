import { motion } from 'framer-motion';
import { cn } from '@/utils/cn';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
  glow?: boolean;
}

export function Card({ children, className, hover = false, glow = false }: CardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={hover ? { y: -3, scale: 1.008 } : undefined}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className={cn(
        'card-modern panel-glass rounded-2xl overflow-hidden border border-[#2a3c5d]/55',
        hover && 'transition-all duration-300 hover:border-[#66dacd]/40',
        glow && 'shadow-[0_0_35px_rgba(78,216,201,0.12)]',
        className
      )}
    >
      <span className="card-sheen" />
      <div className="relative z-10">{children}</div>
    </motion.div>
  );
}

interface CardHeaderProps {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

export function CardHeader({ title, subtitle, icon, action, className }: CardHeaderProps) {
  return (
    <div className={cn(
      'flex items-center justify-between px-4 py-3 border-b border-[#2a3c5d]/50 bg-[linear-gradient(180deg,rgba(21,32,51,0.92),rgba(17,27,44,0.85))]',
      className
    )}>
      <div className="flex items-center gap-3">
        {icon && (
          <div className="w-8 h-8 rounded-xl border border-[#3a547f]/45 bg-[linear-gradient(150deg,rgba(78,216,201,0.16),rgba(94,155,255,0.12))] flex items-center justify-center text-[#69ded0] shadow-[0_0_16px_rgba(78,216,201,0.15)]">
            {icon}
          </div>
        )}
        <div>
          <h3 className="font-semibold text-white text-sm tracking-wide">{title}</h3>
          {subtitle && <p className="text-xs text-[#8ea6c9]">{subtitle}</p>}
        </div>
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}

interface CardContentProps {
  children: React.ReactNode;
  className?: string;
  noPadding?: boolean;
}

export function CardContent({ children, className, noPadding }: CardContentProps) {
  return (
    <div className={cn(!noPadding && 'p-4', className)}>
      {children}
    </div>
  );
}
