# Vision

ModelShelf exists so that a reviewer can inspect a BIM delivery against versioned project information requirements and see what changed between deliveries.
It serves a local reviewer working on one machine, and it turns pinned model revisions plus a check pack into grouped findings, retained evidence, and a combined view.
It owns exactly one thing: the local review loop over immutable deliveries.

## Immutable evidence

Source models persist by name.
A model revision includes the original submitted file and does not change after it is recorded.
A delivery is a dated set of named source revisions; it can reuse an unchanged revision without copying bytes.
Finalized delivery membership cannot be edited, including under concurrent requests.
A run evaluates exact revisions against an exact pack version with recorded settings.
When run inputs are not pinned, provenance is incomplete.
Incomplete is distinct from pass, fail, and not applicable.
Pre-migration or unestablished history stays readable as incomplete rather than guessed lineage.

## Authoritative interpretation

The locked local IfcOpenShell/IfcTester worker is the source of IFC meaning and live IDS scoring.
The Rust IDS crate remains a reference and test engine with known gaps; it is not the live scorer and is not grown to replace the worker.
Unsupported or unavailable evaluation is incomplete, never a pass.
Required applicability with no matching objects fails; optional specifications may have no applicable objects.
Geometric emptiness, unsupported conversion, and processing failure do not look identical.
Unknown units keep the raw value; they do not invent SI.

## Identity without pretending

ObjectRef is an opaque pair of revisionId and objectId.
objectId names an occurrence inside one revision; it does not imply identity across revisions.
IFC express IDs and GlobalIds stay in source metadata; consumers do not decode objectId.
Duplicate GlobalIds remain distinct occurrences.
A fingerprint describes object state for change detection; it does not establish identity.
Object matches may be confirmed or uncertain; the product does not auto-accept ambiguous matches.
Discipline is a filter, not a slot: two named sources in the same discipline can sit in one delivery.

## Shared contracts, private modules

JSON Schema under schemas/model/v1 is the one source for shared model payloads.
Rust, Python, and TypeScript consumers are generated from that source; a generation check fails on drift.
Semantic records and render artifacts load independently, joined only by ObjectRef.
Prepared geometry is a fast path only when those chunks carry the worker's ObjectRefs.
A missing chunk is absent, not a license to invent identity from the browser loader.
Job envelopes and application HTTP envelopes stay outside the shared model schema.
The viewer does not own checking policy, finding color, or which revision is better.
The combined ModelShelf view comes before extracting a reusable viewer package.
Native Revit and Archicad importers, and a plugin registry for hypothetical formats, stay out.

## Prove it on the real artifact

A ticket is not resolved by a green library test, a historical Answer, or a mocked path.
Acceptance runs against real processes, real files, and exact oracles.
Do not weaken a failing test, or reshape a fixture, to hide an engine gap.
Independent review can reopen work; historical Answers are implementation history, not current approval.
Coverage and change-risk scores may light up a map; they are not merge gates.

## Scope

ModelShelf is a local, single-user application in one repository.
It is not a clash engine, a fire-code checker, a regulatory approver, a Revit editor, a spreadsheet converter, or a billed multi-tenant service.
It does not patch stored IFC to clear a finding.
It does not share a review over the network.
It does not redistribute restricted third-party sample files.
It does not invent extra network services or a generic plugin framework to host formats nobody has asked to load.

A change aligns when it preserves immutable evidence, worker-authoritative interpretation, opaque revision-local identity, generated shared contracts, and proof on the real artifact.
A change should be resisted when it guesses provenance, treats a custom parser or the IDS crate as live truth, merges occurrences by GlobalId, couples the viewer to checking policy, extracts reuse before the combined loop exists, or marks work done without running the real path.
