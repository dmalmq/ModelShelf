# BIM checking reference library

Saved locally on 2026-09-05 as reference inputs for planning the BIM inspection shelf. This folder is reference-only. The sources below are reference inputs, not an approved national architectural validation pack. The checker, IfcOpenShell/IfcTester worker, demo packs, and delivery viewer exist in the application. They do not live in this folder.

## Initial sources

Use these three sources first to select and explain a small architectural check pack:

| Local folder | Source | Intended use |
| --- | --- | --- |
| [01-sankai](downloads/01-sankai/) | 建築設計三会 category parameter lists, shared parameters/template, 2021 workflow guideline and 2026 data-input guide | Select relevant architectural categories and information fields. Native parameter GUIDs do not establish IFC property mappings. |
| [02-mlit-attributes](downloads/02-mlit-attributes/) | 標準属性項目リスト 統合 Ver2.0 (XLSX/PDF), overview, glossary, common/architecture/structure/MEP explanations | Define vocabulary and property meaning. Explicitly select requirements for the intended use; listing a property does not make it mandatory. |
| [03-blcj-mapping](downloads/03-blcj-mapping/) | BLCJ architectural/MEP terminology tables and sample-model parameter explanations | Interpret the sample models and investigate export mappings. Some concepts are represented through objects rather than parameters. Confirm mappings in actual IFC data. |

Working checklist shape: source reference → intended requirement → applicable elements → IFC field → expected value → automated/manual status. The 8–12 checks are authored in `packs/demo/`.

## Available for future use

Downloaded now, but not selected as initial product requirements:

| Local folder | Source | Possible later use |
| --- | --- | --- |
| [04-buildingsmart-ids](downloads/04-buildingsmart-ids/) | buildingSMART IDS repository snapshot, including documentation, XML schema, examples and IFC/IDS test cases | Technical encoding examples and checker conformance tests. These are not Japanese client requirements. Snapshot comes from the development branch; inspect version compatibility before use. |
| [05-ishigaki](downloads/05-ishigaki/) | Ishigaki-IDS-Bench dataset, dataset card and paper | Japanese/English requirement-to-IDS examples and future authoring evaluation. Dataset records contain the reference IDS; this is research material, not a regulatory rule pack. |
| [06-bsj-civil](downloads/06-bsj-civil/) | buildingSMART Japan bSJ_IDS repository snapshot | Separate civil cost-estimation experiment. Not architectural inspection requirements, and not MLIT-authored. |

## Provenance and use conditions

[manifest.json](manifest.json) records each downloaded file's source URL, resolved URL, retrieval time, byte size and SHA-256 hash. Source pages are saved where relevant. Archive contents preserve upstream documentation and license files.

- Downloaded third-party materials are excluded from Git by the local [.gitignore](.gitignore). They remain available on this machine; the index and manifest can be versioned separately.
- BLCJ prohibits unauthorized redistribution. Its downloaded source page includes the terms. Do not bundle these copies into a public repository or product distribution without resolving permission.
- MLIT usage rules are saved in `02-mlit-attributes/mlit-usage-terms.html`; third-party rights can apply. Retain attribution and identify modifications when applicable.
- 建築設計三会 source notes are saved in `01-sankai/source.html`; review applicable conditions before redistribution.
- buildingSMART IDS: consult the license included in the repository archive before reusing material.
- Ishigaki-IDS-Bench: dataset published under CC BY 4.0, per dataset card/paper; retain attribution. Paper rights are separate from dataset rights.
- bSJ_IDS: upstream README specifies CC BY-NC-SA 4.0 and states MLIT is not involved. Local availability does not authorize commercial bundling; resolve commercial use with the rights holder if needed.

## Scope

This collection covers all six checking-list/example sources discussed immediately before the save request. Large BLCJ/MLIT model archives discussed earlier are separate test-data candidates and are not part of this checklist download. Sources were validated against BLCJ samples in `packs/demo/checks.md`.
