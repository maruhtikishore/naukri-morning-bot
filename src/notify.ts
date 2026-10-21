// Sends the morning summary to your phone over WhatsApp using Green API.
// Credentials come from environment variables (good for a Pi/server) or notify.local.json:
//   NOTIFY_API_URL, NOTIFY_ID_INSTANCE, NOTIFY_API_TOKEN, NOTIFY_CHAT_ID
// notify.local.json is a secret. Never share it.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, type JobRecord, type Status } from './util.js';

interface Creds {
  api_url: string;
  id_instance: string;
  api_token: string;
  chat_id: string;
}

function loadCreds(): Creds | null {
  const e = process.env;
  if (e.NOTIFY_ID_INSTANCE && e.NOTIFY_API_TOKEN && e.NOTIFY_CHAT_ID) {
    return {
      api_url: e.NOTIFY_API_URL ?? 'https://api.green-api.com',
      id_instance: e.NOTIFY_ID_INSTANCE,
      api_token: e.NOTIFY_API_TOKEN,
      chat_id: e.NOTIFY_CHAT_ID,
    };
  }
  const file = path.join(ROOT, 'notify.local.json');
  if (!fs.existsSync(file)) return null;
  const c = JSON.parse(fs.readFileSync(file, 'utf8')) as Creds;
  return c.id_instance && c.api_token && c.chat_id ? c : null;
}

export async function sendWhatsApp(text: string): Promise<{ ok: boolean; detail: string }> {
  const c = loadCreds();
  if (!c) return { ok: false, detail: 'No notify credentials (see README, "Phone summary").' };
  const url = `${c.api_url.replace(/\/$/, '')}/waInstance${c.id_instance}/sendMessage/${c.api_token}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: c.chat_id, message: text }),
      signal: AbortSignal.timeout(30000),
    });
    const body = await res.text();
    return { ok: res.ok, detail: `HTTP ${res.status} ${body.slice(0, 120)}` };
  } catch (e) {
    return { ok: false, detail: String(e) };
  }
}

const MAX_PER_SECTION = 6;

export function buildSummary(records: JobRecord[], notes: string[], mode: 'APPLY' | 'DRY RUN', reportFile: string): string {
  const by = (s: Status): JobRecord[] => records.filter((r) => r.status === s);
  const when = new Date().toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const lines: string[] = [`Naukri bot - ${when} (${mode})`];

  const section = (title: string, list: JobRecord[], withLinks: boolean): void => {
    if (!list.length) return;
    lines.push('', `${title} (${list.length}):`);
    for (const r of list.slice(0, MAX_PER_SECTION)) {
      lines.push(`- ${r.title} @ ${r.company}`);
      if (withLinks) lines.push(`  ${r.url}`);
      for (const x of r.qa ?? []) lines.push(`  Q: ${x.q.slice(0, 70)} -> ${x.a}`);
      if (r.status === 'needs-questions' && r.note?.startsWith('Not submitted')) lines.push(`  (${r.note.slice(0, 110)})`);
    }
    if (list.length > MAX_PER_SECTION) lines.push(`  +${list.length - MAX_PER_SECTION} more in the report`);
  };

  section('Applied', by('applied'), false);
  section('Would apply (dry run)', by('would-apply'), true);
  section('Apply by hand: recruiter questions', by('needs-questions'), true);
  section('Apply by hand: company site', by('company-site'), true);
  section('Not confirmed, check Naukri', [...by('unknown'), ...by('error')], true);
  if (lines.length === 1) lines.push('', 'No new matching jobs today.');
  for (const n of notes) lines.push('', `! ${n}`);
  lines.push('', `Report: ${path.basename(reportFile)}`);
  return lines.join('\n');
}
