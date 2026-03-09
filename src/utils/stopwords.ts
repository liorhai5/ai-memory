/**
 * Stopword list and content word extraction (R3, used by overlap detection).
 */

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
  'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'could', 'should', 'may', 'might', 'shall', 'can', 'it', 'its',
  'this', 'that', 'these', 'those', 'i', 'me', 'my', 'we', 'our',
  'you', 'your', 'he', 'she', 'they', 'them', 'their', 'not', 'no',
  'if', 'then', 'else', 'when', 'what', 'which', 'who', 'how', 'where',
  'so', 'as', 'up', 'out', 'just', 'also', 'than', 'very', 'too',
  'about', 'into', 'all', 'some', 'any', 'each', 'every', 'both',
  'few', 'more', 'most', 'other', 'such', 'only', 'own', 'same',
  'here', 'there', 'now', 'well', 'way', 'use', 'used', 'using',
  'make', 'made', 'like', 'get', 'got', 'go', 'went', 'come', 'came',
  'take', 'took', 'see', 'saw', 'know', 'knew', 'think', 'thought',
  'want', 'need', 'let', 'say', 'said', 'tell', 'told', 'give', 'gave',
  'work', 'try', 'keep', 'still', 'much', 'many', 'even', 'back',
  'over', 'after', 'before', 'between', 'through', 'during', 'without',
]);

/**
 * Extract content words from text (lowercased, ≥3 chars, no stopwords).
 * Used for overlap detection in R3.
 */
export function extractContentWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}
