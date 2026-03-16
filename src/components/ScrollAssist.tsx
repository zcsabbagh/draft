import { useCallback, useRef, useState, useEffect } from 'react';
import type { RefObject } from 'react';

interface ScrollAssistProps {
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  isMobile: boolean;
}

const SCROLL_STEP = 300;
const HANDLE_HEIGHT = 48;
const TRACK_TOP = 100;    // below header+toolbar
const TRACK_BOTTOM = 60;  // above status bar

export default function ScrollAssist({ scrollContainerRef, isMobile }: ScrollAssistProps) {
  const [topPx, setTopPx] = useState(TRACK_TOP);
  const [visible, setVisible] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragRef = useRef<{ startY: number; startScrollTop: number } | null>(null);

  // Compute the usable track height
  const getTrackHeight = useCallback(() => {
    return window.innerHeight - TRACK_TOP - TRACK_BOTTOM - HANDLE_HEIGHT;
  }, []);

  // Convert scroll position to handle Y position
  const scrollToHandleY = useCallback((el: HTMLElement) => {
    const scrollable = el.scrollHeight - el.clientHeight;
    if (scrollable <= 0) return TRACK_TOP;
    const ratio = el.scrollTop / scrollable;
    return TRACK_TOP + ratio * getTrackHeight();
  }, [getTrackHeight]);

  // Show the handle briefly then fade
  const scheduleHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (!isDragging) setVisible(false);
    }, 2000);
  }, [isDragging]);

  // Listen for scroll to update handle position
  useEffect(() => {
    if (!isMobile) return;
    const el = scrollContainerRef.current;
    if (!el) return;

    const onScroll = () => {
      const scrollable = el.scrollHeight - el.clientHeight;
      if (scrollable <= 10) {
        setVisible(false);
        return;
      }
      setTopPx(scrollToHandleY(el));
      setVisible(true);
      scheduleHide();
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [isMobile, scrollContainerRef, scrollToHandleY, scheduleHide]);

  // Touch handlers — dragging moves the document AND the handle
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    e.stopPropagation();
    const el = scrollContainerRef.current;
    if (!el) return;
    setIsDragging(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    dragRef.current = {
      startY: e.touches[0].clientY,
      startScrollTop: el.scrollTop,
    };
  }, [scrollContainerRef]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const el = scrollContainerRef.current;
    const state = dragRef.current;
    if (!el || !state) return;

    const deltaY = e.touches[0].clientY - state.startY;
    const trackHeight = getTrackHeight();
    if (trackHeight <= 0) return;

    // Map finger movement on track to scroll position
    const scrollable = el.scrollHeight - el.clientHeight;
    const scrollDelta = (deltaY / trackHeight) * scrollable;
    el.scrollTop = state.startScrollTop + scrollDelta;

    // Update handle position to follow the finger
    setTopPx(scrollToHandleY(el));
  }, [scrollContainerRef, getTrackHeight, scrollToHandleY]);

  const onTouchEnd = useCallback(() => {
    setIsDragging(false);
    dragRef.current = null;
    scheduleHide();
  }, [scheduleHide]);

  // Tap to scroll by step
  const scroll = useCallback((direction: 'up' | 'down') => {
    const el = scrollContainerRef.current;
    if (!el) return;
    el.scrollBy({ top: direction === 'up' ? -SCROLL_STEP : SCROLL_STEP, behavior: 'smooth' });
  }, [scrollContainerRef]);

  if (!isMobile) return null;

  return (
    <>
      {/* SVG filter for displacement-based refraction */}
      <svg width="0" height="0" style={{ position: 'absolute' }}>
        <defs>
          <filter id="liquid-glass-refraction" x="-20%" y="-20%" width="140%" height="140%">
            {/* Turbulence creates the displacement texture */}
            <feTurbulence type="fractalNoise" baseFrequency="0.015" numOctaves="3" seed="2" result="noise" />
            {/* Displacement bends the backdrop pixels — simulates refraction through curved glass */}
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="3" xChannelSelector="R" yChannelSelector="G" result="refracted" />
            {/* Subtle blur to soften the refraction */}
            <feGaussianBlur in="refracted" stdDeviation="0.5" />
          </filter>
        </defs>
      </svg>

      <div
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={{
          position: 'fixed',
          right: -8,
          top: topPx,
          zIndex: 30,
          width: 36,
          height: HANDLE_HEIGHT,
          // Liquid glass layered background
          background: `
            linear-gradient(
              168deg,
              rgba(255,255,255,0.55) 0%,
              rgba(255,255,255,0.12) 35%,
              rgba(255,255,255,0.04) 55%,
              rgba(255,255,255,0.18) 100%
            )
          `,
          backdropFilter: 'blur(24px) saturate(200%) brightness(1.08)',
          WebkitBackdropFilter: 'blur(24px) saturate(200%) brightness(1.08)',
          // Glass edge — bright on top-left, dark on bottom-right
          border: '0.5px solid rgba(255,255,255,0.45)',
          borderRadius: 14,
          // Multi-layer shadow: outer ambient + inner specular highlight
          boxShadow: `
            0 1px 6px rgba(0,0,0,0.06),
            0 4px 16px rgba(0,0,0,0.04),
            inset 0 1px 1px rgba(255,255,255,0.7),
            inset 0 -1px 1px rgba(0,0,0,0.04)
          `,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 0,
          touchAction: 'none',
          cursor: 'grab',
          opacity: visible || isDragging ? 1 : 0,
          transition: isDragging ? 'none' : 'opacity 0.3s ease, top 0.15s ease-out',
          pointerEvents: visible || isDragging ? 'auto' : 'none',
          // Slight overflow clip for refraction filter
          overflow: 'hidden',
          isolation: 'isolate',
        }}
      >
        {/* Specular highlight — the bright "light reflection" that sells the glass */}
        <div
          style={{
            position: 'absolute',
            top: -2,
            left: 2,
            right: 2,
            height: '55%',
            background: 'linear-gradient(180deg, rgba(255,255,255,0.65) 0%, rgba(255,255,255,0) 100%)',
            borderRadius: '14px 14px 50% 50%',
            pointerEvents: 'none',
          }}
        />
        {/* Subtle edge refraction glow */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: 14,
            boxShadow: 'inset 0 0 8px rgba(255,255,255,0.15)',
            pointerEvents: 'none',
          }}
        />

        <button
          onClick={() => scroll('up')}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '4px 0 1px',
            color: 'rgba(40, 40, 40, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '100%',
            touchAction: 'none',
            position: 'relative',
            zIndex: 1,
          }}
          aria-label="Scroll up"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M3 7.5L6 4.5L9 7.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          onClick={() => scroll('down')}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '1px 0 4px',
            color: 'rgba(40, 40, 40, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '100%',
            touchAction: 'none',
            position: 'relative',
            zIndex: 1,
          }}
          aria-label="Scroll down"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </>
  );
}
