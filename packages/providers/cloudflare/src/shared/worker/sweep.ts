// One scheduled run of the sweep: the day's question about a newer version, the update an install with `auto_update` on starts by itself, then as many steps of core's walk as fit one invocation, from where the run before stopped.
//
//                        database calls                                                        other calls           in all
//   the run's start       1: the last asking, the settings, the walk's place, and the kept run of the domain with what waits under it, read together   0   1
//   the day's first run   2: that, and the answer written                                        1: the website asked   3
//   the login repaired    8: the users carried anew where their policy was written, an audit entry, a problem noted, on the run that begins a UTC day   29: 14, the 3 of the two alerts, and that carry's 12, and one for each further page of a list   37
//   the logs stated       2: the setting read again after each of two writings, on the run that begins a UTC day   4: 2 x (the observability read, and written where it differs)   6
//   either carried        5 for the users, 4 for the rules: 2 x (the mark set with what is stored read, the settling), a problem noted; 2 where a run only confirms   12 and 10: 2 x 6 and 2 x 5 to Cloudflare; 4 and 3 where nothing differs   17, 14
//   an update             6: the try, the setting of the logs read, the audit entry, and the    11: the release read,   17
//                            try taken back or a problem noted                                   fetched, and put in place
//   one step over sites   4: a listing of what is due, its 5 sites changed in one call, their folders forgotten in one, the count of bucket writes   150: 5 x 30 to the bucket   154
//   one step, at most    12: over the uploads: a listing, 5 x (an upload given up, its record removed), and the count of bucket writes            150: 5 x 30 to the bucket   162
//   a step over uploads   1 more: a copy nobody finished, noted as a problem                     0                      1
//   a walk, nothing due   5: a listing each of the expired sites, the sat-out ones, the old      0                      5
//                            uploads, and the leftovers, and the logins that ran out removed
//   one run, at most     40: the start, the answer, an update, the steps, the count and the place written                290
//   one invocation       50: an instance that starts in it makes up to 10 before the run                                300
//
// D1 answers one invocation 50 queries on Cloudflare's Free plan, a batch being one. A run with nothing due makes 6, with a key or without, however many sites the install holds.
// The settings are read once, at the start, and hold for the run. The walk's place is not written by a run whose walk began and ended in it. A run with nothing due writes no row, but the first run of a UTC day, which writes the one row of the answer.
// The call that ends a walk also removes the audit entries and the ended tokens of over 90 days ago: at most 125 rows a run, and none where nothing is that old.
// An update is started on the day's first run alone, and only where core's rules let it: every other run, and every install with the switch off, makes no call for it.
// A change of the users that did not reach Cloudflare is carried once a run, until it is settled. The setting of the logs keeps no mark: the run that begins a UTC day states it whole.
// The guard rules and the alerts wait for a run a minute or more after their last try: it reads Cloudflare, writes what differs, and lets the mark go only where it wrote nothing. A run sets out to do so 16 minutes after the last try at the latest.
// A run that listed the bucket adds its listings to the day's count in one row. It may list a thousand times a day beyond `max_storage_writes_per_day`, so no other work of a day keeps it from removing files.

import { startDueUpdate } from "@poplin/core/src/actions/update/auto-update";
import { type Asking, checkForUpdate } from "@poplin/core/src/actions/update/check-update";
import { endProblems, meterNoted, noteProblem } from "@poplin/core/src/actions/install/problems";
import { signedBy } from "@poplin/core/src/actions/access/reach";
import type { Install } from "@poplin/core/src/actions/records";
import type { Updating } from "@poplin/core/src/actions/start-update";
import { SWEEP_SPARE_WRITES, sweepExpired } from "@poplin/core/src/actions/install/sweep";
import { SWEEPER } from "@poplin/core/src/auth/scopes";
import type { RememberedCheck } from "@poplin/core/src/records/domain-check";
import { alertAddresses, type SettingValues } from "@poplin/core/src/records/settings";
import { followUsers, type UsersFollow } from "@poplin/app/src/console/access/users-follow";
import { followLogs, type LogsFollow } from "@poplin/app/src/console/settings/logs-follow";
import { followRules, type RulesFollow } from "@poplin/app/src/console/settings/rules-follow";

