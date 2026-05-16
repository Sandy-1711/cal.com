import crypto from "node:crypto";
import { XMLParser } from "fast-xml-parser";

/**
 * Typed error for any BigBlueButton failure mode (HTTP error, malformed XML,
 * or a `<returncode>FAILED</returncode>` payload). Carries the BBB
 * `messageKey` when available so callers can branch on protocol error codes
 * (e.g. ignore `notFound` when ending an already-ended meeting).
 */
export class BbbApiError extends Error {
  constructor(
    message: string,
    public readonly messageKey?: string
  ) {
    super(message);
    this.name = "BbbApiError";
  }
}

const xmlParser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: true,
  parseAttributeValue: false,
  trimValues: true,
});

const stripTrailingSlash = (url: string) => url.replace(/\/+$/, "");

const normalizeApiBase = (serverUrl: string) => {
  const trimmed = stripTrailingSlash(serverUrl);
  return trimmed.endsWith("/bigbluebutton") ? trimmed : `${trimmed}/bigbluebutton`;
};

const toQueryString = (params: Record<string, string | number | boolean | undefined>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    search.append(key, String(value));
  }
  return search.toString();
};

/**
 * Computes the SHA1 checksum BBB requires on every API call:
 * `sha1(callName + queryString + sharedSecret)`. The `queryString` must be the
 * exact URL-encoded body that will be sent (without the leading `?` and
 * without `&checksum=...`).
 *
 * @see https://docs.bigbluebutton.org/development/api/#usage
 */
export const buildChecksum = (call: string, queryString: string, sharedSecret: string) =>
  crypto
    .createHash("sha1")
    .update(call + queryString + sharedSecret)
    .digest("hex");

/**
 * Builds a fully-signed BBB API URL ready to fetch (or to hand to the user as
 * a join link). Handles the protocol quirks the rest of the code doesn't have
 * to care about: appending `/bigbluebutton` to the server URL if missing,
 * stripping trailing slashes, dropping params whose value is `undefined`, and
 * computing the checksum from the same URL-encoded body that ends up on the wire.
 */
export const buildSignedUrl = ({
  serverUrl,
  call,
  params,
  sharedSecret,
}: {
  serverUrl: string;
  call: string;
  params: Record<string, string | number | boolean | undefined>;
  sharedSecret: string;
}) => {
  const queryString = toQueryString(params);
  const checksum = buildChecksum(call, queryString, sharedSecret);
  const apiBase = normalizeApiBase(serverUrl);
  const separator = queryString.length > 0 ? "&" : "";
  return `${apiBase}/api/${call}?${queryString}${separator}checksum=${checksum}`;
};

export type BbbResponseRoot = {
  response?: {
    returncode?: string;
    message?: string;
    messageKey?: string;
    [key: string]: unknown;
  };
};

// Hard timeout for any outbound BBB call. Without this, an unreachable BBB
// server can pin a Cal request indefinitely.
const BBB_REQUEST_TIMEOUT_MS = 10_000;

// Parses an XML body returned by a BBB API call and asserts that
// `<response><returncode>SUCCESS</returncode>...</response>` is present.
// Any parser error or BBB-reported failure becomes a typed BbbApiError so
// callers don't have to discriminate between native and protocol errors.
export const parseBbbResponse = (
  body: string,
  call: string,
  parser: XMLParser = xmlParser
): BbbResponseRoot => {
  let parsed: BbbResponseRoot;
  try {
    parsed = parser.parse(body) as BbbResponseRoot;
  } catch {
    throw new BbbApiError(`BigBlueButton ${call} returned an unparseable response`);
  }
  const root = parsed?.response;
  if (!root) {
    throw new BbbApiError(`BigBlueButton ${call} returned an unparseable response`);
  }
  if (root.returncode !== "SUCCESS") {
    throw new BbbApiError(
      typeof root.message === "string" ? root.message : `BigBlueButton ${call} failed`,
      typeof root.messageKey === "string" ? root.messageKey : undefined
    );
  }
  return parsed;
};

/**
 * Calls a BBB API endpoint and asserts a SUCCESS response. Throws `BbbApiError`
 * for HTTP failures, malformed XML, or `<returncode>FAILED</returncode>`. Adds
 * a 10-second timeout unless the caller supplies their own `init.signal`.
 */
export const callBbb = async ({
  serverUrl,
  sharedSecret,
  call,
  params,
  init,
}: {
  serverUrl: string;
  sharedSecret: string;
  call: string;
  params?: Record<string, string | number | boolean | undefined>;
  init?: RequestInit;
}) => {
  const url = buildSignedUrl({ serverUrl, call, params: params ?? {}, sharedSecret });
  const response = await fetch(url, {
    ...init,
    signal: init?.signal ?? AbortSignal.timeout(BBB_REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new BbbApiError(`BigBlueButton ${call} request failed with HTTP ${response.status}`);
  }

  const body = await response.text();
  const parsed = parseBbbResponse(body, call);
  return parsed.response;
};

/**
 * Returns a fresh 32-character hex string used as a BBB `attendeePW` /
 * `moderatorPW`. Sized for entropy comparable to a UUIDv4 so the password
 * isn't a guessability concern for room access.
 */
export const generateMeetingPassword = () => crypto.randomBytes(16).toString("hex");
