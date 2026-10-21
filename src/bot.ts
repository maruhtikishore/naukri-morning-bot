// Naukri morning bot: search -> filter -> score -> (optionally) apply, with guardrails.
//   npm run dry     search + score only, nothing is clicked
//   npm run apply   also clicks Naukri's own "Apply" on jobs that pass every filter
//   npm run run     uses "mode" from config.json (this is what the scheduled task runs)
import fs from 'node:fs';
import path from 'node:path';
import { type BrowserContext, type Page } from 'playwright';
import { launchBrowser } from './browser.js';
import { buildSummary, sendWhatsApp } from './notify.js';
import { answerQuestionnaire, loadAnswers, type QA } from './questions.js';
import {
  hasTerm,
  DATA_DIR,
  REPORT_DIR,
  loadConfig,
  loadState,
  parseExperience,
  randomDelay,
  saveState,
  score,
  today,
  type Config,
  type JobRecord,
  type Status,
} from './util.js';

const cfg: Config = loadConfig();
const flagApply = process.argv.includes('--apply');
const flagDry = process.argv.includes('--dry');
const APPLY = flagApply ? true : flagDry ? false : cfg.mode === 'apply';

const LOG_DIR = path.join(DATA_DIR, 'logs');
fs.mkdirSync(LOG_DIR, { recursive: true });
fs.mkdirSync(REPORT_DIR, { recursive: true });
const logFile = path.join(LOG_DIR, `${today()}.log`);
const log = (msg: string): void => {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(logFile, line + '\n');
};

/** Thrown for anything that should end the whole run (login wall, CAPTCHA, block). */
class AbortRun extends Error {}

interface Card {
  id: string;
  title: string;
  company: string;
  location: string;
  experience: string;
  url: string;
  posted: string;
}

async function assertNotBlocked(page: Page): Promise<void> {
  const url = page.url();
  if (/nlogin|\/login/i.test(url)) {
    throw new AbortRun('Naukri asked for login. Session expired: run "npm run login" again.');
  }
  const body = ((await page.locator('body').innerText({ timeout: 5000 }).catch(() => '')) || '').slice(0, 4000);
  if (/captcha|verify you are human|are you a robot|unusual traffic|access denied/i.test(body)) {
    throw new AbortRun('Naukri showed a CAPTCHA / bot check. Stopping. The bot will not try to bypass it.');
  }
}

const searchUrl = (role: string, loc: string, pageNo: number): string => {
  const slug = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, '-');
  const base = `https://www.naukri.com/${slug(role)}-jobs-in-${slug(loc)}${pageNo > 1 ? `-${pageNo}` : ''}`;
  const exp = Math.round(cfg.profile.yearsExperience);
  return `${base}?experience=${exp}&jobAge=${cfg.search.jobAgeDays}`;
};

async function readCards(page: Page): Promise<Card[]> {
  return page.$$eval('.srp-jobtuple-wrapper', (nodes) =>
    nodes.map((n) => {
      // No nested named helpers here: this runs inside the page, where tsx's __name shim is missing.
      const a = n.querySelector('a.title') as HTMLAnchorElement | null;
      return {
        id: (n as HTMLElement).dataset.jobId ?? '',
        title: a?.textContent?.trim() ?? '',
        company: n.querySelector('.comp-name')?.textContent?.trim() ?? '',
        location: n.querySelector('.locWdth')?.textContent?.trim() ?? '',
        experience: n.querySelector('.expwdth')?.textContent?.trim() ?? '',
        url: a?.href ?? '',
        posted: n.querySelector('.job-post-day')?.textContent?.trim() ?? '',
      };
    }),
  );
}

function prefilter(c: Card): string | null {
  if (!c.id || !c.url) return 'unreadable card';
  if (!new RegExp(cfg.filters.titleMustMatch, 'i').test(c.title)) return 'title not a testing/QA role';
  if (new RegExp(cfg.filters.titleExclude, 'i').test(c.title)) return 'title excluded (level/other role)';
  const range = parseExperience(c.experience);
  if (range) {
    const y = cfg.profile.yearsExperience;
    const tol = cfg.profile.experienceTolerance;
    if (range[0] > y + tol) return `needs ${range[0]}+ yrs`;
    if (range[1] < Math.floor(y)) return `max ${range[1]} yrs (too junior)`;
  }
  return null;
}

