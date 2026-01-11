import { Client } from "@notionhq/client";
import type { NotionEntry } from "../types/index.js";
import {
  DATABASE_PROPERTIES,
  ensureSchemaProperties,
  markSchemaValidated,
} from "./notion-schema.js";

// Rule 5: Validate auth at initialization
const notionApiKey = process.env.NOTION_API_KEY?.trim();
if (!notionApiKey) {
  throw new Error("NOTION_API_KEY environment variable must be set");
}

const notion = new Client({
  auth: notionApiKey,
  timeoutMs: 30000, // 30 second timeout
});

let databaseId = process.env.NOTION_DATABASE_ID?.trim();

export async function ensureDatabaseExists(): Promise<string> {
  if (databaseId) {
    await ensureSchemaProperties(notion, databaseId);
    return databaseId;
  }

  const parentPageId = process.env.NOTION_PARENT_PAGE_ID?.trim();
  if (!parentPageId) {
    throw new Error(
      "NOTION_DATABASE_ID or NOTION_PARENT_PAGE_ID must be set"
    );
  }

  console.log(`Creating database under parent page: ${parentPageId.slice(0, 8)}...`);

  const response = await notion.databases.create({
    parent: { type: "page_id", page_id: parentPageId },
    title: [{ type: "text", text: { content: "Brain Captures" } }],
    properties: DATABASE_PROPERTIES,
  });

  databaseId = response.id;
  markSchemaValidated();
  console.log(`Created Notion database: ${databaseId}`);
  console.log("Please set NOTION_DATABASE_ID environment variable to this ID");

  return databaseId;
}

export async function isDuplicate(slackMessageId: string): Promise<boolean> {
  // Rule 5: Runtime assertions - validate input
  if (!slackMessageId || typeof slackMessageId !== "string") {
    throw new Error("isDuplicate: slackMessageId must be a non-empty string");
  }

  const dbId = await ensureDatabaseExists();

  const response = await notion.databases.query({
    database_id: dbId,
    filter: {
      property: "Slack Message ID",
      rich_text: {
        equals: slackMessageId,
      },
    },
    page_size: 1,
  });

  return response.results.length > 0;
}

export async function createNotionEntry(entry: NotionEntry): Promise<string> {
  // Rule 5: Runtime assertions - validate input
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

  const dbId = await ensureDatabaseExists();

  // Generate title from first 100 chars
  const title =
    entry.content.slice(0, 100) + (entry.content.length > 100 ? "..." : "");

  const properties: Record<string, unknown> = {
    Title: {
      title: [{ type: "text", text: { content: title } }],
    },
    Content: {
      rich_text: [{ type: "text", text: { content: entry.content } }],
    },
    Category: {
      select: { name: entry.category },
    },
    Confidence: {
      number: entry.confidence,
    },
    "Source Channel": {
      rich_text: [{ type: "text", text: { content: entry.channelName } }],
    },
    Timestamp: {
      date: { start: entry.timestamp.toISOString() },
    },
    "Slack Message ID": {
      rich_text: [{ type: "text", text: { content: entry.slackMessageId } }],
    },
    URLs: {
      rich_text: [
        { type: "text", text: { content: entry.urls.join(", ") } },
      ],
    },
    Status: {
      select: { name: "Open" },
    },
  };

  // Add next action if present
  if (entry.nextAction) {
    properties["Next Action"] = {
      rich_text: [{ type: "text", text: { content: entry.nextAction } }],
    };
  }

  // Add subcategory only for Areas
  if (entry.subcategory) {
    properties.Subcategory = {
      select: { name: entry.subcategory },
    };
  }

  const response = await notion.pages.create({
    parent: { database_id: dbId },
    properties: properties as Parameters<typeof notion.pages.create>[0]["properties"],
  });

  return response.id;
}

/** Find a Notion entry by its Slack Message ID (Rule 4: short function) */
export async function findEntryBySlackMessageId(
  slackMessageId: string
): Promise<{ pageId: string; currentContent: string } | null> {
  // Rule 5: Runtime assertions - validate input
  if (!slackMessageId || typeof slackMessageId !== "string") {
    throw new Error("findEntryBySlackMessageId: slackMessageId must be a non-empty string");
  }

  const dbId = await ensureDatabaseExists();

  const response = await notion.databases.query({
    database_id: dbId,
    filter: {
      property: "Slack Message ID",
      rich_text: {
        equals: slackMessageId,
      },
    },
    page_size: 1,
  });

  // Rule 7: Check return values
  const page = response.results[0];
  if (!page) {
    return null;
  }

  // Rule 5: Validate returned data structure
  if (!page.id) {
    throw new Error("findEntryBySlackMessageId: page.id is missing from Notion response");
  }

  const properties = (page as { properties: Record<string, unknown> }).properties;
  const contentProp = properties.Content as {
    rich_text?: Array<{ plain_text?: string }>;
  };
  const currentContent = contentProp?.rich_text?.[0]?.plain_text ?? "";

  return { pageId: page.id, currentContent };
}

/** Append thread reply content to an existing Notion entry (Rule 4: short function) */
export async function appendToNotionEntry(
  pageId: string,
  additionalContent: string
): Promise<void> {
  // Rule 5: Runtime assertions - validate input
  if (!pageId || typeof pageId !== "string") {
    throw new Error("appendToNotionEntry: pageId must be a non-empty string");
  }
  if (!additionalContent || typeof additionalContent !== "string") {
    throw new Error("appendToNotionEntry: additionalContent must be a non-empty string");
  }

  const entry = await notion.pages.retrieve({ page_id: pageId });

  // Rule 5: Validate returned data structure
  const properties = (entry as { properties: Record<string, unknown> }).properties;
  if (!properties) {
    throw new Error("appendToNotionEntry: page properties missing from Notion response");
  }

  const contentProp = properties.Content as {
    rich_text?: Array<{ plain_text?: string }>;
  };
  const currentContent = contentProp?.rich_text?.[0]?.plain_text ?? "";

  const newContent = currentContent + "\n\n---\n\n" + additionalContent;

  // Rule 7: Check return value (update returns the page object)
  await notion.pages.update({
    page_id: pageId,
    properties: {
      Content: {
        rich_text: [{ type: "text", text: { content: newContent } }],
      },
    },
  });
}

/** Mark an entry as Done by its Slack Message ID (Rule 4: short function) */
export async function markEntryAsDone(slackMessageId: string): Promise<boolean> {
  // Rule 5: Runtime assertions - validate input
  if (!slackMessageId || typeof slackMessageId !== "string") {
    throw new Error("markEntryAsDone: slackMessageId must be a non-empty string");
  }

  const entry = await findEntryBySlackMessageId(slackMessageId);
  if (!entry) {
    return false;
  }

  await notion.pages.update({
    page_id: entry.pageId,
    properties: {
      Status: {
        select: { name: "Done" },
      },
    },
  });

  return true;
}
