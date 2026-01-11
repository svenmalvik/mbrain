/** Maximum URL matches to prevent unbounded loops (Rule 2: Fixed Loop Bounds) */
const MAX_URL_MATCHES = 100;

/**
 * Extract URLs from Slack message text.
 * Handles both Slack-formatted links (<url|text>) and plain URLs.
 */
export function extractUrls(text: string): string[] {
  // Rule 5: Runtime assertions - validate input
  if (typeof text !== "string") {
    throw new Error("extractUrls: text must be a string");
  }

  const urls: string[] = [];
  let iterations = 0;

  // Match Slack-formatted links: <https://example.com|display text> or <https://example.com>
  const slackLinkRegex = /<(https?:\/\/[^|>]+)(?:\|[^>]*)?>/g;
  let match;
  while ((match = slackLinkRegex.exec(text)) !== null && iterations < MAX_URL_MATCHES) {
    // Rule 2: Guard against empty matches causing infinite loops
    if (!match[0]) break;
    // Rule 7: Check indexed access with noUncheckedIndexedAccess
    const url = match[1];
    if (url) {
      urls.push(url);
    }
    iterations++;
  }

  // Match plain URLs (not already captured in Slack format)
  const plainUrlRegex = /(?<![<|])https?:\/\/[^\s<>]+/g;
  while ((match = plainUrlRegex.exec(text)) !== null && iterations < MAX_URL_MATCHES) {
    // Rule 2: Guard against empty matches causing infinite loops
    if (!match[0]) break;
    if (!urls.includes(match[0])) {
      urls.push(match[0]);
    }
    iterations++;
  }

  return urls;
}
