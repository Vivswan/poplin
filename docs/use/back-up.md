---
title: Back up
order: 40
---

# Back up and put back

Export downloads sites and the settings as one zip, and import puts them back; [When poplin refuses](when-poplin-refuses.md) lists what each can refuse.

| Example                                              | Does                                                    |
| ---------------------------------------------------- | ------------------------------------------------------- |
| `npx poplin export`                                  | downloads every site and the settings as one zip        |
| `poplin export --all-versions --out backup.zip`      | adds the kept versions, and names the zip               |
| `poplin export report--k3f9x2ab71qz`                 | downloads one site                                      |
| `poplin export --out backup.zip --overwrite`         | replaces a zip that is already there                    |
| `poplin import backup.zip`                           | puts the sites of a zip back                            |
| `poplin import backup.zip --dry-run`                 | checks the zip, lists its sites, and imports nothing    |
| `poplin import backup.zip --site report--k3f9x2ab71qz` | puts one site back                                    |
| `poplin import backup.zip --settings`                | replaces the install's settings too, but for the logins |
| `poplin import backup.zip --settings --logins`       | replaces the logins as well                             |

Every other example runs the same way, with `npx` before `poplin`.

- **The zip holds plain files.** It holds no token and no signing key.
- **Nothing is overwritten.** A site the install already has is skipped.

## What a restore brings back

A restore is `poplin import backup.zip --settings --logins` into an install that holds none of the zip's sites. A test does that, exports the restored install, and compares the two zips: they hold the same, but for the moment the zip was made.

| Comes back                             | As it was                                                                             |
| -------------------------------------- | ------------------------------------------------------------------------------------- |
| each site, in the trash or not         | its id and so its address, name, title, who can open it, public name, expiry, and dates |
| each file                              | its path, its bytes, and its type                                                     |
| the live version                       | under its number, with who published it and when                                      |
| the other kept versions                | the same, from a zip made with `--all-versions`                                       |
| the settings, with `--settings`        | every one but the logins                                                              |
| the logins, with `--settings --logins` | the whole list                                                                        |

| Stays behind                    | So                                           |
| ------------------------------- | -------------------------------------------- |
| every token                     | each computer logs in again                  |
| the activity log                | the log starts anew, with the import         |
| a version the zip does not hold | a zip of live versions restores those alone  |
