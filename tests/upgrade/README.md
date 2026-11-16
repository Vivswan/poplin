# Upgrade check

An install made and filled by the last release must open, read, serve, and take every command under this code.

```text
last release  = the highest vX.Y.Z tag among the ancestors of the checkout
its code      = git archive of the tag, in a temp folder, with its own lockfile installed
its install   = that code's own preview seed, on a database and a store the test keeps
then          = this code opens the same database and the same objects, and is asked the same things
```

| To                                  | Run                                     |
| ----------------------------------- | --------------------------------------- |
| run the check and its own test      | `bun test ./tests/upgrade/`             |
| check that no released step changed | `bun test ./tests/frozen-steps.test.ts` |
| run both as a release does          | the `Release Gate` workflow             |

Both run on every push, inside `bun run test`, and again in `release-gate.yml` on the pull request of a release. A shallow checkout fails with the command that fetches the history.

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

## The three tests

| Test               | From                                                 | Expects                                                               |
| ------------------ | ---------------------------------------------------- | --------------------------------------------------------------------- |
| `upgrade.test.ts`  | the last release                                     | no finding; before the first release it says that nothing is released |
| `detector.test.ts` | this code itself                                     | no finding                                                            |
| `detector.test.ts` | a commit from before step 1 was last edited in place | findings for the database and the settings                            |

## Adding a schema step

1. Change `packages/core/src/database/schema.ts`.
2. Run `bun run --cwd packages/core draft-step "<what it does>"` and read the draft.
3. List the step in `packages/core/src/migrations/registry.ts`.

A step a release shipped is frozen: `tests/frozen-steps.test.ts` fails when its file differs from the tag. A change to it is a new step with the next number.

A new setting needs a step too. The stored settings row is read strictly, so a row without the new key does not read. The step writes the key's default into the stored row:

```sql
UPDATE settings SET value = json_set(value, '$.<key>', <default>) WHERE json_type(value, '$.<key>') IS NULL
```
