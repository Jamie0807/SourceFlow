import { Readable } from 'node:stream';

export interface StorageObjectReference {
  readonly workspaceId: string;
  readonly sourceId: string;
}

export interface StoragePutObjectInput extends StorageObjectReference {
  readonly body: Uint8Array | Readable;
  readonly contentType: string;
  readonly contentLength?: number;
}

export interface StoredObject {
  readonly body: Readable;
  readonly contentType?: string;
  readonly contentLength?: number;
  readonly etag?: string;
}

export class StorageNotFoundError extends Error {
  constructor(reference: StorageObjectReference) {
    super(
      `Storage object not found for workspace ${reference.workspaceId} and source ${reference.sourceId}`,
    );
    this.name = 'StorageNotFoundError';
  }
}

export class StorageResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageResponseError';
  }
}

export interface StoragePort {
  putObject(input: StoragePutObjectInput): Promise<void>;
  getObject(input: StorageObjectReference): Promise<StoredObject>;
  deleteObject(input: StorageObjectReference): Promise<void>;
}

export function buildSourceObjectKey(input: StorageObjectReference): string {
  assertSafeStorageIdentifier(input.workspaceId, 'workspaceId');
  assertSafeStorageIdentifier(input.sourceId, 'sourceId');

  return `workspaces/${input.workspaceId}/sources/${input.sourceId}/original`;
}

function assertSafeStorageIdentifier(value: string, fieldName: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value)) {
    throw new Error(`${fieldName} must be a safe storage identifier`);
  }
}
