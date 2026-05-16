// Keep in sync with AppSetupMap in ./AppSetupPage.tsx — this is its keyset
// hoisted into a server-importable pure module (no next/dynamic side effects).
export const APPS_WITH_SETUP_FORM = [
  "alby",
  "apple-calendar",
  "bigbluebutton",
  "btcpayserver",
  "caldav-calendar",
  "exchange",
  "exchange2013-calendar",
  "exchange2016-calendar",
  "hitpay",
  "ics-feed",
  "make",
  "paypal",
  "sendgrid",
  "stripe",
] as const;

export type AppWithSetupFormSlug = (typeof APPS_WITH_SETUP_FORM)[number];

/**
 * Returns true if the given app slug has a custom setup form that collects
 * user-supplied credentials (server URL, shared secret, etc.). Used by the
 * install router to skip the silent auto-install for these apps and send the
 * user to `/apps/<slug>/setup` instead.
 */
export const appRequiresSetupForm = (slug: string | null | undefined): boolean =>
  !!slug && (APPS_WITH_SETUP_FORM as readonly string[]).includes(slug);

export type SetupFormRedirect = { permanent: false; destination: string };

/**
 * Returns the Next.js redirect object pointing at the app's setup form, or
 * `null` if the app doesn't require one. Used by `/apps/installation/...`
 * server-side rendering to skip the silent auto-install for apps that need
 * user-supplied credentials.
 */
export const setupFormRedirectFor = (slug: string | null | undefined): SetupFormRedirect | null =>
  appRequiresSetupForm(slug) ? { permanent: false, destination: `/apps/${slug}/setup` } : null;
