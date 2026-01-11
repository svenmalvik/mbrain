import type { PARACategory } from "../types/index.js";

export const CATEGORY_EMOJI: Record<PARACategory, string> = {
  Projects: "🎯",
  Areas: "🔄",
  Resources: "📚",
  Archive: "📦",
  Inbox: "📥",
  Uncategorized: "❓",
};

export const DEFAULT_CONFIDENCE_THRESHOLD = 0.7;
export const DEFAULT_CLAUDE_MODEL = "claude-sonnet-4-20250514";
