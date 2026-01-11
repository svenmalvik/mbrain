import type { VercelRequest, VercelResponse } from "@vercel/node";
import { waitUntil } from "@vercel/functions";
import crypto from "crypto";
import { classifyMessageWithIntent } from "../../src/services/claude.js";
import { answerChannelQuestion, answerThreadQuestion } from "../../src/services/qa.js";
import {
  createNotionEntry,
  isDuplicate,
  findEntryBySlackMessageId,
  appendToNotionEntry,
  markEntryAsDone,
  markEntryAsOpen,
  deleteEntry,
} from "../../src/services/notion.js";
import { extractUrls } from "../../src/services/url-extractor.js";
import { addSlackReaction, postSlackReply, fetchSlackMessage } from "../../src/services/slack-api.js";
import { CATEGORY_EMOJI, SUBCATEGORY_EMOJI } from "../../src/config/constants.js";

// Disable body parsing to get raw body for signature verification
export const config = {
  api: {
    bodyParser: false,
  },
};

/** Maximum time to wait for request body (Rule 2: Fixed Loop Bounds) */
const BODY_READ_TIMEOUT_MS = 5000;

interface MessageEvent {
  text: string;
  channel: string;
  ts: string;
  thread_ts?: string;
  user?: string;
}

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

/** Build reply message text */
function buildReplyText(
  category: string,
  subcategory: string | undefined,
  confidence: number
): string {
  const emoji = CATEGORY_EMOJI[category as keyof typeof CATEGORY_EMOJI];
  const subcategoryText = subcategory
    ? ` -> ${subcategory} ${SUBCATEGORY_EMOJI[subcategory as keyof typeof SUBCATEGORY_EMOJI]}`
    : "";
  return `Saved to Notion -> ${category} ${emoji}${subcategoryText} (confidence: ${confidence.toFixed(2)})`;
}

/** Reaction event item structure */
interface ReactionItem {
  ts?: string;
  channel?: string;
}

/** Handle reaction_added event (Rule 4: extracted function) */
async function handleReactionAdded(
  reaction: string,
  item: ReactionItem
): Promise<boolean> {
  // Rule 5: Validate input
  if (!reaction || !item?.ts) {
    return false;
  }

  const messageTs = item.ts;
  const channel = item.channel;
  const token = process.env.SLACK_BOT_TOKEN;

  if (reaction === "white_check_mark") {
    const marked = await markEntryAsDone(messageTs);
    if (marked && token && channel) {
      await postSlackReply(token, channel, messageTs, "✅ Marked as done");
    }
    return true;
  }

  if (reaction === "x") {
    const deleted = await deleteEntry(messageTs);
    if (deleted && token && channel) {
      await postSlackReply(token, channel, messageTs, "🗑️ Note deleted from Notion");
    }
    return true;
  }

  return false;
}

/** Handle reaction_removed event (Rule 4: extracted function) */
async function handleReactionRemoved(
  reaction: string,
  item: ReactionItem
): Promise<boolean> {
  // Rule 5: Validate input
  if (!reaction || !item?.ts) {
    return false;
  }

  const messageTs = item.ts;
  const channel = item.channel;
  const token = process.env.SLACK_BOT_TOKEN;

  if (reaction === "white_check_mark") {
    const marked = await markEntryAsOpen(messageTs);
    if (marked && token && channel) {
      await postSlackReply(token, channel, messageTs, "🔄 Reopened");
    }
    return true;
  }

  if (reaction === "x" && token && channel) {
    await restoreEntryFromSlack(token, channel, messageTs);
    return true;
  }

  return false;
}

/** Re-create a Notion entry from a Slack message (Rule 4: extracted function) */
async function restoreEntryFromSlack(
  token: string,
  channel: string,
  messageTs: string
): Promise<void> {
  // Rule 5: Validate input
  if (!token || !channel || !messageTs) {
    throw new Error("restoreEntryFromSlack: missing required parameters");
  }

  // Fetch original message from Slack
  const text = await fetchSlackMessage(token, channel, messageTs);
  if (!text) {
    return;
  }

  // Classify and create entry
  const classification = await classifyMessageWithIntent(text);
  if (classification.intent !== "note" || !classification.isMeaningful || !classification.category) {
    return;
  }

  const urls = extractUrls(text);
  const notionEntry: Parameters<typeof createNotionEntry>[0] = {
    content: text,
    category: classification.category,
    confidence: classification.confidence,
    slackMessageId: messageTs,
    channelName: channel,
    timestamp: new Date(parseFloat(messageTs) * 1000),
    urls,
  };
  if (classification.subcategory) {
    notionEntry.subcategory = classification.subcategory;
  }
  if (classification.nextAction) {
    notionEntry.nextAction = classification.nextAction;
  }
  await createNotionEntry(notionEntry);

  await postSlackReply(token, channel, messageTs, "♻️ Note restored in Notion");
}