import { LOGS_PUSH_CALLS } from "../install/pieces/worker-logs/logs-follow";
import type { LoginRepair } from "../install/pieces/access/login-repair";
import type { KeptAlerts } from "../install/pieces/alerts/account-alert";
import { RULES_PUSH_CALLS } from "../../with-domain/pieces/rules/rules-follow";

/** How many sites or uploads one step looks at. */
const STEP_ITEMS = 5;

/** The most calls one step can make, to the database and in all, as the table above adds them up. */
const STEP_CALLS = { database: 12, all: 162 } as const;

/** The call to the database a step over the uploads may make beyond those: a copy nobody finished, noted as a problem. */
const NOTE_CALLS = 1;

/** The most calls one run makes, which leaves an instance that starts first 10 of an invocation's 50 to the database and of its 300 in all. */
const RUN_CALLS = { database: 40, all: 290 } as const;

/** The most sites, uploads, and folders one run changes: three steps' worth. A site removed for good writes about 11 rows, so the 96 runs of a day that each find a full trash write a sixth of the day's 100,000. */
const RUN_ITEMS = 15;

/** The database calls a run makes after its steps, which a step must leave room for: the write of the day's count and the write of the place. */
const CLOSING_CALLS = 2;

/** The calls to Cloudflare one carrying of the users makes at most, before any the SDK sends again: 6, twice. The policies are listed in two calls and the one written; the alerts are listed in one and each of two written. */
const FOLLOW_CALLS = 12;

/** The calls to Cloudflare one keeping of the alerts makes at most, before any the SDK sends again: the account's alerts listed, and each of two made or changed. */
const ALERT_CALLS = 3;

/** The calls to Cloudflare one carrying of the settings to the guard rules makes at most, before any the SDK sends again: the rules written, for the settings and for ones that changed meanwhile. */
const RULES_CALLS = 2 * RULES_PUSH_CALLS;

/** The calls to Cloudflare one stating of the logs makes at most, before any the SDK sends again: the observability written, for the setting and for one that changed meanwhile. */
const LOGS_CALLS = 2 * LOGS_PUSH_CALLS;

/** The most requests an update sends: seven to the website and the release's page, the redirect of each file among them, and four to Cloudflare's API. */
const SELF_UPDATE_REQUESTS = 11;

/** How long after a try a read of Cloudflare is trusted to show what the try wrote: a list or a ruleset read sooner may still answer what was there before. Two runs are a quarter of an hour apart, so a run's own try is this old at the next. */
const SETTLED_AFTER_MS = 60_000;

/** How far apart two runs are, by the schedule `INSTALL_OBJECTS.sweepCron` states: a quarter of an hour. */
const RUN_EVERY_MS = 900_000;

/** The milliseconds of one UTC day. */
const DAY_MS = 86_400_000;

/** Where a walk begins: at the sites that expired. The steps go on from there through the trash, the uploads, and the leftovers. */
const START: NonNullable<Place> = { trash: false };

/** Where the walk stands, as the database keeps it between two runs; `undefined` once it reached its end. */
type Place = Awaited<ReturnType<Install["database"]["readSweepPlace"]>>;

/** The version the install runs, what updates it, and the login's, the users', the alerts', the guard rules', and the logs' side at Cloudflare. */
interface Running {
  readonly version: string;
  readonly updating: Updating;
  readonly login: LoginRepair;
  readonly follow: UsersFollow;
  readonly keepAlerts: (emails: readonly string[]) => Promise<KeptAlerts>;
  readonly rules: RulesFollow;
  readonly dailyLogs: LogsFollow;
}

/** The calls a run has made so far. A call to the database is one query to D1, and one to the web is the request for the newest version. */
interface Tally {
  database: number;
  bucket: number;
  web: number;
}

/** Wrap a database or a bucket so every call of a method of it is counted under its name, as one call or as the many requests it stands for. */
function counted<Target extends object>(target: Target, tally: Tally, under: keyof Tally, weight = 1): Target {
  return new Proxy(target, {
    get(inner, name) {
      const member: unknown = Reflect.get(inner, name, inner);
      if (typeof member !== "function") return member;

      return (...given: unknown[]): unknown => {
        tally[under] += weight;

        return Reflect.apply(member, inner, given);
      };
    },
  });
}

