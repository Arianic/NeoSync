# NeoSync

A local-first writing app with built-in Nextcloud synchronization, based on [Neo by Hugh Howey](https://github.com/hughhowey/neo).

NeoSync keeps Neo's plain-file library, distraction-free editor, shelves, notes and covers, and adds desktop synchronization through Nextcloud/WebDAV. This is an independent, unofficial fork maintained by [Arianic](https://github.com/Arianic).

**Beta:** Windows and Linux desktop builds are available through [Releases](https://github.com/Arianic/NeoSync/releases). Read the release notes before using sync with important writing. Keep separate backups; sync is not a backup. Live read-only Nextcloud downloads have been verified, but full live two-device conflict/recovery testing is still incomplete. No macOS or mobile builds are supported in this beta.

## Download

- **Windows:** download `NeoSync-Setup-<version>.exe` and run it, or use the portable `.exe`. Builds are currently unsigned, so Windows may show an unknown-publisher warning.
- **Linux / CachyOS:** download the x86-64 `.AppImage`, make it executable, and run it. Debian/Ubuntu users can use the `.deb` instead. See [LINUX.md](LINUX.md) for FUSE, GNOME Keyring/KDE Wallet, and Niri setup.
- Install updates manually from this repository's Releases page. NeoSync never installs upstream Neo updates automatically.

## Connect your devices

1. Open **File → Nextcloud Sync…** and enter your Nextcloud website address.
2. Choose **Log in with Nextcloud**, approve access in your browser, then return to NeoSync.
3. Choose a dedicated remote folder (the same one on both devices), confirm that only NeoSync syncs the local library, and select **Connect**.
4. Return to the bookshelf and wait for **Synced** before switching devices or opening incoming books.

Manual app passwords are available under **Use an app password instead**. On Linux, a working GNOME Keyring/Secret Service or KDE Wallet is required. The app refuses to save credentials with an unprotected fallback.

The default local library is `Documents/NeoSync Library`. Keep it outside folders already managed by Nextcloud Desktop, OneDrive, iCloud or Syncthing. Account settings and protected credentials are kept separately in the NeoSync application-data directory.

Books, author names, shelves, chapter order, notes, outlines, darlings, stickies and cover assets sync. Backups, exports, passwords and device settings remain local. Downloads are applied on the bookshelf. Conflicting versions are preserved for review rather than silently overwritten.

For the exact merge rules, first-connection behavior and recovery instructions, see [NEXTCLOUD.md](NEXTCLOUD.md).

## Development

Requires Node.js 24 or newer. Build each platform using its native dependencies.

```sh
git clone https://github.com/Arianic/NeoSync.git
cd NeoSync
npm ci
npm start
```

Checks and packaging:

```sh
npm test
npm run test:sync:desktop
npm run test:sync:restart
npm run test:sync:ui
npm run package:win          # Windows
npm run package:linux:x64    # Linux
```

Desktop tests use temporary profiles and dummy accounts. Linux GUI/keyring tests require a graphical session and a working keyring; CI creates a disposable session. Artifacts go to `dist/`, which is excluded from Git. Node modules and personal libraries must not be committed.

## Maintaining this fork

[MAINTAINING.md](MAINTAINING.md) explains upstream merges, release versions, required verification and draft releases. [UPSTREAM.md](UPSTREAM.md) records the integrated Neo revision. Upstream changes are reviewed on a branch before merging into this fork's `main`.

Report NeoSync issues in [this repository](https://github.com/Arianic/NeoSync/issues). Include your OS, desktop environment on Linux, NeoSync version and steps to reproduce. Do not attach passwords or private manuscript files.

## Credits and license

Neo was created by Hugh Howey. NeoSync preserves its Git history and [MIT license](LICENSE), including the original copyright notice. The editor and its original features remain credited to the upstream project. Third-party dependency notices remain included with the application.

NeoSync's Nextcloud integration and fork maintenance are by Arianic. It is not affiliated with or endorsed by Neo or Nextcloud.
