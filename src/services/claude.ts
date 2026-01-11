import Anthropic from "@anthropic-ai/sdk";
import type { ClassificationResult, PARACategory, AreaSubcategory } from "../types/index.js";
import { CLASSIFICATION_PROMPT } from "../config/prompts.js";
import {
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_CONFIDENCE_THRESHOLD,
} from "../config/constants.js";

/** Maximum time for Claude API call (Rule 2: Fixed Loop Bounds) */
const API_TIMEOUT_MS = 25000;

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
  timeout: API_TIMEOUT_MS,
});

const model = process.env.CLAUDE_MODEL || DEFAULT_CLAUDE_MODEL;
const confidenceThreshold = parseFloat(
  process.env.CONFIDENCE_THRESHOLD || String(DEFAULT_CONFIDENCE_THRESHOLD)
);

interface ClaudeResponse {
  isMeaningful: boolean;
  category: PARACategory | null;
  subcategory: AreaSubcategory | null;
  confidence: number;
  reasoning: string;
  nextAction: string | null;
}

export async function classifyMessage(
  text: string
): Promise<ClassificationResult> {
  // Rule 5: Runtime assertions - validate input
  if (!text || typeof text !== "string") {
    throw new Error("classifyMessage: text must be a non-empty string");
  }

  try {
    const response = await anthropic.messages.create({
      model,
      max_tokens: 256,
      system: CLASSIFICATION_PROMPT,
      messages: [
        {
          role: "user",
          content: `Classify this message:\n\n"${text}"`,
        },
      ],
    });

    // Rule 7: Check return values - validate response has content
    if (!response.content || response.content.length === 0) {
      throw new Error("Empty response from Claude API");
    }

    // Extract text content with bounds check (Rule 7)
    const content = response.content[0];
    if (!content || content.type !== "text") {
      throw new Error("Unexpected response type from Claude API");
    }

    // Parse JSON response with specific error handling
    let result: ClaudeResponse;
    try {
      result = JSON.parse(content.text) as ClaudeResponse;
    } catch {
      throw new Error(`Invalid JSON in Claude response: ${content.text.slice(0, 100)}`);
    }

    // Rule 5: Validate response structure
    if (typeof result.isMeaningful !== "boolean" || typeof result.confidence !== "number") {
      throw new Error("Invalid classification response structure");
    }

    // Apply confidence threshold - downgrade to Inbox if low confidence
    let finalCategory: PARACategory = result.category || "Uncategorized";
    if (result.isMeaningful && result.confidence < confidenceThreshold) {
      finalCategory = "Inbox";
    }

    // Build result with conditional optional properties (Rule 10: exactOptionalPropertyTypes)
    const classificationResult: ClassificationResult = {
      isMeaningful: result.isMeaningful,
      category: finalCategory,
      confidence: result.confidence,
      reasoning: result.reasoning,
    };
    if (finalCategory === "Areas" && result.subcategory) {
      classificationResult.subcategory = result.subcategory;
    }
    if (result.nextAction) {
      classificationResult.nextAction = result.nextAction;
    }
    return classificationResult;
  } catch (error) {
    console.error("Classification failed:", error);
    // Fallback to Uncategorized on any error
    return {
      isMeaningful: true,
      category: "Uncategorized",
      confidence: 0,
      reasoning: "Classification failed - defaulting to Uncategorized",
    };
  }
}
