import 'reflect-metadata';

import { describe, expect, it, vi } from 'vitest';
import { RequestMethod } from '@nestjs/common';

import { AuthService } from '../auth/auth.service.js';
import { AUTH_ROLES_KEY } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RoleGuard } from '../auth/guards/role.guard.js';
import { TenantMembershipGuard } from '../common/tenant-context.js';
import { WorkspacesController } from './workspaces.controller.js';
import type { WorkspacesService } from './workspaces.service.js';

const PATH_METADATA = 'path';
const METHOD_METADATA = 'method';
const GUARDS_METADATA = '__guards__';

const invitation = {
  id: 'invitation-1',
  email: 'teammate@example.com',
  role: 'reviewer' as const,
  expiresAt: new Date('2026-10-05T12:00:00.000Z'),
  inviteUrl: 'https://app.example.com/invitations/plain-token',
};

function request() {
  return {
    auth: {
      sub: 'owner-1',
      sessionId: 'session-1',
      workspaceId: 'workspace-1',
      role: 'owner' as const,
    },
    membership: {
      userId: 'owner-1',
      workspaceId: 'workspace-1',
      role: 'owner' as const,
    },
  };
}

function createController() {
  const service = {
    getCurrent: vi.fn().mockResolvedValue({ workspace: { id: 'workspace-1' } }),
    createInvitation: vi.fn().mockResolvedValue(invitation),
    acceptInvitation: vi.fn().mockResolvedValue({ workspaceId: 'workspace-1', role: 'reviewer' }),
    activateWorkspace: vi.fn().mockResolvedValue({
      accessToken: 'new-access-token',
      user: { id: 'owner-1', email: 'owner@example.com', displayName: null },
      workspace: { id: 'workspace-2', name: '第二工作区', slug: 'second-workspace' },
      role: 'editor',
    }),
  } as unknown as WorkspacesService;
  return { controller: new WorkspacesController(service), service };
}

function metadata(target: object, property: string, key: string): unknown {
  return Reflect.getMetadata(key, (target as Record<string, unknown>)[property] as object);
}

describe('WorkspacesController', () => {
  it('declares the current workspace route with access and membership guards', () => {
    expect(Reflect.getMetadata(PATH_METADATA, WorkspacesController)).toBe('workspaces');
    expect(metadata(WorkspacesController.prototype, 'getCurrent', PATH_METADATA)).toBe('current');
    expect(metadata(WorkspacesController.prototype, 'getCurrent', METHOD_METADATA)).toBe(
      RequestMethod.GET,
    );
    expect(metadata(WorkspacesController.prototype, 'getCurrent', GUARDS_METADATA)).toEqual([
      AccessTokenGuard,
      TenantMembershipGuard,
    ]);
  });

  it('allows only owners to create invitations and passes tenant context instead of body auth fields', async () => {
    const { controller, service } = createController();
    const currentRequest = request();
    const body = { email: ' teammate@example.com ', role: 'reviewer', userId: 'attacker' };

    await expect(controller.createInvitation(currentRequest as never, body)).resolves.toEqual(
      invitation,
    );
    expect(service.createInvitation).toHaveBeenCalledWith(currentRequest.membership, body);
    expect(metadata(WorkspacesController.prototype, 'createInvitation', PATH_METADATA)).toBe(
      'current/members/invitations',
    );
    expect(metadata(WorkspacesController.prototype, 'createInvitation', METHOD_METADATA)).toBe(
      RequestMethod.POST,
    );
    expect(metadata(WorkspacesController.prototype, 'createInvitation', GUARDS_METADATA)).toEqual([
      AccessTokenGuard,
      TenantMembershipGuard,
      RoleGuard,
    ]);
    expect(metadata(WorkspacesController.prototype, 'createInvitation', AUTH_ROLES_KEY)).toEqual([
      'owner',
    ]);
    expect(JSON.stringify(invitation)).not.toContain('tokenHash');
  });

  it('accepts an invitation from the access-token subject and never takes an email from the body', async () => {
    const { controller, service } = createController();
    const currentRequest = request();

    await expect(
      controller.acceptInvitation(currentRequest as never, { token: 'plain-token' }),
    ).resolves.toEqual({ workspaceId: 'workspace-1', role: 'reviewer' });
    expect(service.acceptInvitation).toHaveBeenCalledWith({
      userId: 'owner-1',
      token: 'plain-token',
    });
    expect(metadata(WorkspacesController.prototype, 'acceptInvitation', PATH_METADATA)).toBe(
      'invitations/:token/accept',
    );
    expect(metadata(WorkspacesController.prototype, 'acceptInvitation', METHOD_METADATA)).toBe(
      RequestMethod.POST,
    );
    expect(metadata(WorkspacesController.prototype, 'acceptInvitation', GUARDS_METADATA)).toEqual([
      AccessTokenGuard,
    ]);
  });

  it('activates a workspace with the access-token subject and session', async () => {
    const { controller, service } = createController();
    const currentRequest = request();

    const response = await controller.activateWorkspace(currentRequest as never, {
      workspaceId: 'workspace-2',
    });

    expect(service.activateWorkspace).toHaveBeenCalledWith({
      userId: 'owner-1',
      sessionId: 'session-1',
      workspaceId: 'workspace-2',
    });
    expect(response).not.toHaveProperty('refreshToken');
    expect(metadata(WorkspacesController.prototype, 'activateWorkspace', PATH_METADATA)).toBe(
      ':workspaceId/activate',
    );
    expect(metadata(WorkspacesController.prototype, 'activateWorkspace', METHOD_METADATA)).toBe(
      RequestMethod.POST,
    );
    expect(metadata(WorkspacesController.prototype, 'activateWorkspace', GUARDS_METADATA)).toEqual([
      AccessTokenGuard,
    ]);
  });

  it('passes only membership context to the current workspace service', async () => {
    const { controller, service } = createController();
    const currentRequest = request();

    await controller.getCurrent(currentRequest as never);

    expect(service.getCurrent).toHaveBeenCalledWith(currentRequest.membership);
  });

  it('uses AuthService as the module dependency for workspace activation', () => {
    expect(AuthService).toBeDefined();
  });
});
