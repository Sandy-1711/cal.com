import { afterEach, describe, expect, it, vi } from "vitest";

import { generateTextResponse } from "../../_utils/testUtils";
import {
  BbbApiError,
  buildChecksum,
  buildSignedUrl,
  callBbb,
  generateMeetingPassword,
  parseBbbResponse,
} from "./bbbClient";

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

describe("parseBbbResponse", () => {
  it("returns the parsed object when returncode === SUCCESS", () => {
    const xml = `<?xml version="1.0"?><response><returncode>SUCCESS</returncode><meetingID>m1</meetingID></response>`;
    const result = parseBbbResponse(xml, "create");
    expect(result.response?.returncode).toBe("SUCCESS");
  });

  it("throws BbbApiError with the BBB message and messageKey on FAILED", () => {
    const xml = `<?xml version="1.0"?><response><returncode>FAILED</returncode><messageKey>checksumError</messageKey><message>Invalid checksum</message></response>`;
    try {
      parseBbbResponse(xml, "create");
      throw new Error("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(BbbApiError);
      expect((err as BbbApiError).message).toBe("Invalid checksum");
      expect((err as BbbApiError).messageKey).toBe("checksumError");
    }
  });

  it("throws BbbApiError when XML is malformed", () => {
    const malformed = "<<<not xml>>>";
    expect(() => parseBbbResponse(malformed, "create")).toThrow(BbbApiError);
  });

  it("throws BbbApiError when body has no <response> root", () => {
    const xml = `<?xml version="1.0"?><other>nope</other>`;
    expect(() => parseBbbResponse(xml, "create")).toThrow(BbbApiError);
  });
});

describe("callBbb", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const baseArgs = {
    serverUrl: "https://bbb.example.com",
    sharedSecret: "secret",
    call: "getMeetings",
  };

  it("throws BbbApiError on non-OK HTTP status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("", { status: 500, statusText: "Internal Server Error" })
    );
    await expect(callBbb(baseArgs)).rejects.toBeInstanceOf(BbbApiError);
    await expect(callBbb(baseArgs)).rejects.toThrow(/HTTP 500/);
  });

  it("throws BbbApiError when BBB returns FAILED in the XML body", async () => {
    const failedXml = `<?xml version="1.0"?><response><returncode>FAILED</returncode><messageKey>notFound</messageKey><message>Not found</message></response>`;
    vi.spyOn(globalThis, "fetch").mockResolvedValue(generateTextResponse({ text: failedXml }));
    try {
      await callBbb(baseArgs);
      throw new Error("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(BbbApiError);
      expect((err as BbbApiError).messageKey).toBe("notFound");
    }
  });

  it("throws BbbApiError when the response body is malformed XML", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(generateTextResponse({ text: "<<<garbage>>>" }));
    await expect(callBbb(baseArgs)).rejects.toBeInstanceOf(BbbApiError);
  });

  it("attaches AbortSignal.timeout when the caller does not provide one", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      generateTextResponse({
        text: `<?xml version="1.0"?><response><returncode>SUCCESS</returncode></response>`,
      })
    );
    await callBbb(baseArgs);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});
