import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { initialLook, LOOK_GROUND, LOOK_KEY, type Look } from './look';

interface ThemeContextValue {
  theme: Look;
  resolved: Look;
  setTheme: (theme: Look) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'dark',
  resolved: 'dark',
  setTheme: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

function applyLook(look: Look) {
  const root = document.documentElement;
  root.classList.toggle('light', look === 'light');
  root.style.colorScheme = look;
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content', LOOK_GROUND[look]);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Look>(() => {
    if (typeof document === 'undefined') return 'dark';
    return document.documentElement.classList.contains('light') ? 'light' : 'dark';
  });
  const choice = useRef<Look | null>(null);

  const setTheme = (look: Look) => {
    choice.current = look;
    applyLook(look);
    setThemeState(look);
    try {
      window.localStorage.setItem(LOOK_KEY, look);
    } catch {
      // Keep the choice for this page even when storage is unavailable.
    }
  };

  useEffect(() => {
    const preference = window.matchMedia('(prefers-color-scheme: light)');
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(LOOK_KEY);
    } catch {
      // The system preference is the default when storage is unavailable.
    }

    const syncLook = () => {
      const look = choice.current ?? initialLook(stored, preference.matches);
      applyLook(look);
      setThemeState(look);
    };
    syncLook();
    preference.addEventListener('change', syncLook);
    return () => preference.removeEventListener('change', syncLook);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, resolved: theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
