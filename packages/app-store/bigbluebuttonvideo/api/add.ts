import process from "node:process";
import { throwIfNotHaveAdminAccessToTeam } from "@calcom/app-store/_utils/throwIfNotHaveAdminAccessToTeam";
import { symmetricEncrypt } from "@calcom/lib/crypto";
import logger from "@calcom/lib/logger";
import prisma from "@calcom/prisma";
import type { NextApiRequest, NextApiResponse } from "next";
import getInstalledAppPath from "../../_utils/getInstalledAppPath";
import { BbbApiError, callBbb } from "../lib/bbbClient";
import { bbbCredentialKeySchema } from "../zod";

const log = logger.getSubLogger({ prefix: ["bigbluebuttonvideo/api/add"] });

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!req.session?.user?.id) {
    return res.status(401).json({ message: "You must be logged in to do this" });
  }

  if (req.method === "GET") {
    return res.status(200).json({ url: "/apps/bigbluebutton/setup" });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const teamIdParam = req.query.teamId;
  const teamId = teamIdParam ? Number(teamIdParam) : null;

  await throwIfNotHaveAdminAccessToTeam({ teamId, userId: req.session.user.id });

  const parsed = bbbCredentialKeySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      message: parsed.error.issues[0]?.message ?? "Invalid BigBlueButton credentials",
    });
  }

  const { serverUrl, sharedSecret } = parsed.data;

  try {
    await callBbb({ serverUrl, sharedSecret, call: "getMeetings" });
  } catch (err) {
    log.warn("BigBlueButton credential validation failed", err);
    const message =
      err instanceof BbbApiError
        ? err.message
        : "Could not connect to BigBlueButton server. Verify the URL and shared secret.";
    return res.status(400).json({ message });
  }

  const encryptionKey = process.env.CALENDSO_ENCRYPTION_KEY;
  if (!encryptionKey) {
    log.error("CALENDSO_ENCRYPTION_KEY is not configured");
    return res.status(500).json({ message: "Server is not configured to store credentials securely" });
  }

  const installForObject = teamId ? { teamId } : { userId: req.session.user.id };
  const appType = "bigbluebutton_video";

  const alreadyInstalled = await prisma.credential.findFirst({
    where: { type: appType, ...installForObject },
    select: { id: true },
  });
  if (alreadyInstalled) {
    return res.status(409).json({ message: "BigBlueButton is already installed" });
  }

  await prisma.credential.create({
    data: {
      type: appType,
      key: symmetricEncrypt(JSON.stringify(parsed.data), encryptionKey),
      ...installForObject,
      appId: "bigbluebutton",
    },
  });

  return res.status(200).json({
    url: getInstalledAppPath({ variant: "conferencing", slug: "bigbluebutton" }),
  });
}
