import { Client } from "@notionhq/client";
import { ensureDatabaseExists } from "./notion.js";

const notion = new Client({
  auth: process.env.NOTION_API_KEY?.trim(),
  timeoutMs: 30000,
});

/** Pending action entry for reminders */
export interface PendingAction {
  pageId: string;
  slackMessageId: string;
  channelId: string;
  nextAction: string;
}

/** Get entries with pending actions that need reminders (Rule 4: short function) */
export async function getPendingActions(): Promise<PendingAction[]> {
  const dbId = await ensureDatabaseExists();

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const response = await notion.databases.query({
    database_id: dbId,
    filter: {
      and: [
        {
          property: "Next Action",
          rich_text: { is_not_empty: true },
        },
        {
          property: "Status",
          select: { equals: "Open" },
        },
        {
          or: [
            {
              property: "Last Reminder",
              date: { is_empty: true },
            },
            {
              property: "Last Reminder",
              date: { before: oneDayAgo },
            },
          ],
        },
      ],
    },
    page_size: 50,
  });

  const pending: PendingAction[] = [];

  for (const page of response.results) {
    const props = (page as { properties: Record<string, unknown> }).properties;

    const nextActionProp = props["Next Action"] as {
      rich_text?: Array<{ plain_text?: string }>;
    };
    const slackIdProp = props["Slack Message ID"] as {
      rich_text?: Array<{ plain_text?: string }>;
    };
    const channelProp = props["Source Channel"] as {
      rich_text?: Array<{ plain_text?: string }>;
    };

    const nextAction = nextActionProp?.rich_text?.[0]?.plain_text;
    const slackMessageId = slackIdProp?.rich_text?.[0]?.plain_text;
    const channelId = channelProp?.rich_text?.[0]?.plain_text;

    // Rule 5: Validate required fields
    if (nextAction && slackMessageId && channelId) {
      pending.push({
        pageId: page.id,
        slackMessageId,
        channelId,
        nextAction,
      });
    }
  }

  return pending;
}

/** Update the last reminder timestamp for an entry (Rule 4: short function) */
export async function updateLastReminder(pageId: string): Promise<void> {
  // Rule 5: Runtime assertions - validate input
  if (!pageId || typeof pageId !== "string") {
    throw new Error("updateLastReminder: pageId must be a non-empty string");
  }

  await notion.pages.update({
    page_id: pageId,
    properties: {
      "Last Reminder": {
        date: { start: new Date().toISOString() },
      },
    },
  });
}
