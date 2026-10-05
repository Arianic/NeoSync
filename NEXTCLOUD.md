# NeoSync: private Nextcloud synchronization

This personal fork of [Neo](https://github.com/hughhowey/neo) adds desktop-to-desktop Nextcloud sync. The application is named **NeoSync**, has application ID `personal.neosync.desktop`, and uses its own app-data directory and default `Documents/NeoSync Library`. Upstream release checking, downloading and installation are disabled. Install future fork updates manually. Nothing in this change publishes a release.

Linux installation, packaging, keyring setup and native verification are covered in [LINUX.md](LINUX.md).

## Run and connect

1. Install dependencies with `npm install`, then run `npm start` from this directory. Packaging commands remain `npm run package:win`, `package:mac`, and `package:linux`.
2. Use the new default library or choose a **local** directory under **File → Library Folder…**. Use only one sync mechanism for that directory. Do not put it inside Nextcloud Desktop, iCloud, OneDrive, or Syncthing. Do not simultaneously open the same library with upstream Neo.
3. Open **File → Nextcloud Sync…**. Enter the installation URL, such as `https://cloud.example.com/nextcloud`. Supply the website address, not a sharing link or the DAV URL.
4. Select **Log in with Nextcloud** and approve access in your browser. The dialog shows that it is waiting and continues automatically. Alternatively, expand **Use an app password instead**, enter a Nextcloud username and a generated app password, then choose **Continue**. A normal account password is not needed.
5. Choose a dedicated relative **Folder in Nextcloud**, such as `Writing/NeoSync` (use the same folder on every device). Confirm that only NeoSync syncs the local library, then select **Connect**. This checks access, creates the selected remote folder if needed, and starts reconciliation. Folder write permission is verified by the first upload. Once connected, the dialog shows the saved destination and a **Sync now** button. Recovery and disconnect are under **What syncs & connection options**.
6. Use **Sync now** before switching devices, then return to the bookshelf and wait for **Synced**. On the next device, connect to the same server/folder and sync from the bookshelf before opening a book.

App passwords are encrypted with Electron's OS-backed `safeStorage`, outside the library. If OS protection is unavailable (including Linux's `basic_text` backend), connection is refused rather than storing plaintext. Unlock/configure the OS keyring and retry. Disconnect removes the saved credential and configuration, waits for the current request, and retains local manuscripts and recovery state. Revoke the device's app password in Nextcloud security settings if desired.

URLs must use HTTPS with a valid certificate. The installation subpath is preserved. The OCS user endpoint supplies the actual DAV user ID, which can differ from an email login. Redirects and login/poll endpoints outside the selected installation are rejected.

## Writing and incoming changes

Editing and autosave always write local HTML/JSON files. A successful save is queued only afterward; a network or sync-journal failure cannot undo that save. Startup scanning recovers changes saved before a crash could queue them.

Changes debounce for 1.8 seconds. Sync also runs on startup, after resume, and at a 60-second interval while a window is visible. Requests time out after 30 seconds; retries back off to a maximum of 15 minutes. **Sync now** retries immediately. A small status control appears on hover/keyboard focus, and the settings dialog shows saved locally, pending, syncing, synced, offline/error, and conflict states. Background sync opens no dialogs or notifications while typing.

**Incoming library changes are applied only on the bookshelf.** Uploads continue while writing. Downloads are staged and validated first; the renderer briefly becomes inert during local application and shelf refresh, after outstanding filesystem operations drain. No network transfer takes place during this apply handoff. Open books are never replaced beneath the editor. This deliberate desktop-first restriction also protects notes, stickies, darlings and metadata that Neo holds in memory.

## First connection and conflicts

There is no “replace this library” default. Independent files are combined. Identical content is acknowledged. A colliding path with different content and no shared baseline becomes a conflict. Local content stays in place and the remote alternative is retained outside the manuscript library. This applies to `library.json` too: two independently initialized shelf layouts can require review. Books not in the selected shelf layout remain on disk and can be restored to a shelf with Neo's **Reshelve** action.

Under **Nextcloud Sync…**, each conflict offers:

- **Compare recovery copies** opens a folder with the local, remote and last-synced versions plus the original relative path. HTML and JSON copies use `.txt` to open safely as text; images retain their image extension.
- **Keep current local version** accepts the file currently on this device (including a deliberate local deletion), then reconciles it against the reviewed remote version.
- **Restore remote version** archives displaced local content and restores the remote file. Resolve referenced chapters/assets before metadata if necessary.

Return to the bookshelf before resolving. If the remote version changed since review, the choice is rejected; sync and review the newer conflict. Resolved alternatives remain recoverable. **Open recovery folder** also exports versions displaced by incoming writes/deletions. To manually combine text, edit the current local manuscript, then choose to keep that local version. Recovery copies are never automatically pruned.

