import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export type HostAddressResolver = (hostname: string) => Promise<readonly string[]>;

const isPublicIpv4 = (address: string): boolean => {
  const octets = address.split('.').map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return false;
  }

  const [first, second, third] = octets;
  if (first === undefined || second === undefined || third === undefined) return false;

  return !(
    first === 0 ||
    first === 10 ||
    first === 127 ||
    first >= 224 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0 && third === 0) ||
    (first === 192 && second === 0 && third === 2) ||
    (first === 192 && second === 88 && third === 99) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113)
  );
};

const expandIpv6 = (address: string): readonly number[] | undefined => {
  const normalized = address.toLowerCase();
  const separatorIndex = normalized.indexOf('::');
  const left = (separatorIndex < 0 ? normalized : normalized.slice(0, separatorIndex))
    .split(':')
    .filter(Boolean);
  const right =
    separatorIndex < 0
      ? []
      : normalized
          .slice(separatorIndex + 2)
          .split(':')
          .filter(Boolean);
  const missing = 8 - left.length - right.length;
  if ((separatorIndex < 0 && missing !== 0) || (separatorIndex >= 0 && missing < 1)) {
    return undefined;
  }

  const groups = [...left, ...Array.from({ length: missing }, () => '0'), ...right].map((group) =>
    Number.parseInt(group, 16),
  );
  return groups.length === 8 &&
    groups.every((group) => Number.isInteger(group) && group >= 0 && group <= 0xffff)
    ? groups
    : undefined;
};

const isPublicIpv6 = (address: string): boolean => {
  const groups = expandIpv6(address);
  if (!groups) return false;

  const first = groups[0];
  const second = groups[1];
  if (first === undefined || second === undefined || first < 0x2000 || first > 0x3fff) return false;

  // Exclude the non-global special-purpose ranges that commonly appear in tests and tunnels.
  return !(first === 0x2001 && (second <= 0x0002 || second === 0x0010 || second === 0x0db8));
};

const isPublicAddress = (address: string): boolean => {
  const addressType = isIP(address);
  return addressType === 4 ? isPublicIpv4(address) : addressType === 6 && isPublicIpv6(address);
};

const resolveHostAddresses: HostAddressResolver = async (hostname) => {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map(({ address }) => address);
};

export async function isPublicHttpsMediaUrl(
  value: string,
  resolver: HostAddressResolver = resolveHostAddresses,
): Promise<boolean> {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username.length > 0 || url.password.length > 0)
      return false;

    const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (isIP(hostname) !== 0) return isPublicAddress(hostname);
    if (
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname.endsWith('.local')
    ) {
      return false;
    }

    const addresses = await resolver(hostname);
    return addresses.length > 0 && addresses.every(isPublicAddress);
  } catch {
    return false;
  }
}