/** Whether a whole step at a place and the write of the place still fit the run, by the database's calls and by all of them. */
function fitsAnotherStep(tally: Tally, place: NonNullable<Place>): boolean {
  const noting = "uploads" in place ? NOTE_CALLS : 0;
  const database = tally.database + STEP_CALLS.database + noting + CLOSING_CALLS;
  const all = tally.database + tally.bucket + tally.web + STEP_CALLS.all + noting + CLOSING_CALLS;

  return database <= RUN_CALLS.database && all <= RUN_CALLS.all;
}

/** Whether a run is the one that begins a UTC day: the one of a day's 96 whose clock stands in the day's first quarter of an hour. An install with `update_check` off never asks the day's question, so the clock tells. */
function beginsDay(now: number): boolean {
  return now % DAY_MS < RUN_EVERY_MS;
}

/**
 * Keep the alerts of the install's kind for the users its settings choose.
 *
 * @param emails - who the alerts go to, as the run read the settings; none on an install with no user, which is asked nothing
 * @returns the name of each alert this call made or changed, those written before a refusal among them
 */
async function keptAlerts(running: Pick<Running, "keepAlerts">, tally: Tally, emails: readonly string[]): Promise<readonly string[]> {
  if (emails.length === 0) return [];

  tally.web += ALERT_CALLS;
  const kept = await running.keepAlerts(emails);

  return kept.wrote;
}

/**
 * Put the login in front of the install back, and keep the alerts, where the install holds a key to do it with: what is missing or differs is written, and what stands costs reads alone.
 * What the two wrote is kept as an audit entry the sweep signs; an alert the carry of the users made after them is in none.
 * A repair of the login that stopped is noted as a problem, but for one Cloudflare gave no answer to: the next day's run tries again.
 * An alert that was not kept is noted nowhere: the Domain screen's check reads the alert with the same key, and its row says what to press.
 *
 * @param settings - the settings as the run read them: the users the login is made to let through, and who the alerts go to
 * @returns whether a repair of the login came through, which leaves the login standing, whatever became of the alerts
 */
async function repairLogin(install: Install, running: Pick<Running, "login" | "follow" | "keepAlerts">, tally: Tally, settings: Pick<SettingValues, "users" | "alert_users">): Promise<boolean> {
  if (!running.login.holdsKey()) return false;

  const { wrote, users, calls, refusal } = await running.login.repair(settings.users);
  tally.web += calls;
  // A key Cloudflare refuses, and a Cloudflare that does not answer, would say the same of the alerts.
  const alert = refusal === "key_refused" || refusal === "unreachable" ? [] : await keptAlerts(running, tally, alertAddresses(settings));
  // The users may have changed since the run read them: where their policy was written, they are carried anew, as stored now, and the alerts go to whom the settings choose in that carry.
  if (users) {
    tally.web += FOLLOW_CALLS;
    await followUsers(install, running.follow);
  }

  if (wrote.length + alert.length > 0) await install.database.appendAudit({ action: "domain_synced", detail: { run: "repair", from: "sweep", changed: [...wrote, ...alert] } }, signedBy(SWEEPER, install.now()));

  if (refusal !== undefined && refusal !== "unreachable") await noteProblem(install, "login_not_repaired", new Error(refusal));

  return refusal === undefined;
}

/** Whether a mark is set, and old enough that a read of Cloudflare shows every write made under it. */
function settledBy(mark: number | null, now: number): boolean {
  return mark !== null && now - mark >= SETTLED_AFTER_MS;
}

/**
 * Carry to Cloudflare what still waits there, and confirm what a try carried, where the install holds a key to do it with. A refusal leaves the change waiting for the next run.
 * A change of the users is carried at once. What a try compared, the guard rules and the alerts' address, is read again only once its mark is old enough, and the mark goes where that read found nothing to write.
 *
 * @param kept - the kept run of the domain with its marks, as the run's start read it; `undefined` on an install that keeps none, which remembers nothing to carry
 */
