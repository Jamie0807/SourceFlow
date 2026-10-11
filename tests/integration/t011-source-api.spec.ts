import { createHash } from 'node:crypto';
import { Module } from '../../apps/api/node_modules/@nestjs/common/index.js';
import { NestFactory } from '../../apps/api/node_modules/@nestjs/core/index.js';
import { FastifyAdapter } from '../../apps/api/node_modules/@nestjs/platform-fastify/index.js';
import { expect, test } from '@playwright/test';

import { AUTH_REPOSITORY } from '../../apps/api/dist/auth/auth.repository.js';
import type { MembershipRecord } from '../../apps/api/src/auth/auth.types.js';
import { AccessTokenGuard } from '../../apps/api/dist/auth/guards/access-token.guard.js';
import { RoleGuard } from '../../apps/api/dist/auth/guards/role.guard.js';
import { AuthTokenService } from '../../apps/api/dist/auth/tokens/auth-token.service.js';
import { ApiExceptionFilter } from '../../apps/api/dist/common/api-exception.filter.js';
import { TenantMembershipGuard } from '../../apps/api/dist/common/tenant-context.js';
import { STORAGE_PORT } from '../../apps/api/dist/storage/storage.port.js';
import type {
  StorageObjectMetadata,
  StoragePort,
} from '../../apps/api/src/storage/storage.port.js';
import { SourcesController } from '../../apps/api/dist/sources/sources.controller.js';
import { SourcesService } from '../../apps/api/dist/sources/sources.service.js';
import { SourcesRepositoryToken } from '../../apps/api/dist/sources/sources.repository.js';
import type {
  CreateSourceRecord,
  CreateSourceTaskRun,
  SourceRecord,
  SourceTaskRunRecord,
  SourcesRepository,
} from '../../apps/api/src/sources/sources.repository.js';
import { SOURCE_TASK_PUBLISHER } from '../../apps/api/dist/sources/source-task.publisher.js';
import type { SourceTaskPublisher } from '../../apps/api/src/sources/source-task.publisher.js';
import type { SourceTaskMessage } from '../../packages/domain/src/source-task.js';

const JWT_SECRET = 't011-api-integration-test-secret-at-least-32-bytes';
const CONTENT = Buffer.from('SourceFlow integration smoke content', 'utf8');
const CONTENT_HASH = createHash('sha256').update(CONTENT).digest('base64');

type UploadedObject = Readonly<{
  contentLength: number;
  contentType: string;
  checksumSha256: string;
}>;

class InMemorySourcesRepository implements SourcesRepository {
  readonly sources = new Map<string, SourceRecord>();
  readonly taskRuns = new Map<string, SourceTaskRunRecord>();

  async create(input: CreateSourceRecord): Promise<SourceRecord> {
    const now = new Date();
    const source: SourceRecord = {
      ...input,
      durationSeconds: null,
      createdAt: now,
      updatedAt: now,
    };
    this.sources.set(sourceKey(input.workspaceId, input.id), source);
    return source;
  }

  async findById(workspaceId: string, sourceId: string): Promise<SourceRecord | null> {
    return this.sources.get(sourceKey(workspaceId, sourceId)) ?? null;
  }

  async findByContentHash(workspaceId: string, contentHash: string): Promise<SourceRecord | null> {
    return (
      [...this.sources.values()].find(
        (source) => source.workspaceId === workspaceId && source.contentHash === contentHash,
      ) ?? null
    );
  }

  async updateStatus(
    workspaceId: string,
    sourceId: string,
    from: SourceRecord['status'],
    to: SourceRecord['status'],
  ): Promise<boolean> {
    const key = sourceKey(workspaceId, sourceId);
    const source = this.sources.get(key);
    if (source === undefined || source.status !== from) return false;
    this.sources.set(key, { ...source, status: to, updatedAt: new Date() });
    return true;
  }

  async findTaskRunByIdempotencyKey(
    workspaceId: string,
    idempotencyKey: string,
  ): Promise<SourceTaskRunRecord | null> {
    return (
      [...this.taskRuns.values()].find(
        (taskRun) =>
          taskRun.workspaceId === workspaceId && taskRun.idempotencyKey === idempotencyKey,
      ) ?? null
    );
  }

