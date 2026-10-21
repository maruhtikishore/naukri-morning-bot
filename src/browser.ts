// One place that launches the bot's browser, so Windows, Linux and Raspberry Pi differ only by settings.
//   NAUKRI_BROWSER_CHANNEL  "chrome" (installed Google Chrome) or "chromium" (Playwright's own build)
//   NAUKRI_HEADLESS         "1" for no window (on a server prefer xvfb-run with the window instead)
//   NAUKRI_PROFILE_DIR      where the signed-in browser profile lives
import { chromium, type BrowserContext } from 'playwright';
import { PROFILE_DIR, type Config } from './util.js';

export function launchBrowser(
  cfg: Config,
  viewport: { width: number; height: number } | null,
): Promise<BrowserContext> {
  const channel = process.env.NAUKRI_BROWSER_CHANNEL ?? cfg.browserChannel;
  const headless = process.env.NAUKRI_HEADLESS ? process.env.NAUKRI_HEADLESS === '1' : cfg.headless;
  return chromium.launchPersistentContext(PROFILE_DIR, {
    ...(channel && channel !== 'chromium' ? { channel } : {}),
    headless,
    viewport,
  });
}
