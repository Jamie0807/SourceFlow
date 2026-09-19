import { describe, expect, it } from 'vitest';

import {
  ASSET_TYPES,
  PLATFORM_CAPABILITIES,
  getPlatformCapability,
  type AssetType,
  type Platform,
} from './index';

describe('platform capabilities', () => {
  it.each<Platform>(['douyin', 'xiaohongshu', 'wechat_channels'])(
    'defines an export capability card for %s',
    (platform) => {
      const capability = PLATFORM_CAPABILITIES[platform];

      expect(capability.platform).toBe(platform);
      expect(capability.publish).toBe('export-only');
      expect(capability.analytics).toBe(false);
      expect(capability.comments).toBe(false);
      expect(capability.media.ratios.length).toBeGreaterThan(0);
      expect(capability.limits).toBeDefined();
    },
  );

  it('exposes the supported generated asset types', () => {
    const expected: AssetType[] = [
      'short_video_script',
      'platform_caption',
      'title',
      'cover_title',
      'hashtags',
      'cta',
    ];

    expect(ASSET_TYPES).toEqual(expected);
    expect(getPlatformCapability('douyin')).toEqual(PLATFORM_CAPABILITIES.douyin);
  });
});
