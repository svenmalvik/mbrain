import Anthropic from "@anthropic-ai/sdk";
import type { ClassificationResult, PARACategory } from "../types/index.js";
import { CLASSIFICATION_PROMPT } from "../config/prompts.js";
import {
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_CONFIDENCE_THRESHOLD,
} from "../config/constants.js";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

const model = process.env.CLAUDE_MODEL || DEFAULT_CLAUDE_MODEL;
const confidenceThreshold = parseFloat(
  process.env.CONFIDENCE_THRESHOLD || String(DEFAULT_CONFIDENCE_THRESHOLD)
);

interface ClaudeResponse {
  isMeaningful: boolean;
  category: PARACategory | null;
  confidence: number;
  reasoning: string;
}

export async function classifyMessage(
  text: string
): Promise<ClassificationResult> {
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

    // Extract text content
    const content = response.content[0];
    if (content.type !== "text") {
      throw new Error("Unexpected response type");
    }

    // Parse JSON response
    const result = JSON.parse(content.text) as ClaudeResponse;

    // Apply confidence threshold - downgrade to Inbox if low confidence
    let finalCategory: PARACategory = result.category || "Uncategorized";
    if (result.isMeaningful && result.confidence < confidenceThreshold) {
      finalCategory = "Inbox";
    }

    return {
      isMeaningful: result.isMeaningful,
      category: finalCategory,
      confidence: result.confidence,
      reasoning: result.reasoning,
    };
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
