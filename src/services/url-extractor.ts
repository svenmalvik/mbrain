/**
 * Extract URLs from Slack message text.
 * Handles both Slack-formatted links (<url|text>) and plain URLs.
 */
export function extractUrls(text: string): string[] {
  const urls: string[] = [];

  // Match Slack-formatted links: <https://example.com|display text> or <https://example.com>
  const slackLinkRegex = /<(https?:\/\/[^|>]+)(?:\|[^>]*)?>/g;
  let match;
  while ((match = slackLinkRegex.exec(text)) !== null) {
    urls.push(match[1]);
  }

  // Match plain URLs (not already captured in Slack format)
  const plainUrlRegex = /(?<![<|])https?:\/\/[^\s<>]+/g;
  while ((match = plainUrlRegex.exec(text)) !== null) {
    if (!urls.includes(match[0])) {
      urls.push(match[0]);
    }
  }

  return urls;
}
