import { z } from "zod";

export const appKeysSchema = z.object({});

export const appDataSchema = z.object({});

export const bbbCredentialKeySchema = z.object({
  serverUrl: z.string().trim().url(),
  sharedSecret: z.string().trim().min(1),
});

export type BbbCredentialKey = z.infer<typeof bbbCredentialKeySchema>;
