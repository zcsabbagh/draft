import { useState, useRef, useEffect } from 'react';
import { FONT_OPTIONS, loadGoogleFont, type FontOption } from '../lib/fonts';

interface FontSelectorProps {
  selectedFont: string;
  onFontChange: (fontName: string) => void;
}

const CATEGORIES = ['Serif', 'Sans', 'Mono'] as const;

export default function FontSelector({ selectedFont, onFontChange }: FontSelectorProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Preload fonts for preview when dropdown opens
  useEffect(() => {
    if (open) {
      FONT_OPTIONS.forEach((font) => loadGoogleFont(font));
    }
  }, [open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const selected = FONT_OPTIONS.find((f) => f.name === selectedFont) || FONT_OPTIONS[0];

  const grouped = CATEGORIES.map((cat) => ({
    label: cat,
    fonts: FONT_OPTIONS.filter((f) => f.category === cat),
  }));

  return (
    <div ref={containerRef} className="relative">
      <button
        onMouseDown={(e) => {
          e.preventDefault();
          setOpen((v) => !v);
        }}
        title="Change font"
        className="flex items-center gap-1 px-2 py-2 text-xs rounded transition-colors text-ink-light hover:bg-cream-dark hover:text-ink min-w-[100px]"
        style={{ fontFamily: selected.family }}
      >
        <span className="truncate">{selected.name}</span>
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none" className="shrink-0 opacity-50">
          <path d="M1.5 3L4 5.5L6.5 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-52 max-h-72 overflow-y-auto bg-[#FAFAF8] border border-[#E5E5E0] rounded-lg shadow-lg z-50 py-1 px-1 custom-scrollbar animate-dropdown-open">
          {grouped.map((group) => (
            <div key={group.label}>
              <div className="px-3 py-1.5 text-[10px] font-semibold text-ink-lighter uppercase tracking-wider select-none">
                {group.label}
              </div>
              {group.fonts.map((font) => (
                <FontItem
                  key={font.name}
                  font={font}
                  isSelected={font.name === selectedFont}
                  onClick={() => {
                    onFontChange(font.name);
                    setOpen(false);
                  }}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FontItem({
  font,
  isSelected,
  onClick,
}: {
  font: FontOption;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onMouseDown={(e) => {
        e.preventDefault();
        onClick();
      }}
      className={`w-full text-left px-2 py-1.5 text-xs flex items-center justify-between transition-colors rounded ${
        isSelected
          ? 'bg-cream-dark text-ink'
          : 'text-ink-light hover:bg-cream-dark hover:text-ink'
      }`}
      style={{ fontFamily: font.family }}
    >
      <span>{font.name}</span>
      {isSelected && (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="shrink-0 text-ink">
          <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}
