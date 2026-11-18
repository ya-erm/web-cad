/** Best-effort iPad detection, including iPadOS Safari's desktop identity.
 * This identifies the tablet, not an attached Pencil: browsers report pens per pointer event.
 */
export function isIPad(device: Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'> | undefined = typeof navigator === 'undefined' ? undefined : navigator): boolean {
  if (!device) return false;
  return /iPad/i.test(device.userAgent) ||
    ((device.platform === 'MacIntel' || /Macintosh/i.test(device.userAgent)) && device.maxTouchPoints > 1);
}
