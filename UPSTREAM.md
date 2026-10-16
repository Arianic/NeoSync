# Upstream baseline

- Project: https://github.com/hughhowey/neo
- Version integrated: 1.5.7
- Commit: `0c407809db407e749ee5c25aa9661fb54cab9814`
- Remote name: `upstream`
- NeoSync releases use their own `neosync-v*` tags.

Update this record only after an upstream merge has passed review and tests. Fetching upstream alone does not change the integrated baseline.

Keep the sync engine in `sync/` separate from the editor where possible. Review changes to the library schema, save/flush behavior, IPC, startup paths, credentials, and build/update configuration especially carefully.
