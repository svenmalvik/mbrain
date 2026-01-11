export type PARACategory =
  | "Projects"
  | "Areas"
  | "Resources"
  | "Archive"
  | "Inbox"
  | "Uncategorized";

export type AreaSubcategory =
  | "Relationships"
  | "Health"
  | "Finances"
  | "Career"
  | "Home";

export interface ClassificationResult {
  isMeaningful: boolean;
  category: PARACategory;
  subcategory?: AreaSubcategory;
  confidence: number;
  reasoning: string;
}

export interface NotionEntry {
  content: string;
  category: PARACategory;
  subcategory?: AreaSubcategory;
  confidence: number;
  slackMessageId: string;
  channelName: string;
  timestamp: Date;
  urls: string[];
}
