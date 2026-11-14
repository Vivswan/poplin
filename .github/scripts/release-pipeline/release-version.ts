/** The version a release publishes under the `latest` dist-tag. */

const RELEASE_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/**
 * The package's version, held to the release tag: package.json is the file npm reads, and release-please rewrites it apart from the tag.
 *
 * @param tag - the release tag, vX.Y.Z
 * @param packageVersion - the version in the published package's package.json at the release commit
 * @throws {Error} the tag is not vX.Y.Z, or it names another version than package.json
 */
export function releaseVersion(tag: string, packageVersion: string): string {
  if (!RELEASE_TAG.test(tag)) {
    throw new Error(`the release tag ${JSON.stringify(tag)} is not vX.Y.Z; refusing to publish a release under it.`);
  }

  if (`v${packageVersion}` !== tag) {
    throw new Error(
      `package.json at the release source is version ${packageVersion}, but the release tag is ${tag}; refusing to publish a version this source did not release.`,
    );
  }

  return packageVersion;
}
