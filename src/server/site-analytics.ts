/**
 * Visitor analytics for the hosted demo at paracosm.agentos.sh: Plausible
 * first, self-hosted on the team's server and cookieless, then Google
 * Analytics 4 with Google signals and ad personalization off, then
 * Microsoft Clarity with the whole page masked. The landing page's privacy
 * section (#privacy) names the three tools and what they collect.
 *
 * Only the hosted demo loads them. The server adds the tags to the pages it
 * sends when it runs in hosted_demo mode (PARACOSM_HOSTED_DEMO=true), so a
 * copy run from the npm package or a clone serves its landing page, its
 * dashboard and its API docs without analytics. The dashboard's bundle
 * follows the same rule: deploy.yml builds it with the Google Analytics and
 * Clarity ids below for the hosted demo, and the package's build has none
 * (src/dashboard/src/components/shared/Analytics.tsx loads them).
 *
 * @module paracosm/server/site-analytics
 */

/** The site the hosted demo counts under on the shared Plausible instance, analytics.manic.agency. */
export const PLAUSIBLE_DOMAIN = 'paracosm.agentos.sh';

/** The hosted demo's Google Analytics 4 measurement id, the one deploy.yml gives the dashboard's build; agentos.sh reports to it too. */
export const GA_MEASUREMENT_ID = 'G-4KEEK15KWZ';

/** The hosted demo's Microsoft Clarity project id, the one deploy.yml gives the dashboard's build; agentos.sh reports to it too. */
export const CLARITY_PROJECT_ID = 'ukky5yykaj';

const PLAUSIBLE_TAG = `<script defer data-domain="${PLAUSIBLE_DOMAIN}" src="https://analytics.manic.agency/js/script.js"></script>`;

// Google's tag with advertising features and ad personalization off for this
// property: https://developers.google.com/tag-platform/security/guides/privacy
const GOOGLE_ANALYTICS_TAGS = [
  `<script async src="https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}"></script>`,
  `<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${GA_MEASUREMENT_ID}',{allow_google_signals:false,allow_ad_personalization_signals:false});</script>`,
].join('\n');

// Microsoft's install snippet. The masking comes from the attribute that
// withSiteAnalytics puts on <body>.
const CLARITY_TAG = `<script>(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script","${CLARITY_PROJECT_ID}");</script>`;

/**
 * The tools a page loads. `all` is Plausible, Google Analytics and Clarity;
 * `plausible` is for the dashboard, whose bundle loads the other two.
 */
export type SiteAnalyticsTools = 'all' | 'plausible';

/**
 * Adds the analytics tags to a page just before its `</head>`, Plausible
 * first, and puts `data-clarity-mask="True"` on its `<body>`. Clarity masks
 * the text and images of a marked element and everything inside it,
 * whatever the project's masking mode, so the whole page is masked
 * (https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-masking).
 * The dashboard takes the mark too, since its bundle loads Clarity. A page
 * without `</head>` comes back unchanged.
 */
export function withSiteAnalytics(html: string, tools: SiteAnalyticsTools): string {
  const headEnd = html.indexOf('</head>');
  if (headEnd === -1) return html;
  const tags = tools === 'all' ? [PLAUSIBLE_TAG, GOOGLE_ANALYTICS_TAGS, CLARITY_TAG] : [PLAUSIBLE_TAG];
  const tagged = `${html.slice(0, headEnd)}${tags.join('\n')}\n${html.slice(headEnd)}`;
  return tagged.replace(/<body(?=[\s>])/, '<body data-clarity-mask="True"');
}
