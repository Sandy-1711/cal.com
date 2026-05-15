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

type BbbResponseRoot = {
  response?: {
    returncode?: string;
    message?: string;
    messageKey?: string;
    [key: string]: unknown;
  };
};

const ensureSuccess = (parsed: BbbResponseRoot, call: string) => {
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
  return root;
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
  const response = await fetch(url, init);

  if (!response.ok) {
    throw new BbbApiError(`BigBlueButton ${call} request failed with HTTP ${response.status}`);
  }

  const body = await response.text();
  const parsed = xmlParser.parse(body) as BbbResponseRoot;
  return ensureSuccess(parsed, call);
};

export const generateMeetingPassword = () => crypto.randomBytes(16).toString("hex");
