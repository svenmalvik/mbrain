export type PARACategory =
  | "Projects"
  | "Areas"
  | "Resources"
  | "Archive"
  | "Inbox"
  | "Uncategorized";

export interface ClassificationResult {
  isMeaningful: boolean;
  category: PARACategory;
  confidence: number;
  reasoning: string;
}

export interface NotionEntry {
  content: string;
  category: PARACategory;
  confidence: number;
  slackMessageId: string;
  channelName: string;
  timestamp: Date;
  urls: string[];
}
