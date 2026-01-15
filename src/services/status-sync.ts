/**
 * Status Sync Service
 *
 * Detects Notion status changes and syncs them back to Slack.
 */

import { Client } from "@notionhq/client";
import { ensureDatabaseExists } from "./notion.js";
import type { NoteStatus } from "../types/index.js";

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

/** Select property structure from Notion API */
interface SelectProperty {
  select?: { name?: string } | null;
}

/** Extract plain text from Notion rich_text property (Rule 9: limit indirection) */
function extractPlainText(prop: RichTextProperty | undefined): string | undefined {
  const richText = prop?.rich_text;
  if (!richText || richText.length === 0) {
    return undefined;
  }
  return richText[0]?.plain_text;
}

/** Extract select value from Notion select property */
function extractSelectValue(prop: SelectProperty | undefined): string | undefined {
  return prop?.select?.name;
}

/** Entry with status change to sync */
export interface StatusChange {
  pageId: string;
  slackMessageId: string;
  channelId: string;
  currentStatus: NoteStatus;
  syncedStatus: NoteStatus | undefined;
}

/** Get entries with status changes that need syncing (Rule 4: short function) */
export async function getStatusChanges(): Promise<StatusChange[]> {
  const dbId = await ensureDatabaseExists();

  // Query entries where Status may have changed - fetch entries where
  // either Status = Done or Synced Status = Done, then filter in code
  const response = await notion.databases.query({
    database_id: dbId,
    filter: {
      or: [
        { property: "Status", select: { equals: "Done" } },
        { property: "Synced Status", select: { equals: "Done" } },
      ],
    },
    page_size: 100,
  });

  const changes: StatusChange[] = [];

  for (const page of response.results) {
    const props = (page as { properties: Record<string, unknown> }).properties;

    // Rule 9: Use helpers to limit property chain depth
    const slackMessageId = extractPlainText(props["Slack Message ID"] as RichTextProperty);
    const channelId = extractPlainText(props["Source Channel"] as RichTextProperty);
    const currentStatus = extractSelectValue(props.Status as SelectProperty) as NoteStatus | undefined;
    const syncedStatus = extractSelectValue(props["Synced Status"] as SelectProperty) as NoteStatus | undefined;

    // Rule 5: Validate required fields - skip entries without Slack info
    if (!slackMessageId || !channelId || !currentStatus) {
      continue;
    }

    // Filter to only entries where Status actually changed:
    // 1. Status = "Done" AND Synced Status != "Done" (marked done in Notion)
    // 2. Status = "Open" AND Synced Status = "Done" (reopened in Notion)
    const needsSync =
      (currentStatus === "Done" && syncedStatus !== "Done") ||
      (currentStatus === "Open" && syncedStatus === "Done");

    if (needsSync) {
      changes.push({
        pageId: page.id,
        slackMessageId,
        channelId,
        currentStatus,
        syncedStatus,
      });
    }
  }

  return changes;
}

/** Update the Synced Status for an entry (Rule 4: short function) */
export async function updateSyncedStatus(pageId: string, status: NoteStatus): Promise<void> {
  // Rule 5: Runtime assertions - validate input
  if (!pageId || typeof pageId !== "string") {
    throw new Error("updateSyncedStatus: pageId must be a non-empty string");
  }
  if (!status || typeof status !== "string") {
    throw new Error("updateSyncedStatus: status must be a non-empty string");
  }

  await notion.pages.update({
    page_id: pageId,
    properties: {
      "Synced Status": {
        select: { name: status },
      },
    },
  });
}
