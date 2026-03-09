import { createHash } from 'node:crypto';

export function hashContent(input: string): string {
  return createHash('sha256').update(input.trim().toLowerCase()).digest('hex');
}