Merge rules use content and a persistent last-successfully-synced base, never device clocks:

- Manuscript HTML, notes and outlines: different concurrent edits require review. There is no automatic text merge or last-write-wins rule.
- JSON objects: independent keys merge recursively. Record arrays (shelves, darlings, stickies) merge by stable `id`; incompatible edits to the same value require review.
- Shelf `bookIds`, custom words and pen names: combine additions; a removal of an unchanged base member is respected.
- Chapter order: one-sided changes are accepted; simultaneous append-only additions combine deterministically. Competing moves, reorder/removal combinations and incompatible scalar changes require review.
- Concurrent `modified`, `lastPosition`, `wordCount` and `dailyCounts` bookkeeping takes the observed remote value. These fields never decide which manuscript text survives.

## Deletions and consistency

Only explicit application deletions create deletion intents. Deletion bytes are recorded durably before removal; if that record cannot be saved, the deletion is refused. Missing files, new devices, missing baselines, failed listings and incomplete listings are never deletion instructions.

Remote deletions use recoverable records under `.neosync/deletions/`, not WebDAV DELETE of manuscript files. Each record includes the deleted bytes and their hash. The old remote object is deliberately retained. Devices interpret a matching record as a logical deletion; a different remote edit triggers a conflict. Restoration conditionally clears the record. Do not delete these records or manually purge retained files while devices still use this library. Back up the entire remote folder, including `.neosync`.

Uploads use `If-Match` for existing files and `If-None-Match: *` for new files. A 412 starts a fresh fetch/reconciliation, not a blind retry. Chapters and assets precede metadata; shelf metadata comes last. Metadata cannot publish references whose files are unavailable. Downloads are staged as a complete observed generation before any local file is changed. Immediately before application, hashes are compared again against local disk. An edit made during transfer stays pending or becomes a conflict, rather than being overwritten.

An apply journal stores old and new bytes before replacements. Restart replays only entries whose files still match their expected version, and archives conflicts otherwise. Successful uploads advance the baseline to the uploaded snapshot, so a later local save stays pending. If the server committed an upload but the response/state commit was lost, identical hashes reconcile safely on restart.

WebDAV is **not a library-wide transaction**. Intermediate remote files may exist before their metadata. NeoSync stages/validates what it receives and uses dependency ordering; it does not claim atomic multi-file publication to unrelated WebDAV clients. Physical remote deletion or editing outside NeoSync has no deletion authority and may restore a missing file or raise a conflict.

## Synced files and local-only data

Included: `library.json`; each `book-*` folder's HTML/JSON sidecars; `chapters/*.html`; `cover-*` and `art-*` PNG/JPEG/WebP assets. This covers book metadata, shelves, notes, outlines, darlings, stickies, painting metadata and covers without changing Neo's readable format.

Excluded: `Backups/`, `Exports/`, `_catalog.txt`, logs, `.tmp`, `.bak`, unsupported attachments, credentials, app settings and all device-local sync state. Backups and exports remain independently local; sync is not a replacement for separate backups. User-created symlinks are rejected. Windows-reserved names, traversal and filename collisions differing only by case are rejected for desktop portability.

Device state is below Electron's NeoSync `userData/nextcloud/`, keyed by local library path and remote account/folder. On Windows this is normally `%APPDATA%/NeoSync/nextcloud/`. It contains bases, hashes, ETags, pending work, staging, apply journal, deletion intents and conflict/history copies. Treat it as private manuscript data. Do not copy it between devices or remove it to “fix” a conflict. A corrupt/unsupported state file fails closed and leaves local editing available; preserve the directory before repairing it or connecting afresh.

Closing the settings or the app preserves the connection. Disconnect asks for confirmation before removing the saved account and encrypted credential. The device-local `connection-events.json` retains the last 40 connection lifecycle events and timestamps (no account, server, passwords, or manuscript content) to diagnose unexpected connection loss. Missing credentials for a saved connection produce a visible error instead of silently appearing unconfigured.

## Architecture and current limits

- `sync/engine-core.js`: platform-independent reconciliation factory with injected model/byte operations, local storage, remote transport, apply lease and status callbacks. It imports no Electron, filesystem, networking or Node APIs.
- `sync/model.js`, `engine.js`: desktop content/path/merge rules and Node byte/hash implementation.
- `sync/storage.js`: synchronous local snapshot/CAS boundary, durable state and apply journal.
- `sync/webdav.js`: bounded authenticated HTTP, XML PROPFIND parsing, GET and conditional PUT.
- `sync/credentials.js`, `desktop.js`: OS credentials, Login Flow v2, scheduling, conflict actions and renderer apply lease.
- `main.js` owns all of this; `preload.js` exposes only the narrow actions and save-drain/ready handoff. `app.js` supplies the settings/status/recovery controls.

