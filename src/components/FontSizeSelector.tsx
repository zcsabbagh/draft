import { useState, useRef, useEffect } from 'react';

const FONT_SIZES = [
  { label: '10', value: '10px' },
  { label: '12', value: '12px' },
  { label: '14', value: '14px' },
  { label: '16', value: '16px' },
  { label: '17', value: '17px' },
  { label: '18', value: '18px' },
  { label: '20', value: '20px' },
  { label: '24', value: '24px' },
  { label: '28', value: '28px' },
  { label: '32', value: '32px' },
  { label: '36', value: '36px' },
  { label: '48', value: '48px' },
];

interface FontSizeSelectorProps {
  currentSize: string | undefined;
  onSizeChange: (size: string | undefined) => void;
}

export default function FontSizeSelector({ currentSize, onSizeChange }: FontSizeSelectorProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setFilter('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [open]);

  const displaySize = currentSize ? currentSize.replace('px', '') : '17';

  const filtered = filter
    ? FONT_SIZES.filter((s) => s.label.startsWith(filter))
    : FONT_SIZES;

  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered.length > 0) {
        onSizeChange(filtered[0].value);
        setOpen(false);
        setFilter('');
      } else if (filter && /^\d+$/.test(filter)) {
        onSizeChange(`${filter}px`);
        setOpen(false);
        setFilter('');
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
      setFilter('');
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        onMouseDown={(e) => {
          e.preventDefault();
          setOpen((v) => !v);
          setFilter('');
        }}
        title="Font size"
        className="flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors text-ink-light hover:bg-cream-dark hover:text-ink min-w-[48px] justify-center"
      >
        <span>{displaySize}</span>
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none" className="shrink-0 opacity-50">
          <path d="M1.5 3L4 5.5L6.5 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-24 max-h-64 bg-[#FAFAF8] border border-[#E5E5E0] rounded-lg shadow-lg z-50 flex flex-col animate-dropdown-open">
          <input
            ref={inputRef}
            value={filter}
            onChange={(e) => setFilter(e.target.value.replace(/\D/g, ''))}
            onKeyDown={handleInputKeyDown}
            onMouseDown={(e) => e.stopPropagation()}
            placeholder={displaySize}
            className="w-full px-3 py-1.5 text-xs border-b border-[#E5E5E0] bg-transparent focus:outline-none text-ink placeholder:text-ink-lighter"
          />
          <div className="overflow-y-auto custom-scrollbar py-1">
            <button
              onMouseDown={(e) => {
                e.preventDefault();
                onSizeChange(undefined);
                setOpen(false);
                setFilter('');
              }}
              className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                !currentSize
                  ? 'bg-cream-dark text-ink'
                  : 'text-ink-light hover:bg-cream-dark hover:text-ink'
              }`}
            >
              Default
            </button>
            {filtered.map((size) => (
              <button
                key={size.value}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSizeChange(size.value);
                  setOpen(false);
                  setFilter('');
                }}
                className={`w-full text-left px-3 py-1.5 text-xs flex items-center justify-between transition-colors ${
                  currentSize === size.value
                    ? 'bg-cream-dark text-ink'
                    : 'text-ink-light hover:bg-cream-dark hover:text-ink'
                }`}
              >
                <span>{size.label}</span>
                {currentSize === size.value && (
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="shrink-0 text-ink">
                    <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
