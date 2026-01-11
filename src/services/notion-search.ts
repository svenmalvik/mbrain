/**
 * Notion Search Operations
 *
 * Search and query functions for Notion database.
 */

import type { SearchResult } from "../types/index.js";
import { getNotionClient, ensureDatabaseExists } from "./notion.js";
import { extractSearchResult } from "./notion-helpers.js";

/** Maximum search results to return */
const MAX_SEARCH_RESULTS = 50;

/** Maximum results for URL query */
const MAX_URL_RESULTS = 20;

/** Search notes by text content using Notion search API */
export async function searchNotes(
  query: string,
  limit: number = 10
): Promise<SearchResult[]> {
  // Rule 5: Runtime assertions - validate input
  if (!query || typeof query !== "string") {
    throw new Error("searchNotes: query must be a non-empty string");
  }
  if (limit < 1 || limit > MAX_SEARCH_RESULTS) {
    throw new Error(`searchNotes: limit must be between 1 and ${MAX_SEARCH_RESULTS}`);
  }

  const notion = getNotionClient();
  const dbId = await ensureDatabaseExists();

  // Use Notion search API
  const response = await notion.search({
    query: query,
    filter: {
      property: "object",
      value: "page",
    },
    page_size: limit * 2, // Fetch more to filter by database
  });

  const results: SearchResult[] = [];

  // Rule 2: Fixed loop bounds
  const maxIterations = Math.min(response.results.length, limit * 2);
  for (let i = 0; i < maxIterations && results.length < limit; i++) {
    const page = response.results[i];
    if (!page || page.object !== "page") continue;

    // Filter to only pages from our database
    const pageWithParent = page as {
      parent?: { type?: string; database_id?: string };
      properties: Record<string, unknown>;
      id: string;
    };

    if (pageWithParent.parent?.type !== "database_id") continue;
    if (pageWithParent.parent.database_id !== dbId) continue;

    // Rule 4: Use shared helper for property extraction
    results.push(extractSearchResult(page.id, pageWithParent.properties));
  }

  return results;
}

/** Get full entry content by Slack message ID as SearchResult */
export async function getEntryContent(
  slackMessageId: string
): Promise<SearchResult | null> {
  // Rule 5: Runtime assertions - validate input
  if (!slackMessageId || typeof slackMessageId !== "string") {
    throw new Error("getEntryContent: slackMessageId must be a non-empty string");
  }

  const notion = getNotionClient();
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

  const page = response.results[0];
  if (!page) {
    return null;
  }

  // Rule 5: Validate returned data
  if (!page.id) {
    throw new Error("getEntryContent: page.id is missing from Notion response");
  }

  const properties = (page as { properties: Record<string, unknown> }).properties;

  // Rule 4: Use shared helper for property extraction
  return extractSearchResult(page.id, properties);
}

/** Get all Open notes that have URLs */
export async function getNotesWithUrls(): Promise<SearchResult[]> {
  const notion = getNotionClient();
  const dbId = await ensureDatabaseExists();

  // Rule 5: Validate database ID
  if (!dbId || typeof dbId !== "string") {
    throw new Error("getNotesWithUrls: database ID is required");
  }

  const response = await notion.databases.query({
    database_id: dbId,
    filter: {
      and: [
        {
          property: "URLs",
          rich_text: {
            is_not_empty: true,
          },
        },
        {
          property: "Status",
          select: {
            equals: "Open",
          },
        },
      ],
    },
    page_size: MAX_URL_RESULTS,
  });

  // Rule 7: Check return value
  if (!response || !Array.isArray(response.results)) {
    throw new Error("getNotesWithUrls: invalid response from Notion API");
  }

  const results: SearchResult[] = [];

  // Rule 2: Fixed loop bounds
  const maxIterations = Math.min(response.results.length, MAX_URL_RESULTS);
  for (let i = 0; i < maxIterations; i++) {
    const page = response.results[i];
    if (!page || !page.id) continue;

    const properties = (page as { properties: Record<string, unknown> }).properties;

    // Rule 4: Use shared helper for property extraction
    const result = extractSearchResult(page.id, properties);

    // Only include results that have URLs (filter already applied in query)
    if (result.urls) {
      results.push(result);
    }
  }

  return results;
}
