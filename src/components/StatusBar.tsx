import { useState, useEffect, useCallback, useRef } from 'react';
import { useEditorRef } from 'platejs/react';

// Web Speech API types (not in all TS libs)
interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}
interface SpeechRecognitionErrorEvent extends Event {
  error: string;
}
interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}
declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
  }
}

interface StatusBarProps {
  editorRef: React.RefObject<HTMLElement | null>;
  getDocumentText: () => string;
  getSelectedText: () => string;
}

const PAGE_HEIGHT = 1056;

// Hoisted regex — avoids re-creation per call (js-hoist-regexp)
const WHITESPACE_RE = /\s+/;

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(WHITESPACE_RE).length;
}

export default function StatusBar({ editorRef, getDocumentText, getSelectedText }: StatusBarProps) {
  const [wordCount, setWordCount] = useState(0);
  const [isSelection, setIsSelection] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [isSpinning, setIsSpinning] = useState(false);
  const [displayCount, setDisplayCount] = useState(0);
  const spinIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const spinTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track the editor container's bounding rect so we can position badges
  // within the editor area instead of the full viewport.
  const [containerRect, setContainerRect] = useState<{ left: number; right: number } | null>(null);

  // Track keyboard height via visualViewport so the status bar stays above the keyboard
  const [keyboardOffset, setKeyboardOffset] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => {
      // The difference between layout viewport height and visual viewport height + offsetTop
      // tells us how much the keyboard is pushing up
      const offset = window.innerHeight - (vv.height + vv.offsetTop);
      setKeyboardOffset(Math.max(0, offset));
    };

    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;

    const update = () => {
      const rect = el.getBoundingClientRect();
      setContainerRect({ left: rect.left, right: rect.right });
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [editorRef]);

  const updateWordCount = useCallback(() => {
    const selected = getSelectedText();
    if (selected) {
      setIsSelection(true);
      setWordCount(countWords(selected));
    } else {
      setIsSelection(false);
      setWordCount(countWords(getDocumentText()));
    }
  }, [getDocumentText, getSelectedText]);

  useEffect(() => {
    updateWordCount();
    const interval = setInterval(updateWordCount, 1000);
    document.addEventListener('selectionchange', updateWordCount);
    return () => {
      clearInterval(interval);
      document.removeEventListener('selectionchange', updateWordCount);
    };
  }, [updateWordCount]);

  useEffect(() => {
    if (!isSpinning) {
      setDisplayCount(wordCount);
    }
  }, [wordCount, isSpinning]);

  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;

    const handleScroll = () => {
      const scrollTop = el.scrollTop;
      const scrollHeight = el.scrollHeight;
      // Use the center of the visible area to determine which page is "current"
      const viewportCenter = scrollTop + el.clientHeight / 2;
      const page = Math.floor(viewportCenter / PAGE_HEIGHT) + 1;
      const pages = Math.max(1, Math.ceil(scrollHeight / PAGE_HEIGHT));
      setCurrentPage(Math.min(page, pages));
      setTotalPages(pages);
    };

    handleScroll();
    el.addEventListener('scroll', handleScroll, { passive: true });
    const observer = new ResizeObserver(handleScroll);
    observer.observe(el);
    return () => {
      el.removeEventListener('scroll', handleScroll);
      observer.disconnect();
    };
  }, [editorRef]);

  const handleMouseEnter = () => {
    if (isSpinning) return;
    setIsSpinning(true);

    const actualCount = wordCount;
    // Keep the same number of digits during spin to prevent layout shift
    const digits = String(actualCount).length;
    const lo = Math.pow(10, digits - 1);
    const hi = Math.pow(10, digits) - 1;

    spinIntervalRef.current = setInterval(() => {
      setDisplayCount(Math.floor(Math.random() * (hi - lo + 1)) + lo);
    }, 40);

    spinTimeoutRef.current = setTimeout(() => {
      if (spinIntervalRef.current) clearInterval(spinIntervalRef.current);
      setDisplayCount(actualCount);
      setIsSpinning(false);
    }, 600);
  };

  useEffect(() => {
    return () => {
      if (spinIntervalRef.current) clearInterval(spinIntervalRef.current);
      if (spinTimeoutRef.current) clearTimeout(spinTimeoutRef.current);
    };
  }, []);

  // ── Speech-to-text (Web Speech API + Groq fallback) ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const plateEditor = useEditorRef() as any;
  const [recording, setRecording] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const interimRef = useRef('');

  const networkRetriesRef = useRef(0);
  const wantRecordingRef = useRef(false);

  // Groq fallback state
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const groqModeRef = useRef(false);

  const startGroqRecording = useCallback(async () => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setMicError('Microphone access denied');
      setTimeout(() => setMicError(null), 3000);
      return;
    }

    groqModeRef.current = true;
    audioChunksRef.current = [];

    const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunksRef.current.push(e.data);
    };

    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      groqModeRef.current = false;
      if (audioChunksRef.current.length === 0) return;
      const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
      audioChunksRef.current = [];
      const formData = new FormData();
      formData.append('file', blob, 'audio.webm');
      formData.append('model', 'whisper-large-v3-turbo');
      formData.append('language', 'en');
      try {
        const res = await fetch('/api/transcribe', { method: 'POST', body: formData });
        if (!res.ok) return;
        const data = await res.json();
        if (data.text && plateEditor) {
          try { plateEditor.insertText(data.text); } catch { /* ignore */ }
        }
      } catch { /* ignore */ }
    };

    recorder.start();
    setRecording(true);
    setMicError(null);
  }, [plateEditor]);

  const stopGroqRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;
    setRecording(false);
  }, []);

  const startRecognition = useCallback(() => {
    const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      // No WebSpeech — fall back to Groq
      startGroqRecording();
      return;
    }

    const recognition = new SpeechRecognitionCtor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognitionRef.current = recognition;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let final = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          final += transcript;
        } else {
          interimRef.current = transcript;
        }
      }
      // Insert finalized text at cursor
      if (final && plateEditor) {
        // Reset retry counter on successful transcription
        networkRetriesRef.current = 0;
        try { plateEditor.insertText(final); } catch { /* ignore */ }
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === 'aborted') return;

      if (event.error === 'network') {
        networkRetriesRef.current++;
        if (networkRetriesRef.current <= 3) {
          // Silently retry — Chrome's speech API is flaky on localhost
          return;
        }
      }

      if (event.error === 'no-speech') {
        // Ignore — onend will auto-restart
        return;
      }

      // Fatal WebSpeech error — fall back to Groq
      const fatalErrors = new Set(['network', 'service-not-allowed', 'not-allowed', 'audio-capture']);
      if (fatalErrors.has(event.error) && wantRecordingRef.current) {
        recognitionRef.current = null;
        startGroqRecording();
        return;
      }

      setMicError(`Error: ${event.error}`);
      setTimeout(() => setMicError(null), 4000);
      wantRecordingRef.current = false;
      recognitionRef.current = null;
      setRecording(false);
    };

    recognition.onend = () => {
      // Auto-restart if user still wants to record (Chrome kills recognition after pauses)
      if (wantRecordingRef.current && recognitionRef.current === recognition) {
        setTimeout(() => {
          if (wantRecordingRef.current) {
            try { recognition.start(); } catch {
              // WebSpeech restart failed — fall back to Groq
              recognitionRef.current = null;
              startGroqRecording();
            }
          }
        }, 100);
      } else {
        setRecording(false);
      }
    };

    try {
      recognition.start();
    } catch {
      // WebSpeech start failed — fall back to Groq
      recognitionRef.current = null;
      startGroqRecording();
    }
  }, [plateEditor, startGroqRecording]);

  const toggleRecording = useCallback(async () => {
    // If already recording, stop (either mode)
    if (recording) {
      if (groqModeRef.current) {
        wantRecordingRef.current = false;
        stopGroqRecording();
        return;
      }
      if (recognitionRef.current) {
        wantRecordingRef.current = false;
        const ref = recognitionRef.current;
        recognitionRef.current = null;
        try { ref.stop(); } catch { /* ignore */ }
        setRecording(false);
        return;
      }
    }

    // Request microphone permission — then immediately release the stream
    // so SpeechRecognition can acquire the mic without conflict
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
    } catch {
      setMicError('Microphone access denied');
      setTimeout(() => setMicError(null), 3000);
      return;
    }

    networkRetriesRef.current = 0;
    wantRecordingRef.current = true;
    setRecording(true);
    setMicError(null);
    startRecognition();
  }, [recording, startRecognition, stopGroqRecording]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      wantRecordingRef.current = false;
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch { /* ignore */ }
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        try { mediaRecorderRef.current.stop(); } catch { /* ignore */ }
      }
    };
  }, []);

  // Format with fixed width: pad to same number of digits as the real count
  const digits = String(wordCount).length;
  const displayStr = String(displayCount).padStart(digits, '\u2007'); // figure space

  return (
    <>
      {/* Page count — bottom left, positioned within editor area */}
      {totalPages > 1 && (
        <div
          className="text-xs rounded-full"
          style={{
            position: 'fixed',
            bottom: 16 + keyboardOffset,
            left: containerRect ? containerRect.left + 16 : 16,
            backgroundColor: 'var(--color-cream-dark, #F0F0EC)',
            color: 'var(--color-ink-lighter, #9B9B9B)',
            padding: '4px 12px',
            userSelect: 'none',
            fontVariantNumeric: 'tabular-nums',
            zIndex: 40,
            transition: 'bottom 0.15s ease-out',
          }}
        >
          Page {currentPage} of {totalPages}
        </div>
      )}

      {/* Word count + Mic — bottom right, positioned within editor area */}
      <div
        className="flex items-center gap-2"
        style={{
          position: 'fixed',
          bottom: 16 + keyboardOffset,
          right: containerRect ? window.innerWidth - containerRect.right + 16 : 16,
          zIndex: 40,
          transition: 'bottom 0.15s ease-out',
        }}
      >
        {/* Mic error tooltip */}
        {micError && (
          <div
            className="text-xs rounded-full animate-fade-in"
            style={{
              backgroundColor: '#FFECE9',
              color: '#D4726A',
              padding: '4px 12px',
            }}
          >
            {micError}
          </div>
        )}

        {/* Microphone button */}
        <button
          onClick={toggleRecording}
          className={`mic-button ${recording ? 'mic-recording' : ''}`}
          title={recording ? 'Stop dictation' : 'Start dictation'}
          style={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: recording ? '#C66140' : 'var(--color-cream-dark, #F0F0EC)',
            color: recording ? '#FAFAF8' : 'var(--color-ink-lighter, #9B9B9B)',
            transition: 'background-color 200ms, color 200ms',
            position: 'relative',
            flexShrink: 0,
          }}
        >
          {/* Pulse rings when recording */}
          {recording && (
            <>
              <span className="mic-pulse mic-pulse-1" />
              <span className="mic-pulse mic-pulse-2" />
              <span className="mic-pulse mic-pulse-3" />
            </>
          )}
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className={recording ? 'mic-icon-active' : ''} style={{ position: 'relative', zIndex: 1 }}>
            <rect x="4.5" y="1" width="5" height="8" rx="2.5" stroke="currentColor" strokeWidth="1.3" />
            <path d="M2.5 6.5C2.5 9 4.5 11 7 11s4.5-2 4.5-4.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            <line x1="7" y1="11" x2="7" y2="13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            <line x1="5" y1="13" x2="9" y2="13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </button>

        {/* Word count */}
        <div
          className="text-xs rounded-full"
          onMouseEnter={handleMouseEnter}
          style={{
            backgroundColor: 'var(--color-cream-dark, #F0F0EC)',
            color: 'var(--color-ink-lighter, #9B9B9B)',
            padding: '4px 12px',
            cursor: 'default',
            userSelect: 'none',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {displayStr} {isSelection ? 'selected' : 'words'}
        </div>
      </div>
    </>
  );
}
