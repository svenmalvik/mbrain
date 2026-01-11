import type {
  AllMiddlewareArgs,
  SlackEventMiddlewareArgs,
  GenericMessageEvent,
} from "@slack/bolt";
import { classifyMessage } from "../services/claude.js";
import { createNotionEntry, isDuplicate } from "../services/notion.js";
import { extractUrls } from "../services/url-extractor.js";
import { CATEGORY_EMOJI } from "../config/constants.js";

type MessageArgs = SlackEventMiddlewareArgs<"message"> & AllMiddlewareArgs;

export async function handleMessage({
  message,
  client,
  say,
  logger,
}: MessageArgs): Promise<void> {
  // Type guard: only handle regular messages (not subtypes like edits, deletes, bot messages)
  if (!("text" in message) || message.subtype) {
    return;
  }

  const msg = message as GenericMessageEvent;
  const messageId = msg.ts;
  const channelId = msg.channel;
  const text = msg.text || "";

  // Skip empty messages
  if (!text.trim()) {
    return;
  }

  try {
    // 1. Check for duplicates
    if (await isDuplicate(messageId)) {
      logger.info(`Skipping duplicate message: ${messageId}`);
      return;
    }

    // 2. Classify with Claude
    const classification = await classifyMessage(text);

    // 3. If noise, ignore silently
    if (!classification.isMeaningful) {
      logger.info(`Filtered as noise: ${messageId}`);
      return;
    }

    // 4. Extract URLs
    const urls = extractUrls(text);

    // 5. Create Notion entry
    await createNotionEntry({
      content: text,
      category: classification.category,
      confidence: classification.confidence,
      slackMessageId: messageId,
      channelName: channelId,
      timestamp: new Date(parseFloat(messageId) * 1000),
      urls,
    });

    // 6. React with checkmark
    await client.reactions.add({
      channel: channelId,
      timestamp: messageId,
      name: "white_check_mark",
    });

    // 7. Reply with category
    const emoji = CATEGORY_EMOJI[classification.category];
    await say({
      text: `Saved to Notion → ${classification.category} ${emoji} (confidence: ${classification.confidence.toFixed(2)})`,
      thread_ts: messageId,
    });

    logger.info({
      messageId,
      channel: channelId,
      action: "saved",
      category: classification.category,
      confidence: classification.confidence,
    });
  } catch (error) {
    logger.error("Failed to process message", error);

    // Reply with error in thread
    await say({
      text: "Failed to save thought. Please try again.",
      thread_ts: messageId,
    });
  }
}