/** Process a thread reply - handles questions vs notes (Rule 4: short function) */
async function processThreadReply(event: MessageEvent): Promise<void> {
  // Rule 5: Validate input
  if (!event.ts || !event.channel || !event.text) {
    throw new Error("processThreadReply: invalid event structure");
  }

  const threadTs = event.thread_ts;
  if (!threadTs || typeof threadTs !== "string") {
    throw new Error("processThreadReply: thread_ts is required");
  }

  const text = event.text.trim();
  if (!text) {
    return;
  }

  // Rule 5: Validate environment
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    throw new Error("SLACK_BOT_TOKEN not configured");
  }

  // Classify intent first
  const classification = await classifyMessageWithIntent(text);

  // Handle questions in threads - answer based on parent note only
  if (classification.intent === "question") {
    const answer = await answerThreadQuestion(text, threadTs);
    await postSlackReply(token, event.channel, event.ts, answer);
    return;
  }

  // Handle noise - ignore silently
  if (classification.intent === "noise" || !classification.isMeaningful) {
    return;
  }

  // For notes: append to parent entry
  const parentEntry = await findEntryBySlackMessageId(threadTs);
  if (!parentEntry) {
    console.log(`Thread reply to unknown parent: ${threadTs}, skipping`);
    return;
  }

  // Rule 5: Validate returned data
  if (!parentEntry.pageId) {
    throw new Error("processThreadReply: parentEntry.pageId is missing");
  }

  // Append the thread reply content to the parent entry
  await appendToNotionEntry(parentEntry.pageId, text);

  // Add reaction to the thread reply
  await addSlackReaction(token, event.channel, event.ts);
}

/** Process and classify a Slack message (Rule 4: split from processMessage) */
async function processMessage(event: MessageEvent): Promise<void> {
  // Rule 5: Validate input
  if (!event.ts || !event.channel || !event.text) {
    throw new Error("processMessage: invalid event structure");
  }

  // Check if this is a thread reply (thread_ts exists and differs from ts)
  if (event.thread_ts && event.thread_ts !== event.ts) {
    await processThreadReply(event);
    return;
  }

  const messageId = event.ts;
  const channelId = event.channel;
  const text = event.text.trim();

  if (!text) {
    return;
  }

  // Rule 5: Validate environment
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    throw new Error("SLACK_BOT_TOKEN not configured");
  }

  // Use intent-aware classification
  const classification = await classifyMessageWithIntent(text);

  // Handle questions in channel - search all notes
  if (classification.intent === "question") {
    const answer = await answerChannelQuestion(text);
    await postSlackReply(token, channelId, messageId, answer);
    return;
  }

  // Handle noise - ignore silently
  if (classification.intent === "noise" || !classification.isMeaningful) {
    return;
  }

  // For notes: check duplicate and save
  if (await isDuplicate(messageId)) {
    return;
  }

  const urls = extractUrls(text);

  // Rule 5: Validate category exists for notes
  if (!classification.category) {
    throw new Error("processMessage: category required for note intent");
  }

  // Build entry with conditional optional properties (Rule 10: exactOptionalPropertyTypes)
  const notionEntry: Parameters<typeof createNotionEntry>[0] = {
    content: text,
    category: classification.category,
    confidence: classification.confidence,
    slackMessageId: messageId,
    channelName: channelId,
    timestamp: new Date(parseFloat(messageId) * 1000),
    urls,
  };
  if (classification.subcategory) {
    notionEntry.subcategory = classification.subcategory;
  }
  if (classification.nextAction) {
    notionEntry.nextAction = classification.nextAction;
  }
  await createNotionEntry(notionEntry);

  await addSlackReaction(token, channelId, messageId);

  const replyText = buildReplyText(
    classification.category,
    classification.subcategory,
    classification.confidence
  );
  await postSlackReply(token, channelId, messageId, replyText);
}

/** Main Slack event handler */
export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  const rawBody = await getRawBody(req);

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody);
  } catch {
    console.error("Failed to parse body");
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

  if (!verifySlackSignature(rawBody, timestamp, slackSignature, signingSecret)) {
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

    // Handle reaction_added events (Rule 4: delegated to helper)
    if (event?.type === "reaction_added") {
      const reaction = event.reaction as string | undefined;
      const item = event.item as ReactionItem | undefined;

      if (reaction && item) {
        res.status(200).json({ ok: true });
        waitUntil(
          handleReactionAdded(reaction, item).catch((error) =>
            console.error("Error handling reaction_added:", error)
          )
        );
        return;
      }
    }

    // Handle reaction_removed events (Rule 4: delegated to helper)
    if (event?.type === "reaction_removed") {
      const reaction = event.reaction as string | undefined;
      const item = event.item as ReactionItem | undefined;

      if (reaction && item) {
        res.status(200).json({ ok: true });
        waitUntil(
          handleReactionRemoved(reaction, item).catch((error) =>
            console.error("Error handling reaction_removed:", error)
          )
        );
        return;
      }
    }
  }

  res.status(200).json({ ok: true });
}
