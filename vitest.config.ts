import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // tests/adapters/cli.test.ts drives the real CLI as a subprocess, 25 times.
    // A single spawn takes ~0.2s on an idle machine, but the suite runs 19
    // files in parallel and under that contention they intermittently exceeded
    // vitest's 5s default — the same suite failed 3 tests, then 1, then 0 on
    // consecutive runs. A suite that fails differently each time is worse than
    // one that fails consistently: nobody can tell whether they broke it.
    //
    // These tests are legitimately slow, so the limit is raised rather than the
    // work reduced.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
