import { describe, it, expect, vi } from 'vitest';
import { authService } from './auth';

global.fetch = vi.fn();

describe('AuthService', () => {
  it('should return true when authenticated (token exists)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockReturnValue('mock-token');
    expect(authService.isAuthenticated()).toBe(true);
  });

  it('should return false when not authenticated', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(null);
    expect(authService.isAuthenticated()).toBe(false);
  });
});