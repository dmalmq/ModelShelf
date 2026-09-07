# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary: the client-side BIM reviewer accepting a delivery.** A BIM manager at the
receiving organisation who decides whether a consultant's submitted models meet the
project information requirements. The relationship is mildly adversarial — a rejection
has to be defensible to the consultant who submitted the work — so evidence and an
audit trail matter more than speed.

They work in two distinct situations with the same data:

1. **At their desk**, working through findings over a long focused session. Density is
   an asset here; more on screen means less navigation.
2. **In a review meeting**, screen-shared or projected with the consultant present and
   decisions made live. The screen has to be legible to someone who did not run the
   check and does not know the tool.

These are two presentations of one dataset, not one compromise between them.

## Product Purpose

ModelShelf checks a dated collection of BIM model revisions against a versioned set of
client information requirements, groups the violations into findings a person can act
on, and shows what changed between one delivery and the next.

Success is a reviewer reaching a defensible accept-or-reject decision, with the exact
inputs, pack version and engine version that produced it still recoverable months later.

## Positioning

Three things a neighbouring model-checker could not truthfully copy without rebuilding
around them:

- **Immutability is structural, not a feature.** Model revisions and run inputs are
  immutable; a delivery's membership freezes on finalize. Re-running a check against a
  different pack version mints a new run and preserves the old results. A reviewer can
  always answer "what exactly was checked, against which rules, with which engine".
- **Undecided is a first-class outcome.** Pass, fail, not-applicable and
  *review-incomplete* are four distinct states. A check the engine could not evaluate is
  never silently folded into a pass, and a rule that legitimately does not apply is
  never counted as a failure.
- **Delivery-to-delivery comparison via fingerprints.** Object fingerprints describe
  state, not identity; matches between revisions may be confirmed or uncertain, and
  uncertain matches are surfaced rather than auto-accepted.

## Operating Context

Japanese BIM practice. The demo corpus is real BLCJ S1000 architecture, structure and
MEP exports; the check pack traces to BLCJ mapping tables, MLIT attribute guidance and
BE-Bridge/Rebro property naming. Authoring tools in evidence include GLOOBE and Rebro.

Deliveries arrive as IFC exports, typically three or more source models per delivery
across disciplines, sharing one coordinate frame. Model content is Japanese — property
names (`Rebro_PartsData.用途`, `外径[mm]`), object names (`SD-04 片開き`), descriptions
(`電気.ケーブルラック`) — and reviewers cross-reference against drawing legends and
schedules that live outside the IFC.

The interface is **bilingual and switchable** (Japanese / English). Both are first-class:
the same reviewer may work in Japanese and present to an English-speaking stakeholder.
Every label must survive roughly 1.6× length variance between the two.

## Capabilities and Constraints

**Confirmed capabilities.** Source models with immutable revisions; deliveries assembled
from revisions with reuse of unchanged ones; versioned check packs authored as IDS;
scoped runs producing grouped findings with severity and category; combined multi-model
3D viewing with per-finding highlighting; model-to-model and finding-to-finding
comparison between deliveries.

**Authority.** The established IfcOpenShell / IfcTester Python worker is the
authoritative interpreter of IFC and evaluator of IDS. The in-repo Rust IDS crate is a
reference and test implementation only — it passes 288/307 conformance with 19 accepted
gaps and must never be presented to a user as the verdict.

**Terminology** is fixed by `CONTEXT.md` and is binding on all UI copy: *source model,
model revision, delivery, check pack, pack version, run, finding, object occurrence,
object match, fingerprint, incomplete review.* `CONTEXT.md` also records terms to avoid:
"discipline slot", "live model", "one error per object".

**Current constraints.** Local, single-user prototype. Run input provenance currently
defaults to *incomplete* — the models shown for a historical run are reconstructed from
present delivery membership and are not proven inputs. The UI must say so rather than
imply proof. The worker does not yet distinguish occurrence-level from type-level
properties, and does not extract predefined types.

**Explicitly out of scope.** Revit write-back; clash detection or fire-code geometry
checking; regulatory approval; arbitrary spreadsheet conversion; production
authentication and billing; automatic acceptance of ambiguous object matches;
redistribution of the restricted sample models.

## Brand Commitments

Name: **ModelShelf**. The user named Speckle, Solibri and ACC/Forma as the professional
register the product should sit in. Recorded as volunteered, not expanded.

## Evidence on Hand

- Real BLCJ S1000 IFC exports (`samples/ifc/`), fetched by a checksum-pinned script.
  **Not redistributable** — gitignored, and no screenshot or export may publish them.
- An 11-check demo pack in two versions (`packs/demo/`) with full traceability from each
  check to the real property it was authored against (`packs/demo/checks.md`), including
  one deliberate, documented rule change between v1 and v2.
- Real evaluation results against the real models
  (`.omo/evidence/modelshelf-prototype/task-5/`), including one genuine confirmed gap:
  no door or window in the architecture export carries a fire rating.
- A self-authored synthetic A/B fixture pair with a machine-readable oracle covering
  additions, removals, property/shape/move changes and ambiguous GlobalIds.

No customers, testimonials, benchmarks, pricing or deployment claims exist. Future work
must not invent them.

## Product Principles

1. **Evidence over verdict.** Every number traces to the exact revisions, pack version
   and engine version that produced it. Where provenance is unproven, say so.
2. **Severity outranks volume.** Never collapse risk into a single score; a large
   advisory group must never displace a small critical one.
3. **Undecided is visible.** A check that could not be evaluated stays on screen even
   when everything evaluated passed.
4. **Group by requirement, not by object.** A finding is one distinct requirement with
   its affected objects attached — never one row per violation.
5. **The reviewer's conclusion must be defensible.** Anything shown must be explainable
   to the consultant who submitted the delivery.

## Accessibility & Inclusion

- Colour must always carry a textual equivalent — a stated acceptance criterion, not a
  preference.
- Full keyboard operation including viewer controls.
- Japanese labels must render and remain readable throughout, at both chrome and data
  level.
- Severity is the product's highest-stakes encoding and must survive colour-vision
  deficiency; the committed severity ramp currently fails this and is corrected in the
  design work.
