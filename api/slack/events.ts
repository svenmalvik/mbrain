import type { VercelRequest, VercelResponse } from "@vercel/node";
import { waitUntil } from "@vercel/functions";
import crypto from "crypto";

// Disable body parsing to get raw body for signature verification
export const config = {
  api: {
    bodyParser: false,
  },
};

async function getRawBody(req: VercelRequest): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => {
      resolve(data);
    });
    req.on("error", reject);
  });
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // Get raw body for signature verification
  const rawBody = await getRawBody(req);

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody);
  } catch (e) {
    console.error("Failed to parse body:", e);
    res.status(400).json({ error: "Invalid JSON" });
    return;
  }

  // Handle Slack URL verification challenge (no signature check needed)
  if (body?.type === "url_verification") {
    res.status(200).json({ challenge: body.challenge });
    return;
  }

  // Verify Slack signature - trim to handle any whitespace from env var
  const signingSecret = process.env.SLACK_SIGNING_SECRET?.trim();
  if (!signingSecret) {
    console.error("SLACK_SIGNING_SECRET not configured");
    res.status(500).json({ error: "Server configuration error" });
    return;
  }
  // Debug: show secret details including any hidden chars
  const charCodes = [...signingSecret].map(c => c.charCodeAt(0));
  console.log(`Secret: len=${signingSecret.length} chars=${charCodes.slice(-5).join(',')}`);

  const timestamp = req.headers["x-slack-request-timestamp"] as string;
  const slackSignature = req.headers["x-slack-signature"] as string;

  if (!timestamp || !slackSignature) {
    console.error("Missing headers - timestamp:", !!timestamp, "signature:", !!slackSignature);
    res.status(401).json({ error: "Missing Slack signature headers" });
    return;
  }

  // Check timestamp to prevent replay attacks (allow 5 min window)
  const currentTime = Math.floor(Date.now() / 1000);
  if (Math.abs(currentTime - parseInt(timestamp)) > 60 * 5) {
    console.error("Timestamp too old:", timestamp, "current:", currentTime);
    res.status(401).json({ error: "Request timestamp too old" });
    return;
  }

  // Verify signature using raw body
  const sigBasestring = `v0:${timestamp}:${rawBody}`;
  const mySignature = `v0=${crypto
    .createHmac("sha256", signingSecret)
    .update(sigBasestring, "utf8")
    .digest("hex")}`;

  // Debug logging - single line for Vercel logs
  const sigMatch = mySignature === slackSignature;
  console.log(`Sig check: len=${rawBody.length} ts=${timestamp} match=${sigMatch} exp=${mySignature.slice(0,15)} got=${slackSignature.slice(0,15)}`);

  if (!sigMatch) {
    // Return detailed error for debugging
    res.status(401).json({
      error: "Invalid signature",
      debug: {
        bodyLength: rawBody.length,
        timestamp,
        expectedPrefix: mySignature.slice(0, 20),
        receivedPrefix: slackSignature.slice(0, 20),
      }
    });
    return;
  }

  // Handle event callback
  console.log(`Event type: ${body?.type}, event: ${JSON.stringify(body?.event).slice(0, 200)}`);

  if (body?.type === "event_callback") {
    const event = body.event as Record<string, unknown> | undefined;
    console.log(`Event details: type=${event?.type} subtype=${event?.subtype} hasText=${!!event?.text}`);

    // Only handle message events (not subtypes like message_changed, not from bots)
    if (event?.type === "message" && !event.subtype && !event.bot_id && event.text) {
      console.log(`Processing message: ${(event.text as string).slice(0, 50)}`);

      // Respond immediately to Slack (prevents retries)
      res.status(200).json({ ok: true });

      // Process in background using waitUntil (keeps function alive)
      waitUntil(
        processMessage(event as unknown as MessageEvent)
          .then(() => console.log("Message processing completed successfully"))
          .catch((error) => console.error("Error processing message:", error))
      );
      return;
    }
  }

  // Default response for unhandled events
  res.status(200).json({ ok: true });
}

interface MessageEvent {
  text: string;
  channel: string;
  ts: string;
  user?: string;
}

async function processMessage(event: MessageEvent): Promise<void> {
  console.log("processMessage started");
  const { classifyMessage } = await import("../../src/services/claude.js");
  const { createNotionEntry, isDuplicate } = await import("../../src/services/notion.js");
  const { extractUrls } = await import("../../src/services/url-extractor.js");
  const { CATEGORY_EMOJI } = await import("../../src/config/constants.js");
  console.log("Imports loaded");

  const messageId = event.ts;
  const channelId = event.channel;
  const text = event.text;

  // Skip empty messages
  if (!text.trim()) {
    console.log("Empty message, skipping");
    return;
  }

  // Check for duplicates
  console.log("Checking for duplicates...");
  if (await isDuplicate(messageId)) {
    console.log(`Skipping duplicate message: ${messageId}`);
    return;
  }
  console.log("Not a duplicate, classifying...");

  // Classify with Claude
  const classification = await classifyMessage(text);
  console.log(`Classification result: ${JSON.stringify(classification)}`);

  // If noise, ignore silently
  if (!classification.isMeaningful) {
    console.log(`Filtered as noise: ${messageId}`);
    return;
  }

  // Extract URLs
  const urls = extractUrls(text);

  // Create Notion entry
  await createNotionEntry({
    content: text,
    category: classification.category,
    confidence: classification.confidence,
    slackMessageId: messageId,
    channelName: channelId,
    timestamp: new Date(parseFloat(messageId) * 1000),
    urls,
  });

  // Post reaction and reply to Slack
  const token = process.env.SLACK_BOT_TOKEN!;

  // Add reaction
  await fetch("https://slack.com/api/reactions.add", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({
      channel: channelId,
      timestamp: messageId,
      name: "white_check_mark",
    }),
  });

  // Reply in thread
  const emoji = CATEGORY_EMOJI[classification.category];
  await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({
      channel: channelId,
      thread_ts: messageId,
      text: `Saved to Notion → ${classification.category} ${emoji} (confidence: ${classification.confidence.toFixed(2)})`,
    }),
  });

  console.log(`Saved message ${messageId} as ${classification.category}`);
}
