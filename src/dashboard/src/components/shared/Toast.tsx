import { useState, useCallback, createContext, useContext, type ReactNode } from 'react';

interface ToastMessage {
  id: number;
  type: 'info' | 'error' | 'success' | 'crisis-a' | 'crisis-b';
  title: string;
  message: string;
}

interface ToastContextValue {
  toast: (type: ToastMessage['type'], title: string, message: string, durationMs?: number) => void;
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

let nextId = 0;

const BORDER_COLORS: Record<ToastMessage['type'], string> = {
  info: 'var(--amber)',
  error: 'var(--rust)',
  success: 'var(--green)',
  'crisis-a': 'var(--vis, #e8b44a)',
  'crisis-b': 'var(--eng, #4ca8a8)',
};

const TITLE_COLORS: Record<ToastMessage['type'], string> = {
  info: 'var(--amber)',
  error: 'var(--rust)',
  success: 'var(--green)',
  'crisis-a': 'var(--vis, #e8b44a)',
  'crisis-b': 'var(--eng, #4ca8a8)',
};

// Theme-aware backgrounds: layer a faint accent tint on the current
// theme's bg-card so the toast contrasts with the page in both dark
// AND light modes. The earlier hardcoded near-black hex values were
// invisible on the light theme (dark box on cream page).
const BG_TINTS: Record<ToastMessage['type'], string> = {
  info: 'color-mix(in srgb, var(--amber) 8%, var(--bg-card))',
  error: 'color-mix(in srgb, var(--rust) 8%, var(--bg-card))',
  success: 'color-mix(in srgb, var(--green) 8%, var(--bg-card))',
  'crisis-a': 'color-mix(in srgb, var(--vis, #e8b44a) 8%, var(--bg-card))',
  'crisis-b': 'color-mix(in srgb, var(--eng, #4ca8a8) 8%, var(--bg-card))',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const toast = useCallback((type: ToastMessage['type'], title: string, message: string, durationMs?: number) => {
    const id = nextId++;
    setToasts(prev => [...prev, { id, type, title, message }]);
    // Auto-size duration to content length so short ops ("Saved", "Cleared")
    // flash briefly and long error messages ("No events received within 60
    // seconds...") stay visible long enough to read. Roughly targets
    // ~250 characters per 10 seconds of display time, clamped to [3s, 15s].
    // An explicit durationMs override always wins.
    const computedDuration = (() => {
      const chars = title.length + message.length;
      return Math.max(3000, Math.min(15000, 2500 + chars * 40));
    })();
    const duration = durationMs ?? computedDuration;
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, duration);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div style={{
        position: 'fixed', top: 56, right: 16, zIndex: 100000,
        display: 'flex', flexDirection: 'column', gap: 8,
        pointerEvents: 'none', maxWidth: 380,
      }}>
        {toasts.map(t => (
          <div
            key={t.id}
            style={{
              pointerEvents: 'auto',
              padding: '10px 14px',
              borderRadius: 8,
              fontSize: 'var(--font-sm)',
              background: BG_TINTS[t.type],
              border: `1px solid ${BORDER_COLORS[t.type]}`,
              borderLeft: `3px solid ${BORDER_COLORS[t.type]}`,
              color: 'var(--text-1)',
              // Soft elevation that works on both themes (same shadow opacity
              // reads as a subtle drop on cream, a deeper one on near-black).
              boxShadow: 'var(--card-shadow, 0 4px 16px rgba(0,0,0,0.18))',
              animation: 'slideIn 0.3s ease',
              position: 'relative',
            }}
          >
            <button
              onClick={() => dismiss(t.id)}
              style={{
                position: 'absolute', top: 4, right: 8,
                background: 'none', border: 'none', color: 'var(--text-3)',
                cursor: 'pointer', fontSize: 'var(--font-lg)', lineHeight: 1,
              }}
              aria-label="Dismiss"
            >
              x
            </button>
            <div style={{ fontWeight: 700, fontSize: 'var(--font-sm)', marginBottom: 2, color: TITLE_COLORS[t.type], paddingRight: 16 }}>
              {t.title}
            </div>
            {t.message && (
              <div style={{ fontSize: 'var(--font-xs)', color: 'var(--text-2)', lineHeight: 1.5 }}>
                {t.message}
              </div>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
