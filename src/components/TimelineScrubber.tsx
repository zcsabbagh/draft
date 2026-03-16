import { useRef, useCallback } from 'react';
import type { DocumentSnapshot } from '../lib/types';

interface TimelineScrubberProps {
  snapshots: DocumentSnapshot[];
  activeIndex: number | null;
  onScrub: (index: number | null) => void;
}

function formatTimestamp(ts: number): string {
  const now = new Date();
  const date = new Date(ts);
  const isToday =
    now.getFullYear() === date.getFullYear() &&
    now.getMonth() === date.getMonth() &&
    now.getDate() === date.getDate();

  const time = date.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });

  return isToday ? time : `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
}

export default function TimelineScrubber({
  snapshots,
  activeIndex,
  onScrub,
}: TimelineScrubberProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  if (snapshots.length < 2) {
    return (
      <div className="flex items-center gap-3 px-6 py-2 bg-cream-dark/50">
        <span className="text-xs text-ink-lighter">
          Edit history will appear as you write...
        </span>
      </div>
    );
  }

  const currentIdx = activeIndex ?? snapshots.length - 1;
  const maxIdx = snapshots.length - 1;

  const snapToNearest = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const rawIdx = ratio * maxIdx;
      const snappedIdx = Math.round(rawIdx);
      onScrub(snappedIdx === maxIdx ? null : snappedIdx);
    },
    [maxIdx, onScrub],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      isDragging.current = true;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      snapToNearest(e.clientX);
    },
    [snapToNearest],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging.current) return;
      snapToNearest(e.clientX);
    },
    [snapToNearest],
  );

  const onPointerUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  const thumbPercent = (currentIdx / maxIdx) * 100;

  return (
    <div className="flex items-center gap-3 px-6 py-2 bg-cream-dark/50">
      <span className="text-xs text-ink-lighter font-medium shrink-0">
        Edit History
      </span>

      <div
        ref={trackRef}
        className="relative flex-1 h-5 flex items-center cursor-pointer select-none touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <div className="absolute inset-x-0 h-[3px] rounded-full bg-ink-faintest" />

        {snapshots.map((_, i) => (
          <div
            key={i}
            className={`absolute w-[5px] h-[5px] rounded-full -translate-x-1/2 transition-all duration-150 ${
              i === currentIdx ? 'bg-accent-ambiguous scale-150' : 'bg-ink-lighter hover:scale-150 hover:bg-ink-light'
            }`}
            style={{ left: `${(i / maxIdx) * 100}%` }}
          />
        ))}

        <div
          className="absolute w-3 h-3 rounded-full bg-accent-ambiguous border-2 border-white shadow -translate-x-1/2 transition-[left] duration-100 ease-out"
          style={{ left: `${thumbPercent}%` }}
        />
      </div>

      <span className="text-xs text-ink-light shrink-0 text-right">
        {formatTimestamp(snapshots[currentIdx].timestamp)}
      </span>

      {activeIndex !== null && (
        <button
          onClick={() => onScrub(null)}
          className="text-xs text-accent-ambiguous hover:underline shrink-0"
        >
          Live
        </button>
      )}
    </div>
  );
}
