# Naukri Morning Bot

A personal automation that, every morning, searches Naukri for SDET / QA-automation jobs, scores each
one against your skills, applies to the best matches (up to a daily cap), and sends you a WhatsApp
summary of what it did and what you still need to do by hand.

Built with Node.js, TypeScript and Playwright. Windows first; it also runs on Linux / Raspberry Pi.

> **Read this first.** Automated applying is against Naukri's terms of use and can get an account
> restricted. This project keeps the volume low and stops on any warning sign, but it cannot remove that
> risk. Use it on your own account, at your own risk, and read the daily report.

---

## How a morning run works

1. **7:00 AM**: Windows Task Scheduler starts `keepawake-run.ps1` (waking the PC if it is asleep), which
   runs the bot while keeping the PC awake until it finishes.
2. **Search** (about 3 minutes): the roles in `search.roles` x the cities in `search.locations`, 2 result
   pages each, for jobs posted in the last `jobAgeDays` days.
3. **Filter**: wrong titles (manager, trainee, manual-only...) and experience ranges you do not fit are dropped.
4. **Open each remaining job** (random 6-14 s pauses):
   - Skipped if Naukri already shows **Applied** (applied by the bot, by you, or from your phone).
   - **Scored** on your skills. The job needs at least one core skill and a score of at least `minScore`.
   - Goes on your **manual list** if it applies on the company's own website.
5. **Apply**: clicks Naukri's own Apply. If a recruiter question form opens, it answers **only** from your
   private `answers.local.json`, uses the form's own "Skip" for anything it cannot answer truthfully, and
   leaves the form unsubmitted if it cannot finish.
6. **Confirm**: reloads the job page and counts the application only if Naukri shows **Applied**.
7. **Stop** at the daily cap, then write the report + log, send the **WhatsApp summary**, close Chrome.
   A run takes about 15-25 minutes.

## Requirements

