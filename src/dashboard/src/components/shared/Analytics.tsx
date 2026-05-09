import { useEffect } from 'react';

/**
 * Google Analytics 4 + Microsoft Clarity tracking.
 * Uses the same IDs as agentos.sh (shared analytics under one property).
 *
 * Set VITE_GA_MEASUREMENT_ID and VITE_CLARITY_PROJECT_ID in your
 * dashboard .env or deployment environment. If not set, no scripts load.
 */

// Read via optional chaining + cast so node:test runs (which load this
// module transitively through App.tsx but don't populate import.meta.env)
// don't crash at import time. Production builds via Vite still inline
// the env values; the optional access is a no-op there.
const META_ENV = ((import.meta as { env?: Record<string, string | undefined> }).env) ?? {};
const GA_ID = META_ENV.VITE_GA_MEASUREMENT_ID || '';
const CLARITY_ID = META_ENV.VITE_CLARITY_PROJECT_ID || '';

function injectScript(id: string, src: string) {
  if (document.getElementById(id)) return;
  const s = document.createElement('script');
  s.id = id;
  s.async = true;
  s.src = src;
  document.head.appendChild(s);
}

function injectInline(id: string, code: string) {
  if (document.getElementById(id)) return;
  const s = document.createElement('script');
  s.id = id;
  s.textContent = code;
  document.head.appendChild(s);
}

export function Analytics() {
  useEffect(() => {
    // Google Analytics 4
    if (GA_ID && GA_ID !== 'G-XXXXXXXXXX') {
      injectInline('ga-init', `
        window.dataLayer = window.dataLayer || [];
        function gtag(){dataLayer.push(arguments);}
        gtag('js', new Date());
        gtag('config', '${GA_ID}', {
          page_path: window.location.pathname,
          anonymize_ip: true
        });
      `);
      injectScript('ga-js', `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`);
    }

    // Microsoft Clarity
    if (CLARITY_ID) {
      injectInline('clarity-init', `
        (function(c,l,a,r,i,t,y){
          c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
          t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
          y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
        })(window, document, "clarity", "script", "${CLARITY_ID}");
      `);
    }
  }, []);

  return null;
}
