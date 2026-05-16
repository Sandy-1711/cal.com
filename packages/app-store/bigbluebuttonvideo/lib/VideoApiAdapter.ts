import process from "node:process";
import { symmetricDecrypt } from "@calcom/lib/crypto";
import logger from "@calcom/lib/logger";
import { prisma } from "@calcom/prisma";
import type { GetAccessLinkResponseSchema, GetRecordingsResponseSchema } from "@calcom/prisma/zod-utils";
import type { CalendarEvent } from "@calcom/types/Calendar";
import type { CredentialPayload } from "@calcom/types/Credential";
import type { PartialReference } from "@calcom/types/EventManager";
import type { VideoApiAdapter, VideoCallData } from "@calcom/types/VideoApiAdapter";
import { XMLParser } from "fast-xml-parser";
import { metadata } from "../_metadata";
import { type BbbCredentialKey, bbbCredentialKeySchema } from "../zod";
import { BbbApiError, buildSignedUrl, callBbb, generateMeetingPassword, parseBbbResponse } from "./bbbClient";

const log = logger.getSubLogger({ prefix: ["bigbluebuttonvideo/VideoApiAdapter"] });

const recordingResponseParser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: true,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (name) => name === "recording" || name === "format",
});

const decryptCredentialKey = (credential: CredentialPayload): BbbCredentialKey => {
  const raw = typeof credential.key === "string" ? credential.key : "";
  if (!raw) {
    throw new BbbApiError("BigBlueButton credential is missing");
  }
  const encryptionKey = process.env.CALENDSO_ENCRYPTION_KEY || "";
  const decrypted = JSON.parse(symmetricDecrypt(raw, encryptionKey));
  return bbbCredentialKeySchema.parse(decrypted);
};

const minutesBetween = (start: string, end: string) => {
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return 0;
  // Round up so a window with leftover seconds doesn't get BBB to auto-end
  // the room before event.endTime.
  return Math.max(1, Math.ceil((endMs - startMs) / 60000));
};

type RecordingFormat = { type?: string; url?: string };
type RecordingItem = {
  recordID?: string;
  meetingID?: string;
  startTime?: number | string;
  endTime?: number | string;
  state?: string;
  participants?: number | string;
  playback?: { format?: RecordingFormat[] };
};

const normalizeRecordings = (parsedXml: unknown): RecordingItem[] => {
  const root = (parsedXml as { response?: { recordings?: unknown } })?.response;
  const recordings = root?.recordings;
  if (!recordings || typeof recordings !== "object") return [];
  const inner = (recordings as { recording?: RecordingItem | RecordingItem[] }).recording;
  if (!inner) return [];
  return Array.isArray(inner) ? inner : [inner];
};

const toEpochMs = (value: number | string | undefined) => {
  if (value === undefined) return 0;
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return 0;
  return num > 1e12 ? num : num * 1000;
};

const fetchRecordingsXml = async (creds: BbbCredentialKey, params: Record<string, string>) => {
  const url = buildSignedUrl({
    serverUrl: creds.serverUrl,
    sharedSecret: creds.sharedSecret,
    call: "getRecordings",
    params,
  });
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) {
    throw new BbbApiError(`BigBlueButton getRecordings failed with HTTP ${response.status}`);
  }
  const body = await response.text();
  // parseBbbResponse asserts returncode === SUCCESS and converts parser errors
  // to BbbApiError. Without this check an auth/checksum/server failure would
  // be silently mapped to "no recordings".
  return parseBbbResponse(body, "getRecordings", recordingResponseParser);
};

/**
 * Cal's `VideoApiAdapter` for BigBlueButton. One adapter instance is created
 * per booking action (create/update/delete/getRecordings) from the user's
 * encrypted credential. Implements the standard adapter contract plus the
 * optional recordings methods.
 *
 * BBB-specific behavior:
 * - `event.uid` is used as the `meetingID` so reschedule (updateMeeting) is
 *   idempotent — BBB returns the existing room when `create` is called with
 *   the same `meetingID`.
 * - The moderator password generated at create time is stored in
 *   `BookingReference.meetingPassword` so `deleteMeeting` can call BBB's
 *   `/api/end` on cancel.
 */
