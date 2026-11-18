# Upgrade check

An install made and filled by the last release must open, read, serve, and take every command under this code.

```text
last release  = the highest vX.Y.Z tag among the ancestors of the checkout
its code      = git archive of the tag, in a temp folder, with its own lockfile installed
its install   = that code's own preview seed, on a database and a store the test keeps
then          = this code opens the same database and the same objects, and is asked the same things
```

| To                                  | Run                                                                               |
| ----------------------------------- | --------------------------------------------------------------------------------- |
| run the check and its own test      | `bun test ./tests/migrations/upgrade.test.ts ./tests/migrations/detector.test.ts` |
| check that no released step changed | `bun test ./tests/migrations/frozen-steps.test.ts`                                |
| run both as a release does          | `bun test ./tests/migrations/`, as the `Release Gate` workflow does               |

Both run on every push, inside `bun run test`, and again in `release-gate.yml` on the pull request of a release, beside the fuzz run. The upgrade of the two real test installs is `release-live-upgrade.yml`, on the same pull request, which then puts each install back to main's build, the sample sites, and the demo. A shallow checkout fails with the command that fetches the history.

## What is checked

| Shape                        | Made by the last release                        | Must hold under this code                                                                                                                      |
| ---------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| database                     | the seeded install's database                   | it opens, has the schema of a new install, loses no row, answers `list` and `show` as before, and a site takes every site action               |
| settings                     | the stored settings row                         | it reads, and `config` answers as before                                                                                                       |
| storage                      | every object of every site                      | every stored path answers the same at every address                                                                                            |
| update notice                | the update row                                  | `whoami` and `update --dry-run` answer as before                                                                                                 |
| backup                       | `export --all-versions`                         | `import` brings every site back as it was, and `import --settings` takes its settings; the other way round, all or a refusal with nothing kept |
| login file                   | `login.json`                                    | `whoami` reads it                                                                                                                              |
| this command on that install | its API                                         | every site action is done, or refused with a hint to update                                                                                    |
| that command on this install | its `poplin`                                    | the same                                                                                                                                       |

A read is asked when the command of the code that made the install has its flags.

`upgrade.test.ts` lists what is not checked as skipped tests, each with what it needs.

## The tests

| Test               | From                                                 | Expects                                                               |
| ------------------ | ---------------------------------------------------- | --------------------------------------------------------------------- |
| `upgrade.test.ts`  | the last release                                     | no finding; before the first release it says that nothing is released |
| `detector.test.ts` | this code itself                                     | no finding                                                            |
| `detector.test.ts` | a commit from before step 1 was last edited in place | findings for the database, the settings, and the backup               |
| `detector.test.ts` | answers written by hand                              | each comparison names what is gone or changed, and passes what is kept, moved, or added |

## Adding a schema step

1. Change `packages/core/src/database/schema.ts`.
2. Run `bun run --cwd packages/core draft-step "<what it does>"` and read the draft: it adds the step to the file of the current version.

A file of steps a release shipped is frozen: `tests/migrations/frozen-steps.test.ts` fails when it differs from the tag. A change is a new step, in the file named for the last release: the one file that may be new or change.

A new setting needs a step too. The stored settings row is read strictly, so a row without the new key does not read. The step writes the key's default into the stored row:

```sql
UPDATE settings SET value = json_set(value, '$.<key>', <default>) WHERE json_type(value, '$.<key>') IS NULL
```
