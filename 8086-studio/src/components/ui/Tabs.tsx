import { motion } from 'framer-motion';
import { cn } from '@/utils/cn';

interface Tab {
  id: string;
  label: string;
  icon?: React.ReactNode;
}

interface TabsProps {
  tabs: Tab[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
  className?: string;
}

export function Tabs({ tabs, activeTab, onTabChange, className }: TabsProps) {
  return (
    <div className={cn('tabs-shell flex items-center gap-1 p-1.5 rounded-xl', className)}>
      {tabs.map((tab) => (
        <motion.button
          key={tab.id}
          whileHover={{ y: -1 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => onTabChange(tab.id)}
          className={cn(
            'relative flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
            activeTab === tab.id
              ? 'text-white'
              : 'text-[#9bb0d3] hover:text-[#d9e3fb]'
          )}
        >
          {activeTab === tab.id && (
            <motion.div
              layoutId="activeTab"
              className="absolute inset-0 rounded-lg bg-[linear-gradient(140deg,rgba(78,216,201,0.24),rgba(94,155,255,0.2),rgba(244,182,95,0.2))] border border-[#6f99d8]/40 shadow-[0_0_20px_rgba(94,155,255,0.2)]"
              transition={{ type: 'spring', bounce: 0.2, duration: 0.4 }}
            />
          )}
          <span className="relative z-10 flex items-center gap-2">
            {tab.icon}
            {tab.label}
          </span>
        </motion.button>
      ))}
    </div>
  );
}
