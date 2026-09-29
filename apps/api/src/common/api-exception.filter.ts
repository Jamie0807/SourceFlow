import { Catch, type ArgumentsHost, type ExceptionFilter, HttpException } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';

import { isAuthError, isWorkspaceError, WorkspaceError } from '../auth/auth.errors.js';

type ErrorResponse = Readonly<{
  code: string;
  message: string;
  request_id: string;
  details: null;
}>;

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<FastifyReply>();
    const request = host.switchToHttp().getRequest<FastifyRequest & { id?: string }>();
    const payload = toSafeErrorResponse(exception, request.id ?? randomUUID());
    const status = getStatus(exception);

    response.status(status).send(payload);
  }
}

function getStatus(exception: unknown): number {
  if (isWorkspaceError(exception)) return exception.status;
  if (isAuthError(exception)) return exception.status;
  if (exception instanceof HttpException) return exception.getStatus();
  return 500;
}

function toSafeErrorResponse(exception: unknown, requestId: string): ErrorResponse {
  if (isWorkspaceError(exception)) {
    return {
      code: exception.code,
      message: new WorkspaceError(exception.code).message,
      request_id: requestId,
      details: null,
    };
  }

  if (isAuthError(exception)) {
    return {
      code: exception.code,
      message: exception.message,
      request_id: requestId,
      details: null,
    };
  }

  if (exception instanceof HttpException && exception.getStatus() < 500) {
    return {
      code: 'REQUEST_INVALID',
      message: '请求参数不正确',
      request_id: requestId,
      details: null,
    };
  }

  return {
    code: 'INTERNAL_ERROR',
    message: '服务器暂时无法处理请求',
    request_id: requestId,
    details: null,
  };
}
