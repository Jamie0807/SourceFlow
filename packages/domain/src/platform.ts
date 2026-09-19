export type Platform = 'douyin' | 'xiaohongshu' | 'wechat_channels';

export type PlatformPublishMode = 'automatic' | 'assisted' | 'export-only';

export interface PlatformCapability {
  readonly platform: Platform;
  readonly publish: PlatformPublishMode;
  readonly analytics: boolean;
  readonly comments: boolean;
  readonly media: {
    readonly ratios: readonly string[];
    readonly maxDurationSeconds?: number;
  };
  readonly limits: {
    readonly titleMax?: number;
    readonly bodyMax?: number;
    readonly hashtagsMax?: number;
  };
}

export const PLATFORM_CAPABILITIES: Readonly<Record<Platform, PlatformCapability>> = {
  douyin: {
    platform: 'douyin',
    publish: 'export-only',
    analytics: false,
    comments: false,
    media: { ratios: ['9:16', '1:1'], maxDurationSeconds: 60 * 60 },
    limits: { titleMax: 55, bodyMax: 2_000, hashtagsMax: 5 },
  },
  xiaohongshu: {
    platform: 'xiaohongshu',
    publish: 'export-only',
    analytics: false,
    comments: false,
    media: { ratios: ['3:4', '1:1', '16:9'], maxDurationSeconds: 60 * 60 },
    limits: { titleMax: 20, bodyMax: 1_000, hashtagsMax: 10 },
  },
  wechat_channels: {
    platform: 'wechat_channels',
    publish: 'export-only',
    analytics: false,
    comments: false,
    media: { ratios: ['16:9', '9:16', '1:1'], maxDurationSeconds: 60 * 60 },
    limits: { titleMax: 32, bodyMax: 2_000, hashtagsMax: 10 },
  },
};

export const ASSET_TYPES = [
  'short_video_script',
  'platform_caption',
  'title',
  'cover_title',
  'hashtags',
  'cta',
] as const;

export type AssetType = (typeof ASSET_TYPES)[number];

export function getPlatformCapability(platform: Platform): PlatformCapability {
  return PLATFORM_CAPABILITIES[platform];
}
