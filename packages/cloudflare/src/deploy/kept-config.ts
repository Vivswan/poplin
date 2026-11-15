// The deploy configuration of a release, with what an install's own copy says about its account kept.
//
//   field                                          wins
//   name, account_id                               the copy
//   r2_buckets[].bucket_name, .jurisdiction        the copy, for the binding of the same name
//   d1_databases[].database_name, .database_id     the copy, for the binding of the same name
//   vars.WORKER_NAME                               the copy's `name`: the Worker reads its own name there
//   everything else, and which bindings there are  the release

/** The fields at the top of the configuration that name the install in its account. */
const KEPT_FIELDS: readonly string[] = ["name", "account_id"];

/** The variable that repeats `name`, for the Worker to read. */
const NAME_VARIABLE = "WORKER_NAME";

/** The lists of bindings to things the account holds, each with the fields that say which thing. */
const KEPT_IN_BINDINGS: Readonly<Record<string, readonly string[]>> = {
  r2_buckets: ["bucket_name", "jurisdiction"],
  d1_databases: ["database_name", "database_id"],
};

/** A wrangler configuration as parsed JSON. */
export type DeployConfig = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bindingsOf(list: unknown): Record<string, unknown>[] {
  return Array.isArray(list) ? list.filter(isRecord) : [];
}

function only(record: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(fields.filter((field) => field in record).map((field) => [field, record[field]]));
}

/**
 * Lay the copy's account fields over a release's configuration, by the table at the top of this file.
 *
 * @returns the configuration to deploy: a binding the release lacks is gone, and one the copy lacks is the release's own
 */
export function keepCopyConfig(release: DeployConfig, copy: DeployConfig): DeployConfig {
  const merged: Record<string, unknown> = { ...release, ...only(copy, KEPT_FIELDS) };

  for (const [list, fields] of Object.entries(KEPT_IN_BINDINGS)) {
    if (!(list in release)) continue;

    const kept = new Map(bindingsOf(copy[list]).map((entry) => [entry.binding, only(entry, fields)]));
    merged[list] = bindingsOf(release[list]).map((entry) => ({ ...entry, ...kept.get(entry.binding) }));
  }

  if (isRecord(release.vars) && NAME_VARIABLE in release.vars) merged.vars = { ...release.vars, [NAME_VARIABLE]: merged.name };

  return merged;
}
