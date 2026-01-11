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

export type NoteStatus = "Open" | "Done";

export interface ClassificationResult {
  isMeaningful: boolean;
  category: PARACategory;
  subcategory?: AreaSubcategory;
  confidence: number;
  reasoning: string;
  nextAction?: string;
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
  nextAction?: string;
}

export type MessageIntent = "note" | "question" | "noise";

export interface MessageClassification {
  intent: MessageIntent;
  isMeaningful: boolean;
  category?: PARACategory;
  subcategory?: AreaSubcategory;
  confidence: number;
  reasoning: string;
  nextAction?: string;
}

export interface SearchResult {
  pageId: string;
  title: string;
  content: string;
  category: PARACategory;
  status: NoteStatus;
  slackMessageId: string;
}
