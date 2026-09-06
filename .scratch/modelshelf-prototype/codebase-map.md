# Starting codebase, inspected 2026-09-06

These paths are orientation points, not immutable file-layout requirements. Re-read actual files before edits.

- Rust workspace: `Cargo.toml`; IFC/parser, IDS, fingerprint, and modeldiff crates under `crates/`.
- Service: `services/checker/src/`, `services/checker/migrations/0001_init.sql`, and service Cargo manifest.
- HTTP contract: `docs/contracts/http-api.md`; mirrored browser types under `apps/web/src/lib/types.ts`.
- Worker: `services/ifc-worker/pyproject.toml` and `uv.lock` exist. Its declared `ifc_worker.cli:main` entrypoint has no implementation. `docs/contracts/worker-v1.md` is a proposed protocol, not a verified interface. No worker schema/tests were present at inspection.
- Frontend: `apps/web/` contains configuration, dependencies, global theme, formatting/types/palette, and a viewer interface. No page/layout or actual viewer component exists yet.
- References: `references/bim-checking/README.md` and manifest describe six locally downloaded collections. Use the first three for initial requirements, retain the remaining three for future work.
- Existing model: ignored `samples/ifc/AC20-FZK-Haus.ifc`. BLCJ delivery fixture assembly is outstanding.
- Existing technical tests: `crates/*/tests/` and ignored `.local/ids-testcases/`.
- Plan: `.omo/plans/modelshelf-prototype.md`.

## Observed baseline

The prior review ran all four Rust library test suites successfully. IDS conformance was 288/307 with 19 accepted gaps, including over-permissive cases. The full service failed compilation due to missing seed code and dependency features. Frontend type checking passed for the scaffold, not a working UI. Re-run these checks; these are historical observations, not completion receipts.

The attempted Wave 1 work added only worker dependency files and a protocol draft. Do not assume any plan checkbox is complete. The branch contains substantial earlier uncommitted work and transcript exports. Preserve it; never reset or clean the tree to establish a baseline.

## Ownership boundaries

Backend tickets own Rust service/data/API changes. Worker tickets own Python code and the worker schema. Viewer tickets own rendering and browser integration. Fixture tickets own acquisition/generation and test packs. Shared HTTP/browser types must change together under one ticket owner. Inspect open claims before editing shared contracts.

## Approved module amendment

Read [the module decision](../../docs/adr/0001-reusable-model-modules.md). The proposed shared-contract and viewer packages do not exist yet. Their extraction is tracked work, not a completed refactor. The baseline ticket is being worked by another agent; its service/seed files may have advanced since the observations above.
