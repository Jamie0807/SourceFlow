import 'reflect-metadata';

import { describe, expect, it, vi } from 'vitest';
import { HttpStatus, RequestMethod } from '@nestjs/common';

import { AUTH_ROLES_KEY } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RoleGuard } from '../auth/guards/role.guard.js';
import { TenantMembershipGuard } from '../common/tenant-context.js';
import { SourcesController } from './sources.controller.js';
import type { SourcesService } from './sources.service.js';

const PATH = 'path';
const METHOD = 'method';
const GUARDS = '__guards__';

function createController() {
  const service = {
    create: vi.fn().mockResolvedValue({ sourceId: 'source-1' }),
    get: vi.fn().mockResolvedValue({ id: 'source-1' }),
    cancel: vi.fn().mockResolvedValue({ id: 'source-1', status: 'cancelled' }),
    completeUpload: vi.fn().mockResolvedValue({ taskRunId: 'validation-task' }),
    process: vi.fn().mockResolvedValue({ taskRunId: 'processing-task' }),
  } as unknown as SourcesService;
  const controller = new SourcesController(service);
  return { controller, service };
}

function metadata(method: string, key: string): unknown {
  const handler = Object.getOwnPropertyDescriptor(SourcesController.prototype, method)?.value;
  if (handler === undefined) throw new Error(`Missing controller method: ${method}`);
  return Reflect.getMetadata(key, handler);
}

describe('SourcesController', () => {
  it('takes create tenant identity only from guard-populated membership', async () => {
    const { controller, service } = createController();
    const request = {
      membership: { userId: 'user-1', workspaceId: 'workspace-1', role: 'owner' },
    };
    const body = {
      fileName: 'episode.mp3',
      mimeType: 'audio/mpeg',
      sizeBytes: 42,
      contentHash: 'checksum',
      workspaceId: 'attacker-workspace',
      uploadedById: 'attacker-user',
    };

    await controller.create(request as never, body);

    expect(service.create).toHaveBeenCalledWith(request.membership, body);
    expect(Reflect.getMetadata(PATH, SourcesController)).toBe('sources');
    expect(metadata('create', PATH)).toBe('/');
    expect(metadata('create', METHOD)).toBe(RequestMethod.POST);
    expect(metadata('create', GUARDS)).toEqual([
      AccessTokenGuard,
      TenantMembershipGuard,
      RoleGuard,
    ]);
    expect(metadata('create', AUTH_ROLES_KEY)).toEqual(['owner', 'editor']);
  });

  it('requires membership for reading and only passes its workspace context', async () => {
    const { controller, service } = createController();
    const request = {
      membership: { userId: 'user-1', workspaceId: 'workspace-1', role: 'reviewer' },
    };

    await controller.get(request as never, { sourceId: 'source-1' });

    expect(service.get).toHaveBeenCalledWith(request.membership, 'source-1');
    expect(metadata('get', GUARDS)).toEqual([AccessTokenGuard, TenantMembershipGuard]);
    expect(metadata('get', PATH)).toBe(':sourceId');
    expect(metadata('get', METHOD)).toBe(RequestMethod.GET);
  });

  it('limits cancellation to owner and editor membership', async () => {
    const { controller, service } = createController();
    const request = {
      membership: { userId: 'user-1', workspaceId: 'workspace-1', role: 'editor' },
    };

    await controller.cancel(request as never, { sourceId: 'source-1' });

    expect(service.cancel).toHaveBeenCalledWith(request.membership, 'source-1');
    expect(metadata('cancel', PATH)).toBe(':sourceId/cancel');
    expect(metadata('cancel', GUARDS)).toEqual([
      AccessTokenGuard,
      TenantMembershipGuard,
      RoleGuard,
    ]);
    expect(metadata('cancel', AUTH_ROLES_KEY)).toEqual(['owner', 'editor']);
  });

  it.each([
    ['completeUpload', ':sourceId/upload-complete', 'completeUpload'],
    ['process', ':sourceId/process', 'process'],
  ])('exposes the owner/editor %s endpoint with HTTP 202', async (method, path, serviceMethod) => {
    const { controller, service } = createController();
    const request = {
      membership: { userId: 'user-1', workspaceId: 'workspace-1', role: 'owner' },
    };
    const params = { sourceId: 'source-1' };

    await controller[method as 'completeUpload' | 'process'](request as never, params);

    expect(service[serviceMethod as 'completeUpload' | 'process']).toHaveBeenCalledWith(
      request.membership,
      'source-1',
    );
    expect(metadata(method, PATH)).toBe(path);
    expect(metadata(method, METHOD)).toBe(RequestMethod.POST);
    expect(metadata(method, GUARDS)).toEqual([AccessTokenGuard, TenantMembershipGuard, RoleGuard]);
    expect(metadata(method, AUTH_ROLES_KEY)).toEqual(['owner', 'editor']);
    const handler = Object.getOwnPropertyDescriptor(SourcesController.prototype, method)?.value;
    expect(Reflect.getMetadata('__httpCode__', handler)).toBe(HttpStatus.ACCEPTED);
  });
});
