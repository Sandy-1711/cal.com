import crypto from "node:crypto";
import { XMLParser } from "fast-xml-parser";

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

export const buildChecksum = (call: string, queryString: string, sharedSecret: string) =>
  crypto
    .createHash("sha1")
    .update(call + queryString + sharedSecret)
    .digest("hex");

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

export const generateMeetingPassword = () => crypto.randomBytes(16).toString("hex");