  async findLatestTaskRunForSource(
    workspaceId: string,
    sourceId: string,
  ): Promise<SourceTaskRunRecord | null> {
    return (
      [...this.taskRuns.values()]
        .reverse()
        .find(
          (taskRun) => taskRun.workspaceId === workspaceId && taskRun.payload.sourceId === sourceId,
        ) ?? null
    );
  }

  advanceValidation(taskRunId: string): void {
    const taskRun = this.taskRuns.get(taskRunId);
    if (taskRun === undefined) throw new Error(`Unknown TaskRun ${taskRunId}`);
    const source = this.sources.get(sourceKey(taskRun.workspaceId, taskRun.payload.sourceId));
    if (source === undefined || source.status !== 'validating') {
      throw new Error('Source is not awaiting validation');
    }
    this.sources.set(sourceKey(source.workspaceId, source.id), {
      ...source,
      status: 'uploaded',
      updatedAt: new Date(),
    });
    this.taskRuns.set(taskRunId, { ...taskRun, status: 'succeeded' });
  }

  async completeUploadAndCreateTaskRun(input: {
    workspaceId: string;
    sourceId: string;
    taskRun: CreateSourceTaskRun;
  }): Promise<{ source: SourceRecord; taskRun: SourceTaskRunRecord } | null> {
    const source = await this.findById(input.workspaceId, input.sourceId);
    if (source === null || source.status !== 'uploading') return null;
    const updated = { ...source, status: 'validating' as const, updatedAt: new Date() };
    const taskRun = toTaskRun(input.taskRun);
    this.sources.set(sourceKey(input.workspaceId, input.sourceId), updated);
    this.taskRuns.set(taskRun.id, taskRun);
    return { source: updated, taskRun };
  }

  async queueSourceAndCreateTaskRun(input: {
    workspaceId: string;
    sourceId: string;
    taskRun: CreateSourceTaskRun;
  }): Promise<{ source: SourceRecord; taskRun: SourceTaskRunRecord } | null> {
    const source = await this.findById(input.workspaceId, input.sourceId);
    if (source === null || source.status !== 'uploaded') return null;
    const updated = { ...source, status: 'queued' as const, updatedAt: new Date() };
    const taskRun = toTaskRun(input.taskRun);
    this.sources.set(sourceKey(input.workspaceId, input.sourceId), updated);
    this.taskRuns.set(taskRun.id, taskRun);
    return { source: updated, taskRun };
  }

  async cancelSourceAndTaskRuns(
    workspaceId: string,
    sourceId: string,
  ): Promise<SourceRecord | null> {
    const source = await this.findById(workspaceId, sourceId);
    if (source === null) return null;
    const cancelled = { ...source, status: 'cancelled' as const, updatedAt: new Date() };
    this.sources.set(sourceKey(workspaceId, sourceId), cancelled);
    for (const [id, taskRun] of this.taskRuns) {
      if (
        taskRun.workspaceId === workspaceId &&
        taskRun.payload.sourceId === sourceId &&
        (taskRun.status === 'queued' || taskRun.status === 'processing')
      ) {
        this.taskRuns.set(id, { ...taskRun, status: 'cancelled' });
      }
    }
    return cancelled;
  }
}

class InMemorySourceTaskPublisher implements SourceTaskPublisher {
  readonly messages: SourceTaskMessage[] = [];

  async enqueue(message: SourceTaskMessage): Promise<string> {
    this.messages.push(message);
    return message.taskRunId;
  }
}

const repository = new InMemorySourcesRepository();
const publisher = new InMemorySourceTaskPublisher();
const uploadedObjects = new Map<string, UploadedObject>();
let serverUrl = '';
let app: Awaited<ReturnType<typeof NestFactory.create>> | undefined;
let ownerToken = '';
let otherWorkspaceToken = '';

const memberships = new Map<string, MembershipRecord>([
  ['owner-user:workspace-alpha', membership('owner-user', 'workspace-alpha', 'owner')],
  ['other-user:workspace-beta', membership('other-user', 'workspace-beta', 'editor')],
]);

