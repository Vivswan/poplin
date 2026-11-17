---
title: Back up
order: 20
---

# Back up and put back

Export downloads sites and the settings as one zip, and import puts them back. The two are also the one way to [move an install](#move-an-install). [When poplin refuses](../fix/poplin-refuses.md) lists what each can refuse.

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
| `poplin import backup.zip --settings --users`        | replaces the logins as well                             |

Every other example runs the same way, with `npx` before `poplin`.

- **The zip holds plain files.** It holds no token and no key of the install.
- **Nothing is overwritten.** A site the install already has is skipped.
- **An install without a domain checks each site as it checks a publish.** A site whose live version has a link that starts with `/` is not put back: its line says `failed` with `root_links` and the first such link, nothing of it is sent, and the next site is tried. [Publish](../sites/publish.md) has the rule. `--dry-run` does not check it.

## What a restore brings back

A restore is `poplin import backup.zip --settings --users` into an install that holds none of the zip's sites. A test does that, exports the restored install, and compares the two zips: they hold the same, but for the moment the zip was made.

| Comes back                             | As it was                                                                             |
| -------------------------------------- | ------------------------------------------------------------------------------------- |
| each site, in the trash or not         | its id, name, title, who can open it, public name, expiry, and dates. Its address too, in an install at the same place |
| each file                              | its path, its bytes, and its type                                                     |
| the live version                       | under its number, with who published it and when                                      |
| the other kept versions                | the same, from a zip made with `--all-versions`. A site too large to import with every version is tried again with its live version alone |
| the settings, with `--settings`        | every one but the logins                                                              |
| the logins, with `--settings --users`  | the whole list                                                                        |

| Stays behind                    | So                                           |
| ------------------------------- | -------------------------------------------- |
| every token                     | each machine logs in again                  |
| the activity log                | the log starts anew, with the import         |
| a version the zip does not hold | a zip of live versions restores those alone  |

## Move an install

Poplin has no command that moves an install: not to a domain, not off one, and not to another account. The one way is the same for each: back up, install anew where you want it, and bring the data back.

```text
the old install  ->  backup.zip  ->  a new install, where you want it
     export                              import
```

| Step | Do                                                                    | Line                                                    |
| ---- | --------------------------------------------------------------------- | ------------------------------------------------------- |
| 1    | save every site, its kept versions, and the settings                  | `npx poplin export --all-versions --out backup.zip`     |
| 2    | check the zip: it lists its sites, and sends nothing                  | `npx poplin import backup.zip --dry-run`                |
| 3    | in the same account: remove the old install, whole                    | [Remove](remove.md) from its step 2, without `--keep-data` |
| 4    | install anew, where you want it                                       | `npx poplin install cloudflare`, as [Install](../start/install.md) has it |
| 5    | log this machine in to the new install, with Can change: Everything  | `npx poplin login --server https://poplin.example.com`  |
| 6    | bring the sites and the settings back                                 | `npx poplin import backup.zip --settings`               |
| 7    | to another account: remove the old install                            | [Remove](remove.md) from its step 3                     |

One account holds one install. So a move inside an account, to a domain or off one, removes the old install in step 3, before the new one is made. A move to another account leaves the old install up until step 7: remove it once step 6 put every site back.

**Leave Remove's step 1 out.** It is the export of step 1 here, and a second run is refused with `file_exists`, since `backup.zip` is there already. In step 7, leave its step 2 out on this machine too: step 5 logged it in to the new install, and a logout would end that login.

**Keep the zip safe.** After step 3 it is the only copy of your sites until step 6 is done. The last line of step 2 is `The backup passed every check`, before the line of the dry run, for a zip that can be read. It does not try the sites against the new install.

**Before step 1, where the move is off a domain**, mend what an install without a domain does not take, and publish those sites again:

| An install without a domain refuses | Do, on the old install                                                              |
| ----------------------------------- | ----------------------------------------------------------------------------------- |
| a site with a link that starts with one `/` in a page | write the link from its own page, as [Publish](../sites/publish.md) has the rule |
| a public name in the form of a site's id | give the site another public name                                              |

A site that is refused for one of these two has a line that says `failed` in step 6, and the next site is tried. Its files are still in the zip, under `sites/`, as plain files.

| Thing                         | After the move                                                                                  |
| ----------------------------- | ----------------------------------------------------------------------------------------------- |
| a site's address              | built from the site's name and id, which stay, and the new install's address. It changes when the domain or the kind of install changes, and stays the same under the same domain |
| a link you shared             | stops where the address is new, once the old install is removed. Nothing sends it on: send the new one |
| a public name                 | comes back with its site, at the new install's address                                          |
| each machine's login         | made anew: the zip holds no token. Run `npx poplin login`, with `--server` and the new address, on each one |
| the users                     | the first login of the new install. `--settings --users` puts the old list in its place, where that list holds a login of the new install. Else it is refused with `no_working_login` |
| the install's keys            | made anew by the new install: the zip holds none                                                |
| the activity log              | starts anew                                                                                     |
| the kept versions             | come back from a zip made with `--all-versions`, and from no other. A site too large to import with every version is tried again with its live version alone |

```text
under example.com      https://report--k3f9x2ab71qz-p-poplin.example.com
without a domain       https://poplin-private.your-name.workers.dev/report--k3f9x2ab71qz/
```

[Keep the data](remove.md#keep-the-data) is another thing: an install of the same kind, made again in the same account over the data as it stands. It is not a way to move.

## The database's own history at Cloudflare

Cloudflare keeps a history of the install's database, named `poplin`, and calls it Time Travel. Its documentation says it is "always on", reaches back "7 days (Workers Free plan)", and that history and a restore "incur no additional costs". It is a second net under the export, for the records alone.

| Time Travel         | Holds                                                                                                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| brings back         | the records: sites and their versions, the settings, the logins, the tokens, the activity log, the counts of visits, the key the visitor limits are made from |
| does not bring back | a file. The files are in the bucket, which has no such history                                                                                                    |
| reaches             | any minute of the last 7 days on the free plan                                                                                                                    |
| is run with         | Cloudflare's own tool: `wrangler d1 time-travel restore poplin --timestamp=<moment>`                                                                              |

- **It overwrites the database in place.** The command prints a bookmark that undoes the restore.
- **A site deleted for good stays gone.** Its record comes back and its files do not, so a browser that holds no copy of a page gets a 404.
- **The export stays the backup.** It alone holds the files, and it outlasts the 7 days.

### Before the install is used again

The restore also undoes what was removed after the moment it goes back to. Go through this list first.

| After the restore                                             | So                                                         | Do                                                                           |
| ------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------- |
| a token removed after that moment is a token again            | it works again, unless it ran out since                    | Access, Tokens: remove it again. It is in the list above Removed tokens      |
| a user removed after that moment is a user again              | their email is in `logins` again                           | Access, Users: remove them again, before the next Repair                     |
