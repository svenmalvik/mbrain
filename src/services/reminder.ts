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

/** Date property structure from Notion API */
interface DateProperty {
  date?: { start?: string } | null;
}

/** Check if entry needs reminder based on tiered schedule */
function needsReminder(reminderCount: number, lastReminderDate: string | undefined): boolean {
  const now = Date.now();
  const oneDayMs = 24 * 60 * 60 * 1000;
  const twoDaysMs = 48 * 60 * 60 * 1000;
  const oneWeekMs = 7 * 24 * 60 * 60 * 1000;

  // No last reminder = always needs one
  if (!lastReminderDate) {
    return true;
  }

  const lastReminderTime = new Date(lastReminderDate).getTime();
  const timeSinceReminder = now - lastReminderTime;

  // Tier 1: Count < 3 -> daily (24h)
  if (reminderCount < DAILY_THRESHOLD) {
    return timeSinceReminder >= oneDayMs;
  }

  // Tier 2: 3 <= Count < 6 -> every other day (48h)
  if (reminderCount < EVERY_OTHER_DAY_THRESHOLD) {
    return timeSinceReminder >= twoDaysMs;
  }

  // Tier 3: 6 <= Count < 8 -> weekly (7 days)
  if (reminderCount < AUTO_PARK_THRESHOLD) {
    return timeSinceReminder >= oneWeekMs;
  }

  // Count >= 8: should be parked, no reminders
  return false;
}

/** Get entries with pending actions that need reminders (Rule 4: short function) */
export async function getPendingActions(): Promise<PendingAction[]> {
  const dbId = await ensureDatabaseExists();

  // Simple filter: get all Open entries with Next Action
  // Tiered timing logic is applied in code to avoid Notion's 2-level nesting limit
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
    const reminderCount = extractNumber(props["Reminder Count"] as NumberProperty);
    const lastReminderDate = (props["Last Reminder"] as DateProperty)?.date?.start;

    // Rule 5: Validate required fields and check tiered timing
    if (nextAction && slackMessageId && channelId && needsReminder(reminderCount, lastReminderDate)) {
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
