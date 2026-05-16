import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { APPS_WITH_SETUP_FORM, appRequiresSetupForm, setupFormRedirectFor } from "./appsWithSetupForm";

describe("appRequiresSetupForm", () => {
  it("returns true for slugs registered in APPS_WITH_SETUP_FORM", () => {
    for (const slug of APPS_WITH_SETUP_FORM) {
      expect(appRequiresSetupForm(slug)).toBe(true);
    }
  });

  it("returns true for the bigbluebutton slug specifically", () => {
    // Regression guard: the whole reason this helper exists is so BBB and any
    // future non-OAuth conferencing app with user-supplied credentials gets
    // routed through its setup form instead of silently auto-installing.
    expect(appRequiresSetupForm("bigbluebutton")).toBe(true);
  });

  it("returns false for OAuth conferencing apps that handle credentials via callback", () => {
    expect(appRequiresSetupForm("zoom")).toBe(false);
    expect(appRequiresSetupForm("msteams")).toBe(false);
    expect(appRequiresSetupForm("google-meet")).toBe(false);
    expect(appRequiresSetupForm("webex")).toBe(false);
  });

  it("returns false for credential-free conferencing apps", () => {
    expect(appRequiresSetupForm("jitsi")).toBe(false);
    expect(appRequiresSetupForm("daily-video")).toBe(false);
  });

  it("returns false for unknown slugs", () => {
    expect(appRequiresSetupForm("not-a-real-app")).toBe(false);
    expect(appRequiresSetupForm("random-string")).toBe(false);
  });

  it("returns false for empty / nullish inputs", () => {
    expect(appRequiresSetupForm("")).toBe(false);
    expect(appRequiresSetupForm(null)).toBe(false);
    expect(appRequiresSetupForm(undefined)).toBe(false);
  });

  it("is case-sensitive (slugs are stable identifiers)", () => {
    expect(appRequiresSetupForm("BigBlueButton")).toBe(false);
    expect(appRequiresSetupForm("Caldav-Calendar")).toBe(false);
  });
});

describe("setupFormRedirectFor", () => {
  it("returns a Next.js redirect object for apps that need a setup form", () => {
    expect(setupFormRedirectFor("bigbluebutton")).toEqual({
      permanent: false,
      destination: "/apps/bigbluebutton/setup",
    });
  });

  it("uses the slug directly in the destination path", () => {
    expect(setupFormRedirectFor("caldav-calendar")).toEqual({
      permanent: false,
      destination: "/apps/caldav-calendar/setup",
    });
  });

  it("always returns permanent: false (these redirects are session-scoped)", () => {
    for (const slug of APPS_WITH_SETUP_FORM) {
      const result = setupFormRedirectFor(slug);
      expect(result).not.toBeNull();
      expect(result?.permanent).toBe(false);
    }
  });

  it("returns null for apps that don't require a setup form", () => {
    expect(setupFormRedirectFor("zoom")).toBeNull();
    expect(setupFormRedirectFor("jitsi")).toBeNull();
    expect(setupFormRedirectFor("daily-video")).toBeNull();
  });

  it("returns null for unknown slugs", () => {
    expect(setupFormRedirectFor("not-a-real-app")).toBeNull();
  });

  it("returns null for empty / nullish inputs", () => {
    expect(setupFormRedirectFor("")).toBeNull();
    expect(setupFormRedirectFor(null)).toBeNull();
    expect(setupFormRedirectFor(undefined)).toBeNull();
  });
});

describe("APPS_WITH_SETUP_FORM (drift detection)", () => {
  // This is the only safeguard preventing the list from drifting out of sync
  // with AppSetupMap. We can't import AppSetupMap directly here because it
  // pulls in next/dynamic side effects, so instead we read the source file
  // as plain text and check the slug keys appear in it.
  it("every entry must be a key in AppSetupMap (AppSetupPage.tsx)", () => {
    const appSetupPagePath = path.resolve(__dirname, "AppSetupPage.tsx");
    const source = fs.readFileSync(appSetupPagePath, "utf-8");

    for (const slug of APPS_WITH_SETUP_FORM) {
      // AppSetupMap keys can be bare identifiers (alby) or quoted strings
      // ("apple-calendar"), so check both forms.
      const bareMatch = new RegExp(`\\b${slug}:\\s*dynamic\\(`).test(source);
      const quotedMatch = new RegExp(`["']${slug}["']:\\s*dynamic\\(`).test(source);
      expect(
        bareMatch || quotedMatch,
        `${slug} is in APPS_WITH_SETUP_FORM but not registered in AppSetupMap`
      ).toBe(true);
    }
  });
});
