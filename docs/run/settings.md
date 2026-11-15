---
title: Settings
order: 20
---

# Settings

The settings of an install, the people who can log in, and the login this computer keeps; a site's own settings are in [Manage sites](../use/manage-sites.md#other-settings-of-a-site).

## Change a setting

```sh
npx poplin config
npx poplin config trash_days 30
```

The dashboard's Settings tab changes the same settings.

## The install

| Example                                                              | Does                                              |
| -------------------------------------------------------------------- | ------------------------------------------------- |
| `poplin config`                                                      | shows every setting                               |
| `poplin config versions_kept`                                        | shows one setting                                 |
| `poplin config versions_kept 10`                                     | changes one setting                               |
| `poplin doctor`                                                      | checks that the install answers, and prints its version beside this poplin's, as `install 0.1.0, this poplin 0.1.0`; changes nothing |
| `poplin update`                                                      | starts an update of the install to the newest version; `--check` says what it would do |
| `poplin setup --server https://poplin.your-name.workers.dev --domain example.com --login you@example.com` | finishes a new install, as its setup page does |
| `poplin setup --check --server https://poplin.your-name.workers.dev` | lists what that would change, with the same flags; changes nothing |
| `poplin help rollback`                                               | shows the help of one command                     |

`poplin update` needs a Deploy Hook saved in the install once: [Update the install](update.md#update-the-install) shows how. It is read from `POPLIN_UPDATE_ADDRESS` in the environment, and no command prints it.

An install made with the Deploy button has a build at Cloudflare to make the Deploy Hook for. One made from a terminal or with the OpenTofu module has none: with no URL saved it answers `no_update_address`, and updates as [Update the install](update.md#update-the-install) says.

`poplin setup` reads the Cloudflare API token from `POPLIN_SETUP_TOKEN` in the environment. A new install needs `--domain` and `--login`. On an install that has them, `--login` alone corrects a first login that was mistyped. It needs no login, and it works only until the first login to the install. [From a terminal instead](../start/from-a-terminal.md) shows where it fits.

The settings `poplin config` takes:

| Setting                                                                                 | Holds                                                    |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `default_expires`, `default_search_engines`                                             | what a new site starts with                              |
| `versions_kept`, `trash_days`                                                           | how much is kept, and for how long                       |
| `logins`                                                                                | the emails that may log in                               |
| `dashboard_title`                                                                       | the dashboard's title                                    |
| `outside_pages`, `search_engines_allowed`, `block_bots`                                 | what the install lets in                                 |
| `max_total_size`, `max_site_size`, `max_sites`                                          | size limits                                              |
| `max_files_per_publish`, `max_files_per_day`                                            | how many files one publish holds, and all publishes begun in one UTC day |
| `max_storage_writes_per_day`                                                            | how many times a day the storage is written to or listed |
| `requests_per_day`, `site_share_of_day`, `site_requests_per_minute`, `visitor_requests_per_minute` | request limits                                |
| `update_check`                                                                          | whether the install asks which version is the newest     |

Every command that talks to the install also takes `--json`, for the answer as JSON, and `--server`, to name the install.

## Add a login

A second person needs two steps, because Cloudflare's login page keeps its own list.

| Step | Where                   | Do                                           |
| ---- | ----------------------- | -------------------------------------------- |
| 1    | the dashboard, Settings | add the email to `logins`, and save          |
| 2    | the dashboard, Domain   | paste a token as in [step 3](../start/by-hand.md#the-steps), and press Repair |

A new login works after step 2, not before. Removing another person's login needs step 1 alone: that person is out of the dashboard at once, and out of private sites within a minute. Your own email cannot be the one you remove.

## This computer

| Example                                              | Does                                                          |
| ---------------------------------------------------- | ------------------------------------------------------------- |
| `poplin login --server https://poplin.example.com`   | logs this computer in: you allow it in your browser           |
| `poplin login --publisher --name ci-runner`          | saves a publisher's login, for a computer that should only publish            |
| `poplin login --no-browser`                          | prints the address and opens no browser                       |
| `poplin whoami`                                      | prints the install, the role, and when the login runs out     |
| `poplin logout`                                      | revokes the login and forgets it                              |

```text
$ poplin login --server https://poplin.example.com
  ->  prints an address and a short code
  ->  you open the address, check that the code is the same, and allow it
  ->  the login is saved on this computer
```

An install begins five logins a minute for all computers together. In a minute that is full, `poplin login` waits and asks again.

A computer keeps one saved login: a new `poplin login` replaces it. An agent on the computer uses that login and does not log in itself. `POPLIN_SERVER` and `POPLIN_TOKEN` in the environment stand in for a saved login.

`POPLIN_CONFIG_DIR` in the environment names another folder for the saved login, read when the two names above are not set. Set for an agent's tools alone, it gives the agent a login of its own, which shows under its own name: [the skill's page](../../skills/poplin/references/mcp-server.md#optional-a-login-of-your-own) has the step.

`--publisher` is for a computer or a script that should only publish, such as a build server or a shared machine.

| A publisher's login | What                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| can                 | publish, and for the sites it published: list, show, update, change who can open, roll back, re-link, copy, delete, and restore |
| cannot              | reach a site another login published, or the install's settings, logins, backups, and updates                                   |
