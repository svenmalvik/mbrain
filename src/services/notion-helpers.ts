/**
 * Notion Property Helpers
 *
 * Safe type guards and property extraction for Notion API responses.
 */

import type { SearchResult, PARACategory, NoteStatus, NotionEntry } from "../types/index.js";

/** Safe extraction of title property (Rule 5: runtime type validation) */
export function safeGetTitle(properties: Record<string, unknown>): string {
  const prop = properties.Title;
  if (
    prop &&
    typeof prop === "object" &&
    "title" in prop &&
    Array.isArray((prop as { title: unknown[] }).title)
  ) {
    const arr = (prop as { title: Array<{ plain_text?: string }> }).title;
    return arr[0]?.plain_text ?? "";
  }
  return "";
}

/** Safe extraction of rich_text property (Rule 5: runtime type validation) */
export function safeGetRichText(
  properties: Record<string, unknown>,
  propName: string
): string {
  const prop = properties[propName];
  if (
    prop &&
    typeof prop === "object" &&
    "rich_text" in prop &&
    Array.isArray((prop as { rich_text: unknown[] }).rich_text)
  ) {
    const arr = (prop as { rich_text: Array<{ plain_text?: string }> }).rich_text;
    return arr[0]?.plain_text ?? "";
  }
  return "";
}

/** Safe extraction of select property (Rule 5: runtime type validation) */
export function safeGetSelect(
  properties: Record<string, unknown>,
  propName: string,
  defaultValue: string
): string {
  const prop = properties[propName];
  if (
    prop &&
    typeof prop === "object" &&
    "select" in prop &&
    (prop as { select?: { name?: string } }).select?.name
  ) {
    return (prop as { select: { name: string } }).select.name;
  }
  return defaultValue;
}

/** Extract SearchResult from Notion page properties (Rule 4: shared helper) */
export function extractSearchResult(
  pageId: string,
  properties: Record<string, unknown>
): SearchResult {
  // Rule 5: Validate input
  if (!pageId || !properties) {
    throw new Error("extractSearchResult: pageId and properties are required");
  }

  // Rule 5: Use safe type guards instead of unsafe type assertions
  const title = safeGetTitle(properties);
  const content = safeGetRichText(properties, "Content");
  const category = safeGetSelect(properties, "Category", "Uncategorized") as PARACategory;
  const status = safeGetSelect(properties, "Status", "Open") as NoteStatus;
  const urls = safeGetRichText(properties, "URLs");
  const slackMessageId = safeGetRichText(properties, "Slack Message ID");

  const result: SearchResult = {
    pageId,
    title,
    content,
    category,
    status,
    slackMessageId,
  };

  if (urls) {
    result.urls = urls;
  }

  return result;
}

/** Build Notion page properties from entry (Rule 4: extracted helper) */
export function buildNotionProperties(entry: NotionEntry): Record<string, unknown> {
  const title = entry.content.slice(0, 100) + (entry.content.length > 100 ? "..." : "");

  const properties: Record<string, unknown> = {
    Title: { title: [{ type: "text", text: { content: title } }] },
    Content: { rich_text: [{ type: "text", text: { content: entry.content } }] },
    Category: { select: { name: entry.category } },
    Confidence: { number: entry.confidence },
    "Source Channel": { rich_text: [{ type: "text", text: { content: entry.channelName } }] },
    Timestamp: { date: { start: entry.timestamp.toISOString() } },
    "Slack Message ID": { rich_text: [{ type: "text", text: { content: entry.slackMessageId } }] },
    URLs: { rich_text: [{ type: "text", text: { content: entry.urls.join(", ") } }] },
    Status: { select: { name: "Open" } },
    "Synced Status": { select: { name: "Open" } },
  };

  if (entry.nextAction) {
    properties["Next Action"] = { rich_text: [{ type: "text", text: { content: entry.nextAction } }] };
  }
  if (entry.subcategory) {
    properties.Subcategory = { select: { name: entry.subcategory } };
  }

  return properties;
}

/** Validate NotionEntry input (Rule 5: runtime assertions) */
export function validateNotionEntry(entry: NotionEntry): void {
  if (!entry || typeof entry !== "object") {
    throw new Error("createNotionEntry: entry must be an object");
  }
  if (!entry.content || typeof entry.content !== "string") {
    throw new Error("createNotionEntry: entry.content must be a non-empty string");
  }
  if (!entry.category || typeof entry.category !== "string") {
    throw new Error("createNotionEntry: entry.category must be a non-empty string");
  }
  if (!entry.slackMessageId || typeof entry.slackMessageId !== "string") {
    throw new Error("createNotionEntry: entry.slackMessageId must be a non-empty string");
  }
}
