# NeoSync on Linux

The desktop Nextcloud/WebDAV implementation is shared by Linux, Windows and macOS. Linux uses the same readable library files, sync baseline, conditional uploads, recovery copies and bookshelf-only incoming application. Follow [Nextcloud setup and recovery](NEXTCLOUD.md) after starting the app.

## Install or build

Linux packaging supports x86-64 and ARM64, with **AppImage** and **Debian `.deb`** targets. The executable and desktop entry are named `neosync`, and the application is displayed as **NeoSync**. Upstream automatic updates remain disabled. Packages are built with `--publish never`.

For an AppImage, make the downloaded file executable and open it from your file manager, or run:

```sh
chmod +x NeoSync-1.3.3-beta.1-x86_64.AppImage
./NeoSync-1.3.3-beta.1-x86_64.AppImage
```

Starting with beta.5, NeoSync uses upstream's newer AppImage runtime, avoiding the older libfuse2 requirement. Older builds may need your distribution's AppImage/FUSE support. AppImage also supports `--appimage-extract-and-run` when mounting is unavailable. For Debian/Ubuntu, install the matching `.deb` with your package manager so desktop library dependencies are resolved:

```sh
sudo apt install ./NeoSync-1.3.3-beta.1-amd64.deb
```

Replace the example version with the version you downloaded. Published beta builds target x86-64; ARM64 builds can be made locally but have not been runtime-tested. Do not run the app as root. Keep Electron's normal sandbox enabled.

To run from source, use Node.js **24 or later** (the pinned Hunspell dependency requires it):

```sh
npm ci
npm start
```

Build on Linux using a native Node installation and Linux dependencies, rather than reusing a Windows `node_modules` directory:

```sh
npm run package:linux:x64
# Or, for an ARM64 target:
npm run package:linux:arm64
```

`npm run package:linux` builds for the host architecture. Install the distribution's `xz-utils` and `binutils` packages for Debian packaging. Outputs go to `dist/`. For Ubuntu/Debian development environments, the runtime libraries include GTK 3, NSS, ALSA, GBM and libsecret; package names vary by distribution/release. A minimal WSL installation may lack these even when WSLg supplies a display.

## Credentials and Linux sessions

### AppImage quick start

Use the x86-64 AppImage on an Intel/AMD Linux computer. Copy the downloaded AppImage to `~/Applications` (create that folder if needed). No Node.js or source checkout is needed. Install your distribution's AppImage/FUSE support if required, then run:

```sh
chmod +x ~/Applications/NeoSync-1.3.3-beta.1-x86_64.AppImage
~/Applications/NeoSync-1.3.3-beta.1-x86_64.AppImage
```

After marking it executable, you can also launch it by double-clicking it in the file manager. On KDE Plasma, leave KDE Wallet enabled and unlock it if asked. On GNOME, use GNOME Keyring. Connect through **Log in with Nextcloud**, approve access in the browser, then click **Connect** with the same remote folder used on Windows. Leave the manual username/password fields empty when using browser login. Wait on the bookshelf for incoming books. The local library should remain outside a Nextcloud Desktop managed folder.

The AppImage runs as a portable app; it does not automatically install a launcher-menu entry. On KDE, add one with the application menu editor, pointing at the AppImage's permanent location. Starting with beta.3, x86-64 AppImages download updates from published NeoSync releases and offer **Restart to update** under **Help → Check for Update…**. Keep the AppImage and its directory writable by your user. Earlier versions need one manual replacement; Debian packages and extracted AppImages remain manual updates. Your library and account settings are stored separately.

### Protected account storage

Nextcloud app passwords require an unlocked **GNOME Keyring / Secret Service** or **KDE Wallet**. The supported Electron backend identifiers are `gnome_libsecret`, `kwallet`, `kwallet5` and `kwallet6`. Unknown, unavailable and `basic_text` backends are rejected. No plaintext fallback is used. The settings dialog displays an actionable explanation when protection is unavailable.

On GNOME, sign in normally and unlock your login keyring. On KDE, enable/unlock Wallet. On minimal desktops, install and start a compatible Secret Service or Wallet through your distribution's desktop-session setup. The app needs the session D-Bus service; merely having the libsecret client library installed is insufficient.