async function collectCandidates(page: Page, seen: Set<string>): Promise<{ cards: Card[]; skipped: Record<string, string> }> {
  const cards: Card[] = [];
  const skipped: Record<string, string> = {};
  for (const role of cfg.search.roles) {
    for (const loc of cfg.search.locations) {
      for (let p = 1; p <= cfg.search.maxPagesPerSearch; p++) {
        const url = searchUrl(role, loc, p);
        log(`search: ${role} / ${loc} / page ${p}`);
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await assertNotBlocked(page);
        const found = await page
          .waitForSelector('.srp-jobtuple-wrapper', { timeout: 15000 })
          .then(() => true)
          .catch(() => false);
        if (!found) break;
        const list = await readCards(page);
        for (const c of list) {
          if (seen.has(c.id)) continue;
          seen.add(c.id);
          const why = prefilter(c);
          if (why) skipped[c.id] = why;
          else cards.push(c);
        }
        await randomDelay(2, 5);
      }
    }
  }
  return { cards, skipped };
}

async function jobText(page: Page): Promise<string> {
  const desc = await page.locator('[class*="dang-inner-html"]').first().innerText({ timeout: 8000 }).catch(() => '');
  const tags = await page.locator('[class*="key-skill"] a, [class*="chip"]').allInnerTexts().catch(() => []);
  const title = await page.title();
  return `${title}\n${desc}\n${tags.join(' ')}`;
}

let stateRef: Record<string, JobRecord> = {};

interface ApplyOutcome {
  status: Status;
  note?: string;
  qa?: QA[];
}

async function tryApply(page: Page, jobUrl: string): Promise<ApplyOutcome> {
  const btn = page.locator('#apply-button').first();
  await btn.scrollIntoViewIfNeeded();
  await btn.click();
  await page.waitForTimeout(3500);
  await assertNotBlocked(page);

  // Extra questions / chatbot drawer: the bot never answers on your behalf.
  // The page keeps hidden chatbot nodes around, so .first() can be a hidden one: count visible matches.
  const visibleQuestionUi = await page
    .locator('[class*="chatbot" i], [class*="questionnaire" i], [id*="chatbot" i]')
    .filter({ visible: true })
    .count()
    .catch(() => 0);
  const bodyText = (await page.locator('body').innerText().catch(() => '')).slice(0, 6000);
  // Naukri sometimes sends the application first and only then shows OPTIONAL recruiter questions, so a
  // visible question form does not mean "not applied". Whatever happens, ask Naukri itself at the end.
  const confirmApplied = async (): Promise<boolean> => {
    await page.goto(jobUrl, { waitUntil: 'domcontentloaded' });
    await assertNotBlocked(page);
    await page.waitForSelector('#apply-button, #already-applied, #company-site-button', { timeout: 12000 }).catch(() => undefined);
    return page.locator('#already-applied').first().isVisible().catch(() => false);
  };

  let qa: QA[] | undefined;
  let gaveUp: string | null = null;
  if (visibleQuestionUi > 0) {
    const answers = loadAnswers();
    const usedToday = Object.values(stateRef).filter((r) => r.date === today() && r.qa?.length).length;
    if (!answers) {
      gaveUp = 'recruiter questions need answering by hand';
    } else if (usedToday >= cfg.limits.maxQuestionnaireApplicationsPerDay) {
      gaveUp = 'daily limit for question-answering applications reached';
    } else {
      log('recruiter questions detected: answering only from answers.local.json');
      const r = await answerQuestionnaire(page, answers, log);
      qa = r.qa;
      if (!r.finished) gaveUp = r.reason ?? 'could not answer every question';
    }
  } else if (
    /answer all the recruiter'?s questions|not accepted due to incomplete information|mandatory questions/i.test(bodyText)
  ) {
    gaveUp = 'recruiter questions need answering by hand';
  }

  const confirmed = await confirmApplied();
  if (gaveUp) {
    // We left the form unanswered (never closed it). Report what Naukri actually shows.
    return confirmed
      ? { status: 'applied', note: `Applied; optional recruiter questions left unanswered (${gaveUp}).`, qa }
      : { status: 'needs-questions', note: `Not submitted: ${gaveUp}.`, qa };
  }
  if (confirmed) return { status: 'applied', qa };
  return { status: 'unknown', note: 'Clicked Apply but the job page does not show "Applied".', qa };
}

