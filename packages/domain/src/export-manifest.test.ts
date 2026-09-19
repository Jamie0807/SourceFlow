import { describe, expect, it } from 'vitest';

import { createExportManifest, type ExportManifestAsset, type Platform } from './index';

describe('export manifest types', () => {
  it('creates a manifest grouped by the selected platforms', () => {
    const asset: ExportManifestAsset = {
      assetId: 'asset-1',
      platform: 'douyin',
      assetType: 'platform_caption',
      title: 'A useful title',
      body: 'A useful caption',
      tags: ['sourceflow'],
      cta: 'Learn more',
      mediaReferences: ['source-1'],
    };
    const platforms: Platform[] = ['douyin', 'xiaohongshu'];

    const manifest = createExportManifest({
      batchId: 'batch-1',
      sourceId: 'source-1',
      generatedAt: '2026-09-19T00:00:00.000Z',
      platforms,
      assets: [asset],
    });

    expect(manifest).toMatchObject({
      version: 1,
      batchId: 'batch-1',
      sourceId: 'source-1',
      platforms: [
        { platform: 'douyin', directory: 'douyin' },
        { platform: 'xiaohongshu', directory: 'xiaohongshu' },
      ],
      assets: [asset],
    });
  });
});