If your keyring was locked or unavailable when NeoSync started, unlock/start it and fully close and reopen NeoSync. Electron can remember a failed connection for the rest of the process; **Check again** retries the saved credential but cannot reset that connection. The encrypted credential stays intact while unavailable. Background polling does not repeatedly retry the saved credential or open prompts.

Electron normally chooses the backend from the desktop session. On an unrecognized desktop it can select an unprotected fallback even when GNOME Keyring is unlocked. NeoSync now selects Secret Service on those desktops before Electron starts, while preserving native desktop selection and explicit launch options. For an older build, or to select a different provider, launch with the matching option:

```sh
./NeoSync-1.3.3-beta.1-x86_64.AppImage --password-store=gnome-libsecret
# KDE Plasma 6:
./NeoSync-1.3.3-beta.1-x86_64.AppImage --password-store=kwallet6
```

Do not use `--password-store=basic`; NeoSync deliberately refuses to persist credentials with it. Changing desktop/keyring providers can make an old credential unreadable; reconnect with a newly granted app password instead of moving credential files between providers or machines. See [Electron's documented Linux secret-store behavior](https://www.electronjs.org/docs/latest/api/safe-storage).

The library defaults to the system Documents directory under `NeoSync Library`. State and encrypted credentials normally live under `~/.config/NeoSync/nextcloud/`, or `$XDG_CONFIG_HOME/NeoSync/nextcloud/` when that base directory is configured. Keep the manuscript library outside other synchronization clients' folders.

## Verification

```sh
npm test
npm run test:sync:desktop
```

The Linux-specific unit tests cover GNOME/KDE providers, refusal of unsafe/unknown providers, preservation of encrypted files when locked, retry after unlocking, private file permissions, and durable POSIX replacement. The shared two-device sync suite runs unchanged on Linux.

The 1.3.3-beta.1 release passed GitHub Actions verification on Linux x86-64 and Windows with Node 24: all 89 Linux tests passed; Windows passed 88 with the POSIX-only test skipped. Targeted sync lint, real Electron desktop, restart and UI checks passed on both platforms. Native GNOME libsecret encryption and `basic_text` refusal passed in an isolated Linux D-Bus/keyring session. KDE Wallet is covered by provider test doubles, not a live KDE session; ARM64 is configured but has not been runtime-tested. A live read-only download check passed; full live two-device reconciliation remains unverified.

`.github/workflows/linux-sync.yml` supplies an Ubuntu verification job with Node 24. It runs the unit tests, targeted lint, real Electron desktop, restart and UI checks, real libsecret storage in a disposable GNOME keyring, and plaintext-fallback rejection, then builds x64 AppImage and Debian packages. The desktop workflow calls it on pushes to `main`, release tags and pull requests; it can also be run manually. Tagged desktop builds attach the installers and checksums to a draft release after both platforms pass. Publishing the release remains a manual step.

For a manual native-keyring test, install Xvfb, D-Bus and GNOME Keyring in a disposable Linux test environment, then use the same isolated session as CI:

```sh
xvfb-run -a dbus-run-session -- bash -euo pipefail -c '
  export XDG_DATA_HOME="$(mktemp -d)"
  export XDG_CONFIG_HOME="$(mktemp -d)"
  export XDG_RUNTIME_DIR="$(mktemp -d)"
  export XDG_CURRENT_DESKTOP=GNOME
  printf "%s" "disposable-test-keyring" | gnome-keyring-daemon --unlock --components=secrets
  npm run test:sync:keyring -- --password-store=gnome-libsecret
  npm run test:sync:desktop -- --password-store=gnome-libsecret
'
xvfb-run -a env NEOSYNC_EXPECT_KEYRING=basic_text npm run test:sync:keyring -- --password-store=basic
```

Only dummy credentials and temporary libraries are used by these tests. A live Nextcloud test still requires a disposable server folder and app passwords; see the checklist in [NEXTCLOUD.md](NEXTCLOUD.md).
