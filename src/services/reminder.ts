import { Client } from "@notionhq/client";
import type { QueryDatabaseParameters } from "@notionhq/client/build/src/api-endpoints.js";
import { ensureDatabaseExists } from "./notion.js";

/** Filter type for Notion database queries (nested compound filters supported by API) */
type NotionFilter = NonNullable<QueryDatabaseParameters["filter"]>;

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

/** Number property structure from Notion API */
interface NumberProperty {
  number?: number | null;
}

/** Extract number from Notion number property (Rule 9: limit indirection) */
function extractNumber(prop: NumberProperty | undefined): number {
  return prop?.number ?? 0;
}

/** Pending action entry for reminders */
export interface PendingAction {
  pageId: string;
  slackMessageId: string;
  channelId: string;
  nextAction: string;
  reminderCount: number;
}

/** Reminder thresholds for tiered schedule */
const DAILY_THRESHOLD = 3;        // Reminders 1-3: daily (count < 3)
const EVERY_OTHER_DAY_THRESHOLD = 6; // Reminders 4-5: every other day (3 <= count < 6)
export const AUTO_PARK_THRESHOLD = 8; // After 8 reminders: auto-park

/** Get entries with pending actions that need reminders (Rule 4: short function) */
export async function getPendingActions(): Promise<PendingAction[]> {
  const dbId = await ensureDatabaseExists();

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Note: Notion API supports nested compound filters, but SDK types are stricter
  // Using type assertion as the API accepts this structure
  const filter = {
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
          // Tier 1: Count < 3 (or empty) -> daily reminders (24h)
          {
            and: [
              {
                or: [
                  { property: "Reminder Count", number: { is_empty: true } },
                  { property: "Reminder Count", number: { less_than: DAILY_THRESHOLD } },
                ],
              },
              {
                or: [
                  { property: "Last Reminder", date: { is_empty: true } },
                  { property: "Last Reminder", date: { before: oneDayAgo } },
                ],
              },
            ],
          },
          // Tier 2: 3 <= Count < 6 -> every-other-day reminders (48h)
          {
            and: [
              { property: "Reminder Count", number: { greater_than_or_equal_to: DAILY_THRESHOLD } },
              { property: "Reminder Count", number: { less_than: EVERY_OTHER_DAY_THRESHOLD } },
              { property: "Last Reminder", date: { before: twoDaysAgo } },
            ],
          },
          // Tier 3: 6 <= Count < 8 -> weekly reminders (7 days)
          {
            and: [
              { property: "Reminder Count", number: { greater_than_or_equal_to: EVERY_OTHER_DAY_THRESHOLD } },
              { property: "Reminder Count", number: { less_than: AUTO_PARK_THRESHOLD } },
              { property: "Last Reminder", date: { before: oneWeekAgo } },
            ],
          },
        ],
      },
    ],
  } as NotionFilter;

  const response = await notion.databases.query({
    database_id: dbId,
    filter,
    page_size: 50,
  });

  const pending: PendingAction[] = [];

  for (const page of response.results) {
    const props = (page as { properties: Record<string, unknown> }).properties;

    // Rule 9: Use helper to limit property chain depth
    const nextAction = extractPlainText(props["Next Action"] as RichTextProperty);
    const slackMessageId = extractPlainText(props["Slack Message ID"] as RichTextProperty);
    const channelId = extractPlainText(props["Source Channel"] as RichTextProperty);
    const reminderCount = extractNumber(props["Reminder Count"] as NumberProperty);

    // Rule 5: Validate required fields
    if (nextAction && slackMessageId && channelId) {
      pending.push({
        pageId: page.id,
        slackMessageId,
        channelId,
        nextAction,
        reminderCount,
      });
    }
  }

  return pending;
}

/** Update the last reminder timestamp and increment count (Rule 4: short function) */
export async function updateLastReminder(pageId: string, currentCount: number): Promise<void> {
  // Rule 5: Runtime assertions - validate input
  if (!pageId || typeof pageId !== "string") {
    throw new Error("updateLastReminder: pageId must be a non-empty string");
  }
  if (typeof currentCount !== "number" || currentCount < 0) {
    throw new Error("updateLastReminder: currentCount must be a non-negative number");
  }

  await notion.pages.update({
    page_id: pageId,
    properties: {
      "Last Reminder": {
        date: { start: new Date().toISOString() },
      },
      "Reminder Count": {
        number: currentCount + 1,
      },
    },
  });
}

/** Park an entry after too many reminders (Rule 4: short function) */
export async function parkEntry(pageId: string): Promise<void> {
  // Rule 5: Runtime assertions - validate input
  if (!pageId || typeof pageId !== "string") {
    throw new Error("parkEntry: pageId must be a non-empty string");
  }

  await notion.pages.update({
    page_id: pageId,
    properties: {
      Status: {
        select: { name: "Parked" },
      },
    },
  });
}
