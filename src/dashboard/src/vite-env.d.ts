/// <reference types="vite/client" />

declare module '*.css' {
  const content: string;
  export default content;
}

// CSS Modules — `*.module.scss` and `*.module.css` resolve at build
// time to an object mapping class names to hashed strings (e.g.
// `styles.card` → 'App_card__a1b2'). The dashboard imports these as
// `import styles from './X.module.scss'`. Vite's `vite/client` types
// don't cover SCSS modules; declare them explicitly so tsc -p
// src/dashboard doesn't emit spurious TS2307 errors on every file
// that imports a stylesheet.
declare module '*.module.scss' {
  const styles: Record<string, string>;
  export default styles;
}
declare module '*.module.css' {
  const styles: Record<string, string>;
  export default styles;
}

// Vite-specific module / metadata declarations. `vite` isn't a tracked
// devDep (the build runs through `npx vite`) so the `vite/client`
// reference at the top of this file resolves to nothing in `npm ci`
// installs and the dashboard's tsc -p run flags every `import.meta.env`
// access and every `?url`/`?raw` asset import. Declare what the
// dashboard actually uses inline so the typecheck stays self-contained.
interface ImportMetaEnv {
  readonly VITE_NEW_GRID?: string;
  readonly VITE_GA_MEASUREMENT_ID?: string;
  readonly VITE_CLARITY_PROJECT_ID?: string;
  // Open string index so `(import.meta as { env?: Record<string,
  // string | undefined> }).env` casts elsewhere in the dashboard
  // (Analytics.tsx) stay assignment-compatible. The named VITE_* keys
  // above document the env vars the dashboard actually reads.
  readonly [key: string]: string | undefined;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
declare module '*?url' {
  const url: string;
  export default url;
}
declare module '*?raw' {
  const content: string;
  export default content;
}
