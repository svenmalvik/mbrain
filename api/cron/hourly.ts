import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  getPendingActions,
  updateLastReminder,
} from "../../src/services/reminder.js";
import {
  getStatusChanges,
  updateSyncedStatus,
} from "../../src/services/status-sync.js";
import {
  addSlackReaction,
  removeSlackReaction,
} from "../../src/services/slack-api.js";

/** Maximum number of reminders to send per cron run (Rule 2: Fixed Loop Bounds) */
const MAX_REMINDERS_PER_RUN = 20;

/** Maximum number of status syncs per cron run (Rule 2: Fixed Loop Bounds) */
const MAX_STATUS_SYNCS_PER_RUN = 20;

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

/** Post status update reply to Slack (Rule 7: check response) */
async function postSlackStatusUpdate(
  token: string,
  channelId: string,
  messageTs: string,
  text: string
): Promise<boolean> {
  // Rule 5: Validate input
  if (!token || !channelId || !messageTs || !text) {
    throw new Error("postSlackStatusUpdate: missing required parameters");
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

  let data: { ok?: boolean };
  try {
    data = await response.json();
  } catch {
    console.error("postSlackStatusUpdate: Failed to parse JSON response");
    return false;
  }
  return data.ok === true;
}

/** Hourly cron job to send action reminders and sync status changes */
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
  // Rule 5: Require CRON_SECRET - if not set, reject all requests
  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
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

    // Status sync: Reflect Notion status changes back to Slack
    const statusChanges = await getStatusChanges();
    const changesToProcess = statusChanges.slice(0, MAX_STATUS_SYNCS_PER_RUN);
    let statusSynced = 0;

    for (const change of changesToProcess) {
      // Rule 7: Wrap each iteration to prevent partial failures
      try {
        if (change.currentStatus === "Done" && change.syncedStatus !== "Done") {
          // Marked as done in Notion - add checkmark reaction
          await addSlackReaction(token, change.channelId, change.slackMessageId);
          await postSlackStatusUpdate(
            token,
            change.channelId,
            change.slackMessageId,
            "✅ Marked as done in Notion"
          );
          await updateSyncedStatus(change.pageId, "Done");
          statusSynced++;
        } else if (change.currentStatus === "Open" && change.syncedStatus === "Done") {
          // Reopened in Notion - remove checkmark reaction
          await removeSlackReaction(token, change.channelId, change.slackMessageId);
          await postSlackStatusUpdate(
            token,
            change.channelId,
            change.slackMessageId,
            "🔄 Reopened in Notion"
          );
          await updateSyncedStatus(change.pageId, "Open");
          statusSynced++;
        }
      } catch (error) {
        console.error(`Failed to sync status for ${change.pageId}:`, error);
        // Continue with next change instead of failing entire batch
      }
    }

    res.status(200).json({
      ok: true,
      remindersSent,
      totalPendingReminders: pendingActions.length,
      statusSynced,
      totalPendingStatusChanges: statusChanges.length,
    });
  } catch (error) {
    console.error("Cron job failed:", error);
    res.status(500).json({ error: "Cron job failed" });
  }
}
