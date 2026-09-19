import type { AssetType, Platform } from './platform';

export interface ExportManifestAsset {
  readonly assetId: string;
  readonly platform: Platform;
  readonly assetType: AssetType;
  readonly title: string;
  readonly body: string;
  readonly tags: readonly string[];
  readonly cta: string;
  readonly mediaReferences: readonly string[];
}

export interface ExportManifestPlatform {
  readonly platform: Platform;
  readonly directory: string;
  readonly assetIds: readonly string[];
  readonly files: readonly string[];
}

export interface ExportManifest {
  readonly version: 1;
  readonly batchId: string;
  readonly sourceId: string;
  readonly generatedAt: string;
  readonly readmeFile: 'README.md';
  readonly manifestFile: 'manifest.json';
  readonly platforms: readonly ExportManifestPlatform[];
  readonly assets: readonly ExportManifestAsset[];
}

export interface CreateExportManifestInput {
  readonly batchId: string;
  readonly sourceId: string;
  readonly generatedAt: string;
  readonly platforms: readonly Platform[];
  readonly assets: readonly ExportManifestAsset[];
}

export function createExportManifest(input: CreateExportManifestInput): ExportManifest {
  return {
    version: 1,
    batchId: input.batchId,
    sourceId: input.sourceId,
    generatedAt: input.generatedAt,
    readmeFile: 'README.md',
    manifestFile: 'manifest.json',
    platforms: input.platforms.map((platform) => ({
      platform,
      directory: platform,
      assetIds: input.assets
        .filter((asset) => asset.platform === platform)
        .map((asset) => asset.assetId),
      files: ['publish-list.csv'],
    })),
    assets: input.assets,
  };
}
