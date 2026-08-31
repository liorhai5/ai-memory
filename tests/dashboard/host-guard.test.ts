import { describe, test, expect } from 'vitest';
import { parseHostHeader, isLoopbackHost, hostAllowed } from '../../src/dashboard/server.js';

describe('parseHostHeader', () => {
  test('strips the port', () => {
    expect(parseHostHeader('localhost:8485')).toBe('localhost');
    expect(parseHostHeader('127.0.0.1:8485')).toBe('127.0.0.1');
  });

  test('handles an IPv6 literal, whose address contains colons', () => {
    // splitting on ':' would return '[' and reject a legitimate loopback request
    expect(parseHostHeader('[::1]:8485')).toBe('::1');
    expect(parseHostHeader('[::1]')).toBe('::1');
    expect(parseHostHeader('[2001:db8::1]:80')).toBe('2001:db8::1');
  });

  test('no port', () => {
    expect(parseHostHeader('example.com')).toBe('example.com');
  });

  test('is case-insensitive and trims', () => {
    expect(parseHostHeader('  LocalHost:8485 ')).toBe('localhost');
  });

  test('missing or empty is null, not an empty string', () => {
    expect(parseHostHeader(undefined)).toBeNull();
    expect(parseHostHeader('')).toBeNull();
    expect(parseHostHeader('   ')).toBeNull();
    expect(parseHostHeader('[::1')).toBeNull(); // unterminated bracket
  });
});

describe('hostAllowed while bound to loopback', () => {
  const bind = '127.0.0.1';

  test('accepts loopback names', () => {
    for (const h of ['localhost:8485', '127.0.0.1:8485', '[::1]:8485', 'localhost']) {
      expect(hostAllowed(h, bind)).toBe(true);
    }
  });

  test('rejects a rebound attacker hostname', () => {
    expect(hostAllowed('evil.example.com:8485', bind)).toBe(false);
    expect(hostAllowed('memory.attacker.test', bind)).toBe(false);
  });

  test('rejects the machine LAN address', () => {
    expect(hostAllowed('192.168.68.52:8485', bind)).toBe(false);
  });

  test('rejects a missing Host header', () => {
    expect(hostAllowed(undefined, bind)).toBe(false);
    expect(hostAllowed('', bind)).toBe(false);
  });
});

describe('hostAllowed when the operator opted into exposure', () => {
  test('--host 0.0.0.0 must not be made inert by the guard', () => {
    expect(hostAllowed('192.168.68.52:8485', '0.0.0.0')).toBe(true);
    expect(hostAllowed('memory.internal:8485', '0.0.0.0')).toBe(true);
  });

  test('an explicit loopback bind still enforces the guard', () => {
    expect(hostAllowed('evil.example.com', 'localhost')).toBe(false);
    expect(hostAllowed('evil.example.com', '::1')).toBe(false);
  });
});

describe('isLoopbackHost', () => {
  test('the three loopback spellings, and nothing else', () => {
    expect(['localhost', '127.0.0.1', '::1'].every(isLoopbackHost)).toBe(true);
    expect(['0.0.0.0', '192.168.1.1', 'example.com', ''].some(isLoopbackHost)).toBe(false);
  });
});
