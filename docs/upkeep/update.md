---
title: Update
order: 10
---

# Update the install

How an install updates, and the notice of a newer version.

Nothing updates on its own while the setting `auto_update` is off, as it is in a new install. An install says when a newer version is out, and updates itself with the key it keeps.

| The install   | It updates by                                                                          |
| ------------- | -------------------------------------------------------------------------------------- |
| holds its key | one press, or one command: [With the kept key](#with-the-kept-key)                     |
| holds no key  | a repair first, which gives it one: Repair on the Domain screen, or `npx poplin doctor --repair` |

The row `Key` of the Domain screen says whether the install holds its key. An install that holds none cannot update itself: `poplin update` answers `no_key`.

## With the kept key

```text
Update now, or poplin update
        |
1  read releases.json                 poplin's website         which releases are out, each with a digest
2  fetch the manifest                 the release's page       its digest == the website's
3  fetch worker.js and its map        the release's page       each digest and size == the manifest's
4  one upload, with the kept key      Cloudflare's API         whole, or not at all
        |
the next request runs the new version
```

No build runs, at Cloudflare or anywhere. The install takes the built Worker the release published, and nothing is replaced before every row of step 1 to 3 passed.

| Where                 | Do                                                                        |
| --------------------- | ------------------------------------------------------------------------- |
| the dashboard         | press Update now, at the foot of the side, when a newer version is out    |
| a terminal            | `npx poplin update`                                                       |
| nowhere               | switch `auto_update` on: [Update by itself](#optional-update-by-itself)   |

```text
$ npx poplin update --dry-run
0.3.1 is out; the install runs 0.3.0
the install holds its key
nothing was started

$ npx poplin update
the install now runs 0.3.1; it ran 0.3.0
```

**It worked when** the foot of the dashboard's side, and the `version` row of `npx poplin doctor`, name the new version. Activity says `Started an update to 0.3.1`.

| What stays as it was                                   | How                                                              |
| ------------------------------------------------------ | ---------------------------------------------------------------- |
| the bucket, the database, every variable, and the key  | the upload names every binding the Worker has as kept            |
| the routes, the DNS records, the rules, and the login  | an upload does not touch them                                    |
| the Worker's log settings                              | the upload states them again: the release's, or else the Worker's own |
| the schedule of the sweep                              | written only when the release's differs                          |

| The install finds                                         | It answers            | Changed |
| --------------------------------------------------------- | --------------------- | ------- |
| no release above the running version, or `--to` the version it runs | `no_update` | nothing |
| a start in the same minute                                | `too_many_requests`   | nothing |
| a key Cloudflare no longer takes, or none                 | `key_refused`, `no_key` | nothing |
| a key made before poplin could update itself              | `lacks_right`, about `Workers Scripts Write` | nothing |
| the website or the release's page does not answer         | `release_refused` | nothing |
| a file whose digest or size is not the published one      | `release_refused` | nothing |
| a manifest of another version or schema than the website names | `release_refused` | nothing |
| a release that needs a binding the Worker does not have   | `release_refused` | nothing |
| Cloudflare refuses the new code, such as code that stops as it starts | `version_refused` | nothing: the install runs the version it ran |
| Cloudflare does not answer the upload                     | `update_unreachable`  | the update may be in: reload in a minute |

`release_refused` comes with a word for which row it is. For `key_refused`, `no_key`, and `lacks_right`, press Repair on the Domain screen with an account token: it makes a key with every right the install uses. [When poplin refuses](../fix/poplin-refuses.md) has each code.

A release that changes the database is taken when you start it, never by itself. Once it ran, an older poplin cannot read the database, so the install cannot [go back](#go-back) from it.

[The kept key](../about/security.md#the-kept-key) says what the key can reach, and [Hardening](../about/security.md#hardening) what an update still trusts.

## Go back

For an install that updated itself, to the version it ran before that update.

```text
0.3.1 runs, by its own update from 0.3.0
        |
Go back to 0.3.0, or poplin update --to 0.3.0
        |
the same four steps, for release 0.3.0     fetched, checked, one upload with the kept key
```

| After an update that                              | Going back                                                                              |
| ------------------------------------------------- | --------------------------------------------------------------------------------------- |
| did not change the database                       | you start it: the button, or the command                                                |
| could not change the database: its step failed    | the install does it by itself, at the new version's first request                       |
| changed the database                              | refused: `no_update`, and no button. The older code cannot read that database           |
| left code too broken to answer                    | by hand, at Cloudflare: [Roll back at Cloudflare](#roll-back-at-cloudflare)             |

| Where          | Do                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------- |
| the dashboard  | press Go back to 0.3.0, at the foot of the side, under `Running poplin 0.3.1, since ...`    |
| a terminal     | `npx poplin update --to 0.3.0`; `npx poplin update --dry-run` names the version to go back to |

```text
$ npx poplin update --dry-run
no newer version is known; the install runs 0.3.1
the install holds its key
the install can go back to 0.3.0: poplin update --to 0.3.0
nothing was started

$ npx poplin update --to 0.3.0
the install now runs 0.3.0; it ran 0.3.1
```

The upload of an update writes one variable onto the Worker, `LAST_UPDATE`: the version it came from, the version it took, the schema of the database, and when.

The button is there while that variable names the running version as one taken from a lower version, and the database is as that update found it. Going back takes the button away, and so does another version put in place any other way.

`--to` goes below the running version only where the button is: to the version before, and no further. Any other lower version, and the running one, is answered `no_update`. A published version above the running one is taken.

### When a database step fails

```text
update to 0.3.1 is in  ->  first request starts 0.3.1  ->  its database step fails, nothing of it kept
        |
the install asks Cloudflare, with its key, to run the version before again
        |
503  The update to 0.3.1 could not change the database. poplin went back to 0.3.0. Reload in a minute.
```

| Question            | Answer                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------- |
| How long            | Cloudflare runs the version before about ten seconds after it is asked                                  |
| What is lost        | nothing: a step is kept whole or not at all, so the database is as 0.3.0 left it                        |
| Where it shows      | Activity: `Went back to 0.3.0: the update to 0.3.1 could not change the database`; the problem `update_went_back` |
| When it stays put   | the install holds no key, the code was put in place another way, or an earlier step of the same release was kept |
| What to do          | report it, and update again once a later release is out                                                 |

Where the install stays put, it answers `This install's database could not be brought up to date. Try again.` until the step runs, or until you roll back at Cloudflare.

### Roll back at Cloudflare

For code that cannot answer at all. Cloudflare's documentation gives these steps:

| Step | In Cloudflare's dashboard                                                        |
| ---- | -------------------------------------------------------------------------------- |
| 1    | go to Workers & Pages and select your Worker, `poplin`                           |
| 2    | select Deployments                                                               |
| 3    | open the menu of the version to go back to, then select Rollback                 |

After a rollback there, press Check on the Domain screen: it says whether every piece of the install is as it should be.

A release refuses a database whose schema a newer release changed. After a rollback to such a release the install answers `This install's database is newer than its code: update poplin.` until a release that knows that schema runs again.

## What a release publishes

| On the release's page            | Holds                                                                         | Its SHA-256 digest is in      |
| -------------------------------- | ----------------------------------------------------------------------------- | ----------------------------- |
| `poplin-<version>-worker.json`   | a manifest: the version, the schema, and the digest and size of each built file | `releases.json`, as `bundle`  |
| `poplin-<version>-worker.js`     | the built Worker: the one file an install or an update uploads                | the manifest                  |
| `poplin-<version>-worker.js.map` | the built Worker's source map                                                 | the manifest                  |

```json
{ "0.3.1": { "bundle": "<64 hex>", "schema": 1 } }
```

- **Attested.** GitHub attests each of the three files as made by the project's release workflow, in a run of its main branch. The website names a release only when all three pass, and the built files are the ones the manifest states.
- **Built twice.** The release workflow builds the Worker two times from the release's commit. A release whose two builds differ by one byte is not made.
- **Schema.** `schema` counts the steps the release's database has been through. A release whose number differs from the running install's changes the database. `latest.json` carries the number too.

The website is built after a release is out, so a new release is named there, and in the notice of [A newer version](#a-newer-version), within a day of its release.

An install and an update upload the Worker's source map with the Worker, so an error in Cloudflare's log of the Worker names a source file and its line. A map of more than 16 MiB is left out. No address serves the map.

## The command on your computer

`poplin doctor` names both versions. When they differ, the row says so:

```text
ok  version   install 0.2.0, this poplin 0.1.0: the install and this poplin are of two versions; update the older one
```

`npx poplin@latest doctor` runs the newest command.

## Optional: update by itself

With the setting `auto_update` on, the install updates with nobody asking: it takes the release with its key. It is off in a new install. On an install that holds no key it starts nothing.

```sh
npx poplin config auto_update on
```

| It starts an update when all of these hold               | Otherwise                                             |
| -------------------------------------------------------- | ----------------------------------------------------- |
| `auto_update` and `update_check` are both on             | nothing starts by itself                              |
| the project's website answered that day                  | nothing starts that day                               |
| a version newer than the install's is out                | nothing starts                                        |
| the release does not change the database                 | it never starts by itself: you start it               |
| 3 days passed since the install first knew of the version | it waits                                             |
| the install holds its key                                | nothing starts                                        |
| it has not started that version, or a newer one, before  | it never starts one version twice                     |

| Question                 | Answer                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------ |
| When it looks            | once a UTC day, right after it asked which version is the newest: a start comes 3 to 4 days after the version was first seen |
| A release that changes the database | waits for you: press Update now in the dashboard, or run `poplin update`                    |
| A release that could not be fetched or checked | tried again the next UTC day: nothing was sent to Cloudflare                     |
| An upload Cloudflare refused        | tried again the next UTC day, once a day at most                                            |
| An upload with no answer from Cloudflare | not started again by itself, since it may be in: run `poplin update`                   |
| Which version            | the version that waited its 3 days, and no other                                                       |
| Where it shows           | under Activity in the dashboard: `Started an update to 0.2.0 by itself`, by `sweep@poplin.invalid`    |
| Going back               | an update it started is one the database did not change, so [Go back](#go-back) is offered after it   |
| Switching it off         | `poplin config auto_update off`                                                                        |

## A newer version

While the setting `update_check` is on, the install says when a newer version is out. `poplin update --dry-run` says the same on every kind of install.

```text
$ poplin doctor
ok  install   https://poplin.example.com answers
ok  version   install 0.1.0, this poplin 0.1.0
ok  update    0.2.0 is out (this install runs 0.1.0): https://example.com/changelog/#v0-2-0
ok  login     admin token 3f9a1c07b2d84e65, saved on this machine, expires 2026-12-15
ok  settings  20 settings read
ok  sites     4 sites
ok  trash     0 sites
nothing was changed
```

| Question             | Answer                                                                                             |
| -------------------- | -------------------------------------------------------------------------------------------------- |
| What is checked      | one file on the project's website, `latest.json`, which names the newest release an install can take  |
| How often            | once a UTC day, by the install itself; a day with no answer is tried again the next day            |
| What is sent         | a plain request for the file: no version, no id, and no address of the install is put in it        |
| What Cloudflare adds | a `CF-Worker` header on every request a Worker sends. It names where the Worker runs: the account's `workers.dev` name, or the install's domain |
| Where it shows       | the foot of the dashboard's side, on every page: `0.2.0 is out` and a link, What changed           |
| Where else           | the `update` row of `poplin doctor`, and `update` under `--json`; no row when nothing newer is out |
| Switching it off     | `poplin config update_check off`: nothing is asked, and a release learned before is not shown      |
| Updating to it       | `poplin update`, on an install that holds its key; [Update the install](#update-the-install) says what one without a key does first |
