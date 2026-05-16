import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { symmetricEncrypt } from "@calcom/lib/crypto";
import type { CredentialPayload } from "@calcom/types/Credential";

import { generateTextResponse } from "../../_utils/testUtils";
import VideoApiAdapter from "./VideoApiAdapter";

const ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef";

const buildCredential = (overrides: Partial<CredentialPayload> = {}): CredentialPayload => ({
  id: 1,
  type: "bigbluebutton_video",
  key: symmetricEncrypt(
    JSON.stringify({ serverUrl: "https://bbb.example.com", sharedSecret: "test-secret" }),
    ENCRYPTION_KEY
  ),
  userId: 1,
  teamId: null,
  appId: "bigbluebutton",
  invalid: false,
  user: { email: "user@example.com" },
  delegatedTo: null,
  delegationCredentialId: null,
  encryptedKey: null,
  ...overrides,
});

const buildEvent = (overrides: Partial<Parameters<NonNullable<ReturnType<typeof VideoApiAdapter>>["createMeeting"]>[0]> = {}) =>
  ({
    uid: "booking-uid-123",
    title: "Test Meeting",
    description: "An interview",
    startTime: "2026-06-01T10:00:00.000Z",
    endTime: "2026-06-01T10:30:00.000Z",
    attendees: [{ name: "Alice", email: "a@example.com", timeZone: "UTC", language: { locale: "en" } }],
    organizer: { name: "Bob", email: "b@example.com", timeZone: "UTC", language: { locale: "en" } },
    type: "test-type",
    ...overrides,
  } as unknown as Parameters<NonNullable<ReturnType<typeof VideoApiAdapter>>["createMeeting"]>[0]);

const successXml = `<?xml version="1.0"?><response><returncode>SUCCESS</returncode><meetingID>booking-uid-123</meetingID></response>`;
const notFoundXml = `<?xml version="1.0"?><response><returncode>FAILED</returncode><messageKey>notFound</messageKey><message>Meeting not found</message></response>`;

const originalEncryptionKey = process.env.CALENDSO_ENCRYPTION_KEY;

beforeEach(() => {
  process.env.CALENDSO_ENCRYPTION_KEY = ENCRYPTION_KEY;
});

afterEach(() => {
  process.env.CALENDSO_ENCRYPTION_KEY = originalEncryptionKey;
  vi.restoreAllMocks();
});

describe("BBBVideoApiAdapter", () => {
  it("createMeeting calls BBB /api/create and returns a signed join URL", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      generateTextResponse({ text: successXml })
    );

    const adapter = VideoApiAdapter(buildCredential());
    if (!adapter) throw new Error("adapter undefined");
    const result = await adapter.createMeeting(buildEvent());

    expect(fetchMock).toHaveBeenCalledOnce();
    const requestedUrl = fetchMock.mock.calls[0][0] as string;
    expect(requestedUrl).toMatch(/\/bigbluebutton\/api\/create\?/);
    expect(requestedUrl).toMatch(/meetingID=booking-uid-123/);
    expect(requestedUrl).toMatch(/checksum=[0-9a-f]{40}$/);

    expect(result.type).toBe("bigbluebutton_video");
    expect(result.id).toBe("booking-uid-123");
    expect(result.password).toMatch(/^[0-9a-f]{32}$/);
    expect(result.url).toMatch(/\/bigbluebutton\/api\/join\?/);
    expect(result.url).toMatch(/fullName=Guest/);

    // The join URL embeds the attendee password (least privilege for the
    // shared link). The moderator password stays internal on
    // BookingReference.meetingPassword and is reused by deleteMeeting.
    const passwordInJoinUrl = new URL(result.url).searchParams.get("password");
    expect(passwordInJoinUrl).toMatch(/^[0-9a-f]{32}$/);
    expect(passwordInJoinUrl).not.toBe(result.password);
  });

  it("updateMeeting reuses meetingId and moderator password from booking reference", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      generateTextResponse({ text: successXml })
    );

    const adapter = VideoApiAdapter(buildCredential());
    if (!adapter) throw new Error("adapter undefined");

    const result = await adapter.updateMeeting(
      {
        type: "bigbluebutton_video",
        uid: "ignored",
        meetingId: "existing-room-id",
        meetingPassword: "preserved-moderator-pw",
        meetingUrl: "https://ignored.example.com",
      },
      buildEvent()
    );

    expect(result.id).toBe("existing-room-id");
    expect(result.password).toBe("preserved-moderator-pw");
  });

  it("getAvailability returns an empty array (BBB has no calendar)", async () => {
    const adapter = VideoApiAdapter(buildCredential());
    if (!adapter) throw new Error("adapter undefined");
    await expect(adapter.getAvailability()).resolves.toEqual([]);
  });

  it("createMeeting throws BbbApiError when BBB returns FAILED", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      generateTextResponse({ text: notFoundXml })
    );

    const adapter = VideoApiAdapter(buildCredential());
    if (!adapter) throw new Error("adapter undefined");

    await expect(adapter.createMeeting(buildEvent())).rejects.toThrow(/Meeting not found/);
  });

  it("throws when CALENDSO_ENCRYPTION_KEY cannot decrypt credential.key", () => {
    process.env.CALENDSO_ENCRYPTION_KEY = "wrong-key-wrong-key-wrong-key-wrong-key-wrong";
    expect(() => VideoApiAdapter(buildCredential())).toThrow();
  });
});
