// One-time (and whenever the session expires): opens Chrome with the bot's own profile
// so YOU sign in to Naukri by hand (password, OTP or Google). The bot never sees or stores
// credentials; it only reuses the session cookies kept in .profile/.
import { launchBrowser } from './browser.js';
import { loadConfig } from './util.js';

const cfg = loadConfig();
// Signing in always needs a visible window, even if the scheduled runs are headless.
process.env.NAUKRI_HEADLESS = '0';
const context = await launchBrowser(cfg, null);
const page = context.pages()[0] ?? (await context.newPage());
await page.goto('https://www.naukri.com/nlogin/login');
console.log('\nSign in to Naukri in the opened browser window.');
console.log('When your profile/home page is showing, just close the browser window.\n');
await new Promise<void>((resolve) => context.on('close', () => resolve()));
console.log('Session saved. You can now run: npm run dry');
