/** Slack API helper functions (Rule 4: extracted for shorter files) */

/** Add reaction to Slack message (Rule 7: check response) */
export async function addSlackReaction(
  token: string,
  channelId: string,
  messageId: string
): Promise<void> {
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
      name: "white_check_mark",
    }),
  });

  // Rule 7: Check return values
  if (!response.ok) {
    console.error(`Slack reactions.add failed: ${response.status}`);
  }
}

/** Post thread reply to Slack (Rule 7: check response) */
export async function postSlackReply(
  token: string,
  channelId: string,
  messageId: string,
  text: string
): Promise<void> {
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

  // Rule 7: Check return values
  if (!response.ok) {
    console.error(`Slack chat.postMessage failed: ${response.status}`);
  }
}
