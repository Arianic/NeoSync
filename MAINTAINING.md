# Maintaining NeoSync

## Repositories and branches

`origin` is `https://github.com/Arianic/NeoSync.git`; `upstream` is `https://github.com/hughhowey/neo.git`. The GitHub repository was created independently, so it may not display GitHub's “forked from” badge. The original Git history and an upstream remote provide the same Git merge workflow. Do not delete/recreate the repository just to obtain a badge.

`main` is the tested release branch. Use feature branches for changes and an update branch for each upstream merge. Do not force-reset `main` to upstream or rebase published history. Protect `main` with pull-request review and required NeoSync desktop checks when repository settings permit it.

## Bringing in upstream changes

Check upstream roughly weekly or after a relevant upstream release. Security and save/recovery fixes deserve prompt review; feature changes can wait for a tested integration. This is a manual cadence, not a configured scheduled job.

Start with a clean worktree:

```sh
git switch main
git pull --ff-only origin main
git fetch --no-tags upstream tag v1.3.5
git switch -c update/neo-1.3.5
git merge v1.3.5
```

Replace `1.3.5` with the upstream release being integrated. A release tag keeps the review focused on that release; `upstream/main` may contain newer, unreleased work. Fetching upstream alone never changes NeoSync or anyone's installed app.

Resolve conflicts deliberately. Keep NeoSync's application identity, user-data directory, credential protection, save/apply handoff and update source pinned to Arianic/NeoSync. In particular, do not accept upstream `package.json`, README or release-workflow replacements wholesale. Never change the library format without considering compatibility with another device running the previous NeoSync version.

Review changes, update `UPSTREAM.md`, run tests, and make a pull request to **Arianic/NeoSync main**. Merge after checks pass. Opening an upstream pull request is a separate decision.

## Verification before a public release

- Run `npm test`, desktop smoke, restart and UI tests on Windows and Linux. CI includes native GNOME keyring and unprotected-backend rejection tests on Linux.
- Keep targeted sync lint clean. Full-project lint has inherited findings; do not describe it as passing until those are resolved.
- Test a disposable Windows/Linux library against a real Nextcloud folder: first connection, author names/covers, offline edits, same-file conflicts, deletions/recovery, and close/reopen on both devices.
- Confirm that an installed build keeps the previous profile/library and can decrypt its saved credential. Test each desktop environment before claiming support; GNOME CI alone does not validate other desktop sessions or KDE Wallet.
- Keep MIT and dependency notices. Review the committed source for secrets, personal paths and manuscripts. Only installers and checksum files are release assets.

## Versioning and draft releases

The first public candidate is `1.3.3-beta.1`, above the local 1.3.2 builds already distributed. Record the upstream baseline separately; a matching version number is not a promise to match upstream behavior. Subsequent beta versions can be `1.3.3-beta.2`; the stable release can be `1.3.3` after the live checks pass.

1. Set the version in both package files:

   ```sh
   npm version 1.3.3-beta.2 --no-git-tag-version --ignore-scripts
   ```

2. Add `docs/releases/<version>.md` covering changes, validation, known limitations and any migration steps. Commit the files on the tested `main` branch.
3. Run `npm run release`. It checks the branch, clean worktree (including new files), destination repository, matching metadata and tag availability, then pushes `main` and an annotated `neosync-v<version>` tag.
4. Wait for **NeoSync desktop** in GitHub Actions. It tests and builds Windows and Linux and creates a **draft** release with installers and per-platform SHA-256 manifests. Prerelease versions get the prerelease flag.
5. Check the installers, checksum files and release notes. Starting with beta.3, also verify `latest.yml`, `latest-linux.yml` and the Windows blockmap are attached. CI verifies the metadata's file names, sizes and SHA-512 hashes against the actual installers. Test a complete installed-version upgrade on both platforms before claiming end-to-end validation.
6. Publish the draft manually only when ready. Publishing makes it eligible for automatic download by installed NeoSync versions from beta.3 onward. Drafts are invisible to the updater. Beta installations follow the same prerelease channel or a newer stable release; stable installations exclude prereleases. Installation requires **Restart to update**, after local saves finish. Older versions, Windows portable builds and Debian packages require manual updates.

Keep `neosync-v<version>` tags. `updates.js` validates published releases from Arianic/NeoSync and pins the updater to that release's download directory, because the standard GitHub provider does not recognize these beta tags. Builder metadata uses the same `latest*.yml` filenames inside each versioned release; it is not a separate rolling feed. `--publish never` still prevents the packaging step from publishing anything. Do not add repository tokens to the app.

The workflow refuses to overwrite an already-published release. If a build fails, fix it and use a new version/tag if source changes are needed. A failed infrastructure run can be rerun for the same commit while its release remains a draft. Never silently replace a public artifact with different contents.

## Scope

Windows and Linux x64 are the release targets. Builds are unsigned. macOS signing/notarization and mobile sync are not part of this beta. The inherited Pocket workflow is disabled for this repository. ARM64 can be built locally but is not included in supported release assets until runtime-tested.
