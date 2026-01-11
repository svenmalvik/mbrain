import type { VercelRequest, VercelResponse } from "@vercel/node";
import { waitUntil } from "@vercel/functions";
import crypto from "crypto";
import { classifyMessage } from "../../src/services/claude.js";
import { createNotionEntry, isDuplicate } from "../../src/services/notion.js";
import { extractUrls } from "../../src/services/url-extractor.js";
import { CATEGORY_EMOJI } from "../../src/config/constants.js";

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
  const rawBody = await getRawBody(req);

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody);
  } catch (e) {
    console.error("Failed to parse body:", e);
    res.status(400).json({ error: "Invalid JSON" });
    return;
  }

  if (body?.type === "url_verification") {
    res.status(200).json({ challenge: body.challenge });
    return;
  }

  const signingSecret = process.env.SLACK_SIGNING_SECRET?.trim();
  if (!signingSecret) {
    console.error("SLACK_SIGNING_SECRET not configured");
    res.status(500).json({ error: "Server configuration error" });
    return;
  }

  const timestamp = req.headers["x-slack-request-timestamp"] as string;
  const slackSignature = req.headers["x-slack-signature"] as string;

  if (!timestamp || !slackSignature) {
    res.status(401).json({ error: "Missing Slack signature headers" });
    return;
  }

  const currentTime = Math.floor(Date.now() / 1000);
  if (Math.abs(currentTime - parseInt(timestamp)) > 60 * 5) {
    res.status(401).json({ error: "Request timestamp too old" });
    return;
  }

  const sigBasestring = `v0:${timestamp}:${rawBody}`;
  const mySignature = `v0=${crypto
    .createHmac("sha256", signingSecret)
    .update(sigBasestring, "utf8")
    .digest("hex")}`;

  if (mySignature !== slackSignature) {
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  if (body?.type === "event_callback") {
    const event = body.event as Record<string, unknown> | undefined;

    if (event?.type === "message" && !event.subtype && !event.bot_id && event.text) {
      res.status(200).json({ ok: true });

      waitUntil(
        processMessage(event as unknown as MessageEvent).catch((error) =>
          console.error("Error processing message:", error)
        )
      );
      return;
    }
  }

  res.status(200).json({ ok: true });
}

interface MessageEvent {
  text: string;
  channel: string;
  ts: string;
  user?: string;
}

async function processMessage(event: MessageEvent): Promise<void> {
  const messageId = event.ts;
  const channelId = event.channel;
  const text = event.text;

  if (!text.trim()) {
    return;
  }

  if (await isDuplicate(messageId)) {
    return;
  }

  const classification = await classifyMessage(text);

  if (!classification.isMeaningful) {
    return;
  }

  const urls = extractUrls(text);

  await createNotionEntry({
    content: text,
    category: classification.category,
    confidence: classification.confidence,
    slackMessageId: messageId,
    channelName: channelId,
    timestamp: new Date(parseFloat(messageId) * 1000),
    urls,
  });

  const token = process.env.SLACK_BOT_TOKEN!;

  await fetch("https://slack.com/api/reactions.add", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      channel: channelId,
      timestamp: messageId,
      name: "white_check_mark",
    }),
  });

  const emoji = CATEGORY_EMOJI[classification.category];
  await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      channel: channelId,
      thread_ts: messageId,
      text: `Saved to Notion → ${classification.category} ${emoji} (confidence: ${classification.confidence.toFixed(2)})`,
    }),
  });
}
