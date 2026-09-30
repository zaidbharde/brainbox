import { motion } from 'framer-motion';
import { useState } from 'react';
import { Registers } from '@/types/cpu';
import { FlagsPanel } from '@/components/FlagsPanel';
import { cn } from '@/utils/cn';

interface RegisterDisplayProps {
  registers: Registers;
  previousRegisters?: Registers;
  compact?: boolean;
  showAllRegisters?: boolean;
  /**
   * Called with a register name and the value the field was given, once the
   * value parses.
   *
   * Absent means read-only, which is what every other place this is drawn wants.
   * The parse happens here rather than in the caller so a field cannot be driven
   * from a name the engine will not accept: the caller receives a name it can
   * hand straight to `DebugSession.setRegister`, which still refuses anything
   * unknown, and the two refusals agree.
   */
  onChangeRegister?: (name: string, value: number) => void;
  /** While the engine is running, fields are shown but not editable. */
  readOnly?: boolean;
}

export function RegisterDisplay({ 
  registers, 
  previousRegisters, 
  compact = false,
  showAllRegisters = false,
  onChangeRegister,
  readOnly = false,
}: RegisterDisplayProps) {
  const editable = onChangeRegister !== undefined && !readOnly;

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
              onCommit={editable ? (value) => onChangeRegister!(reg, value) : undefined}
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
                onCommit={editable ? (value) => onChangeRegister!(reg, value) : undefined}
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
                onCommit={editable ? (value) => onChangeRegister!(reg, value) : undefined}
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
            {editable ? (
              <RegisterField name="IP" value={registers.IP} onCommit={(value) => onChangeRegister!('IP', value)} />
            ) : (
              formatHex(registers.IP)
            )}
          </motion.span>
        </div>
      </div>

      {/* Flags */}
      <div className="pt-3 border-t border-[#1f2b29]">
        <span className="text-xs text-gray-500 uppercase tracking-wider block mb-2">Flags</span>
        <FlagsPanel
          flags={registers.FLAGS}
          previousFlags={previousRegisters?.FLAGS}
        />
      </div>

      {/* Flags Raw Value */}
      <div className="pt-3 border-t border-[#1f2b29]">
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-500 uppercase tracking-wider">FLAGS Register</span>
          {editable ? (
            <RegisterField name="FLAGS" value={registers.FLAGS} onCommit={(value) => onChangeRegister!('FLAGS', value)} />
          ) : (
            <span className="font-mono text-sm text-gray-400">{formatHex(registers.FLAGS)}</span>
          )}
        </div>
      </div>
    </div>
  );
}

function RegisterCard({ name, value, changed, small = false, onCommit }: {
  name: string;
  value: number;
  changed: boolean;
  small?: boolean;
  onCommit?: (value: number) => void;
}) {
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
        {onCommit === undefined ? (
          <span className={cn('font-mono font-bold text-white', small ? 'text-base' : 'text-xl')}>{hexValue}</span>
        ) : (
          <RegisterField name={name} value={value} onCommit={onCommit} />
        )}
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


/**
 * One register's value, editable in place.
 *
 * Accepts what this lab prints and what it accepts in source: up to four hex
 * digits, the same with an `h`, and a `0x` prefix. All hexadecimal, so the value
 * typed back in is the value shown.
 *
 * A value that does not parse is refused and the field goes back to what the
 * machine holds. It does not clamp and it does not write a zero: a mistyped
 * `GHIJ` silently becoming `0000` would be worse than refusing. Nor is a value
 * too big for the register truncated to fit -- five hex digits is a typo, and
 * the low sixteen bits of a typo are not what anyone meant.
 */
function RegisterField({ name, value, onCommit }: { name: string; value: number; onCommit: (value: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [refused, setRefused] = useState(false);

  const shown = value.toString(16).toUpperCase().padStart(4, '0');

  const commit = () => {
    const parsed = parseRegisterInput(text);
    if (parsed === null) {
      setRefused(true);
      setEditing(false);
      setText('');
      return;
    }
    onCommit(parsed & 0xffff);
    setEditing(false);
    setText('');
    setRefused(false);
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={text}
        aria-label={`${name} value`}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
          if (event.key === 'Escape') {
            setEditing(false);
            setText('');
          }
        }}
        className="font-mono font-bold text-white bg-[#0d1614] border border-[#45d1a3] rounded px-1 py-0.5 text-lg w-20 outline-none"
      />
    );
  }

  return (
    <button
      type="button"
      title={`Edit ${name}`}
      onClick={() => {
        setRefused(false);
        setText(shown);
        setEditing(true);
      }}
      className="font-mono font-bold text-white hover:text-[#45d1a3] hover:underline decoration-dotted underline-offset-4 text-left"
    >
      {shown}
      {refused && <span className="ml-1 text-xs text-[#e05d5d]">?</span>}
    </button>
  );
}

/**
 * A register value as typed, or null if it is not one.
 *
 * Exported so the field's rules can be tested without a DOM, and so nothing else
 * in the lab has to grow a second, looser idea of what a register field accepts.
 *
 * Everything here is hexadecimal, because everything the field shows is. A bare
 * `10` is sixteen, not ten, and that is the whole point: the field displays `00FF`
 * and if `FF` meant two hundred and fifty-five when typed back in, then opening a
 * register and pressing Enter without changing anything would alter it. Decimal
 * is not accepted at all, rather than accepted on a hunch -- a lab that shows hex
 * everywhere has no decimal to guess from.
 */
export function parseRegisterInput(raw: string): number | null {
  const text = raw.trim();
  if (text.length === 0) return null;
  // Four digits at most on every spelling. A register is 16 bits, so a longer
  // run is not a value with a prefix on it -- it is a different number, or a
  // typo, and neither belongs in a register.
  if (/^0[xX][0-9a-fA-F]{1,4}$/.test(text)) return Number.parseInt(text.slice(2), 16);
  if (/^[0-9a-fA-F]{1,4}h$/.test(text)) return Number.parseInt(text.slice(0, -1), 16);
  if (/^[0-9a-fA-F]{1,4}$/.test(text)) return Number.parseInt(text, 16);
  return null;
}
