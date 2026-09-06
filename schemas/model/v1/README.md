# Model contracts v1

Canonical JSON Schema (draft 2020-12) for the wire shapes shared by the Python IFC
worker, the Rust service, and the browser viewer. See
[`docs/adr/0001-reusable-model-modules.md`](../../../docs/adr/0001-reusable-model-modules.md)
for why this exists and what each module may and may not depend on.

Generated language bindings live in `packages/model-contracts-py/`,
`crates/model-contracts/`, and `packages/model-contracts-ts/`. None of them import
application, database, Next.js, React, Three.js, or general-purpose validation-engine
code; `scripts/verify-model-contracts.mjs` checks that boundary.

## Files

- `object-ref.schema.json` — `ObjectRef`, an opaque `{ revisionId, objectId }` pair.
- `transform.schema.json` — placement of a revision into the shared delivery origin.
- `semantic-capability.schema.json` / `render-capability.schema.json` — the four
  mutually-exclusive artifact states (`available` / `absent` / `unsupported` /
  `failed`), one schema per artifact kind so each carries its own `available` payload
  shape without a cross-language generic.
- `model-descriptor.schema.json` — `ModelDescriptor`: revision identity, units, axes,
  transform, source provenance, and artifact capability.
- `semantic-model.schema.json` — `SemanticModel`: classification/properties/native IDs
  per object, keyed by `ObjectRef`.
- `render-manifest.schema.json` — `RenderManifest`: rendered-instance-to-`ObjectRef`
  mapping for one revision's geometry artifact.

`ModelDescriptor`, `SemanticModel`, and `RenderManifest` are independently valid,
independently transmittable payloads correlated by `revisionId`; a consumer may load
any one without the others (a delivery can have geometry with no semantics yet, or
semantics with unsupported geometry).

## Versioning

`schemaVersion` is the literal string `"model-v1"` on every top-level payload
(`ModelDescriptor`, `SemanticModel`, `RenderManifest`). A breaking change to any shape
in this directory ships as `model-v2` alongside, not an in-place edit; nothing here is
ever mutated after a version ships.

## ObjectRef identity and the IFC express-ID mapping

`ObjectRef.objectId` is opaque: consumers must not decode it, and it is unique only
within its `revisionId`, never compared across revisions. The first IFC adapter (the
Python worker for ingestion, a browser IFC loader for rendering) derives it from an
IFC express ID with one deterministic, revision-scoped mapping so that two
independent implementations produce byte-identical references for the same
`(revisionId, expressId)` pair without either one importing the other's code:

```text
objectId = "occ_" + sha256(f"{revisionId}:{expressId}")[:16]   (hex digest, lowercase)
```

`revisionId` is part of the hash input, not merely a namespace prefix: the same
express ID in two different revisions must not produce a comparable-looking
`objectId`, since `ObjectRef` equality is never meant to cross revisions. Native
`GlobalId`s are carried separately in `SemanticModel.objects[].nativeIds.globalId` and
may legitimately duplicate across occurrences (e.g. a copy/paste in the source
authoring tool); `objectId` must never duplicate within one revision even when
`globalId` does. `fixtures/express-id-mapping.json` is the golden table both the
Python and TypeScript implementations of this function are tested against
(`packages/model-contracts-py` and `packages/model-contracts-ts`); Rust only consumes
`ObjectRef` opaquely and does not implement the mapping.

## Fixtures

`fixtures/valid/` and `fixtures/invalid/` hold the golden payloads every language
consumer validates against (see `scripts/verify-model-contracts.mjs`).
`fixtures/valid/prepared-scene-non-ifc/` is the format-neutral demonstration fixture:
a descriptor, semantic model, and render manifest built entirely from synthetic
non-IFC `ObjectRef`s, proving the contract does not require IFC metadata to exist.
`fixtures/invalid/*.json` each violate exactly one rule; `scripts/verify-model-contracts.mjs`
records which rule and the rejection message from each language.
