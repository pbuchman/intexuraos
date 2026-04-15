/**
 * Detects if the device is a Xiaomi/HyperOS/MIUI device based on user agent.
 * These devices aggressively kill background PWA processes.
 */
export function isXiaomiDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /Xiaomi|MIUI|HyperOS|Redmi|POCO/i.test(ua);
}
