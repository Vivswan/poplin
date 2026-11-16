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

## The database's own history at Cloudflare

Cloudflare keeps a history of the install's database, named `poplin`, and calls it Time Travel. Its documentation says it is "always on", reaches back "7 days (Workers Free plan)", and that history and a restore "incur no additional costs". It is a second net under the export, for the records alone.

| Time Travel         | Holds                                                                                                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| brings back         | the records: sites and their versions, the settings, the logins, the tokens, the activity log, the counts of visits, the update link, the key that signs sessions |
| does not bring back | a file. The files are in the bucket, which has no such history                                                                                                    |
| reaches             | any minute of the last 7 days on the free plan                                                                                                                    |
| is run with         | Cloudflare's own tool: `wrangler d1 time-travel restore poplin --timestamp=<moment>`                                                                              |

- **It overwrites the database in place.** The command prints a bookmark that undoes the restore.
- **A site deleted for good stays gone.** Its record comes back and its files do not, so a browser that holds no copy of a page gets a 404.
- **The export stays the backup.** It alone holds the files, and it outlasts the 7 days.

### Before the install is used again

The restore also undoes what was removed after the moment it goes back to, and it winds each site's version numbers back while the bucket keeps its files. Go through this list first.

| After the restore                                             | So                                                         | Do                                                                           |
| ------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------- |
| a token removed after that moment is a token again            | it works again, unless it ran out since                    | Access, Tokens: remove it again. It is in the list above Removed tokens      |
| a user removed after that moment is a user again              | their email is in `logins` again                           | Access, Users: remove them again, before the next Repair                     |
| a site published after that moment can get a used number      | its next publish can say it worked and serve old files     | do not publish to it before the three steps below                            |

A publish stores each file under its site's folder and version number, and skips a file the bucket already holds there at the same size. After the restore a site's next number can be one whose files are still in the bucket: a changed page of the same size then keeps its old bytes, and the publish reports no fault.

Do this for each site that was published after that moment, and for every site if you cannot tell which:

| Step | Example                                                 | Does                                                             |
| ---- | ------------------------------------------------------- | ---------------------------------------------------------------- |
| 1    | `poplin export report--k3f9x2ab71qz --out restored.zip` | downloads the site as the restored records list it               |
| 2    | `poplin delete report--k3f9x2ab71qz --forever`          | removes the site and every file under its folder                 |
| 3    | `poplin import restored.zip`                            | puts it back under its address, in a new folder with no old file |

- **Stop if step 1 fails.** The files of the restored version are gone from the bucket then, and step 2 would remove what is left. Publish the folder as a new site, or undo the restore with its bookmark.
- **Step 2 removes the newer versions for good.** The versions published after that moment are in the bucket and in no record, so no zip holds them.
- **Name a zip that is not there yet.** `--all-versions` adds the other versions the restored records list.