async function processJob(page: Page, c: Card): Promise<JobRecord> {
  const rec: JobRecord = { ...c, status: 'unknown', date: today() };
  await page.goto(c.url, { waitUntil: 'domcontentloaded' });
  await assertNotBlocked(page);
  await page.waitForSelector('#apply-button, #company-site-button, #already-applied', { timeout: 12000 }).catch(() => undefined);

  if (await page.locator('#already-applied, button:has-text("Applied")').first().isVisible().catch(() => false)) {
    return { ...rec, status: 'already-applied' };
  }
  const text = await jobText(page);
  const s = score(`${c.title}\n${text}`, cfg, c.title);
  rec.score = s.score;
  rec.matched = s.matched;

  const fullText = `${c.title}\n${text}`;
  const hasCoreSkill = cfg.filters.requireAny.some((t) => hasTerm(fullText, t));
  const blocked = cfg.filters.descriptionExclude.find((t) => hasTerm(fullText, t));
  if (!hasCoreSkill || blocked) {
    return {
      ...rec,
      status: 'low-score',
      note: blocked ? `contains excluded term "${blocked}"` : 'mentions none of your core skills',
    };
  }

  if (await page.locator('#company-site-button').first().isVisible().catch(() => false)) {
    return { ...rec, status: s.score >= cfg.filters.minScore ? 'company-site' : 'low-score', note: 'Applies on company site (manual).' };
  }
  if (s.score < cfg.filters.minScore) return { ...rec, status: 'low-score' };
  if (!(await page.locator('#apply-button').first().isVisible().catch(() => false))) {
    // Walk-ins, closed or expired jobs: nothing to click, and not a failure.
    return { ...rec, status: 'filtered', note: 'No Apply button on the page (walk-in, closed or expired).' };
  }
  if (!APPLY) return { ...rec, status: 'would-apply' };
  const r = await tryApply(page, c.url);
  return { ...rec, ...r };
}

function writeReport(records: JobRecord[], skipped: Record<string, string>, notes: string[]): string {
  const by = (s: Status): JobRecord[] => records.filter((r) => r.status === s);
  const cell = (s: string): string => s.replace(/\|/g, '/');
  const row = (r: JobRecord): string =>
    `| ${cell(r.title)} | ${cell(r.company)} | ${cell(r.location)} | ${r.experience} | ${r.score ?? ''} | [open](${r.url}) |`;
  const table = (list: JobRecord[]): string =>
    list.length
      ? ['| Title | Company | Location | Exp | Score | Link |', '|---|---|---|---|---|---|', ...list.map(row)].join('\n')
      : '_none_';
  const md = [
    `# Naukri morning report - ${today()}`,
    `Mode: **${APPLY ? 'APPLY' : 'DRY RUN (nothing was clicked)'}**`,
    ...notes.map((n) => `> ${n}`),
    '',
    `## Applied (${by('applied').length})`,
    table(by('applied')),
    '',
    `## Would apply - dry run (${by('would-apply').length})`,
    table(by('would-apply')),
    '',
    `## Apply manually: company site (${by('company-site').length})`,
    table(by('company-site')),
    '',
    `## Apply manually: needs recruiter questions (${by('needs-questions').length})`,
    table(by('needs-questions')),
    '',
    `## Unconfirmed / errors (${by('unknown').length + by('error').length})`,
    table([...by('unknown'), ...by('error')]),
    '',
    `## Skipped: low fit score (${by('low-score').length})`,
    table(by('low-score')),
    '',
    '## Answers sent to recruiters (from answers.local.json)',
    records.filter((r) => r.qa?.length).length
      ? records
          .filter((r) => r.qa?.length)
          .map((r) => `**${cell(r.title)} @ ${cell(r.company)}** (${r.status})\n` + r.qa!.map((x) => `- ${x.q} -> ${x.a}`).join('\n'))
          .join('\n\n')
      : '_none_',
    '',
    `Already applied earlier: ${by('already-applied').length}. No Apply button (walk-in/closed): ${by('filtered').length}. Filtered before opening: ${Object.keys(skipped).length}.`,
  ].join('\n');
  const file = path.join(REPORT_DIR, `${today()}.md`);
  fs.writeFileSync(file, md);
  return file;
}

