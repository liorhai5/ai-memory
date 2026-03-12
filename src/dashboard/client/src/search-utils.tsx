import type { ReactNode } from 'react';

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function countOccurrences(text: string, query: string): number {
  if (!query) return 0;
  const haystack = text.toLocaleLowerCase();
  const needle = query.toLocaleLowerCase();
  let count = 0;
  let index = 0;
  while (index < haystack.length) {
    const found = haystack.indexOf(needle, index);
    if (found === -1) break;
    count += 1;
    index = found + needle.length;
  }
  return count;
}

export function highlightText(text: string, query: string): ReactNode {
  if (!query) return text;
  const pattern = new RegExp(`(${escapeRegex(query)})`, 'gi');
  const parts = text.split(pattern);
  return parts.map((part, idx) =>
    part.toLocaleLowerCase() === query.toLocaleLowerCase() ? (
      <mark key={`m-${idx}`} className="turn-highlight">{part}</mark>
    ) : (
      part
    )
  );
}
