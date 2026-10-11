export type SourceErrorCode =
  | 'SOURCE_INVALID_INPUT'
  | 'SOURCE_DUPLICATE'
  | 'SOURCE_NOT_FOUND'
  | 'SOURCE_INVALID_STATE'
  | 'SOURCE_UPLOAD_INCOMPLETE'
  | 'SOURCE_STORAGE_UNAVAILABLE'
  | 'SOURCE_QUEUE_UNAVAILABLE';

const statusByCode: Record<SourceErrorCode, number> = {
  SOURCE_INVALID_INPUT: 400,
  SOURCE_DUPLICATE: 409,
  SOURCE_NOT_FOUND: 404,
  SOURCE_INVALID_STATE: 409,
  SOURCE_UPLOAD_INCOMPLETE: 409,
  SOURCE_STORAGE_UNAVAILABLE: 503,
  SOURCE_QUEUE_UNAVAILABLE: 503,
};

const messageByCode: Record<SourceErrorCode, string> = {
  SOURCE_INVALID_INPUT: 'Source 参数不正确',
  SOURCE_DUPLICATE: '该文件已存在于当前工作区',
  SOURCE_NOT_FOUND: 'Source 不存在',
  SOURCE_INVALID_STATE: 'Source 当前状态不允许此操作',
  SOURCE_UPLOAD_INCOMPLETE: '上传对象不存在或与 Source 声明不匹配',
  SOURCE_STORAGE_UNAVAILABLE: '存储服务暂时不可用，请重试',
  SOURCE_QUEUE_UNAVAILABLE: '任务队列暂时不可用，请重试',
};

export class SourceError extends Error {
  readonly status: number;

  constructor(readonly code: SourceErrorCode) {
    super(messageByCode[code]);
    this.name = 'SourceError';
    this.status = statusByCode[code];
  }
}

export function isSourceError(error: unknown): error is SourceError {
  return error instanceof SourceError;
}
