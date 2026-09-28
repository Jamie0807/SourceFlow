export type AuthErrorCode =
  | 'AUTH_INVALID_INPUT'
  | 'AUTH_EMAIL_ALREADY_REGISTERED'
  | 'AUTH_INVALID_CREDENTIALS'
  | 'AUTH_REFRESH_EXPIRED'
  | 'AUTH_REFRESH_REUSE_DETECTED'
  | 'AUTH_UNAUTHORIZED'
  | 'AUTH_FORBIDDEN';

const defaultMessages: Record<AuthErrorCode, string> = {
  AUTH_INVALID_INPUT: '请求参数不正确',
  AUTH_EMAIL_ALREADY_REGISTERED: '邮箱已注册',
  AUTH_INVALID_CREDENTIALS: '邮箱或密码不正确',
  AUTH_REFRESH_EXPIRED: '登录状态已过期，请重新登录',
  AUTH_REFRESH_REUSE_DETECTED: '登录状态已失效，请重新登录',
  AUTH_UNAUTHORIZED: '请先登录',
  AUTH_FORBIDDEN: '没有执行此操作的权限',
};

const statusByCode: Record<AuthErrorCode, number> = {
  AUTH_INVALID_INPUT: 400,
  AUTH_EMAIL_ALREADY_REGISTERED: 409,
  AUTH_INVALID_CREDENTIALS: 401,
  AUTH_REFRESH_EXPIRED: 401,
  AUTH_REFRESH_REUSE_DETECTED: 401,
  AUTH_UNAUTHORIZED: 401,
  AUTH_FORBIDDEN: 403,
};

export class AuthError extends Error {
  readonly code: AuthErrorCode;
  readonly status: number;

  constructor(code: AuthErrorCode, message = defaultMessages[code]) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    this.status = statusByCode[code];
  }
}

export function isAuthError(error: unknown): error is AuthError {
  return error instanceof AuthError;
}
