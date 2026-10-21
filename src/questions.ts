// Answers Naukri's standard recruiter questions (notice period, CTC, experience, relocation) from
// YOUR facts in answers.local.json. Safety rules:
//  - Every question must match a known pattern with a value you supplied.
//  - An unknown question is answered with the form's own "Skip" option if it has one; otherwise the
//    bot gives up WITHOUT submitting (it never closes the form, which would send a half application).
//  - Tools/skills not listed in answers.local.json are never claimed.
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from 'playwright';
import { ROOT } from './util.js';

export interface Answers {
  facts: {
    noticePeriodDays: number;
    currentCtcLpa: number;
    expectedCtcLpa: number;
    totalExperienceYears: number;
    relocate: boolean;
    currentLocation: string;
  };
  generalTestingTerms: string[];
  toolExperienceYears: Record<string, number>;
}

export interface QA {
  q: string;
  a: string;
}

export interface QuestionnaireResult {
  finished: boolean;
  qa: QA[];
  reason?: string;
}

export function loadAnswers(): Answers | null {
  const file = path.join(ROOT, 'answers.local.json');
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as Answers) : null;
}

const BOX = '[class*="_chatBotContainer"]';
const OPTION = [
  `${BOX} label.mcc__label`,
  `${BOX} label[class*="ssrc__label"]`,
  `${BOX} label[class*="radio" i]`,
].join(', ');
const TEXT_INPUT = `${BOX} .textArea[contenteditable="true"]`;

const norm = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9+#. ]/g, ' ').replace(/\s+/g, ' ').trim();

interface Decision {
  text: string;
  pick?: (opts: string[]) => number | null;
}

function optionDays(t: string): number | null {
  const s = t.toLowerCase();
  if (/immediate/.test(s)) return 0;
  const m = s.match(/(\d+)\s*(day|week|month)/);
  if (!m) return null;
  const n = Number(m[1]);
  return /month/.test(m[2]) ? n * 30 : /week/.test(m[2]) ? n * 7 : n;
}

function pickRange(opts: string[], y: number): number | null {
  for (let i = 0; i < opts.length; i++) {
    const s = opts[i].toLowerCase();
    let lo: number | null = null;
    let hi: number | null = null;
    let m = s.match(/(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)/);
    if (m) [lo, hi] = [Number(m[1]), Number(m[2])];
    else if ((m = s.match(/(?:more than|above|over)\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*\+/))) [lo, hi] = [Number(m[1] ?? m[2]), Infinity];
    else if ((m = s.match(/(?:less than|below|under)\s*(\d+(?:\.\d+)?)/))) [lo, hi] = [0, Number(m[1])];
    if (lo !== null && hi !== null && y >= lo && y <= hi) return i;
  }
  return null;
}

function ctcDecision(lpa: number, q: string): Decision {
  const t = norm(q);
  const text = /lakh|lpa|lac/.test(t)
    ? String(lpa)
    : /rupee|inr|per annum|annual|₹/.test(q.toLowerCase())
      ? String(Math.round(lpa * 100000))
      : `${lpa} LPA`; // ambiguous wording: say the unit so a human reader cannot misread it
  return { text };
}

function experienceText(years: number, q: string): string {
  return /month/.test(q.toLowerCase()) ? String(Math.round(years * 12)) : String(years);
}