const authRepository = {
  findMembership: async (userId: string, workspaceId: string) =>
    memberships.get(`${userId}:${workspaceId}`) ?? null,
};
const tokenService = new AuthTokenService({ jwtSecret: JWT_SECRET });
const storage: StoragePort = {
  putObject: async () => undefined,
  getObject: async () => {
    throw new Error('Not used by API smoke');
  },
  deleteObject: async () => undefined,
  createPresignedPut: async (input) => ({
    url: `${serverUrl}/mock-upload/${input.sourceId}`,
    headers: {
      'content-type': input.contentType,
      'x-amz-checksum-sha256': input.checksumSha256,
    },
    expiresAt: new Date(Date.now() + input.expiresInSeconds * 1_000),
  }),
  headObject: async ({ sourceId }): Promise<StorageObjectMetadata> => {
    const object = uploadedObjects.get(sourceId);
    if (object === undefined) throw new Error('Object has not been uploaded');
    return object;
  },
};

@Module({
  controllers: [SourcesController],
  providers: [
    SourcesService,
    AccessTokenGuard,
    TenantMembershipGuard,
    RoleGuard,
    { provide: AuthTokenService, useValue: tokenService },
    { provide: AUTH_REPOSITORY, useValue: authRepository },
    { provide: SourcesRepositoryToken, useValue: repository },
    { provide: STORAGE_PORT, useValue: storage },
    { provide: SOURCE_TASK_PUBLISHER, useValue: publisher },
  ],
})
class SourceApiSmokeModule {}

