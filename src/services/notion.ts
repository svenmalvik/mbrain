import { Client } from "@notionhq/client";
import type { NotionEntry } from "../types/index.js";

const notion = new Client({
  auth: process.env.NOTION_API_KEY?.trim(),
  timeoutMs: 30000, // 30 second timeout
});

let databaseId = process.env.NOTION_DATABASE_ID?.trim();

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
  Confidence: { number: { format: "percent" as const } },
  "Source Channel": { rich_text: {} },
  Timestamp: { date: {} },
  "Slack Message ID": { rich_text: {} },
  URLs: { rich_text: {} },
};

export async function ensureDatabaseExists(): Promise<string> {
  if (databaseId) {
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
  console.log(`Created Notion database: ${databaseId}`);
  console.log("Please set NOTION_DATABASE_ID environment variable to this ID");

  return databaseId;
}

export async function isDuplicate(slackMessageId: string): Promise<boolean> {
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
  const dbId = await ensureDatabaseExists();

  // Generate title from first 100 chars
  const title =
    entry.content.slice(0, 100) + (entry.content.length > 100 ? "..." : "");

  const response = await notion.pages.create({
    parent: { database_id: dbId },
    properties: {
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
    },
  });

  return response.id;
}
