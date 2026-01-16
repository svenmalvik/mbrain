import { Client } from "@notionhq/client";

/** Notion database schema definition (Rule 4: extracted for shorter files) */
export const DATABASE_PROPERTIES = {
  Title: { title: {} },
  Status: {
    select: {
      options: [
        { name: "Open", color: "yellow" as const },
        { name: "Done", color: "green" as const },
        { name: "Parked", color: "gray" as const },
      ],
    },
  },
  "Synced Status": {
    select: {
      options: [
        { name: "Open", color: "yellow" as const },
        { name: "Done", color: "green" as const },
      ],
    },
  },
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
  URLs: { rich_text: {} },
  Content: { rich_text: {} },
  "Next Action": { rich_text: {} },
  Confidence: { number: { format: "percent" as const } },
  "Source Channel": { rich_text: {} },
  Timestamp: { date: {} },
  "Slack Message ID": { rich_text: {} },
  "Last Reminder": { date: {} },
  "Reminder Count": { number: {} },
};

/** Track if schema has been validated this session */
let schemaValidated = false;

/** Ensure database has all required properties (adds if missing) */
export async function ensureSchemaProperties(
  notion: Client,
  dbId: string
): Promise<void> {
  if (schemaValidated) {
    return;
  }

  try {
    const db = await notion.databases.retrieve({ database_id: dbId });
    const properties = db.properties as Record<string, { type: string }>;

    const missingProps: Record<string, unknown> = {};

    if (!properties.Subcategory) {
      missingProps.Subcategory = DATABASE_PROPERTIES.Subcategory;
    }
    if (!properties["Next Action"]) {
      missingProps["Next Action"] = DATABASE_PROPERTIES["Next Action"];
    }
    if (!properties["Last Reminder"]) {
      missingProps["Last Reminder"] = DATABASE_PROPERTIES["Last Reminder"];
    }
    if (!properties.Status) {
      missingProps.Status = DATABASE_PROPERTIES.Status;
    }
    if (!properties["Synced Status"]) {
      missingProps["Synced Status"] = DATABASE_PROPERTIES["Synced Status"];
    }
    if (!properties["Reminder Count"]) {
      missingProps["Reminder Count"] = DATABASE_PROPERTIES["Reminder Count"];
    }

    const missingPropKeys = Object.keys(missingProps);
    if (missingPropKeys.length > 0) {
      console.log("Adding missing properties to database:", missingPropKeys);
      // Rule 5: Only update if we have properties to add
      type DatabaseUpdateProps = NonNullable<Parameters<typeof notion.databases.update>[0]["properties"]>;
      await notion.databases.update({
        database_id: dbId,
        properties: missingProps as DatabaseUpdateProps,
      });
      console.log("Properties added successfully");
    }

    schemaValidated = true;
  } catch (error) {
    console.error("Failed to validate/update database schema:", error);
    // Continue anyway - the create might still work
  }
}

/** Mark schema as validated (called after database creation) */
export function markSchemaValidated(): void {
  schemaValidated = true;
}
