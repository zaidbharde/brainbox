import { motion } from 'framer-motion';
import { Registers } from '@/types/cpu';
import { getFlags } from '@/emulator/cpu';
import { cn } from '@/utils/cn';

interface RegisterDisplayProps {
  registers: Registers;
  previousRegisters?: Registers;
  compact?: boolean;
  showAllRegisters?: boolean;
}

export function RegisterDisplay({ 
  registers, 
  previousRegisters, 
  compact = false,
  showAllRegisters = false 
}: RegisterDisplayProps) {
  const flags = getFlags(registers.FLAGS);
  const previousFlags = previousRegisters ? getFlags(previousRegisters.FLAGS) : null;

  const formatHex = (value: number) => value.toString(16).toUpperCase().padStart(4, '0');
  const hasChanged = (reg: keyof Registers) => !!(previousRegisters && registers[reg] !== previousRegisters[reg]);

  const generalRegs: (keyof Registers)[] = ['AX', 'BX', 'CX', 'DX'];
  const indexRegs: (keyof Registers)[] = ['SI', 'DI', 'SP', 'BP'];
  const segmentRegs: (keyof Registers)[] = ['CS', 'DS', 'ES', 'SS'];

  if (compact) {
    return (
      <div className="grid grid-cols-4 gap-2">
        {generalRegs.map((reg) => (
          <RegisterChip
            key={reg}
            name={reg}
            value={registers[reg]}
            changed={hasChanged(reg)}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* General Purpose Registers */}
      <div>
        <span className="text-xs text-gray-500 uppercase tracking-wider block mb-2">General Purpose</span>
        <div className="grid grid-cols-2 gap-3">
          {generalRegs.map((reg) => (
            <RegisterCard
              key={reg}
              name={reg}
              value={registers[reg]}
              changed={hasChanged(reg)}
            />
          ))}
        </div>
      </div>

      {/* Index/Pointer Registers */}
      {showAllRegisters && (
        <div className="pt-3 border-t border-[#1f2b29]">
          <span className="text-xs text-gray-500 uppercase tracking-wider block mb-2">Index & Pointers</span>
          <div className="grid grid-cols-2 gap-3">
            {indexRegs.map((reg) => (
              <RegisterCard
                key={reg}
                name={reg}
                value={registers[reg]}
                changed={hasChanged(reg)}
                small
              />
            ))}
          </div>
        </div>
      )}

      {showAllRegisters && (
        <div className="pt-3 border-t border-[#1f2b29]">
          <span className="text-xs text-gray-500 uppercase tracking-wider block mb-2">Segments</span>
          <div className="grid grid-cols-2 gap-3">
            {segmentRegs.map((reg) => (
              <RegisterCard
                key={reg}
                name={reg}
                value={registers[reg]}
                changed={hasChanged(reg)}
                small
              />
            ))}
          </div>
        </div>
      )}

      {/* Instruction Pointer */}
      <div className="pt-3 border-t border-[#1f2b29]">
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-500 uppercase tracking-wider">Instruction Pointer</span>
          <motion.span
            key={registers.IP}
            initial={{ scale: 1.2, color: '#f0b45b' }}
            animate={{ scale: 1, color: '#45d1a3' }}
            className="font-mono text-lg font-bold text-[#45d1a3]"
          >
            {formatHex(registers.IP)}
          </motion.span>
        </div>
      </div>

      {/* Flags */}
      <div className="pt-3 border-t border-[#1f2b29]">
        <span className="text-xs text-gray-500 uppercase tracking-wider block mb-2">Flags</span>
        <div className="grid grid-cols-3 gap-2">
          <FlagIndicator name="ZF" value={flags.ZF} changed={previousFlags ? previousFlags.ZF !== flags.ZF : false} label="Zero" />
          <FlagIndicator name="SF" value={flags.SF} changed={previousFlags ? previousFlags.SF !== flags.SF : false} label="Sign" />
          <FlagIndicator name="CF" value={flags.CF} changed={previousFlags ? previousFlags.CF !== flags.CF : false} label="Carry" />
          <FlagIndicator name="OF" value={flags.OF} changed={previousFlags ? previousFlags.OF !== flags.OF : false} label="Overflow" />
          <FlagIndicator name="PF" value={flags.PF} changed={previousFlags ? previousFlags.PF !== flags.PF : false} label="Parity" />
          <FlagIndicator name="AF" value={flags.AF} changed={previousFlags ? previousFlags.AF !== flags.AF : false} label="Aux Carry" />
        </div>
      </div>

      {/* Flags Raw Value */}
      <div className="pt-3 border-t border-[#1f2b29]">
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-500 uppercase tracking-wider">FLAGS Register</span>
          <span className="font-mono text-sm text-gray-400">
            {formatHex(registers.FLAGS)} ({registers.FLAGS.toString(2).padStart(16, '0')})
          </span>
        </div>
      </div>
    </div>
  );
}

function RegisterCard({ name, value, changed, small = false }: { name: string; value: number; changed: boolean; small?: boolean }) {
  const hexValue = value.toString(16).toUpperCase().padStart(4, '0');
  
  return (
    <motion.div
      initial={changed ? { scale: 0.95 } : false}
      animate={{ scale: 1 }}
      className={cn(
        'relative rounded-lg border transition-all duration-300',
        small ? 'p-2' : 'p-3',
        changed
          ? 'bg-[#f0b45b]/10 border-[#f0b45b]/30'
          : 'bg-[#152320] border-[#1f2b29]'
      )}
    >
      <div className="flex items-center justify-between mb-1">
        <span className={cn('font-semibold text-gray-400', small ? 'text-xs' : 'text-xs')}>{name}</span>
        {changed && (
          <motion.span
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            className="text-xs text-[#f0b45b]"
          >
            *
          </motion.span>
        )}
      </div>
      <motion.div
        key={value}
        initial={changed ? { y: -5, opacity: 0 } : false}
        animate={{ y: 0, opacity: 1 }}
        className="flex items-baseline gap-2"
      >
        <span className={cn('font-mono font-bold text-white', small ? 'text-base' : 'text-xl')}>{hexValue}</span>
        <span className="text-xs text-gray-500">({value})</span>
      </motion.div>
    </motion.div>
  );
}

function RegisterChip({ name, value, changed }: { name: string; value: number; changed: boolean }) {
  const hexValue = value.toString(16).toUpperCase().padStart(4, '0');
  
  return (
    <div className={cn(
      'px-3 py-1.5 rounded-lg font-mono text-xs',
      changed
        ? 'bg-[#f0b45b]/20 text-[#f3c37c]'
        : 'bg-[#152320] text-gray-300'
    )}>
      <span className="text-gray-500">{name}:</span>{' '}
      <span className="font-semibold">{hexValue}</span>
    </div>
  );
}

function FlagIndicator({ name, value, changed, label }: { name: string; value: boolean; changed: boolean; label: string }) {
  return (
    <motion.div
      initial={false}
      animate={{
        backgroundColor: value ? 'rgba(47, 191, 113, 0.2)' : 'rgba(19, 32, 30, 1)',
        borderColor: changed ? 'rgba(240, 180, 91, 0.7)' : value ? 'rgba(47, 191, 113, 0.35)' : 'rgba(31, 43, 41, 1)',
      }}
      title={label}
      className={cn(
        'px-3 py-1.5 rounded-lg text-xs font-mono font-semibold transition-all border',
        value ? 'text-[#5de6a0]' : 'text-gray-600'
      )}
    >
      <span>{name}</span>
      {changed && <span className="ml-1 text-[#f0b45b]">*</span>}
      <motion.span 
        className="ml-1"
        initial={false}
        animate={{ 
          color: value ? '#5de6a0' : '#4b5563',
          scale: value ? 1.2 : 1
        }}
      >
        {value ? '1' : '0'}
      </motion.span>
    </motion.div>
  );
}
