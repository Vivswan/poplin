# Writing a migration

How to carry an install made by an older poplin on to this code: where the code goes, which file a step goes in, and what holds each rule. It is not the guide to updating an install; [Update](../../../../docs/upkeep/update.md) is.

```text
packages/core/src/migrations/                 the steps and their runner
|-- 0.0.0.ts      the schema steps that leave 0.0.0, in the order they run
|-- registry.ts   every file of steps, in ascending order of version
`-- migrate.ts    the runner: it applies the steps a database lacks, one by one
packages/providers/cloudflare/migrations/     the provider's fix-ups in steps/, and the live upgrade check
tests/migrations/                             the offline upgrade check
```

## Old shapes live under `migrations` alone

| Code that | Lives |
| --- | --- |
| knows an older version: its schema, a stored shape, a name it had | under a folder named `migrations`: the three above, and the tests of each in a `migrations` folder of their own |
| is anything else | with the current shape alone; the old one is deleted outright |

`tests/no-old-shapes.test.ts` reads the source under `packages/*/src` for code that handles an old stored shape, and the code, settings, and Markdown files of the repository for a name the upgrade checks use. Outside a `migrations` folder either is a failure; the test lists the few files that may.

The lint settings refuse an import of a `migrations` folder in the source they read outside one. They name one file of source that may: the doorway, `packages/core/src/database/open.ts`. Tests and scripts may.

## A file is named for the version it leaves

| The last release | Write into | Frozen |
| --- | --- | --- |
| `v0.1.0` | `0.1.0.ts` | `0.0.0.ts` |
| `v0.2.0` | `0.2.0.ts` | `0.0.0.ts`, `0.1.0.ts` |

- **The name is the version the steps migrate away from.** That is the last release: the highest `vX.Y.Z` tag among the ancestors of the checkout. A checkout without its tags is told to fetch them.
- **Never guess the next number.** The version being cut is in no file name. `draft-step` picks the file by itself.
- **A released file is frozen.** `tests/migrations/frozen-steps.test.ts` fails when a file of an earlier version differs from the last release's copy by one byte. A change to a frozen step is a new step in the current file. The provider's files of steps are held the same way.

## An update is one jump, then every step in order

```text
install at 0.1.0 --- update ---> the code of 0.3.0, in one jump
the new code then applies:   0.1.0/add-a-flag -> 0.1.0/fill-the-flag -> 0.2.0/drop-a-column
```

The new code reads which steps the database is marked with, and applies each step it lacks, one by one. A step is called `<version>/<name>`.

```text
schema_steps   step | version | name          | description | applied_at | fingerprint
               1    | 0.0.0   | create-schema | ...         | ...        | the SHA-256 of its statements
```

| The database | The code |
| --- | --- |
| lacks steps the code has | applies them |
| holds a mark that is not the code's step at that place | refuses it as `differs`: another build made it |
| holds a mark beyond the code's last step | refuses it as `newer`: update poplin |

**Every step is safe to run twice.** A step's statements and its mark are kept together or not at all, and a marked step never runs again. Whatever a step does outside that unit is written so that a second run changes nothing.

## Each step says who can do it

| `by` | Who does the step | Such a step |
| --- | --- | --- |
| `"install"` | the install by itself, as it updates | every schema step in `packages/core/src/migrations/<version>.ts` |
| `"account token"` | Repair alone, which is given an account token | none exists |

Every step carries the field `by`. A schema step is always `by: "install"`: the type takes no other value, and `draft-step` writes it.

A step at the provider goes in `packages/providers/cloudflare/migrations/steps/`, in a file `<version>.ts` named as a file of schema steps is and listed in the `registry.ts` of that folder. Such a step holds `run`, which makes the change at Cloudflare, where a schema step holds `statements`. The list is empty.

A step with `by: "account token"` must carry `notice`: one sentence that tells the user to press Repair and why. `packages/providers/cloudflare/tests/migrations/steps/notices.test.ts` fails when a notice is no single sentence or does not name Repair.

| What holds a provider's step | Rule |
| --- | --- |
| `tests/migrations/frozen-steps.test.ts` | a released file is frozen, and a new step goes into the file named for the last release |
| `tests/layout.test.ts` | a file named for its version does not count toward the size of `steps/` |
| `tests/migrations/steps/notices.test.ts` of the provider | every step of the list that needs an account token has its notice |
| the type of a step | `by` is there, and `notice` with `"account token"` |

A provider's step may import code: `run` reaches Cloudflare through the provider's own client. The rule that a file of steps imports types alone is held for schema steps.

No code runs a provider step. Whoever writes the first one writes what runs it in the same change: the install tells its user to press Repair, and Repair does the step.

## A step never walks many rows

```text
Cloudflare's free plan     one request: 50 database queries
```

A step that must touch many rows does not run inside a request. It runs as a background job, in pieces, and the step itself makes only what the job needs. No step of this kind exists.

## Add a step

1. Change `packages/core/src/database/schema.ts`.
2. Run the drafter, and say what the step does.
3. Read the draft. Add by hand what a declaration cannot say: `STRICT`, `WITHOUT ROWID`, and every trigger.

```sh
bun run --cwd packages/core draft-step "add a pinned flag to sites"
```

```text
drafted the step add-a-pinned-flag-to-sites in 0.1.0.ts: 1 statement(s). Read it before it is kept
```

The last release is `v0.1.0`, so the step goes into `0.1.0.ts`, after the steps that file holds:

```ts
// The steps that take a database on from 0.1.0.

import type { VersionSteps } from "./migrate";

/** The steps that leave 0.1.0. */
export const V0_1_0: VersionSteps = {
  version: "0.1.0",
  steps: [
    {
      name: "add-a-pinned-flag-to-sites",
      description: "add a pinned flag to sites",
      by: "install",
      statements: [
        "ALTER TABLE `sites` ADD `pinned` integer DEFAULT 0 NOT NULL",
      ],
    },
  ],
};
```

A version with no file gets one, as here, and `registry.ts` lists it:

```ts
import { V0_0_0 } from "./0.0.0";
import { V0_1_0 } from "./0.1.0";
import type { Step, VersionSteps } from "./migrate";

export const VERSIONS: readonly VersionSteps[] = [V0_0_0, V0_1_0];
```

A new setting needs a step too. The stored settings row is read strictly, so the step writes the key's default into it:

```sql
UPDATE settings SET value = json_set(value, '$.<key>', <default>) WHERE json_type(value, '$.<key>') IS NULL
```

## Do and do not

| Do | Do not |
| --- | --- |
| put code for an older version under a `migrations` folder | branch on a stored version anywhere else |
| let `draft-step` pick the file | name a file for a version that is not released |
| add a new step for a change to a released step | edit a file of an earlier version |
| keep a schema step's statements in its own file | import code into a file of schema steps: it imports types alone |
| write a step so a second run changes nothing | count on a step running once |
| make a background job for many rows | loop over rows inside a step |
| delete the old shape in the same change | keep a reader of the old shape beside the new one |

## How the upgrade checks use the files

| Check | Starts from | A failure |
| --- | --- | --- |
| `tests/migrations/upgrade.test.ts` | the last release, on a database the test keeps | blocks a release |
| the live upgrade | the last release, on the two test installs | blocks a release |
| the live upgrade | the newest pre-release on npm that is an earlier build of this code | is advice, and blocks nothing |

Each check makes an install with the older code, fills it, and opens it with this code, so every step between the two runs on real rows.

The live upgrade adds one step for its run alone, `upgrade-proof`, to the file named for the older build's version. The new code applies it to the filled database, and the checks read what it left.
