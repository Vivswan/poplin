# Changelog

## [0.1.3](https://github.com/Vivswan/poplin/compare/v0.1.2...v0.1.3) (2026-11-24)


### Features

* choose when a token expires, and change it later ([#487](https://github.com/Vivswan/poplin/issues/487)) ([faa7d03](https://github.com/Vivswan/poplin/commit/faa7d031082cd482a3f7c45a16f46174d4dfe9f8))
* **cli:** end a finished install and login with how to give the agent poplin ([#479](https://github.com/Vivswan/poplin/issues/479)) ([eb1602f](https://github.com/Vivswan/poplin/commit/eb1602fe0ee697cd0896069f514afce95984cfda))
* **cli:** show the token step as four steps and one link, not a wall of text ([#472](https://github.com/Vivswan/poplin/issues/472)) ([7090ca1](https://github.com/Vivswan/poplin/commit/7090ca116c8ff8c462232c359a667cf1727f5e65))
* **dashboard:** copy the whole status of the Domain screen ([#474](https://github.com/Vivswan/poplin/issues/474)) ([f8ac32b](https://github.com/Vivswan/poplin/commit/f8ac32b57ff265da454ae09a6cf48517a6c56e41))
* **dashboard:** fold a site's files, versions, and details, and change a value by its pencil ([#489](https://github.com/Vivswan/poplin/issues/489)) ([4a71baf](https://github.com/Vivswan/poplin/commit/4a71baf229a05a04ef54e039914a9034f9ae7022))
* **dashboard:** list a site's files in its panel ([#488](https://github.com/Vivswan/poplin/issues/488)) ([e1a2fe3](https://github.com/Vivswan/poplin/commit/e1a2fe3b82d840b79722792d6bf2bfc22d3ac004))
* **dashboard:** show the version in Settings beside the update, not in the side menu ([#476](https://github.com/Vivswan/poplin/issues/476)) ([4b6a5d4](https://github.com/Vivswan/poplin/commit/4b6a5d41db2501d1ed50f22c38e49b66dd16fb8f))
* install poplin in Claude Code as a plugin, with its MCP server and its skill ([#483](https://github.com/Vivswan/poplin/issues/483)) ([9270344](https://github.com/Vivswan/poplin/commit/92703446f16e4f9efbb15e2ad3f9584d6892d5ef))
* type or paste the whole login code, which the CLI copies for you ([#477](https://github.com/Vivswan/poplin/issues/477)) ([700fea6](https://github.com/Vivswan/poplin/commit/700fea6bd90044265ee5017e894f87246b3d0760))
* **website:** show the skills install line in the Start block ([#484](https://github.com/Vivswan/poplin/issues/484)) ([2b12139](https://github.com/Vivswan/poplin/commit/2b1213976dd066b1d390016c2ef6d4c20949d449))


### Bug Fixes

* **cli:** redraw only the spinner while a step runs ([#481](https://github.com/Vivswan/poplin/issues/481)) ([478b52d](https://github.com/Vivswan/poplin/commit/478b52d107483e2fa074c7fb128af4abad01ee17))
* **cli:** say a skipped optional row in one short line, with the step that is true for the run ([#473](https://github.com/Vivswan/poplin/issues/473)) ([134e629](https://github.com/Vivswan/poplin/commit/134e629dd4e897dad7464a459bbdbb5a35e30459))
* **cloudflare:** make the account's workers.dev subdomain when a fresh account has none ([#480](https://github.com/Vivswan/poplin/issues/480)) ([82ca725](https://github.com/Vivswan/poplin/commit/82ca72529da2248861a5c380411c4ff0dd36deeb))
* **cloudflare:** ride out a bucket name Cloudflare still holds after a removal ([#490](https://github.com/Vivswan/poplin/issues/490)) ([5743684](https://github.com/Vivswan/poplin/commit/5743684092622cad9b0076f987010436a39078db))
* show the hand pointer over every control that can be pressed ([#485](https://github.com/Vivswan/poplin/issues/485)) ([2ab6d51](https://github.com/Vivswan/poplin/commit/2ab6d515d794cc3458d0a6ba039a105a9a5de873))

## [0.1.2](https://github.com/Vivswan/poplin/compare/v0.1.1...v0.1.2) (2026-11-19)


### Features

* **website:** show the one install command on the home page ([#457](https://github.com/Vivswan/poplin/issues/457)) ([3f719d3](https://github.com/Vivswan/poplin/commit/3f719d3ea6e840be2c5846f61a371655737eb528))
* **website:** show what is requested, not built, in the comparison ([#458](https://github.com/Vivswan/poplin/issues/458)) ([b19c4b0](https://github.com/Vivswan/poplin/commit/b19c4b0e47403ca384504dd10b8b3d2cba0f6e0c))

## [0.1.1](https://github.com/Vivswan/poplin/compare/v0.1.0...v0.1.1) (2026-11-18)


### Features

* **cloudflare:** offer the Cloudflare login beside the email code and the passkey ([#440](https://github.com/Vivswan/poplin/issues/440)) ([c34ff10](https://github.com/Vivswan/poplin/commit/c34ff109940ff60e5dfe3cfe838ee1bb4589b7e6))

## 0.1.0 (2026-11-18)


### Features

* **access:** a site is private, unlisted, or public, and users log in with an email code or a passkey ([c273dfd](https://github.com/Vivswan/poplin/commit/c273dfd37af95f6a01e4acb01794f4dec01cc62f))
* **backup:** export every site and the settings as one zip, and import it ([c273dfd](https://github.com/Vivswan/poplin/commit/c273dfd37af95f6a01e4acb01794f4dec01cc62f))
* **cli:** manage the sites and the install from a terminal, and see a change first with --dry-run ([c273dfd](https://github.com/Vivswan/poplin/commit/c273dfd37af95f6a01e4acb01794f4dec01cc62f))
* **dashboard:** the screens Sites, Activity, Usage, Access, Domain, and Settings ([c273dfd](https://github.com/Vivswan/poplin/commit/c273dfd37af95f6a01e4acb01794f4dec01cc62f))
* **install:** one command installs poplin in your Cloudflare account, under your domain or without one ([c273dfd](https://github.com/Vivswan/poplin/commit/c273dfd37af95f6a01e4acb01794f4dec01cc62f))
* **limits:** settings cap storage, a day's files, and requests, and a budget alert emails the users you choose ([c273dfd](https://github.com/Vivswan/poplin/commit/c273dfd37af95f6a01e4acb01794f4dec01cc62f))
* **publish:** publish one HTML file or a folder, from an AI agent or from the command line ([c273dfd](https://github.com/Vivswan/poplin/commit/c273dfd37af95f6a01e4acb01794f4dec01cc62f))
* **upkeep:** update the install, go back a version of a site, check the install and repair it ([c273dfd](https://github.com/Vivswan/poplin/commit/c273dfd37af95f6a01e4acb01794f4dec01cc62f))
