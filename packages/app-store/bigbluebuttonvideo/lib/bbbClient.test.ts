import { describe, expect, it } from "vitest";

import { BbbApiError, buildChecksum, buildSignedUrl, generateMeetingPassword } from "./bbbClient";

describe("buildChecksum", () => {
  it("computes SHA1(call + queryString + sharedSecret) deterministically", () => {
    const result = buildChecksum(
      "create",
      "name=Test+Meeting&meetingID=test01",
      "639259d4-9dd8-4b25-bf01-95f9567eaf4b"
    );
    expect(result).toBe("3baf7225edafd69b220ed9d86931c07ab5262275");
    expect(result).toMatch(/^[0-9a-f]{40}$/);
  });

  it("changes when the secret changes", () => {
    const a = buildChecksum("create", "meetingID=x", "secret-a");
    const b = buildChecksum("create", "meetingID=x", "secret-b");
    expect(a).not.toBe(b);
  });

  it("changes when the call name changes", () => {
    const create = buildChecksum("create", "meetingID=x", "s");
    const join = buildChecksum("join", "meetingID=x", "s");
    expect(create).not.toBe(join);
  });
});

describe("buildSignedUrl", () => {
  const sharedSecret = "test-secret";
  const serverUrl = "https://bbb.example.com";

  it("appends api base, query string, and checksum", () => {
    const url = buildSignedUrl({
      serverUrl,
      sharedSecret,
      call: "create",
      params: { meetingID: "abc", name: "Hello" },
    });
    expect(url).toMatch(
      /^https:\/\/bbb\.example\.com\/bigbluebutton\/api\/create\?meetingID=abc&name=Hello&checksum=[0-9a-f]{40}$/
    );
  });

  it("does not double-append /bigbluebutton when server URL already includes it", () => {
    const url = buildSignedUrl({
      serverUrl: "https://bbb.example.com/bigbluebutton",
      sharedSecret,
      call: "getMeetings",
      params: {},
    });
    expect(url.startsWith("https://bbb.example.com/bigbluebutton/api/getMeetings?")).toBe(true);
    expect(url.includes("/bigbluebutton/bigbluebutton")).toBe(false);
  });

  it("strips trailing slashes from the server URL", () => {
    const url = buildSignedUrl({
      serverUrl: "https://bbb.example.com///",
      sharedSecret,
      call: "getMeetings",
      params: {},
    });
    expect(url.startsWith("https://bbb.example.com/bigbluebutton/api/getMeetings?")).toBe(true);
  });

  it("omits undefined parameters from the query string and checksum", () => {
    const url = buildSignedUrl({
      serverUrl,
      sharedSecret,
      call: "create",
      params: { meetingID: "abc", duration: undefined, welcome: undefined },
    });
    expect(url.includes("duration")).toBe(false);
    expect(url.includes("welcome")).toBe(false);
  });

  it("url-encodes spaces in parameter values using +", () => {
    const url = buildSignedUrl({
      serverUrl,
      sharedSecret,
      call: "create",
      params: { name: "Test Meeting" },
    });
    expect(url.includes("name=Test+Meeting")).toBe(true);
  });

  it("places checksum after the query string with & separator", () => {
    const url = buildSignedUrl({
      serverUrl,
      sharedSecret,
      call: "create",
      params: { meetingID: "x" },
    });
    expect(url).toMatch(/\?meetingID=x&checksum=[0-9a-f]{40}$/);
  });

  it("uses no separator before checksum when params are empty", () => {
    const url = buildSignedUrl({
      serverUrl,
      sharedSecret,
      call: "getMeetings",
      params: {},
    });
    expect(url).toMatch(/\?checksum=[0-9a-f]{40}$/);
  });
});

describe("generateMeetingPassword", () => {
  it("returns a 32-character hex string", () => {
    const pw = generateMeetingPassword();
    expect(pw).toMatch(/^[0-9a-f]{32}$/);
  });

  it("returns a different value on each call", () => {
    expect(generateMeetingPassword()).not.toBe(generateMeetingPassword());
  });
});

describe("BbbApiError", () => {
  it("preserves the message and optional messageKey", () => {
    const err = new BbbApiError("meeting not found", "notFound");
    expect(err.message).toBe("meeting not found");
    expect(err.messageKey).toBe("notFound");
    expect(err.name).toBe("BbbApiError");
    expect(err).toBeInstanceOf(Error);
  });
});
