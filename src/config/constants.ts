import type { PARACategory, AreaSubcategory } from "../types/index.js";

export const CATEGORY_EMOJI: Record<PARACategory, string> = {
  Projects: "🎯",
  Areas: "🔄",
  Resources: "📚",
  Archive: "📦",
  Inbox: "📥",
  Uncategorized: "❓",
};

export const SUBCATEGORY_EMOJI: Record<AreaSubcategory, string> = {
  Relationships: "👥",
  Health: "💪",
  Finances: "💰",
  Career: "💼",
  Home: "🏠",
};

export const DEFAULT_CONFIDENCE_THRESHOLD = 0.7;
export const DEFAULT_CLAUDE_MODEL = "claude-sonnet-4-20250514";