- Windows 10/11 (or Linux/Raspberry Pi, see "Moving to another machine"), Node.js 20+, Google Chrome.
- A Naukri account you sign in to **by hand** once (the bot never sees your password or OTP).
- Optional: a [Green API](https://green-api.com) WhatsApp instance for the phone summary.
- The PC must be **on or asleep (not shut down)**, signed in to Windows, and online at run time.

## Quick start

```powershell
npm install
copy answers.example.json answers.local.json     # then fill in YOUR true facts
copy notify.example.json  notify.local.json      # optional: WhatsApp summary
npm run login          # Chrome opens: sign in to Naukri yourself, then close the window
npm run dry            # test: search + score, clicks nothing
npm run notify-test    # sends a test WhatsApp message
```

Read `data/reports/<date>.md`. When it looks right, set `"mode": "apply"` in `config.json`, then schedule it:

```powershell
powershell -ExecutionPolicy Bypass -File deploy\install-windows-task.ps1 -At 7:00AM
```

| Command | What it does |
|---|---|
| `npm run dry` | Search and score only, nothing is clicked |
| `npm run apply` | Same, and applies (respects the cap) |
| `npm run run` | Follows `"mode"` in `config.json` (this is what the schedule runs) |
| `npm run login` | Sign in to Naukri again (when the session expires) |
| `npm run notify-test` | Send a test WhatsApp message |
| `shutdown-bot.bat` | Stop everything and undo the Windows settings (see "Shutdown") |

## Configuration (`config.json`)

| Key | Meaning | Current |
|---|---|---|
| `mode` | `dry` (never clicks) or `apply` | `apply` |
| `search.roles` / `search.locations` | What to search and where | 4 roles, Chennai / Bengaluru / Hyderabad |
| `search.jobAgeDays` | Only jobs posted in the last N days (Naukri accepts 1, 3, 7, 15, 30) | 3 |
| `filters.minScore` | Minimum fit score to apply | 8 |
| `filters.titleExclude` | Titles to ignore (lead, manager, java, selenium, manual...) | see file |
| `filters.requireAny` | A job must mention at least one of these skills | Playwright, TypeScript, JavaScript, Mocha, API testing... |
| `scoring.positive` / `negative` | Keyword weights | see file |
| `scoring.playwrightShield` | Penalties (Selenium, Java...) ignored when the job also asks for Playwright | on |
| `limits.maxApplicationsPerDay` | **Total** confirmed applications per day, across all runs | 5 |
| `limits.maxQuestionnaireApplicationsPerDay` | Applications that needed question-answering (also count toward the total) | 1 |
| `limits.delayMinSeconds` / `delayMaxSeconds` | Random pause between jobs | 6 / 14 |
| `limits.maxConsecutiveFailures` | Stop after this many unconfirmed applies in a row | 3 |
| `notify.enabled` | Send the WhatsApp summary | true |
| `browserChannel`, `headless` | `chrome` / `chromium`; show or hide the window | chrome, false |

The cap is a **maximum, not a target**. Some days only 0-3 jobs qualify.

## Recruiter questions (`answers.local.json`)

Many jobs open a form with questions. The bot answers only what you put in this private file:
notice period, current / expected CTC, total experience, relocation, current location, and
experience in the tools you list under `toolExperienceYears`.

- **Never claimed:** any tool or skill not listed. An unlisted skill question is answered with "Skip"
  if the form offers it; otherwise the bot gives up and does not submit.
- Fill in **only true values**. Employers see these answers, and false ones can cost you an interview or an offer.
- Every question and answer is written to the report and to the WhatsApp summary.

## Reports and verification

| Where | What |
|---|---|
| `data/reports/<date>.md` | Applied, would-apply (dry run), manual (company site / recruiter questions), unconfirmed, skipped, and the exact answers sent |
| `data/logs/<date>.log`, `data/logs/scheduler.log` | Line-by-line logs |
| `data/applied.json` | Every job the bot has handled, with its status (also prevents repeats) |
| WhatsApp | Short summary after each run |
| Naukri **Application status** page | The source of truth. Compare it with the report. |

## Safety rules built in

- Daily cap, random pauses, and a limit on question-answering applications.
- Confirms every application on Naukri before counting it.
- Stops the whole run on a login wall, CAPTCHA or bot check, or 3 unconfirmed applies in a row, and
  says so in the report. It never tries to get around any of these.
- Never closes an unanswered question form (that sends an incomplete application).
- Never creates accounts, never types your Naukri password, never applies on company websites.

## What it cannot do

Company-site applications, other job portals, questions it has no truthful answer for, replying to
recruiters, tracking recruiter views, uploading your resume to Naukri, or running while the PC is shut down.

## Windows scheduling and wake-up

`deploy/install-windows-task.ps1` registers the task `NaukriMorningBot` (daily, wake-to-run, run
as soon as possible if a run was missed). Waking also needs **Allow wake timers = Enable**:

- Plugged in: enable it in Power Options > Change advanced power settings > Sleep.
- On battery too: run `deploy/enable-wake-on-battery.ps1` once (it changes that one setting).
- A laptop that is **shut down** will not wake. Leave it asleep, plugged in, and signed in.
  A locked screen is fine.

## Shutdown (undo everything)

Double-click **`shutdown-bot.bat`**. It:

1. Stops any bot run in progress (only this project's processes, never your other Chrome windows).
2. Removes the `NaukriMorningBot` scheduled task.
3. Sets "Allow wake timers" **on battery** back to Disable (its value before this project).
4. Sets `"mode": "dry"` in `config.json` so nothing can apply by accident.
5. Asks (default **No**) whether to also delete the saved Naukri login, WhatsApp token and your private answers.

It cannot undo things that live outside your PC: your Naukri resume headline, applications already
sent (withdraw them on Naukri's Application status page), and WhatsApp messages already delivered.
To start again later, follow "Quick start".

## Moving to another machine (spare PC, Raspberry Pi, cloud server)

1. Copy the project **without** `.profile/`, `node_modules/`, `data/` and the two `*.local.json` files, then
   `npm install` (Node 20+). Re-create the two `*.local.json` files from the examples.
2. Linux / Pi: `npx playwright install --with-deps chromium`, `sudo apt install xvfb`, and set
   `"browserChannel": "chromium"` (or `NAUKRI_BROWSER_CHANNEL=chromium`).
3. **Sign in to Naukri again** on the new machine with `npm run login` (a login cannot be copied between
   computers). On a headless Pi or server, do this once through a desktop/VNC session.
4. Schedule it: Windows `deploy/install-windows-task.ps1`; Linux systemd `deploy/naukri-bot.service` +
   `deploy/naukri-bot.timer` (set `sudo timedatectl set-timezone Asia/Kolkata`) or cron
   `0 7 * * * <path>/deploy/run-morning.sh`.
5. Run `npm run dry` and `npm run notify-test` first.

A home PC or Raspberry Pi is the better choice. A cloud server's data-centre IP address can trigger
Naukri's OTP / bot checks. Environment overrides: `NAUKRI_PROFILE_DIR`, `NAUKRI_BROWSER_CHANNEL`,
`NAUKRI_HEADLESS`, and `NOTIFY_API_URL` / `NOTIFY_ID_INSTANCE` / `NOTIFY_API_TOKEN` / `NOTIFY_CHAT_ID`.

## Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| Run stops: "asked for login" | Session expired. Run `npm run login` |
| Run stops: CAPTCHA / bot check | Do **not** retry in a loop. Wait a day, check your Naukri account in a normal browser, lower the cap |
| "profile is already in use" | A Chrome window from an earlier run is still open. Close it (or run `shutdown-bot.bat`) |
| No WhatsApp message | Check `notify.local.json`, run `npm run notify-test`, check Green API status |
| Nothing was applied | Normal on quiet days. Read the report: most jobs need recruiter answers or apply on the company site |
| "Unconfirmed" application | The click happened but Naukri did not show "Applied". Check the Application status page |
| Did not run at 7:00 AM | PC was shut down / signed out, or wake timers are off. Check `data/logs/scheduler.log` |

## Project layout

```
config.json            settings (committed)
answers.local.json     YOUR private facts for recruiter questions  (git-ignored)
notify.local.json      WhatsApp (Green API) credentials             (git-ignored)
.profile/              the bot's signed-in Chrome profile           (git-ignored)
data/                  reports, logs, applied history               (git-ignored)
src/                   bot.ts (main), questions.ts, notify.ts, browser.ts, util.ts, login.ts
deploy/                Windows task installer, wake-on-battery, shutdown, Linux systemd + cron files
keepawake-run.ps1      scheduled entry point (keeps the PC awake during a run)
shutdown-bot.bat       stop everything and undo Windows settings
```

## Privacy

`.profile/` contains your logged-in Naukri session and `notify.local.json` contains your WhatsApp API token.
Both, plus `answers.local.json` (salary and personal details) and `data/`, are listed in `.gitignore`.
Never share, upload or commit them. If a token is ever exposed, rotate it in the provider's dashboard,
and change your Naukri password.
