// Installing the app: the browser's offer, the dialog it shows once, the installed app's window; the manifest's icons
// that browsers need to offer the installation at all.

import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { initInstall, installApp, installState } from './pwa';

function fakeWindow(display = 'browser', iosStandalone = false) {
  const target = new EventTarget();
  const w = {
    addEventListener: target.addEventListener.bind(target),
    matchMedia: (q: string) => ({ matches: q === `(display-mode: ${display})`, addEventListener() {} }),
    navigator: iosStandalone ? { standalone: true } : {},
  };
  initInstall(w as never);
  return (e: Event) => target.dispatchEvent(e);
}

function offer(outcome: 'accepted' | 'dismissed') {
  const e = Object.assign(new Event('beforeinstallprompt'), {
    prompt: vi.fn(async () => {}),
    userChoice: Promise.resolve({ outcome }),
  });
  return e;
}

describe('install the app', () => {
  it('no offer from the browser: the help tells how', async () => {
    fakeWindow();
    expect(installState()).toBe('manual');
    expect(await installApp()).toBe('unavailable');
  });

  it("the browser's offer: one dialog, then installed", async () => {
    const fire = fakeWindow();
    const e = offer('accepted');
    fire(e);
    expect(installState()).toBe('available');
    expect(await installApp()).toBe('accepted');
    expect(e.prompt).toHaveBeenCalledTimes(1);
    // the offer is used up
    expect(await installApp()).toBe('unavailable');
    fire(new Event('appinstalled'));
    expect(installState()).toBe('installed');
  });

  it('dismissed: no offer left', async () => {
    const fire = fakeWindow();
    fire(offer('dismissed'));
    expect(await installApp()).toBe('dismissed');
    expect(installState()).toBe('manual');
  });

  it("the app's own window", () => {
    fakeWindow('standalone');
    expect(installState()).toBe('installed');
    fakeWindow('window-controls-overlay');
    expect(installState()).toBe('installed');
    fakeWindow('browser', true);
    expect(installState()).toBe('installed');
    fakeWindow('fullscreen');
    expect(installState()).toBe('manual');
  });
});

describe('manifest', () => {
  const pub = (f: string) => new URL(`../public/${f}`, import.meta.url);
  /** A PNG's width and height (its IHDR). */
  const pngSize = (f: string) => {
    const b = readFileSync(pub(f));
    expect(b.subarray(1, 4).toString()).toBe('PNG');
    return [b.readUInt32BE(16), b.readUInt32BE(20)];
  };

  it('PNG icons 192 and 512 (and a maskable one): browsers offer to install with them', () => {
    const m = JSON.parse(readFileSync(pub('manifest.webmanifest'), 'utf8')) as { display: string; start_url: string; icons: { src: string; sizes: string; type: string; purpose?: string }[] };
    expect(m.display).toBe('standalone');
    expect(m.start_url).toBeTruthy();
    for (const size of ['192x192', '512x512']) expect(m.icons.some((i) => i.sizes === size && i.type === 'image/png' && i.purpose !== 'maskable')).toBe(true);
    expect(m.icons.some((i) => i.purpose === 'maskable')).toBe(true);
    for (const i of m.icons.filter((x) => x.type === 'image/png')) expect(pngSize(i.src).join('x')).toBe(i.sizes);
  });

  it("iOS's home screen icon", () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    expect(html).toContain('rel="apple-touch-icon" href="./apple-touch-icon.png"');
    expect(pngSize('apple-touch-icon.png')).toEqual([180, 180]);
  });
});
