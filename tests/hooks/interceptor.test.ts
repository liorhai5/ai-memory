import { describe, expect, test } from 'vitest';
import { beforeSubmitPromptHook } from '../../src/hooks/handlers.js';

describe('Interceptor (beforeSubmitPromptHook)', () => {
  test('86 interceptor.status-blocks', () => {
    const out = beforeSubmitPromptHook({ prompt: '/memory status' });
    expect(out.block).toBe(true);
  });

  test('87 interceptor.query-blocks', () => {
    const out = beforeSubmitPromptHook({ prompt: '/memory query hello' });
    expect(out.block).toBe(true);
  });

  test('88 interceptor.reconcile-blocks', () => {
    const out = beforeSubmitPromptHook({ prompt: '/memory reconcile' });
    expect(out.block).toBe(true);
  });

  test('89 interceptor.capture-redirect', () => {
    const out = beforeSubmitPromptHook({ prompt: '/memory capture x' });
    expect((out as any).user_message).toContain('Remember that');
  });

  test('90 interceptor.extract-redirect', () => {
    const out = beforeSubmitPromptHook({ prompt: '/memory extract' });
    expect((out as any).user_message).toContain('Extract key memories');
  });

  test('91 interceptor.non-matching-passes', () => {
    const out = beforeSubmitPromptHook({ prompt: '/memory/src/utils.ts' });
    expect(out.block).toBe(false);
  });

  test('92 interceptor.exact-grammar', () => {
    const a = beforeSubmitPromptHook({ prompt: '/memory status now' });
    const b = beforeSubmitPromptHook({ prompt: '/mem status' });
    expect(a.block).toBe(true);
    expect(b.block).toBe(false);
  });

  test('96 interceptor.deterministic-idempotent', () => {
    const a = beforeSubmitPromptHook({ prompt: '/memory status' });
    const b = beforeSubmitPromptHook({ prompt: '/memory status' });
    expect(a.block).toBe(true);
    expect(b.block).toBe(true);
    const pa = JSON.parse((a as any).user_message);
    const pb = JSON.parse((b as any).user_message);
    expect(pa.pending_extractions_count).toBe(pb.pending_extractions_count);
    expect(pa.memory_entries_count).toBe(pb.memory_entries_count);
    expect(pa.db_path).toBe(pb.db_path);
    expect(pa.index_status).toBe(pb.index_status);
  });
});
