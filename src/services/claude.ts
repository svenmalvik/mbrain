import Anthropic from "@anthropic-ai/sdk";
import type {
  ClassificationResult,
  MessageClassification,
  MessageIntent,
  PARACategory,
  AreaSubcategory,
  SearchResult,
} from "../types/index.js";
import {
  CLASSIFICATION_PROMPT,
  MESSAGE_CLASSIFICATION_PROMPT,
  ANSWER_GENERATION_PROMPT,
} from "../config/prompts.js";
import {
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_CONFIDENCE_THRESHOLD,
} from "../config/constants.js";

/** Maximum time for Claude API call (Rule 2: Fixed Loop Bounds) */
const API_TIMEOUT_MS = 25000;

// Lazy initialization for Anthropic client (Rule 5: validate at first use, not module load)
let _anthropic: Anthropic | null = null;

function getAnthropicClient(): Anthropic {
  if (!_anthropic) {
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY environment variable is required");
    }
    _anthropic = new Anthropic({
      apiKey,
      timeout: API_TIMEOUT_MS,
    });
  }
  return _anthropic;
}

function getModel(): string {
  return process.env.CLAUDE_MODEL?.trim() || DEFAULT_CLAUDE_MODEL;
}

// Rule 5: Validate CONFIDENCE_THRESHOLD is a valid number, fallback to default if NaN
function getConfidenceThreshold(): number {
  const parsedThreshold = parseFloat(process.env.CONFIDENCE_THRESHOLD || "");
  return isNaN(parsedThreshold) ? DEFAULT_CONFIDENCE_THRESHOLD : parsedThreshold;
}

/** Strip markdown code block wrapper from JSON response if present */
function extractJsonFromResponse(text: string): string {
  // Handle ```json ... ``` or ``` ... ``` wrapped responses
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch?.[1]) {
    return codeBlockMatch[1].trim();
  }
  return text.trim();
}

interface ClaudeResponse {
  isMeaningful: boolean;
  category: PARACategory | null;
  subcategory: AreaSubcategory | null;
  confidence: number;
  reasoning: string;
  nextAction: string | null;
}

interface ClaudeIntentResponse {
  intent: MessageIntent;
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
    const response = await getAnthropicClient().messages.create({
      model: getModel(),
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
      result = JSON.parse(extractJsonFromResponse(content.text)) as ClaudeResponse;
    } catch {
      throw new Error(`Invalid JSON in Claude response: ${content.text.slice(0, 100)}`);
    }

    // Rule 5: Validate response structure
    if (typeof result.isMeaningful !== "boolean" || typeof result.confidence !== "number") {
      throw new Error("Invalid classification response structure");
    }

    // Rule 5: Normalize confidence to valid 0-1 range
    const normalizedConfidence = Math.max(0, Math.min(1, result.confidence));

    // Apply confidence threshold - downgrade to Inbox if low confidence
    let finalCategory: PARACategory = result.category || "Uncategorized";
    if (result.isMeaningful && normalizedConfidence < getConfidenceThreshold()) {
      finalCategory = "Inbox";
    }

    // Build result with conditional optional properties (Rule 10: exactOptionalPropertyTypes)
    const classificationResult: ClassificationResult = {
      isMeaningful: result.isMeaningful,
      category: finalCategory,
      confidence: normalizedConfidence,
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

/** Classify message with intent detection (question vs note vs noise) */
export async function classifyMessageWithIntent(
  text: string
): Promise<MessageClassification> {
  // Rule 5: Runtime assertions - validate input
  if (!text || typeof text !== "string") {
    throw new Error("classifyMessageWithIntent: text must be a non-empty string");
  }

  try {
    const response = await getAnthropicClient().messages.create({
      model: getModel(),
      max_tokens: 256,
      system: MESSAGE_CLASSIFICATION_PROMPT,
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

    const content = response.content[0];
    if (!content || content.type !== "text") {
      throw new Error("Unexpected response type from Claude API");
    }

    // Parse JSON response
    let result: ClaudeIntentResponse;
    try {
      result = JSON.parse(extractJsonFromResponse(content.text)) as ClaudeIntentResponse;
    } catch {
      throw new Error(`Invalid JSON in Claude response: ${content.text.slice(0, 100)}`);
    }

    // Rule 5: Validate response structure
    if (typeof result.intent !== "string" || typeof result.isMeaningful !== "boolean") {
      throw new Error("Invalid classification response structure");
    }

    // For questions, return early with question classification
    if (result.intent === "question") {
      return {
        intent: "question",
        isMeaningful: true,
        confidence: 1.0,
        reasoning: result.reasoning,
      };
    }

    // For noise, return early
    if (result.intent === "noise" || !result.isMeaningful) {
      return {
        intent: "noise",
        isMeaningful: false,
        confidence: 0,
        reasoning: result.reasoning,
      };
    }

    // Rule 5: Normalize confidence to valid 0-1 range
    const normalizedConfidence = Math.max(0, Math.min(1, result.confidence ?? 0));

    // For notes, apply existing classification logic
    let finalCategory: PARACategory = result.category || "Uncategorized";
    if (normalizedConfidence < getConfidenceThreshold()) {
      finalCategory = "Inbox";
    }

    const classification: MessageClassification = {
      intent: "note",
      isMeaningful: true,
      category: finalCategory,
      confidence: normalizedConfidence,
      reasoning: result.reasoning,
    };

    if (finalCategory === "Areas" && result.subcategory) {
      classification.subcategory = result.subcategory;
    }
    if (result.nextAction) {
      classification.nextAction = result.nextAction;
    }

    return classification;
  } catch (error) {
    console.error("Intent classification failed:", error);
    // Fallback: treat as note with Uncategorized
    return {
      intent: "note",
      isMeaningful: true,
      category: "Uncategorized",
      confidence: 0,
      reasoning: "Classification failed - defaulting to Uncategorized",
    };
  }
}

/** Maximum tokens for answer generation */
const ANSWER_MAX_TOKENS = 1024;

/** Generate answer based on notes context */
export async function generateAnswer(
  question: string,
  notes: SearchResult[]
): Promise<string> {
  // Rule 5: Runtime assertions
  if (!question || typeof question !== "string") {
    throw new Error("generateAnswer: question must be a non-empty string");
  }
  if (!Array.isArray(notes)) {
    throw new Error("generateAnswer: notes must be an array");
  }

  // Handle empty notes case
  if (notes.length === 0) {
    return "I don't have any notes that seem relevant to your question.";
  }

  // Build notes context string with status and URLs
  const notesContext = notes
    .map((note, i) => {
      let context = `Note ${i + 1} (${note.category}, Status: ${note.status}):\n${note.content}`;
      if (note.urls) {
        context += `\nURLs: ${note.urls}`;
      }
      return context;
    })
    .join("\n\n---\n\n");

  const systemPrompt = ANSWER_GENERATION_PROMPT.replace("{notes}", notesContext);

  try {
    const response = await getAnthropicClient().messages.create({
      model: getModel(),
      max_tokens: ANSWER_MAX_TOKENS,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: question,
        },
      ],
    });

    // Rule 7: Validate response
    if (!response.content || response.content.length === 0) {
      throw new Error("Empty response from Claude API");
    }

    const content = response.content[0];
    if (!content || content.type !== "text") {
      throw new Error("Unexpected response type from Claude API");
    }

    return content.text;
  } catch (error) {
    console.error("Answer generation failed:", error);
    return "I encountered an error while trying to answer your question. Please try again.";
  }
}