export function decide(q: string, a: Answers): Decision | null {
  const t = norm(q);
  const f = a.facts;

  if (/notice period/.test(t)) {
    return {
      text: /in days|days\)/.test(t) ? String(f.noticePeriodDays) : `${f.noticePeriodDays} days`,
      pick: (opts) => {
        const i = opts.findIndex((o) => optionDays(o) === f.noticePeriodDays);
        return i >= 0 ? i : null;
      },
    };
  }
  if (/(current|present).*(ctc|salary|compensation)|(ctc|salary|compensation).*(current|present)/.test(t)) {
    return ctcDecision(f.currentCtcLpa, q);
  }
  if (/expected.*(ctc|salary|compensation)|(ctc|salary|compensation).*expect|salary expectation/.test(t)) {
    return ctcDecision(f.expectedCtcLpa, q);
  }
  if (/relocat/.test(t)) {
    const want = f.relocate ? /^yes\b/i : /^no\b/i;
    return { text: f.relocate ? 'Yes' : 'No', pick: (opts) => { const i = opts.findIndex((o) => want.test(o.trim())); return i >= 0 ? i : null; } };
  }
  if (/(current|present).*(location|city)|where are you (currently )?(located|based)/.test(t)) {
    return { text: f.currentLocation };
  }
  if (/experience/.test(t)) {
    // Any experience question that names a subject ("... in Java", "... with Playwright") is checked
    // against your own list first; only the plain "total experience" question uses the total.
    const m = q.match(/experience\b[^?]*?\b(?:in|with|on|of|using)\s+(.+?)\s*[?.]?\s*$/i);
    let years: number | null = null;
    if (m) {
      const subject = norm(m[1]);
      const general = a.generalTestingTerms.some((g) => norm(g) === subject);
      const own = Object.entries(a.toolExperienceYears).find(([k]) => norm(k) === subject);
      years = general ? f.totalExperienceYears : own ? own[1] : null; // an unlisted tool is never claimed
    } else if (/(total|overall)|^how many years of (work |professional )?experience( do you have)?$/.test(t)) {
      years = f.totalExperienceYears;
    }
    if (years === null) return null;
    const y = years;
    return { text: experienceText(y, q), pick: (opts) => pickRange(opts, y) };
  }
  return null;
}

const visibleCount = (page: Page, sel: string): Promise<number> =>
  page.locator(sel).filter({ visible: true }).count().catch(() => 0);

async function botTexts(page: Page): Promise<string[]> {
  const all = await page.locator(`${BOX} .botItem`).allInnerTexts().catch(() => [] as string[]);
  return all.map((s) => s.trim()).filter((s) => s && !/thank you for showing interest/i.test(s));
}

async function clickSave(page: Page): Promise<void> {
  const save = page.locator(`${BOX} .sendMsg`).filter({ visible: true }).first();
  if (await save.count()) await save.click({ timeout: 4000 }).catch(() => undefined);
}

export async function answerQuestionnaire(
  page: Page,
  a: Answers,
  log: (m: string) => void,
): Promise<QuestionnaireResult> {
  const qa: QA[] = [];
  const asked = new Set<string>();
  const fail = (reason: string): QuestionnaireResult => ({ finished: false, qa, reason });

  for (let step = 0; step < 15; step++) {
    await page.waitForTimeout(2000);
    if ((await visibleCount(page, BOX)) === 0) return { finished: true, qa };

    const texts = await botTexts(page);
    const q = texts[texts.length - 1];
    if (!q) return fail('could not read the question');
    if (asked.has(q)) return fail(`the form did not move past: ${q}`);
    asked.add(q);

    const optLoc = page.locator(OPTION).filter({ visible: true });
    const opts = (await optLoc.allInnerTexts().catch(() => [] as string[])).map((s) => s.trim());
    const hasText = (await visibleCount(page, TEXT_INPUT)) > 0;
    const d = decide(q, a);

    if (!d) {
      const skip = opts.findIndex((o) => /^skip$/i.test(o));
      if (skip < 0) return fail(`no safe answer for: ${q}`);
      await optLoc.nth(skip).click();
      await clickSave(page);
      qa.push({ q, a: '(skipped)' });
      log(`  Q: ${q} -> skipped`);
      continue;
    }
    if (opts.length) {
      const i = d.pick ? d.pick(opts) : null;
      if (i === null) return fail(`no matching option for: ${q} [options: ${opts.slice(0, 6).join(' | ')}]`);
      await optLoc.nth(i).click();
      qa.push({ q, a: opts[i] });
    } else if (hasText) {
      const box = page.locator(TEXT_INPUT).first();
      await box.click();
      await page.keyboard.type(d.text, { delay: 40 });
      qa.push({ q, a: d.text });
    } else {
      return fail(`unrecognised input type for: ${q}`);
    }
    log(`  Q: ${q} -> ${qa[qa.length - 1].a}`);
    await clickSave(page);
  }
  return fail('too many questions');
}
