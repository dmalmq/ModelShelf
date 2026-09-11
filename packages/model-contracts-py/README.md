# modelshelf-model-contracts

Generated Python (pydantic v2) bindings for the shared model contract
(`schemas/model/v1`). See `docs/adr/0001-reusable-model-modules.md` and
`schemas/model/v1/README.md` for what this exists to do and its versioning rules.

No `ifcopenshell`/`ifctester` imports — this package only knows the wire shapes, not
how to produce IFC data. `services/ifc-worker` (a separate package) is the one that
will actually interpret IFC and construct these payloads.

```sh
uv sync --project packages/model-contracts-py
uv run --project packages/model-contracts-py pytest -q          # runs against schemas/model/v1/fixtures
uv run --project packages/model-contracts-py model-contracts-produce <dir>  # writes 5 valid payloads to <dir>
```

`src/model_contracts/generated.py` is generated (do not hand-edit;
`node scripts/generate-model-contracts.ts` regenerates it from
`schemas/model/v1/*.schema.json`). `boundary.py` and `express_id_mapping.py` are the
two hand-written pieces schema generation cannot express (see their docstrings).
`produce.py` is the demonstration "producer" `scripts/verify-model-contracts.ts`
drives to prove Rust and TypeScript can consume a payload this package actually
built with its own generated types, not just hand-authored JSON.
