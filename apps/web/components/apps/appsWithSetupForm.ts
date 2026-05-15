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

export const appRequiresSetupForm = (slug: string | null | undefined): boolean =>
  !!slug && (APPS_WITH_SETUP_FORM as readonly string[]).includes(slug);
