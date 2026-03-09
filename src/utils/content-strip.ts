/**
 * Content stripping utility (R1).
 * Removes non-prose content that generates false positives in the deterministic classifier.
 *
 * Strips:
 * 1. Code blocks (triple backticks)
 * 2. Large JSON blocks (>100 chars)
 * 3. HTML blocks (>50 chars of content)
 * 4. Log lines (timestamps / framework prefixes)
 * 5. URLs
 * 6. Injected memory blocks (p1:injected markers)
 */

/** Strip content between triple backticks (code blocks) */
function stripCodeBlocks(text: string): string {
  return text.replace(/```[\s\S]*?```/g, '');
}

/** Strip JSON blocks >100 chars */
function stripLargeJson(text: string): string {
  return text.replace(/\{[^{}]{100,}\}/g, '');
}

/** Strip HTML blocks with >50 chars of content */
function stripHtmlBlocks(text: string): string {
  return text.replace(/<[a-zA-Z][^>]*>[^<]{50,}<\/[a-zA-Z]+>/g, '');
}

/** Strip log lines starting with timestamps or framework prefixes */
function stripLogLines(text: string): string {
  return text
    .split('\n')
    .filter((line) => !/^\s*\[\d{2}:\d{2}(:\d{2})?\]/.test(line))
    .join('\n');
}

/** Strip URLs */
function stripUrls(text: string): string {
  return text.replace(/https?:\/\/[^\s)>\]]+/g, '');
}

/** Strip injected memory blocks (<!-- p1:injected:begin --> ... <!-- p1:injected:end -->) */
function stripInjectedBlocks(text: string): string {
  return text.replace(/<!--\s*p1:injected:begin\s*-->[\s\S]*?<!--\s*p1:injected:end\s*-->/g, '');
}

/**
 * Strips non-prose content from a raw turn message before classification.
 * Returns the cleaned prose text.
 */
export function stripNonProseContent(text: string): string {
  let result = text;
  result = stripInjectedBlocks(result);
  result = stripCodeBlocks(result);
  result = stripLargeJson(result);
  result = stripHtmlBlocks(result);
  result = stripLogLines(result);
  result = stripUrls(result);
  // Collapse excessive whitespace
  result = result.replace(/\n{3,}/g, '\n\n').trim();
  return result;
}
