import { describe, expect, test } from 'vitest';
import { stripNonProseContent } from '../../src/utils/content-strip.js';

describe('Content Stripping', () => {
  test('106 strip.code-blocks', () => {
    const input = 'Before code\n```typescript\nconst x = 1;\nconsole.log(x);\n```\nAfter code';
    const result = stripNonProseContent(input);
    expect(result).toContain('Before code');
    expect(result).toContain('After code');
    expect(result).not.toContain('const x = 1');
    expect(result).not.toContain('console.log');
  });

  test('107 strip.json-and-html', () => {
    // Large JSON (>100 chars)
    const jsonPayload = '{"key":"' + 'x'.repeat(120) + '"}';
    const htmlPayload = '<div>' + 'content '.repeat(10) + '</div>';
    const input = `Before json ${jsonPayload} middle ${htmlPayload} after`;
    const result = stripNonProseContent(input);
    expect(result).toContain('Before json');
    expect(result).toContain('after');
    expect(result).not.toContain('x'.repeat(120));
    expect(result).not.toContain('content content content');
  });

  test('108 strip.urls-and-injected', () => {
    const input = [
      'Check this https://example.com/path?q=test link',
      '<!-- p1:injected:begin -->',
      'These are injected memories from previous session.',
      'Decision: use sqlite',
      '<!-- p1:injected:end -->',
      'Real user message here',
    ].join('\n');
    const result = stripNonProseContent(input);
    expect(result).toContain('Check this');
    expect(result).toContain('link');
    expect(result).not.toContain('https://example.com');
    expect(result).not.toContain('injected memories');
    expect(result).not.toContain('Decision: use sqlite');
    expect(result).toContain('Real user message here');
  });
});
