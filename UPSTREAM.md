# Upstream baseline

- Project: https://github.com/hughhowey/neo
- Version integrated: 1.3.2
- Commit: `b084e63471d17e7e5ae7fc2eb48eab4c7d9878e9`
- Remote name: `upstream`
- NeoSync releases use their own `neosync-v*` tags.

Update this record only after an upstream merge has passed review and tests. Fetching upstream alone does not change the integrated baseline.

Keep the sync engine in `sync/` separate from the editor where possible. Review changes to the library schema, save/flush behavior, IPC, startup paths, credentials, and build/update configuration especially carefully.
