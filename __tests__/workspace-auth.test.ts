import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword, sessionHash, normalizeUsername } from '../lib/workspace/auth';
import { trustedWrite, sessionCookieOptions } from '../lib/workspace/http';

describe('workspace credentials', () => {
  it('salts passwords and rejects wrong or malformed hashes', async () => {
    const a = await hashPassword('correct horse battery staple');
    const b = await hashPassword('correct horse battery staple');
    expect(a).not.toBe(b);
    expect(await verifyPassword('correct horse battery staple', a)).toBe(true);
    expect(await verifyPassword('wrong', a)).toBe(false);
    expect(await verifyPassword('wrong', 'scrypt$bad')).toBe(false);
  });
  it('canonicalizes names and hashes random sessions', () => {
    expect(normalizeUsername(' Alice ')).toBe('alice');
    expect(sessionHash('a'.repeat(43))).toHaveLength(64);
  });
  it('requires configured exact origin for writes', () => {
    process.env.WORKSPACE_ORIGIN = 'http://localhost:13021';
    expect(trustedWrite(new Request('http://localhost/api', {headers:{origin:'http://localhost:13021'}}))).toBe(true);
    expect(trustedWrite(new Request('http://localhost/api', {headers:{origin:'http://evil.test'}}))).toBe(false);
    expect(trustedWrite(new Request('http://localhost/api'))).toBe(false);
    expect(sessionCookieOptions().httpOnly).toBe(true);
    expect(sessionCookieOptions().sameSite).toBe('strict');
  });
});
