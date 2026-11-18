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

Both run on every push, inside `bun run test`, and again in `release-gate.yml` on the pull request of a release, beside the fuzz run. Beside them, the same file upgrades the two real test installs, then runs the live checks on each and puts it back to main's build, the sample sites, and the demo.

A shallow checkout fails with the command that fetches the history, and one without its tags with the command that fetches them.

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
| `upgrade.test.ts`  | the last release                                     | no finding                                                            |
| `detector.test.ts` | this code itself                                     | no finding                                                            |
| `detector.test.ts` | a commit from before step 1 was last edited in place | findings for the database, the settings, and the backup               |
| `detector.test.ts` | answers written by hand                              | each comparison names what is gone or changed, and passes what is kept, moved, or added |

## Adding a schema step

[Writing a migration](../../packages/core/src/migrations/README.md) has the steps, the rules, and a worked example. `frozen-steps.test.ts` here holds its rule on released files, for the schema steps and for the provider's steps.
