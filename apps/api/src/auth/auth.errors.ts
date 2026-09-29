export type AuthErrorCode =
  | 'AUTH_INVALID_INPUT'
  | 'AUTH_EMAIL_ALREADY_REGISTERED'
  | 'AUTH_INVALID_CREDENTIALS'
  | 'AUTH_REFRESH_EXPIRED'
  | 'AUTH_REFRESH_REUSE_DETECTED'
  | 'AUTH_UNAUTHORIZED'
  | 'AUTH_FORBIDDEN';

export type WorkspaceErrorCode =
  | 'WORKSPACE_ACCESS_DENIED'
  | 'WORKSPACE_MEMBER_EXISTS'
  | 'WORKSPACE_INVITATION_EXISTS'
  | 'WORKSPACE_INVITATION_INVALID'
  | 'WORKSPACE_INVITATION_EXPIRED'
  | 'WORKSPACE_INVITATION_USED'
  | 'WORKSPACE_INVALID_ROLE';

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

const workspaceDefaultMessages: Record<WorkspaceErrorCode, string> = {
  WORKSPACE_ACCESS_DENIED: '没有访问该工作区的权限',
  WORKSPACE_MEMBER_EXISTS: '成员已存在',
  WORKSPACE_INVITATION_EXISTS: '邀请已存在',
  WORKSPACE_INVITATION_INVALID: '邀请不存在或无效',
  WORKSPACE_INVITATION_EXPIRED: '邀请已过期',
  WORKSPACE_INVITATION_USED: '邀请已使用',
  WORKSPACE_INVALID_ROLE: '工作区角色不合法',
};

const workspaceStatusByCode: Record<WorkspaceErrorCode, number> = {
  WORKSPACE_ACCESS_DENIED: 403,
  WORKSPACE_MEMBER_EXISTS: 409,
  WORKSPACE_INVITATION_EXISTS: 409,
  WORKSPACE_INVITATION_INVALID: 404,
  WORKSPACE_INVITATION_EXPIRED: 410,
  WORKSPACE_INVITATION_USED: 409,
  WORKSPACE_INVALID_ROLE: 400,
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

export class WorkspaceError extends Error {
  readonly code: WorkspaceErrorCode;
  readonly status: number;

  constructor(code: WorkspaceErrorCode) {
    super(workspaceDefaultMessages[code]);
    this.name = 'WorkspaceError';
    this.code = code;
    this.status = workspaceStatusByCode[code];
  }
}

export function isWorkspaceError(error: unknown): error is WorkspaceError {
  return error instanceof WorkspaceError;
}

export function isAuthError(error: unknown): error is AuthError {
  return error instanceof AuthError;
}
