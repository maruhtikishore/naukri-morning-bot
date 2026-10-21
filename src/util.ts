import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PROFILE_DIR = process.env.NAUKRI_PROFILE_DIR ?? path.join(ROOT, '.profile');
export const DATA_DIR = path.join(ROOT, 'data');
export const REPORT_DIR = path.join(DATA_DIR, 'reports');
export const STATE_FILE = path.join(DATA_DIR, 'applied.json');

export interface Config {
  mode: 'dry' | 'apply';
  /** "chrome" uses installed Google Chrome; "chromium" uses Playwright's own build (Linux/Raspberry Pi). */
  browserChannel: string;
  headless: boolean;
  notify: { enabled: boolean };
  profile: { yearsExperience: number; experienceTolerance: number };
  search: { roles: string[]; locations: string[]; jobAgeDays: number; maxPagesPerSearch: number };
  filters: {
    titleMustMatch: string;
    titleExclude: string;
    minScore: number;
    /** A job must mention at least one of these terms to be considered a fit. */
    requireAny: string[];
    descriptionExclude: string[];
  };
  scoring: {
    positive: Record<string, number>;
    negative: Record<string, number>;
    /** Penalties that do not apply when the job also asks for Playwright (e.g. "Playwright or Selenium"). */
    playwrightShield: string[];
    /** Extra points when the term is in the job title itself. */
    titleBonus: Record<string, number>;
  };
  limits: {
    maxApplicationsPerDay: number;
    delayMinSeconds: number;
    delayMaxSeconds: number;
    maxConsecutiveFailures: number;
    /** Applications that needed the bot to answer recruiter questions (new, so kept low). */
    maxQuestionnaireApplicationsPerDay: number;
  };
}

export function loadConfig(): Config {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8')) as Config;
}

export type Status =
  | 'applied'
  | 'would-apply'
  | 'company-site'
  | 'needs-questions'
  | 'low-score'
  | 'already-applied'
  | 'filtered'
  | 'unknown'
  | 'error';

export interface JobRecord {
  id: string;
  title: string;
  company: string;
  location: string;
  experience: string;
  url: string;
  score?: number;
  matched?: string[];
  status: Status;
  note?: string;
  /** Recruiter questions the bot answered, exactly as sent. */
  qa?: { q: string; a: string }[];
  date: string;
}

export function loadState(): Record<string, JobRecord> {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STATE_FILE)) return {};
  return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
}

export function saveState(state: Record<string, JobRecord>): void {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

/** Local calendar date (not UTC), so reports and the daily cap follow your own day. */
export const today = (): string => {
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export const randomDelay = (minS: number, maxS: number): Promise<void> =>
  sleep((minS + Math.random() * (maxS - minS)) * 1000);

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');

/** Whole-term match so "java" does not hit "javascript". */
export function hasTerm(text: string, term: string): boolean {
  return new RegExp(`(^|[^a-z0-9+#])${esc(term)}($|[^a-z0-9+#])`, 'i').test(text);
}

export function score(text: string, cfg: Config, title = ''): { score: number; matched: string[] } {
  let total = 0;
  const matched: string[] = [];
  const wantsPlaywright = hasTerm(text, 'playwright');
  for (const [term, w] of Object.entries({ ...cfg.scoring.positive, ...cfg.scoring.negative })) {
    if (!hasTerm(text, term)) continue;
    if (w < 0 && wantsPlaywright && cfg.scoring.playwrightShield.includes(term)) {
      matched.push(`${term}(0, shielded by playwright)`);
      continue;
    }
    total += w;
    matched.push(`${term}(${w > 0 ? '+' : ''}${w})`);
  }
  for (const [term, bonus] of Object.entries(cfg.scoring.titleBonus)) {
    if (title && hasTerm(title, term)) {
      total += bonus;
      matched.push(`${term} in title(+${bonus})`);
    }
  }
  return { score: total, matched };
}

/** "2-4 Yrs" -> [2, 4]; returns null when it cannot be read. */
export function parseExperience(s: string): [number, number] | null {
  const m = s.match(/(\d+)\s*-\s*(\d+)/);
  return m ? [Number(m[1]), Number(m[2])] : null;
}
