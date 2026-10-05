# Upstream baseline

- Project: https://github.com/hughhowey/neo
- Version integrated: 1.3.8
- Commit: `0dc4826bd53fc4f30bf04282e329f95773b9acfd`
- Remote name: `upstream`
- NeoSync releases use their own `neosync-v*` tags.

Update this record only after an upstream merge has passed review and tests. Fetching upstream alone does not change the integrated baseline.

Keep the sync engine in `sync/` separate from the editor where possible. Review changes to the library schema, save/flush behavior, IPC, startup paths, credentials, and build/update configuration especially carefully.
