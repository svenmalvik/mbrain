import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  getPendingActions,
  updateLastReminder,
} from "../../src/services/reminder.js";

/** Maximum number of reminders to send per cron run (Rule 2: Fixed Loop Bounds) */
const MAX_REMINDERS_PER_RUN = 20;

/** Post thread reply to Slack (Rule 7: check response) */
async function postSlackReminder(
  token: string,
  channelId: string,
  messageTs: string,
  text: string
): Promise<boolean> {
  // Rule 5: Validate input
  if (!token || !channelId || !messageTs || !text) {
    throw new Error("postSlackReminder: missing required parameters");
  }

  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      channel: channelId,
      thread_ts: messageTs,
      text,
    }),
  });

  // Rule 7: Check return values
  if (!response.ok) {
    console.error(`Slack chat.postMessage failed: ${response.status}`);
    return false;
  }

  // Rule 7: Wrap JSON parsing in try/catch for robustness
  let data: { ok?: boolean };
  try {
    data = await response.json();
  } catch {
    console.error("postSlackReminder: Failed to parse JSON response");
    return false;
  }
  return data.ok === true;
}

/** Hourly cron job to send action reminders */
export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // Rule 5: Validate environment
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    console.error("SLACK_BOT_TOKEN not configured");
    res.status(500).json({ error: "Server configuration error" });
    return;
  }

  // Verify cron authorization (Vercel sends this header)
  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const pendingActions = await getPendingActions();

    // Rule 2: Fixed loop bounds
    const actionsToProcess = pendingActions.slice(0, MAX_REMINDERS_PER_RUN);
    let remindersSent = 0;

    for (const action of actionsToProcess) {
      // Rule 7: Wrap each iteration to prevent partial failures
      try {
        const reminderText = `Reminder: ${action.nextAction}`;

        const success = await postSlackReminder(
          token,
          action.channelId,
          action.slackMessageId,
          reminderText
        );

        if (success) {
          await updateLastReminder(action.pageId);
          remindersSent++;
        }
      } catch (error) {
        console.error(`Failed to process reminder for ${action.pageId}:`, error);
        // Continue with next action instead of failing entire batch
      }
    }

    res.status(200).json({
      ok: true,
      remindersSent,
      totalPending: pendingActions.length,
    });
  } catch (error) {
    console.error("Cron job failed:", error);
    res.status(500).json({ error: "Cron job failed" });
  }
}
