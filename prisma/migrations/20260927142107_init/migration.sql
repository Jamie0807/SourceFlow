-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('owner', 'editor', 'reviewer');

-- CreateEnum
CREATE TYPE "SourceStatus" AS ENUM ('created', 'uploading', 'uploaded', 'queued', 'processing', 'succeeded', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "ContentBatchStatus" AS ENUM ('draft', 'generating', 'needs_review', 'approved', 'exportable', 'exported', 'generation_failed', 'export_failed', 'cancelled');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('draft', 'needs_review', 'needs_changes', 'approved', 'exported');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('needs_review', 'needs_changes', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "ExportJobStatus" AS ENUM ('queued', 'processing', 'succeeded', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "TaskRunStatus" AS ENUM ('queued', 'processing', 'succeeded', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('douyin', 'xiaohongshu', 'wechat', 'bilibili', 'weibo', 'kuaishou', 'youtube', 'instagram', 'tiktok', 'facebook', 'linkedin', 'x');

-- CreateEnum
CREATE TYPE "AssetType" AS ENUM ('short_video', 'image_post', 'text_post', 'carousel', 'live_script');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "displayName" TEXT,
    "isTestData" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "isTestData" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceMember" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'editor',
    "isTestData" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Brand" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isTestData" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Source" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "brandId" TEXT,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "durationSeconds" INTEGER,
    "contentHash" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "status" "SourceStatus" NOT NULL DEFAULT 'created',
    "deletedAt" TIMESTAMP(3),
    "isTestData" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TranscriptSegment" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "segmentIndex" INTEGER NOT NULL,
    "startMs" INTEGER NOT NULL,
    "endMs" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "speaker" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TranscriptSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentInsight" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceVersion" INTEGER NOT NULL DEFAULT 1,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "requestVersion" TEXT NOT NULL,
    "providerMetadata" JSONB NOT NULL,
    "chapters" JSONB NOT NULL,
    "keyPoints" JSONB NOT NULL,
    "quotes" JSONB NOT NULL,
    "candidateClips" JSONB NOT NULL,
    "riskFlags" JSONB NOT NULL,
    "assetReferences" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentInsight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentBatch" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sourceId" TEXT,
    "createdById" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "ContentBatchStatus" NOT NULL DEFAULT 'draft',
    "targetPlatforms" JSONB NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "contentBatchId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "assetType" "AssetType" NOT NULL,
    "status" "AssetStatus" NOT NULL DEFAULT 'draft',
    "currentVersionNumber" INTEGER NOT NULL DEFAULT 1,
    "title" TEXT,
    "body" TEXT,
    "tags" JSONB NOT NULL,
    "cta" TEXT,
    "mediaReferences" JSONB NOT NULL,
    "sourceReferences" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetVersion" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "createdById" TEXT NOT NULL,
    "title" TEXT,
    "body" TEXT,
    "tags" JSONB NOT NULL,
    "cta" TEXT,
    "mediaReferences" JSONB NOT NULL,
    "sourceReferences" JSONB NOT NULL,
    "changeSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssetVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewAction" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "fromStatus" "ReviewStatus" NOT NULL,
    "toStatus" "ReviewStatus" NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExportJob" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "contentBatchId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "status" "ExportJobStatus" NOT NULL DEFAULT 'queued',
    "idempotencyKey" TEXT NOT NULL,
    "outputStorageKey" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "taskType" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "TaskRunStatus" NOT NULL DEFAULT 'queued',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "payload" JSONB NOT NULL,
    "result" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_slug_key" ON "Workspace"("slug");

-- CreateIndex
CREATE INDEX "WorkspaceMember_workspaceId_idx" ON "WorkspaceMember"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceMember_workspaceId_userId_key" ON "WorkspaceMember"("workspaceId", "userId");

-- CreateIndex
CREATE INDEX "Brand_workspaceId_idx" ON "Brand"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Brand_workspaceId_name_key" ON "Brand"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "Source_workspaceId_idx" ON "Source"("workspaceId");

-- CreateIndex
CREATE INDEX "Source_workspaceId_status_idx" ON "Source"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Source_workspaceId_contentHash_key" ON "Source"("workspaceId", "contentHash");

-- CreateIndex
CREATE INDEX "TranscriptSegment_workspaceId_idx" ON "TranscriptSegment"("workspaceId");

-- CreateIndex
CREATE INDEX "TranscriptSegment_workspaceId_sourceId_idx" ON "TranscriptSegment"("workspaceId", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "TranscriptSegment_sourceId_segmentIndex_key" ON "TranscriptSegment"("sourceId", "segmentIndex");

-- CreateIndex
CREATE INDEX "ContentInsight_workspaceId_idx" ON "ContentInsight"("workspaceId");

-- CreateIndex
CREATE INDEX "ContentInsight_workspaceId_sourceId_idx" ON "ContentInsight"("workspaceId", "sourceId");

-- CreateIndex
CREATE INDEX "ContentBatch_workspaceId_idx" ON "ContentBatch"("workspaceId");

-- CreateIndex
CREATE INDEX "ContentBatch_workspaceId_status_idx" ON "ContentBatch"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ContentBatch_workspaceId_idempotencyKey_key" ON "ContentBatch"("workspaceId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "Asset_workspaceId_idx" ON "Asset"("workspaceId");

-- CreateIndex
CREATE INDEX "Asset_workspaceId_status_idx" ON "Asset"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_contentBatchId_platform_assetType_key" ON "Asset"("contentBatchId", "platform", "assetType");

-- CreateIndex
CREATE INDEX "AssetVersion_workspaceId_idx" ON "AssetVersion"("workspaceId");

-- CreateIndex
CREATE INDEX "AssetVersion_workspaceId_assetId_idx" ON "AssetVersion"("workspaceId", "assetId");

-- CreateIndex
CREATE UNIQUE INDEX "AssetVersion_assetId_versionNumber_key" ON "AssetVersion"("assetId", "versionNumber");

-- CreateIndex
CREATE INDEX "ReviewAction_workspaceId_idx" ON "ReviewAction"("workspaceId");

-- CreateIndex
CREATE INDEX "ReviewAction_workspaceId_assetId_idx" ON "ReviewAction"("workspaceId", "assetId");

-- CreateIndex
CREATE INDEX "ExportJob_workspaceId_idx" ON "ExportJob"("workspaceId");

-- CreateIndex
CREATE INDEX "ExportJob_workspaceId_status_idx" ON "ExportJob"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ExportJob_workspaceId_idempotencyKey_key" ON "ExportJob"("workspaceId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "TaskRun_workspaceId_idx" ON "TaskRun"("workspaceId");

-- CreateIndex
CREATE INDEX "TaskRun_workspaceId_status_idx" ON "TaskRun"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TaskRun_workspaceId_idempotencyKey_key" ON "TaskRun"("workspaceId", "idempotencyKey");