Pocket's bridge and native projects are unchanged. Shared UI changes are capability-gated. A future mobile adapter can use `createSyncEngine` with mobile byte/hash helpers, transport, credentials and a staged local snapshot/commit adapter; wiring Capacitor storage and mobile background execution is not included in this desktop delivery.

Current bounds: 64 MiB per request, 20,000 remote files, fixed library directory depth. Each cycle downloads the observed remote library for validation; this favors correctness over bandwidth and is not optimized for very large libraries. Device state retains full baselines and recovery copies and grows with conflicts/deletions. There is no automatic pruning, end-to-end encryption layer, custom CA/client-certificate UI, proxy configuration UI, or mobile built-in sync. JSON/text from other clients that does not meet the library schema is rejected.

Deleting files while built-in sync is disconnected does not create sync deletion authority; a later reconnection can restore the remote copies. To propagate explicit deletions, leave the connection configured (being offline is fine). New settings strings currently fall back to English where translations are missing.

## Verification and disposable live test

Run `npm test`, `npm run test:sync`, `npm run test:sync:desktop`, and `npm run lint`. The desktop smoke uses a new temporary profile/library and a hidden Electron window, leaving the temporary profile for inspection after exit. `npm run test:words` remains the existing interactive word-count test and also uses temporary app data.

`npm run test:sync:restart` starts separate Electron processes with a temporary profile, dummy Nextcloud transport, and real OS credential encryption. It checks settings dismissal, canceled disconnection, normal window close with settings open, offline relaunch, and confirmed disconnection. This test passed on Windows and Linux. It never contacts a real Nextcloud account.

`npm run test:sync:ui` checks guided browser login, manual fallback, keyring recovery, error states, both themes and compact windows in an isolated Electron profile. Screenshots are written to `dist/sync-ui/`.

Implementation verification: all 85 Node tests pass on Linux (including the shared 33 sync tests and five Linux-specific tests); Windows passes 84 with the POSIX-only test skipped. The real Electron smoke passes for fork identity, settings, preload, local saves and editor/bookshelf application handoff. Native GNOME keyring encryption and refusal of Linux's plaintext fallback were also verified. Targeted lint on the sync modules, new tests and preload passes. Full-project lint still reports the same 28 pre-existing findings reproduced from the clean `HEAD` sources. The translation template was refreshed and the French completeness check was run; missing translations use the existing English fallback. See [Linux verification details](LINUX.md#verification).

The controllable WebDAV double covers two devices autosaving offline, identical changes, independent chapters and metadata, chapter ordering/shelf membership, files before references, missing dependencies, deletion/edit races, failed and omitted listings, 401/403/500/offline failures, interrupted download, lost upload response before state commit, edits during GET/PUT, 412 competition, first connection, restart journal replay, credential protection, XML validation, subpath/UID discovery, apply deferral, conflict resolution and stale choices, disconnect, case collisions, and Login Flow v2.

**Live verification is partial:** a read-only check against the connected Nextcloud server reproduced compression weakening download ETags. DAV requests now use `Accept-Encoding: identity`; all seven remote files downloaded with their exact listed validators through the corrected adapter. No local manuscript or remote file was written by this check. The Windows suite passes 84 tests with one POSIX-only skip, including a compression regression and rejection of changed/missing/weak validators. Full live two-device reconciliation remains unverified. To verify safely:

1. Create a disposable remote folder and two temporary local libraries on separate desktops. Use separate revocable app passwords. Do not select a real manuscript library.
2. Add a tiny book, notes, outline, sticky, darling and cover on A. Sync, then connect B and verify the shelf, order, text and cover.
3. Disconnect both networks, edit the same chapter on both, and wait for autosave. Reconnect A, then B. Confirm both texts are recoverable after closing/reopening B; compare and resolve the conflict.
4. Repeat with independent chapter edits and metadata changes; then simultaneous new chapters and incompatible order changes. Confirm dependencies arrive before books become visible.
5. Delete a chapter on A while editing it offline on B; confirm review is required. Verify normal deletion, recovery export and restoration too.
6. Interrupt connectivity during transfer, restart, revoke a test password, and reconnect. Writing must continue locally, retries must be safe, and auth failure must be visible only in status/settings.
7. Leave a book open while A publishes a change. Verify B stages it, preserves B's edits, and applies/reconciles on returning to the bookshelf.
8. Remove only the disposable libraries/folder when finished and revoke the disposable passwords.

Protocol references: [Nextcloud WebDAV](https://docs.nextcloud.com/server/stable/developer_manual/client_apis/WebDAV/basic.html), [Login Flow v2 and DAV user discovery](https://docs.nextcloud.com/server/stable/developer_manual/client_apis/LoginFlow/index.html).
