import { describe, expect, test } from 'vitest';
import { createTempApp } from '../test-helpers.js';

describe('LinkStore', () => {
  test('12 link-store.valid-types-only', () => {
    const { app } = createTempApp();
    expect(app.linkStore.validateType('supports')).toBe(true);
    expect(app.linkStore.validateType('related')).toBe(true);
    expect(app.linkStore.validateType('invalid')).toBe(false);
  });
});
