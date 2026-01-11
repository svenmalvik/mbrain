import { Client } from "@notionhq/client";
import { ensureDatabaseExists } from "./notion.js";

// Rule 5: Validate auth at initialization
const notionApiKey = process.env.NOTION_API_KEY?.trim();
if (!notionApiKey) {
  throw new Error("NOTION_API_KEY environment variable must be set");
}

const notion = new Client({
  auth: notionApiKey,
  timeoutMs: 30000,
});

/** Rich text property structure from Notion API */
interface RichTextProperty {
  rich_text?: Array<{ plain_text?: string }>;
}

/** Extract plain text from Notion rich_text property (Rule 9: limit indirection) */
function extractPlainText(prop: RichTextProperty | undefined): string | undefined {
  const richText = prop?.rich_text;
  if (!richText || richText.length === 0) {
    return undefined;
  }
  return richText[0]?.plain_text;
}

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

    // Rule 9: Use helper to limit property chain depth
    const nextAction = extractPlainText(props["Next Action"] as RichTextProperty);
    const slackMessageId = extractPlainText(props["Slack Message ID"] as RichTextProperty);
    const channelId = extractPlainText(props["Source Channel"] as RichTextProperty);

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
