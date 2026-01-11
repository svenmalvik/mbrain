import { generateAnswer } from "./claude.js";
import { searchNotes, getEntryContent } from "./notion.js";

/** Maximum notes to include in answer context */
const MAX_CONTEXT_NOTES = 5;

/** Answer a question using all notes (channel question) */
export async function answerChannelQuestion(question: string): Promise<string> {
  // Rule 5: Runtime assertions
  if (!question || typeof question !== "string") {
    throw new Error("answerChannelQuestion: question must be a non-empty string");
  }

  // Search for relevant notes
  const searchResults = await searchNotes(question, 20);

  // Filter to only Open notes (items that need attention)
  const openNotes = searchResults.filter((note) => note.status === "Open");

  if (openNotes.length === 0) {
    return "I don't have any open notes that seem relevant to your question. Try asking differently or add some notes first!";
  }

  // Take top results (Rule 2: fixed bound)
  const topNotes = openNotes.slice(0, MAX_CONTEXT_NOTES);

  return generateAnswer(question, topNotes);
}

/** Answer a question using a specific note's context (thread question) */
export async function answerThreadQuestion(
  question: string,
  parentSlackMessageId: string
): Promise<string> {
  // Rule 5: Runtime assertions
  if (!question || typeof question !== "string") {
    throw new Error("answerThreadQuestion: question must be a non-empty string");
  }
  if (!parentSlackMessageId || typeof parentSlackMessageId !== "string") {
    throw new Error("answerThreadQuestion: parentSlackMessageId must be a non-empty string");
  }

  // Get the parent note
  const noteEntry = await getEntryContent(parentSlackMessageId);

  if (!noteEntry) {
    return "I couldn't find the note this thread is about. It may have been deleted.";
  }

  return generateAnswer(question, [noteEntry]);
}
