import { Client } from "@notionhq/client";
import type { NotionEntry } from "../types/index.js";

const notion = new Client({
  auth: process.env.NOTION_API_KEY?.trim(),
  timeoutMs: 30000, // 30 second timeout
});

let databaseId = process.env.NOTION_DATABASE_ID?.trim();
let schemaValidated = false;

const DATABASE_PROPERTIES = {
  Title: { title: {} },
  Content: { rich_text: {} },
  Category: {
    select: {
      options: [
        { name: "Projects", color: "red" as const },
        { name: "Areas", color: "blue" as const },
        { name: "Resources", color: "green" as const },
        { name: "Archive", color: "gray" as const },
        { name: "Inbox", color: "yellow" as const },
        { name: "Uncategorized", color: "default" as const },
      ],
    },
  },
  Subcategory: {
    select: {
      options: [
        { name: "Relationships", color: "pink" as const },
        { name: "Health", color: "green" as const },
        { name: "Finances", color: "yellow" as const },
        { name: "Career", color: "purple" as const },
        { name: "Home", color: "orange" as const },
      ],
    },
  },
  Confidence: { number: { format: "percent" as const } },
  "Source Channel": { rich_text: {} },
  Timestamp: { date: {} },
  "Slack Message ID": { rich_text: {} },
  URLs: { rich_text: {} },
};

/** Ensure database has Subcategory property (adds if missing) */
async function ensureSubcategoryProperty(dbId: string): Promise<void> {
  if (schemaValidated) {
    return;
  }

  try {
    const db = await notion.databases.retrieve({ database_id: dbId });
    const properties = db.properties as Record<string, { type: string }>;

    if (!properties.Subcategory) {
      console.log("Adding missing Subcategory property to database...");
      await notion.databases.update({
        database_id: dbId,
        properties: {
          Subcategory: DATABASE_PROPERTIES.Subcategory,
        },
      });
      console.log("Subcategory property added successfully");
    }

    schemaValidated = true;
  } catch (error) {
    console.error("Failed to validate/update database schema:", error);
    // Continue anyway - the create might still work
  }
}

export async function ensureDatabaseExists(): Promise<string> {
  if (databaseId) {
    await ensureSubcategoryProperty(databaseId);
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
  schemaValidated = true;
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
  };

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
