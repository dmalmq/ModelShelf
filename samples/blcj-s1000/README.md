# BLCJ S1000 demo sample models

Real architecture, structure, and MEP IFC exports of BLCJ's "S造1000㎡事務所モデル"
("S1000": a steel-frame, ~1,000 m² office building), one of the two official
sample buildings the BIM Library Consortium of Japan (BLCJ,
BIMライブラリ技術研究組合) publishes to demonstrate BIM-based building-confirmation
plan review. Used here as the three-discipline demo delivery ticket 05 requires.

## Acquisition

Run `node scripts/fetch-demo-models.mjs` from the repo root. It downloads three
archives from URLs read directly off the official BLCJ sample-model page
(saved locally at
[`references/bim-checking/downloads/03-blcj-mapping/source-and-terms.html`](../../references/bim-checking/downloads/03-blcj-mapping/source-and-terms.html),
`https://blcj.or.jp/archive_index/samplemodel/`), verifies each against the
SHA-256 pinned in the script, and extracts just the `.ifc` file from each into
`samples/ifc/blcj-s1000-{architecture,structure,mep}.ifc`. Re-running the
script is a no-op if the archives are already present and verified; a hash
mismatch (the upstream file changed since the pin was taken) is a hard error,
never a silent overwrite.

| Discipline | Authoring tool | Archive | IFC entry |
| --- | --- | --- | --- |
| Architecture | GLOOBE | `BLCJ_S1000_A_GLOOBE.zip` (~14 MB) | `BLCJsampleIFC_A_GLOOBE_R2.ifc` |
| Structure | Revit/SS7 | `BLCJ_S1000_S_Revit.zip` (~23 MB) | `S_構造モデル_260319修正分.ifc` |
| MEP | Rebro | `BLCJ_S1000_MEP_Rebro.zip` (~17 MB) | `BLCJ_SampleModel_2022_MEP_Variation_03.ifc` |

Each is the smallest archive BLCJ publishes for that discipline that is
confirmed (the page's own update log, and by unzipping it) to bundle a real
IFC export alongside the native project file and a PDF. BLCJ publishes
several other tool variants per discipline (Revit/Archicad/Vectorworks for
architecture; several MEP CAD tools); this ticket did not need more than one
per discipline. [`manifest.json`](manifest.json) records the exact URL, SHA-256,
byte size, and retrieval timestamp for every downloaded archive and every
extracted IFC file.

## Usage terms (BLCJ, translated key points)

From the page's "■利用条件" (usage conditions) section, saved verbatim in
`source-and-terms.html`:

- Copyright in the sample models and reference templates belongs, in
  principle, to BLCJ and the "建築設計三会" (the three major Japanese
  architecture associations: 日本建築士会連合会, 日本建築家協会,
  日本建築士事務所協会連合会). Users customize the data for their own use.
- Published data may change without notice; use is at each user's own risk.
- **Redistribution of the data without authorization is prohibited.** BLCJ
  accepts no liability for damages arising from use of the data.

Consequently: the downloaded archives (`downloads/`) and the extracted `.ifc`
files (`samples/ifc/*.ifc`) are gitignored (see this directory's `.gitignore`
and the root `.gitignore`) and must never be committed, bundled, or otherwise
redistributed. Only this README and `manifest.json` — provenance metadata, not
the copyrighted content itself — are tracked in git. A teammate reproduces the
actual files locally via `fetch-demo-models.mjs`, never from git history.

## Alignment

See [`alignment.md`](alignment.md) for how the three discipline models'
coordinate systems were inspected and reconciled into one shared frame.
