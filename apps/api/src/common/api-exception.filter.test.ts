import { describe, expect, it } from 'vitest';
import type { ArgumentsHost } from '@nestjs/common';

import { WorkspaceError } from '../auth/auth.errors.js';
import { ApiExceptionFilter } from './api-exception.filter.js';

describe('ApiExceptionFilter', () => {
  it('uses the safe default message for WorkspaceError responses', () => {
    const sent: unknown[] = [];
    const reply = {
      status(statusCode: number) {
        expect(statusCode).toBe(403);
        return this;
      },
      send(payload: unknown) {
        sent.push(payload);
        return this;
      },
    };
    const request = { id: 'req' };
    const host = {
      switchToHttp: () => ({
        getResponse: () => reply,
        getRequest: () => request,
      }),
    } as unknown as ArgumentsHost;

    new ApiExceptionFilter().catch(new WorkspaceError('WORKSPACE_ACCESS_DENIED'), host);

    expect(sent).toEqual([
      {
        code: 'WORKSPACE_ACCESS_DENIED',
        message: '没有访问该工作区的权限',
        request_id: 'req',
        details: null,
      },
    ]);
    expect(JSON.stringify(sent)).not.toContain('caller-controlled');
  });
});
