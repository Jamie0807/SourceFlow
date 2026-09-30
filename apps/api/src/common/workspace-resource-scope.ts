import { WorkspaceError } from '../auth/auth.errors.js';

export function workspaceScopedWhere<T extends Record<string, unknown>>(
  workspaceId: string,
  where: T,
): T & { workspaceId: string } {
  if (workspaceId.trim().length === 0) {
    throw new WorkspaceError('WORKSPACE_ACCESS_DENIED');
  }

  return { ...where, workspaceId };
}
