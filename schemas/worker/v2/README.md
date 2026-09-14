# Worker job envelope, protocol 2

Canonical wire shapes live in this directory. Each file's `$id` is its filename.
Job JSON (request, stdout events, manifest, artifact pointers) validates here.
Bytes those pointers name — descriptor.json, semantic.json, render-manifest.json,
geometry.jsonl — validate against `schemas/model/v1/` via
`artifact-contents.schema.json`. Outcomes JSONL is not in this directory.

The live integer on the wire is 2. The contract is
[`docs/contracts/worker-v2.md`](../../../docs/contracts/worker-v2.md).
Do not look for an unpublished combined v1 envelope schema except as a
historical citation.

Hand-written types implement the schema. Nothing here is generated.

- Python: `services/ifc-worker/src/ifc_worker/protocol.py`
- Rust: `services/checker/src/worker_envelope.rs` (crate-private)

`kinds.json` is the table `scripts/verify-worker-envelope.ts --check` walks.
An unlisted `*.schema.json` in this directory fails that command. A `jobId`
rename in `protocol.py` or in `worker_envelope.rs` also fails it.
