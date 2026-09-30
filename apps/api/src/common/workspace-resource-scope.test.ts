import { describe, expect, it } from 'vitest';

import { WorkspaceError } from '../auth/auth.errors.js';
import { workspaceScopedWhere } from './workspace-resource-scope.js';

describe('workspaceScopedWhere', () => {
  it('adds the trusted workspaceId to a resource filter', () => {
    expect(workspaceScopedWhere('workspace-a', { id: 'source-a', status: 'ready' })).toEqual({
      id: 'source-a',
      status: 'ready',
      workspaceId: 'workspace-a',
    });
  });

  it('keeps the context workspaceId as the final ownership condition', () => {
    expect(
      workspaceScopedWhere('workspace-a', { id: 'source-a', workspaceId: 'workspace-b' }),
    ).toEqual({ id: 'source-a', workspaceId: 'workspace-a' });
  });

  it.each(['', ' ', '\t'])('rejects an empty workspaceId: %j', (workspaceId) => {
    expect(() => workspaceScopedWhere(workspaceId, { id: 'source-a' })).toThrowError(
      new WorkspaceError('WORKSPACE_ACCESS_DENIED'),
    );
  });
});
