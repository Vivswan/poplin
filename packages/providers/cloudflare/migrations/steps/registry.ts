// The steps that take an install's side at Cloudflare on from a release: what an older poplin left there, changed to what this one expects.
//
//   <version>.ts   the steps that migrate away from that release, named and shaped as core's files of schema steps are
//   VERSIONS       lists every file, in ascending order of version
//
// Each step says who can do it. No release has left anything to change, so no file is listed, and no code runs a step.

import type { StepBy } from "../../../../core/src/migrations/migrate";
import type { CloudflareResult, Connection } from "../../src/shared/install/client";

/** Where a step works, and with what: the key of whoever runs it, the account, and the name of the install's Worker. */
interface StepPlace {
  readonly connection: Connection;
  readonly accountId: string;
  readonly script: string;
}

/** What every step holds, whoever can do it. */
interface StepOfAny {
  /** What the step is called within its version, in lower case with hyphens; no other step of the version has it. */
  readonly name: string;

  /** What the step changes, in a few words. */
  readonly description: string;

  /** Who can do the step. */
  readonly by: StepBy;

  /** Makes the change at Cloudflare. A change that is already there is made again to no effect. */
  readonly run: (place: StepPlace) => Promise<CloudflareResult<unknown>>;
}

/** A step the install can do by itself, with the key it keeps. */
interface InstallStep extends StepOfAny {
  readonly by: Extract<StepBy, "install">;
}

/** A step only a repair can do, with the account token it is given. */
interface TokenStep extends StepOfAny {
  /** Who can do the step: a repair alone. */
  readonly by: Extract<StepBy, "account token">;

  /** What the person must do and why, in one sentence that names Repair: the release notes carry it. */
  readonly notice: string;
}

/** One change at Cloudflare. */
export type ProviderStep = InstallStep | TokenStep;

/** The steps that take an install on from one release: the file `<version>.ts`. */
export interface ProviderVersionSteps {
  /** The release the steps migrate away from, as a bare `X.Y.Z`: the name of the file. */
  readonly version: string;

  /** The steps, in the order they run. */
  readonly steps: readonly ProviderStep[];
}

/** Every file of steps, in ascending order of version. */
export const VERSIONS: readonly ProviderVersionSteps[] = [];
