/**
 * Slack Events API Handler
 *
 * Main entry point for Slack webhook events.
 * Handles signature verification and routes events to handlers.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { waitUntil } from "@vercel/functions";
import crypto from "crypto";
import { checkRateLimit } from "../../src/services/rate-limiter.js";
import {
  processMessage,
  handleReactionAdded,
  handleReactionRemoved,
  type MessageEvent,
  type ReactionItem,
} from "../../src/services/slack-handlers.js";

// Disable body parsing to get raw body for signature verification
export const config = {
  api: {
    bodyParser: false,
  },
};

/** Maximum time to wait for request body (Rule 2: Fixed Loop Bounds) */
const BODY_READ_TIMEOUT_MS = 5000;

/** Maximum request body size in bytes (Rule 2: Fixed bounds to prevent DoS) */
const MAX_BODY_SIZE = 100 * 1024; // 100KB

/** Read raw request body with timeout (Rule 2) */
async function getRawBody(req: VercelRequest): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    const timeout = setTimeout(() => {
      reject(new Error("Request body read timeout"));
    }, BODY_READ_TIMEOUT_MS);

    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => {
      clearTimeout(timeout);
      resolve(data);
    });
    req.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

/** Verify Slack request signature (Rule 4: extracted for shorter handler) */
function verifySlackSignature(
  rawBody: string,
  timestamp: string,
  slackSignature: string,
  signingSecret: string
): boolean {
  const sigBasestring = `v0:${timestamp}:${rawBody}`;
  const mySignature = `v0=${crypto
    .createHmac("sha256", signingSecret)
    .update(sigBasestring, "utf8")
    .digest("hex")}`;
  return mySignature === slackSignature;
}

/** Handle message events (Rule 4: extracted for clarity) */
function handleMessageEvent(
  event: Record<string, unknown>,
  res: VercelResponse
): boolean {
  if (event?.type !== "message" || event.subtype || event.bot_id || !event.text) {
    return false;
  }

  // Rule 2: Apply rate limiting per user
  const userId = event.user as string | undefined;
  if (userId && !checkRateLimit(userId)) {
    res.status(200).json({ ok: true });
    return true;
  }

  res.status(200).json({ ok: true });

  waitUntil(
    processMessage(event as unknown as MessageEvent).catch((error) =>
      console.error("Error processing message:", error)
    )
  );
  return true;
}

/** Handle reaction events (Rule 4: extracted for clarity) */
function handleReactionEvent(
  event: Record<string, unknown>,
  res: VercelResponse
): boolean {
  const reaction = event.reaction as string | undefined;
  const item = event.item as ReactionItem | undefined;

  if (!reaction || !item) {
    return false;
  }

  res.status(200).json({ ok: true });

  if (event.type === "reaction_added") {
    waitUntil(
      handleReactionAdded(reaction, item).catch((error) =>
        console.error("Error handling reaction_added:", error)
      )
    );
    return true;
  }

  if (event.type === "reaction_removed") {
    waitUntil(
      handleReactionRemoved(reaction, item).catch((error) =>
        console.error("Error handling reaction_removed:", error)
      )
    );
    return true;
  }

  return false;
}

/** Main Slack event handler */
export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  const rawBody = await getRawBody(req);

  // Rule 2: Validate body size before parsing to prevent DoS
  if (rawBody.length > MAX_BODY_SIZE) {
    res.status(413).json({ error: "Payload too large" });
    return;
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody);
  } catch {
    console.error("Failed to parse body");
    res.status(400).json({ error: "Invalid JSON" });
    return;
  }

  // Handle Slack URL verification challenge
  if (body?.type === "url_verification") {
    res.status(200).json({ challenge: body.challenge });
    return;
  }

  // Rule 5: Validate signing secret exists
  const signingSecret = process.env.SLACK_SIGNING_SECRET?.trim();
  if (!signingSecret) {
    console.error("SLACK_SIGNING_SECRET not configured");
    res.status(500).json({ error: "Server configuration error" });
    return;
  }

  // Rule 5: Validate signature headers exist
  const timestamp = req.headers["x-slack-request-timestamp"] as string;
  const slackSignature = req.headers["x-slack-signature"] as string;

  if (!timestamp || !slackSignature) {
    res.status(401).json({ error: "Missing Slack signature headers" });
    return;
  }

  // Rule 5: Validate timestamp is numeric before parsing (prevents NaN bypass)
  const currentTime = Math.floor(Date.now() / 1000);
  const parsedTimestamp = parseInt(timestamp, 10);
  if (isNaN(parsedTimestamp) || Math.abs(currentTime - parsedTimestamp) > 60 * 5) {
    res.status(401).json({ error: "Invalid or expired timestamp" });
    return;
  }

  // Rule 5: Verify signature
  if (!verifySlackSignature(rawBody, timestamp, slackSignature, signingSecret)) {
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  // Route event callbacks to appropriate handlers
  if (body?.type === "event_callback") {
    const event = body.event as Record<string, unknown> | undefined;
    if (!event) {
      res.status(200).json({ ok: true });
      return;
    }

    // Try message handler first
    if (handleMessageEvent(event, res)) {
      return;
    }

    // Try reaction handlers
    if (handleReactionEvent(event, res)) {
      return;
    }
  }

  res.status(200).json({ ok: true });
}
