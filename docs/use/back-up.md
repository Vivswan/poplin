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
