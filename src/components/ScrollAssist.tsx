import { useCallback, useRef } from 'react';
import type { RefObject } from 'react';

interface ScrollAssistProps {
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  isMobile: boolean;
}

const SCROLL_STEP = 300; // pixels per tap

export default function ScrollAssist({ scrollContainerRef, isMobile }: ScrollAssistProps) {
  const dragState = useRef<{
    startY: number;
    startScrollTop: number;
    isDragging: boolean;
  } | null>(null);

  const scroll = useCallback((direction: 'up' | 'down') => {
    const el = scrollContainerRef.current;
    if (!el) return;
    el.scrollBy({
      top: direction === 'up' ? -SCROLL_STEP : SCROLL_STEP,
      behavior: 'smooth',
    });
  }, [scrollContainerRef]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const touch = e.touches[0];
    dragState.current = {
      startY: touch.clientY,
      startScrollTop: el.scrollTop,
      isDragging: false,
    };
  }, [scrollContainerRef]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const el = scrollContainerRef.current;
    const state = dragState.current;
    if (!el || !state) return;

    const touch = e.touches[0];
    const deltaY = touch.clientY - state.startY;

    // Only start dragging after a small threshold to distinguish from taps
    if (!state.isDragging && Math.abs(deltaY) > 5) {
      state.isDragging = true;
    }

    if (state.isDragging) {
      e.preventDefault();
      // Map drag distance to scroll distance proportionally.
      // The ratio: full drag across viewport height = full scroll through document.
      const viewportHeight = window.innerHeight;
      const scrollableHeight = el.scrollHeight - el.clientHeight;
      const scrollRatio = scrollableHeight / viewportHeight;
      el.scrollTop = state.startScrollTop + deltaY * scrollRatio;
    }
  }, [scrollContainerRef]);

  const handleTouchEnd = useCallback(() => {
    dragState.current = null;
  }, []);

  if (!isMobile) return null;

  return (
    <>
      <style>{`
        .scroll-assist-glass::after {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: 16px;
          background: linear-gradient(
            165deg,
            rgba(255, 255, 255, 0.45) 0%,
            rgba(255, 255, 255, 0.08) 40%,
            rgba(255, 255, 255, 0.02) 60%,
            rgba(255, 255, 255, 0.15) 100%
          );
          pointer-events: none;
        }
      `}</style>
      <div
        className="scroll-assist-glass"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{
          position: 'fixed',
          right: -10,
          top: '50%',
          transform: 'translateY(-50%)',
          zIndex: 30,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 0,
          width: 36,
          height: 44,
          background: 'rgba(255, 255, 255, 0.25)',
          backdropFilter: 'blur(20px) saturate(180%)',
          WebkitBackdropFilter: 'blur(20px) saturate(180%)',
          border: '1px solid rgba(255, 255, 255, 0.4)',
          borderRadius: 16,
          boxShadow:
            '0 2px 12px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.5)',
          padding: 0,
          touchAction: 'none',
        }}
      >
        <button
          onClick={() => scroll('up')}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '3px 0',
            color: 'rgba(60, 60, 60, 0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '100%',
            touchAction: 'none',
          }}
          aria-label="Scroll up"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M3 8L6 4.5L9 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          onClick={() => scroll('down')}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '3px 0',
            color: 'rgba(60, 60, 60, 0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '100%',
            touchAction: 'none',
          }}
          aria-label="Scroll down"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M3 4L6 7.5L9 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </>
  );
}
