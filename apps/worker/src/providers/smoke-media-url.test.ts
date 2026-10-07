import { describe, expect, it, vi } from 'vitest';

import { isPublicHttpsMediaUrl } from './smoke-media-url.js';

describe('isPublicHttpsMediaUrl', () => {
  it.each([
    'http://media.example.test/a.mp4',
    'https://user@media.example.test/a.mp4',
    'https://127.0.0.1/a.mp4',
    'https://169.254.1.2/a.mp4',
    'https://[::1]/a.mp4',
    'https://[fd00::1]/a.mp4',
    'https://[fe80::1]/a.mp4',
    'https://[2001:db8::1]/a.mp4',
    'https://[2001:2::1]/a.mp4',
    'https://[2001:10::1]/a.mp4',
    'https://0.1.2.3/a.mp4',
    'https://10.1.2.3/a.mp4',
    'https://100.64.0.1/a.mp4',
    'https://100.127.0.1/a.mp4',
    'https://127.1.2.3/a.mp4',
    'https://169.254.1.2/a.mp4',
    'https://172.16.0.1/a.mp4',
    'https://172.31.0.1/a.mp4',
    'https://192.0.0.1/a.mp4',
    'https://192.0.2.1/a.mp4',
    'https://192.88.99.1/a.mp4',
    'https://192.168.1.1/a.mp4',
    'https://198.18.0.1/a.mp4',
    'https://198.19.0.1/a.mp4',
    'https://198.51.100.1/a.mp4',
    'https://203.0.113.1/a.mp4',
    'https://224.0.0.1/a.mp4',
    'https://240.0.0.1/a.mp4',
    'https://172.16.0.1/a.mp4',
    'https://172.31.255.255/a.mp4',
    'https://198.18.255.255/a.mp4',
    'https://198.19.0.1/a.mp4',
    'https://[2001:0::1]/a.mp4',
  ])('拒绝非公网或不安全 URL：%s', async (url) => {
    await expect(isPublicHttpsMediaUrl(url, vi.fn())).resolves.toBe(false);
  });

  it.each(['localhost', 'asset.localhost', 'router.local'])('拒绝本地域名：%s', async (host) => {
    const resolver = vi.fn(async () => ['8.8.8.8']);

    await expect(isPublicHttpsMediaUrl(`https://${host}/a.mp4`, resolver)).resolves.toBe(false);
    expect(resolver).not.toHaveBeenCalled();
  });

  it('拒绝解析到私有地址的域名', async () => {
    const resolver = vi.fn(async () => ['203.0.113.9', '10.0.0.4']);

    await expect(isPublicHttpsMediaUrl('https://media.example.test/a.mp4', resolver)).resolves.toBe(
      false,
    );
    expect(resolver).toHaveBeenCalledWith('media.example.test');
  });

  it('接受解析结果全部为公网地址的 HTTPS 域名', async () => {
    const resolver = vi.fn(async () => ['8.8.8.8', '2606:4700:4700::1111']);

    await expect(
      isPublicHttpsMediaUrl('https://media.example.test/a.mp4?signature=short-lived', resolver),
    ).resolves.toBe(true);
  });

  it.each(['8.8.8.8', '172.15.0.1', '172.32.0.1', '100.63.255.255', '100.128.0.1'])(
    '接受公网 IPv4 字面量：%s',
    async (address) => {
      await expect(isPublicHttpsMediaUrl(`https://${address}/a.mp4`)).resolves.toBe(true);
    },
  );

  it('接受公网 IPv6 字面量', async () => {
    await expect(isPublicHttpsMediaUrl('https://[2606:4700:4700::1111]/a.mp4')).resolves.toBe(true);
  });

  it('DNS 无结果或解析失败时安全拒绝', async () => {
    await expect(
      isPublicHttpsMediaUrl('https://media.example.test/a.mp4', async () => []),
    ).resolves.toBe(false);
    await expect(
      isPublicHttpsMediaUrl('https://media.example.test/a.mp4', async () => {
        throw new Error('resolver details must not escape');
      }),
    ).resolves.toBe(false);
  });
});
