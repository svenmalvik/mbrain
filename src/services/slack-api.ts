/** Slack API helper functions (Rule 4: extracted for shorter files) */

/** Add reaction to Slack message (Rule 7: check response, return success status) */
export async function addSlackReaction(
  token: string,
  channelId: string,
  messageId: string
): Promise<boolean> {
  // Rule 5: Runtime assertions - validate input
  if (!token || typeof token !== "string") {
    throw new Error("addSlackReaction: token must be a non-empty string");
  }
  if (!channelId || typeof channelId !== "string") {
    throw new Error("addSlackReaction: channelId must be a non-empty string");
  }
  if (!messageId || typeof messageId !== "string") {
    throw new Error("addSlackReaction: messageId must be a non-empty string");
  }

  const response = await fetch("https://slack.com/api/reactions.add", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      channel: channelId,
      timestamp: messageId,
      name: "heavy_check_mark",
    }),
  });

  // Rule 7: Check return values and propagate status
  if (!response.ok) {
    console.error(`Slack reactions.add failed: ${response.status}`);
    return false;
  }
  return true;
}

/** Timeout for Slack API calls (Rule 2: Fixed bounds) */
const SLACK_API_TIMEOUT_MS = 10000;

/** Fetch a Slack message by timestamp (Rule 7: check response) */
export async function fetchSlackMessage(
  token: string,
  channelId: string,
  messageTs: string
): Promise<string | null> {
  // Rule 5: Runtime assertions - validate input
  if (!token || typeof token !== "string") {
    throw new Error("fetchSlackMessage: token must be a non-empty string");
  }
  if (!channelId || typeof channelId !== "string") {
    throw new Error("fetchSlackMessage: channelId must be a non-empty string");
  }
  if (!messageTs || typeof messageTs !== "string") {
    throw new Error("fetchSlackMessage: messageTs must be a non-empty string");
  }

  // Rule 2: Fixed timeout bound
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SLACK_API_TIMEOUT_MS);

  try {
    const response = await fetch(
      `https://slack.com/api/conversations.history?channel=${channelId}&latest=${messageTs}&limit=1&inclusive=true`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        signal: controller.signal,
      }
    );

    // Rule 7: Check return values
    if (!response.ok) {
      console.error(`Slack conversations.history failed: ${response.status}`);
      return null;
    }

    // Rule 7: Wrap JSON parsing in try/catch for robustness
    let data: { ok?: boolean; messages?: Array<{ text?: string }> };
    try {
      data = await response.json();
    } catch {
      console.error("fetchSlackMessage: Failed to parse JSON response");
      return null;
    }

    // Rule 7 & 9: Explicit validation, limit indirection
    if (!data.ok) {
      return null;
    }
    const messages = data.messages as Array<{ text?: string }> | undefined;
    const firstMessage = messages?.[0];
    if (!firstMessage?.text) {
      return null;
    }

    return firstMessage.text;
  } finally {
    clearTimeout(timeout);
  }
}

/** Post thread reply to Slack (Rule 7: check response, return success status) */
export async function postSlackReply(
  token: string,
  channelId: string,
  messageId: string,
  text: string
): Promise<boolean> {
  // Rule 5: Runtime assertions - validate input
  if (!token || typeof token !== "string") {
    throw new Error("postSlackReply: token must be a non-empty string");
  }
  if (!channelId || typeof channelId !== "string") {
    throw new Error("postSlackReply: channelId must be a non-empty string");
  }
  if (!messageId || typeof messageId !== "string") {
    throw new Error("postSlackReply: messageId must be a non-empty string");
  }
  if (!text || typeof text !== "string") {
    throw new Error("postSlackReply: text must be a non-empty string");
  }

  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      channel: channelId,
      thread_ts: messageId,
      text,
    }),
  });

  // Rule 7: Check return values and propagate status
  if (!response.ok) {
    console.error(`Slack chat.postMessage failed: ${response.status}`);
    return false;
  }
  return true;
}