async function main(): Promise<void> {
  log(`=== Naukri bot start | mode=${APPLY ? 'APPLY' : 'DRY'} ===`);
  const state = loadState();
  stateRef = state;
  const seen = new Set<string>(Object.keys(state).filter((k) => state[k].status !== 'would-apply'));
  const records: JobRecord[] = [];
  const notes: string[] = [];
  let skipped: Record<string, string> = {};

  const context: BrowserContext = await launchBrowser(cfg, { width: 1366, height: 850 });
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto('https://www.naukri.com/mnjuser/homepage', { waitUntil: 'domcontentloaded' });
    await assertNotBlocked(page);

    const collected = await collectCandidates(page, seen);
    skipped = collected.skipped;
    log(`candidates after prefilter: ${collected.cards.length} (filtered out: ${Object.keys(skipped).length})`);

    const todaysApplied = Object.values(state).filter((r) => r.status === 'applied' && r.date === today()).length;
    let applied = todaysApplied;
    let failures = 0;

    for (const c of collected.cards) {
      if (APPLY && applied >= cfg.limits.maxApplicationsPerDay) {
        notes.push(`Daily cap of ${cfg.limits.maxApplicationsPerDay} applications reached.`);
        log('daily cap reached, stopping');
        break;
      }
      try {
        const rec = await processJob(page, c);
        records.push(rec);
        state[rec.id] = rec;
        log(`${rec.status.padEnd(15)} ${String(rec.score ?? '-').padStart(3)}  ${rec.title} @ ${rec.company}`);
        if (rec.status === 'applied') {
          applied++;
          failures = 0;
        } else if (rec.status === 'unknown' || rec.status === 'error') {
          failures++;
        }
        if (failures >= cfg.limits.maxConsecutiveFailures) {
          throw new AbortRun(`${failures} unconfirmed applies in a row. Stopping so nothing goes wrong silently.`);
        }
      } catch (e) {
        if (e instanceof AbortRun) throw e;
        const rec: JobRecord = { ...c, status: 'error', note: String(e).slice(0, 200), date: today() };
        records.push(rec);
        log(`error           ${c.title} @ ${c.company}: ${rec.note}`);
        failures++;
      }
      await randomDelay(cfg.limits.delayMinSeconds, cfg.limits.delayMaxSeconds);
    }
  } catch (e) {
    if (e instanceof AbortRun) {
      notes.push(`RUN STOPPED: ${e.message}`);
      log(`ABORT: ${e.message}`);
    } else {
      notes.push(`Unexpected failure: ${String(e)}`);
      log(`FAILED: ${String(e)}`);
    }
  } finally {
    saveState(state);
    const file = writeReport(records, skipped, notes);
    log(`report: ${file}`);
    await context.close();
    if (cfg.notify.enabled) {
      const sent = await sendWhatsApp(buildSummary(records, notes, APPLY ? 'APPLY' : 'DRY RUN', file));
      log(`phone summary: ${sent.ok ? 'sent' : 'NOT sent'} (${sent.detail})`);
    }
  }
}

await main();
