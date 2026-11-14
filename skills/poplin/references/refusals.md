# Refusals, by code

Open this when a poplin tool or command answers with a refusal. From a tool, or from a command run with `--json`, a refusal is one object with a `code`, a sentence, and often a hint. Without `--json` a command prints the sentence and the hint as text. The hint is written for the case at hand, so read it first.

| Code                                              | Means                                            | What to do                                                           |
| ------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------- |
| `no_login`, `not_logged_in`                       | no login on this computer, or it ran out         | tell the user; logging in again is their call                        |
| `not_allowed`                                     | this login may not touch that site               | tell the user; do not look for a way around it                       |
| `not_found`                                       | no site with that label or name                  | `list_sites`; the label changes after `new_link`                     |
| `in_trash`                                        | the site is in the trash                         | ask: restore it, or publish a new site                               |
| `no_index`                                        | the folder has no `index.html` at its root       | add one, or publish the one HTML file                                |
| `no_name`                                         | the path gives the site no name                  | pass `name` (`--name`)                                               |
| `bad_name`                                        | a name or a public name breaks the rules         | lowercase letters, digits, single dashes, 3 to 40 characters         |
| `bad_path`                                        | a file's path cannot be served                   | rename or leave out that file, and say which                         |
| `name_taken`, `reserved_name`                     | the public name is held                          | ask the user for another public name                                 |
| `no_such_version`                                 | the install keeps no such version                | `get_site` lists the kept versions                                   |
| `too_large`, `too_many_sites`                     | a limit of the install                           | tell the user the limit; do not delete sites to make room unasked    |
| `stale_version`, `missing_files`, `size_mismatch` | the publish did not complete; nothing went live  | publish again, the same way                                          |
| `unreachable`, `timeout`, `internal`              | no answer, or the install failed part way        | the change may have been made: `list_sites` before you try again     |
| `not_set_up`                                      | the install has stored no settings               | try again; if it stays, the user deploys the install again           |

After `unreachable`, `timeout`, or `internal` on a publish, check the list before you repeat it. A second publish with no `site` would make a second site.

The table holds the codes an agent meets most. Any other code carries its own sentence, and sometimes a hint: tell the user what it says.
