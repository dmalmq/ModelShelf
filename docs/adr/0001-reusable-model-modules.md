# Reusable model modules in one repository

Status: accepted, 2026-09-06. Implementation is tracked in the local tickets.

ModelShelf needs a viewer that future applications can use without adopting its delivery and checking workflows. Keep one repository and the existing local deployment, but extract shared model contracts and one viewer package with a rendering core and a thin React wrapper. Format-specific processing produces model data behind those contracts; ModelShelf supplies project policy, review state, and persistence. See [`VISION.md`](../../VISION.md) for when to extract the viewer package.

## Module ownership

| Module | Proposed home | Owns | Must not depend on |
| --- | --- | --- | --- |
| Model contracts | `schemas/model-v1.schema.json`, `packages/model-contracts`, generated Rust/Python bindings | Object references, model descriptors, source mappings, semantic records, render manifests, coordinate and capability metadata | Projects, deliveries, packs, databases, React, Three.js |
| Viewer | `packages/model-viewer` | Render lifecycle, camera, picking, selection, isolation, clipping, visibility, loading and disposal | ModelShelf application types, checking rules, priority policy, Next.js routes, database access |
| IFC processing | Existing `services/ifc-worker` and an internal browser IFC loader | Source interpretation, semantic extraction, geometry conversion, provenance and source-ID mappings | Viewer controls, delivery lifecycle, review decisions |
| Checking | Internal worker validation module plus Rust result mapping | Requirements, applicability, raw evaluation outcomes and evidence | Renderer, colors, camera, priority presentation |
| Comparison | Existing `crates/fingerprint` and `crates/modeldiff` | Normalized state fingerprints, matching confidence and change records | IFC parsers, database queries, HTTP, frontend |
| ModelShelf | Existing Rust service and `apps/web` | Source models, deliveries, jobs, packs, severity/category policy, findings UI and storage | Direct modification of viewer internals |

These are ownership boundaries, not six new network services. Keep the worker's processing and checking modules in the same process. Keep separate wire envelopes for jobs and application HTTP data; share the model payloads rather than one universal schema for every subsystem.

## Contracts and identity

The public `ObjectRef` is `{ revisionId, objectId }`, with both fields opaque strings. `objectId` identifies an occurrence within one revision; it does not imply identity across revisions. A future host may create a revision ID locally without a ModelShelf database.

IFC express IDs and GlobalIds are source metadata. For the first IFC adapter, `objectId` uses a deterministic revision-local mapping from express ID, shared by browser and worker adapters. Consumers must not decode that string. The mapping contract and golden fixtures establish the exact encoding before implementation consumers are written. Duplicate GlobalIds do not merge occurrences.

A model descriptor identifies revision and artifact versions, units, axes, transforms, source provenance, and declared capabilities. The viewer treats discipline and storey as generic filter attributes supplied by its host rather than importing ModelShelf enums. A render artifact includes an explicit mapping from rendered primitives/instances to ObjectRef.

Semantic records and rendering artifacts are separate. Semantic properties, classifications, and relationships feed checks and comparison. Geometry chunks feed rendering. Either may be loaded without the other. The browser loader's geometry must map to the authoritative worker's occurrence IDs; a render conversion must not silently rewrite checking evidence.

Retain original files and source IDs alongside derived artifacts. Use explicit available, absent, unsupported, and failed capability/status information. Geometric emptiness, unsupported conversion, and processing failure must not look identical.

## One source for shared payload shapes

Use JSON Schema as the canonical wire-shape source for shared model data. Generate TypeScript types and Rust/Python bindings where those payloads cross languages. Export boundary validators and validate external data once on ingress. Do not hand-maintain independent copies of the model payloads in frontend types, worker models, and Rust DTOs.

Generators, their versions, and generated outputs are reproducible. A generation check fails when committed/generated consumers drift. The first shared-contract ticket provides golden valid/invalid payloads consumed by all three languages, including non-IFC opaque IDs and duplicate native IDs. Job and application envelopes reference these payload definitions. Domain behavior and authorization remain outside generated types.

Do not introduce general code generation for every internal type or endpoint. Keep the initial scope to the model payloads that actually cross the worker, Rust service, and viewer boundaries.

## Viewer interface

Expose the viewer through package exports for the framework-independent core and its React wrapper. The wrapper handles mount/unmount and translates props/events; it contains no ModelShelf business rules. A standalone plain browser example exercises the core without Next.js, the Rust service, or the Python worker running.

The host supplies model inputs and resource loading/property lookup functions. It controls credentials and URLs. The core offers loading/unloading, generic ObjectRef selection and highlighting, framing, visibility, clipping, and disposal, with selection/progress/error events. The full operation set must be consistent with lifecycle and error behavior, not just method signatures.

Keep Three.js scene objects, web-ifc handles, GPU buffers, and browser worker messages private. The renderer consumes normalized scene inputs. Keep IFC loading and optional prepared-geometry loading behind internal seams until real implementations justify more packages. Do not build a plugin registry for hypothetical formats.

ModelShelf turns a finding into a highlight group and chooses its color/priority. A future maintenance app can supply another highlight group without adopting checking terminology. Comparison supplies its own base/head selection; the viewer does not decide which revision is better or which finding is resolved.

## Reuse acceptance

- A standalone example opens self-authored model fixtures, picks an object, highlights/isolates it, applies a section cut, and unloads cleanly using only public exports.
- Its runtime succeeds with the ModelShelf Rust/Next/worker processes stopped, using only a static example server and local assets.
- The example can load a tiny prepared scene with opaque IDs that contain no IFC identifiers, proving the core does not require IFC metadata. This fixture is not a new native-format importer.
- The React wrapper mounts and unmounts against the same public core, and the existing ModelShelf integration still handles a real three-discipline IFC delivery.
- An import-boundary check rejects viewer imports from app code or checking modules, Next.js dependencies in the core, and comparison imports from database/parser/HTTP modules. Test the check with controlled invalid imports in temporary fixtures.
- Capture correct identity mapping, shared-coordinate placement, resource cleanup, and the existing performance targets. Reuse does not excuse a slower or incorrect application.

## Format support

The prototype supports IFC, including IFC exported from Revit or Archicad. Native RVT/PLN upload support is deferred. A future native importer can produce normalized semantic/render artifacts when its capabilities allow it. A provider-specific viewer format may require a separate renderer integration; this architecture does not promise compatibility with proprietary derivatives or native authoring fidelity.

## Consequences

The renderer can be reused and tested independently, while ModelShelf remains a straightforward local application. This adds contract generation and a standalone example now, but avoids separate services, a generic plugin framework, and native-format integrations without a current consumer. Existing live data and unrelated work remain untouched; migrate source-ID consumers under the affected implementation tickets.
