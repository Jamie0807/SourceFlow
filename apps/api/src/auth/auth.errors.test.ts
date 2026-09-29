import { describe, expect, it } from 'vitest';

import { AuthError, isAuthError, isWorkspaceError, WorkspaceError } from './auth.errors.js';

describe('auth error type guards', () => {
  it('does not classify WorkspaceError as AuthError', () => {
    expect(isAuthError(new AuthError('AUTH_UNAUTHORIZED'))).toBe(true);
    expect(isAuthError(new WorkspaceError('WORKSPACE_ACCESS_DENIED'))).toBe(false);
    expect(isWorkspaceError(new WorkspaceError('WORKSPACE_ACCESS_DENIED'))).toBe(true);
  });

  it('always uses the safe default WorkspaceError message', () => {
    const error = Reflect.construct(WorkspaceError, [
      'WORKSPACE_ACCESS_DENIED',
      'caller-controlled message',
    ]) as WorkspaceError;

    expect(error.message).toBe('没有访问该工作区的权限');
  });
});