async function carryWaiting(install: Install, running: Pick<Running, "follow" | "rules">, tally: Tally, kept: RememberedCheck | undefined): Promise<void> {
  if (kept === undefined || !running.follow.holdsKey()) return;

  // A change or a try that came after the run read the marks is later than this moment, and the try that meets it confirms nothing.
  const trusted = { quietSince: install.now() - SETTLED_AFTER_MS };
  if (kept.users_changed_at !== null || settledBy(kept.alerts_changed_at, install.now())) {
    tally.web += FOLLOW_CALLS;
    await followUsers(install, running.follow, trusted);
  }

  if (settledBy(kept.rules_changed_at, install.now())) {
    tally.web += RULES_CALLS;
    await followRules(install, running.rules, trusted);
  }
}

/** State the setting of the logs to Cloudflare, where the install holds a key to state it with: a change that did not reach Cloudflare is carried so, within a day. A refusal is left for the next day's run. */
async function stateLogs(install: Install, running: Pick<Running, "dailyLogs">, tally: Tally, kept: boolean): Promise<void> {
  if (!running.dailyLogs.holdsKey()) return;

  tally.web += LOGS_CALLS;
  await followLogs(install, running.dailyLogs, kept);
}

/**
 * Run the sweep for one scheduled invocation: go on where the run before stopped, and keep where this one stops.
 *
 * The place is kept in the database, since Cloudflare may start a new instance for every run. Only what is due is looked at: a run takes 15 due items, and 5 when each takes a whole removal of files.
 * The first run of a UTC day also writes which version of poplin is the newest and may start an update, and the run that begins the day repairs the login and states the logs: each leaves the steps fewer calls.
 *
 * @param asking - what sends the day's one request for the newest version, and where to
 * @param running - the version the install runs and what updates it, for the update an install starts by itself, and the login's, the users', the guard rules', and the logs' side at Cloudflare
 * @throws {Error} the sweep was refused, or the database failed; what was moved or removed before stays so, and the next run begins where this one began
 */
export async function runSweep(install: Install, asking: Asking, running: Running): Promise<void> {
  const tally: Tally = { database: 0, bucket: 0, web: 0 };
  const database = counted(install.database, tally, "database");
  const meter = meterNoted({ ...install, database }, SWEEP_SPARE_WRITES);
  const start = await database.readSweepStart();
  const settled = start.settings === undefined ? {} : { knownSettings: start.settings };
  const watched: Install = { ...install, ...settled, database, store: counted(meter.store, tally, "bucket") };
  const learned = await checkForUpdate(watched, counted(asking, tally, "web"), { last: start.updateCheck });
  const taking = running.updating.self;
  const self = { ...taking, ready: counted({ ready: taking.ready }, tally, "web", SELF_UPDATE_REQUESTS).ready };
  if (learned !== undefined) await startDueUpdate(watched, { ...learned, version: running.version }, { ...running.updating, self });
  if (beginsDay(install.now()) && start.settings !== undefined && (await repairLogin(watched, running, tally, start.settings))) {
    // What a broken login was noted as ends with a repair that came through. It is ended under the install's own database, which is what a request of this instance noted it under, so the call is counted here.
    tally.database += 1;
    await endProblems(install, ["login_stands"]);
  }
  if (beginsDay(install.now()) && start.settings !== undefined) await stateLogs(watched, running, tally, start.settings.provider_logs);
  await carryWaiting(watched, running, tally, start.domainCheck);

  let place: Place = start.place ?? START;
  let changed = 0;

  try {
    while (place !== undefined && changed < RUN_ITEMS && fitsAnotherStep(tally, place)) {
      const swept = await sweepExpired(watched, SWEEPER, { limit: Math.min(STEP_ITEMS, RUN_ITEMS - changed), from: place });
      if (!swept.ok) throw new Error(`the sweep was refused: ${swept.code}`);

      changed += swept.trashed + swept.deleted + swept.uploads + swept.emptied;
      place = swept.next;
    }
  } finally {
    await meter.settle();
  }

  // A walk that began and ended inside this run left no place to keep, and none was kept before it.
  if (place !== undefined || start.place !== undefined) await watched.database.keepSweepPlace(place);
}