test.describe('T011 Source API @smoke', () => {
  test.beforeAll(async () => {
    const adapter = new FastifyAdapter();
    app = await NestFactory.create(SourceApiSmokeModule, adapter, { logger: false });
    app.useGlobalFilters(new ApiExceptionFilter());
    const fastify = adapter.getInstance();
    fastify.put<{ Params: { sourceId: string } }>(
      '/mock-upload/:sourceId',
      async (incoming, reply) => {
        const body = incoming.body;
        const bytes =
          typeof body === 'string'
            ? Buffer.from(body)
            : Buffer.isBuffer(body) || body instanceof Uint8Array
              ? Buffer.from(body)
              : null;
        if (bytes === null) throw new Error('Mock PUT requires a byte body');
        uploadedObjects.set(incoming.params.sourceId, {
          contentLength: bytes.byteLength,
          contentType: String(incoming.headers['content-type'] ?? ''),
          checksumSha256: createHash('sha256').update(bytes).digest('base64'),
        });
        return reply.code(200).send();
      },
    );
    await app.listen(0, '127.0.0.1');
    serverUrl = await app.getUrl();
    ownerToken = await tokenService.signAccessToken({
      sub: 'owner-user',
      sessionId: 'owner-session',
      workspaceId: 'workspace-alpha',
      role: 'owner',
    });
    otherWorkspaceToken = await tokenService.signAccessToken({
      sub: 'other-user',
      sessionId: 'other-session',
      workspaceId: 'workspace-beta',
      role: 'editor',
    });
  });

  test.afterAll(async () => {
    await app?.close();
  });

  test('creates, uploads, validates, queues, scopes by workspace, and cancels a Source @smoke', async ({
    playwright,
  }) => {
    const api = await playwright.request.newContext();
    try {
      const auth = { Authorization: `Bearer ${ownerToken}` };
      const createdResponse = await api.post(`${serverUrl}/sources`, {
        headers: auth,
        data: {
          fileName: 'smoke.txt',
          mimeType: 'text/plain',
          sizeBytes: CONTENT.length,
          contentHash: CONTENT_HASH,
        },
      });
      expect(createdResponse.status()).toBe(201);
      const created = (await createdResponse.json()) as {
        sourceId: string;
        uploadUrl: string;
        headers: Record<string, string>;
      };

      const uploadResponse = await api.put(created.uploadUrl, {
        headers: created.headers,
        data: CONTENT,
      });
      expect(uploadResponse.status()).toBe(200);

      const uploadCompleteResponse = await api.post(
        `${serverUrl}/sources/${created.sourceId}/upload-complete`,
        { headers: auth },
      );
      expect(uploadCompleteResponse.status()).toBe(202);
      const uploadComplete = (await uploadCompleteResponse.json()) as {
        source: { status: string };
        taskRunId: string;
      };
      expect(uploadComplete.source.status).toBe('validating');
      expect(publisher.messages.at(-1)?.taskType).toBe('source.validate');
      expect(repository.taskRuns.get(uploadComplete.taskRunId)?.status).toBe('queued');

      const validatingResponse = await api.get(`${serverUrl}/sources/${created.sourceId}`, {
        headers: auth,
      });
      expect(await validatingResponse.json()).toMatchObject({
        status: 'validating',
        taskRun: { taskRunId: uploadComplete.taskRunId, status: 'queued' },
      });

      repository.advanceValidation(uploadComplete.taskRunId);

      const uploadedResponse = await api.get(`${serverUrl}/sources/${created.sourceId}`, {
        headers: auth,
      });
      expect(uploadedResponse.status()).toBe(200);
      expect(await uploadedResponse.json()).toMatchObject({
        status: 'uploaded',
        taskRun: { taskRunId: uploadComplete.taskRunId, status: 'succeeded' },
      });

      const processResponse = await api.post(`${serverUrl}/sources/${created.sourceId}/process`, {
        headers: auth,
      });
      expect(processResponse.status()).toBe(202);
      const processing = (await processResponse.json()) as {
        source: { status: string };
        taskRunId: string;
      };
      expect(processing.source.status).toBe('queued');
      expect(processing.taskRunId).toEqual(expect.any(String));
      expect(publisher.messages.at(-1)?.taskType).toBe('source.analyze');
      expect(repository.taskRuns.get(processing.taskRunId)).toMatchObject({
        id: processing.taskRunId,
        status: 'queued',
        workspaceId: 'workspace-alpha',
      });
      const queuedResponse = await api.get(`${serverUrl}/sources/${created.sourceId}`, {
        headers: auth,
      });
      expect(await queuedResponse.json()).toMatchObject({
        status: 'queued',
        taskRun: { taskRunId: processing.taskRunId, status: 'queued' },
      });

      const otherAuth = { Authorization: `Bearer ${otherWorkspaceToken}` };
      const crossWorkspaceRead = await api.get(`${serverUrl}/sources/${created.sourceId}`, {
        headers: otherAuth,
      });
      expect(crossWorkspaceRead.status()).toBe(404);
      await expect(crossWorkspaceRead.json()).resolves.toMatchObject({ code: 'SOURCE_NOT_FOUND' });

      const crossWorkspaceProcess = await api.post(
        `${serverUrl}/sources/${created.sourceId}/process`,
        { headers: otherAuth },
      );
      expect(crossWorkspaceProcess.status()).toBe(404);
      await expect(crossWorkspaceProcess.json()).resolves.toMatchObject({
        code: 'SOURCE_NOT_FOUND',
      });

      const crossWorkspaceCancel = await api.post(
        `${serverUrl}/sources/${created.sourceId}/cancel`,
        { headers: otherAuth },
      );
      expect(crossWorkspaceCancel.status()).toBe(404);
      await expect(crossWorkspaceCancel.json()).resolves.toMatchObject({
        code: 'SOURCE_NOT_FOUND',
      });
      expect((await repository.findById('workspace-alpha', created.sourceId))?.status).toBe(
        'queued',
      );

      const cancelResponse = await api.post(`${serverUrl}/sources/${created.sourceId}/cancel`, {
        headers: auth,
      });
      expect(cancelResponse.status()).toBe(201);
      expect((await cancelResponse.json()).status).toBe('cancelled');
      expect(repository.taskRuns.get(processing.taskRunId)?.status).toBe('cancelled');
      expect(repository.taskRuns.get(uploadComplete.taskRunId)?.status).toBe('succeeded');
    } finally {
      await api.dispose();
    }
  });
});

function sourceKey(workspaceId: string, sourceId: string): string {
  return `${workspaceId}:${sourceId}`;
}

function toTaskRun(input: CreateSourceTaskRun): SourceTaskRunRecord {
  return { ...input, status: 'queued', attempt: 0 };
}

function membership(
  userId: string,
  workspaceId: string,
  role: MembershipRecord['role'],
): MembershipRecord {
  return {
    userId,
    workspaceId,
    role,
    workspace: { id: workspaceId, name: workspaceId, slug: workspaceId },
  };
}