const BBBVideoApiAdapter = (credential: CredentialPayload): VideoApiAdapter => {
  const credentials = decryptCredentialKey(credential);

  return {
    getAvailability: () => Promise.resolve([]),

    createMeeting: async (event: CalendarEvent): Promise<VideoCallData> => {
      const meetingID = event.uid ?? generateMeetingPassword();
      const attendeePW = generateMeetingPassword();
      const moderatorPW = generateMeetingPassword();
      const duration = minutesBetween(event.startTime, event.endTime);

      await callBbb({
        serverUrl: credentials.serverUrl,
        sharedSecret: credentials.sharedSecret,
        call: "create",
        params: {
          meetingID,
          name: event.title,
          attendeePW,
          moderatorPW,
          welcome: event.description ?? undefined,
          duration: duration || undefined,
          record: true,
          autoStartRecording: false,
          allowStartStopRecording: true,
        },
      });

      const joinUrl = buildSignedUrl({
        serverUrl: credentials.serverUrl,
        sharedSecret: credentials.sharedSecret,
        call: "join",
        params: { meetingID, password: moderatorPW, fullName: "Guest" },
      });

      return {
        type: metadata.type,
        id: meetingID,
        password: moderatorPW,
        url: joinUrl,
      };
    },

    updateMeeting: async (bookingRef: PartialReference, event: CalendarEvent): Promise<VideoCallData> => {
      const meetingID = (bookingRef.meetingId as string | null) ?? event.uid ?? generateMeetingPassword();
      const moderatorPW = (bookingRef.meetingPassword as string | null) ?? generateMeetingPassword();
      const attendeePW = generateMeetingPassword();
      const duration = minutesBetween(event.startTime, event.endTime);

      await callBbb({
        serverUrl: credentials.serverUrl,
        sharedSecret: credentials.sharedSecret,
        call: "create",
        params: {
          meetingID,
          name: event.title,
          attendeePW,
          moderatorPW,
          welcome: event.description ?? undefined,
          duration: duration || undefined,
          record: true,
        },
      });

      const joinUrl = buildSignedUrl({
        serverUrl: credentials.serverUrl,
        sharedSecret: credentials.sharedSecret,
        call: "join",
        params: { meetingID, password: moderatorPW, fullName: "Guest" },
      });

      return {
        type: metadata.type,
        id: meetingID,
        password: moderatorPW,
        url: joinUrl,
      };
    },

    deleteMeeting: async (uid: string): Promise<unknown> => {
      const reference = await prisma.bookingReference.findFirst({
        where: { type: metadata.type, uid },
        select: { meetingId: true, meetingPassword: true },
      });

      const meetingID = reference?.meetingId ?? uid;
      const password = reference?.meetingPassword;

      if (!password) {
        log.warn("Skipping BigBlueButton end call — moderator password not stored", { uid });
        return {};
      }

      try {
        await callBbb({
          serverUrl: credentials.serverUrl,
          sharedSecret: credentials.sharedSecret,
          call: "end",
          params: { meetingID, password },
        });
      } catch (err) {
        if (err instanceof BbbApiError && err.messageKey === "notFound") {
          return {};
        }
        throw err;
      }
      return {};
    },

    getRecordings: async (roomName: string): Promise<GetRecordingsResponseSchema> => {
      const parsed = await fetchRecordingsXml(credentials, { meetingID: roomName });
      const recordings = normalizeRecordings(parsed);

      const data = recordings.map((item) => {
        const startMs = toEpochMs(item.startTime);
        const endMs = toEpochMs(item.endTime);
        const playbackUrl = item.playback?.format?.[0]?.url ?? "";
        const participants =
          typeof item.participants === "number" ? item.participants : Number(item.participants ?? 0) || 0;
        return {
          id: item.recordID ?? "",
          room_name: item.meetingID ?? roomName,
          start_ts: Math.floor(startMs / 1000),
          status: item.state ?? "finished",
          max_participants: participants,
          duration: endMs > startMs ? Math.floor((endMs - startMs) / 1000) : 0,
          share_token: playbackUrl,
        };
      });

      return { total_count: data.length, data };
    },

    getRecordingDownloadLink: async (recordingId: string): Promise<GetAccessLinkResponseSchema> => {
      const parsed = await fetchRecordingsXml(credentials, { recordID: recordingId });
      const [recording] = normalizeRecordings(parsed);
      const downloadLink = recording?.playback?.format?.[0]?.url;

      if (!downloadLink) {
        throw new BbbApiError("BigBlueButton recording has no playback URL");
      }

      return { download_link: downloadLink };
    },
  };
};

export default BBBVideoApiAdapter;
