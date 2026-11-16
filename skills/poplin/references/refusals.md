# Refusals, by code

Open this when a poplin tool or command answers with a refusal. From a tool, or from a command run with `--json`, a refusal is one object with a `code`, a sentence, and often a hint. Without `--json` a command prints the sentence and the hint as text. The hint is written for the case at hand, so read it first.

| Code                                              | Means                                            | What to do                                                           |
| ------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------- |
| `no_login`, `not_logged_in`                       | no login on this computer, or it ran out         | tell the user; logging in again is their call                        |
| `not_allowed`                                     | this login may not touch that site               | tell the user; do not look for a way around it                       |
| `not_found`                                       | no site with that label or public name           | `list_sites`; the label changes after `new_link`                     |
| `in_trash`                                        | the site is in the trash                         | ask: restore it, or publish a new site                               |
| `no_index`                                        | the folder has no `index.html` at its root       | add one, or publish the one HTML file                                |
| `no_name`                                         | the path gives the site no name                  | pass `name` (`--name`)                                               |
| `bad_name`                                        | a name or a public name breaks the rules         | lowercase letters, digits, single dashes, 3 to 40 characters         |
| `bad_path`                                        | a file's path cannot be served                   | rename or leave out that file, and say which                         |
| `root_links`                                      | the install has no domain, and a page links with a path that starts with `/`; nothing was sent | write the link from its own page, `css/site.css` for `/css/site.css`, and publish again |
| `name_taken`, `reserved_name`                     | the public name is held                          | ask the user for another public name                                 |
| `no_such_version`                                 | the install keeps no such version                | `get_site` lists the kept versions                                   |
| `too_large`, `too_many_sites`                     | a limit of the install                           | tell the user the limit; do not delete sites to make room unasked    |
| `stale_version`, `missing_files`, `size_mismatch` | the publish did not complete; nothing went live  | publish again, the same way                                          |
| `hash_mismatch`                                   | a file changed while it was published; nothing went live | publish again once nothing writes to the folder              |
| `unreachable`, `timeout`, `internal`              | no answer, or the install failed part way        | the change may have been made: `list_sites` before you try again     |
| `stopped`                                         | the user stopped the command or the server       | the upload is given up or runs out in a day; ask before a retry      |
| `allowance_spent`                                 | a day's allowance is used up: the database's, or the storage's writes | tell the user; do not try again before 00:00 UTC |
| `not_set_up`                                      | the install has stored no settings               | try again; if it stays, the user runs `npx poplin doctor --repair`   |
| `release_refused`, with a hint that names the repair | the install cannot take this release by itself | the user runs `npx poplin doctor --repair`, with their account token |
| `no_working_login`                                | the new logins would let nobody log in           | the user keeps one email that is a login now in the list             |

After `unreachable`, `timeout`, or `internal` on a publish, check the list before you repeat it. A second publish with no `site` would make a second site.

The table holds the codes an agent meets most. Any other code carries its own sentence, and sometimes a hint: tell the user what it says.

## From the commands that work at Cloudflare

Three commands work with the user's account token: `npx poplin install cloudflare`, `npx poplin doctor --repair`, and `npx poplin uninstall cloudflare`. With `--json` each names why it stopped in `problem`, not in `code`. [`setup.md`](setup.md) has the ones of an install's dry run. The rest:

| Problem                  | Means                                                      | What to do                                                        |
| ------------------------ | ---------------------------------------------------------- | ----------------------------------------------------------------- |
| `missing_answer`         | a run that asks nothing lacks an answer, named in its list | give the option the line on stderr names                          |
| `usage`                  | the line is written wrong, and the value says how          | correct the line: `npx poplin install --help`                     |
| `already_installed`      | the account holds an install; nothing was changed          | run what `next` names: the login at the address under `found`, or `npx poplin doctor --repair` where the install needs mending |
| `leftover`               | a bucket or a database of poplin's name, and no install    | ask the user; `--adopt` uses it with what it holds                |
| `name_held`              | a Worker named poplin that is not poplin's own, or an install's Worker that lost a binding | the user does what its sentence says, at `address`; then `next`   |
| `blocked`                | the user must act first, as its list says                  | the table of blocks in [`setup.md`](setup.md)                     |
| `token_refused`          | Cloudflare refused the token, or it shows no such account  | the user makes the token again, for the right account             |
| `no_domain`              | the token shows no active domain of that name              | check the domain with the user, and the token's Zone Resources    |
| `unreachable`, `crashed` | no answer, or a failure with no word for it                | run it again in a minute                                          |
| `no_install`             | the repair or the removal found no install in the account; or a removal with `--keep-data` found kept data alone | tell the user what its sentence says: a token of another account, or kept data that a removal without `--keep-data` removes |
| `other_place`            | the install is of another place than the line named; for the install and the removal, also one started and not finished | give `--domain` and its domain, or `--no-domain`, as the sentence says |
| `unfinished`             | the repair found an install that was started and never set | finish it with the install command: part e of [`setup.md`](setup.md). Where `next.command` holds `--domain` or `--no-domain`, the install was started for that place: use it, not the one your line gave |
| `another_version`        | the install's records are of another version than this command | run the repair as `npx poplin@latest`                         |
| `not_confirmed`          | the removal was given an address that is not the install's; nothing was removed | tell the user; the address is theirs to give |
| `changed`                | the account changed between the look and the work          | run it again                                                      |
