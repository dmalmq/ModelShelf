#!/usr/bin/env python3
"""Derive none/all Snowdon grades by surgical STEP rewrite.

Reads architecture and structure with IfcOpenShell. Writes new files by
replacing targeted entity lines in the original STEP text. Never round-trips
through ifcopenshell.file.write.

Usage (from the repo root):

    uv run --locked --project services/ifc-worker python scripts/generate-snowdon-variants.py
    uv run --locked --project services/ifc-worker python scripts/generate-snowdon-variants.py --files structure --no-oracle
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import ifcopenshell
import ifcopenshell.guid
import ifcopenshell.util.element as util_element

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_IFC_DIR = REPO_ROOT / "samples" / "ifc"
DEFAULT_OUT_DIR = DEFAULT_IFC_DIR
ORACLE_PATH = REPO_ROOT / "packs" / "demo" / "snowdon-variants.oracle.json"
MANIFEST_PATH = REPO_ROOT / "samples" / "snowdon-towers" / "variants.manifest.json"
BASE_MANIFEST = REPO_ROOT / "samples" / "snowdon-towers" / "manifest.json"
SEED = "modelshelf-snowdon-variants-v1"
SCHEMA_VERSION = "snowdon-variants-oracle-v1"

ENTITY_LINE = re.compile(r"^#(\d+)=([A-Za-z0-9]+)\((.*)\)\s*;\s*$")

SPECS: list[dict[str, Any]] = [
    {
        "name": "Wall declares a fire rating",
        "entity": "IfcWall",
        "pset": "Pset_WallCommon",
        "prop": "FireRating",
        "kind": "property",
        "files": ["architecture"],
        "inherit": "type",
        "none": "null",
        "all_token": "IFCLABEL('2 HR')",
        "all_value": "2 HR",
    },
    {
        "name": "Wall declares whether it is external",
        "entity": "IfcWall",
        "pset": "Pset_WallCommon",
        "prop": "IsExternal",
        "kind": "property",
        "files": ["architecture"],
        "inherit": "occurrence",
        "none": "null",
        "all_token": "IFCBOOLEAN(.F.)",
        "all_value": False,
    },
    {
        "name": "Wall declares load-bearing",
        "entity": "IfcWall",
        "pset": "Pset_WallCommon",
        "prop": "LoadBearing",
        "kind": "property",
        "files": ["architecture"],
        "inherit": "occurrence",
        "none": "null",
        "all_token": "IFCBOOLEAN(.F.)",
        "all_value": False,
    },
    {
        "name": "Wall records thermal transmittance",
        "entity": "IfcWall",
        "pset": "Pset_WallCommon",
        "prop": "ThermalTransmittance",
        "kind": "property",
        "files": ["architecture"],
        "inherit": "type",
        "none": "null",
        "all_token": "IFCTHERMALTRANSMITTANCEMEASURE(0.12)",
        "all_value": 0.12,
    },
    {
        "name": "Wall records a length quantity",
        "entity": "IfcWall",
        "pset": "Qto_WallBaseQuantities",
        "prop": "Length",
        "kind": "quantity",
        "files": ["architecture"],
        "inherit": "occurrence",
        "none": "null",
        "all_token": "1.",
        "all_value": 1.0,
    },
    {
        "name": "Beam records its span",
        "entity": "IfcBeam",
        "pset": "Pset_BeamCommon",
        "prop": "Span",
        "kind": "property",
        "files": ["structure"],
        "inherit": "occurrence",
        "none": "null",
        "all_token": "IFCPOSITIVELENGTHMEASURE(1.)",
        "all_value": 1.0,
    },
    {
        "name": "Beam declares load-bearing",
        "entity": "IfcBeam",
        "pset": "Pset_BeamCommon",
        "prop": "LoadBearing",
        "kind": "property",
        "files": ["structure"],
        "inherit": "occurrence",
        "none": "false",
        "all_token": "IFCBOOLEAN(.T.)",
        "all_value": True,
    },
    {
        "name": "Member declares whether it is external",
        "entity": "IfcMember",
        "pset": "Pset_MemberCommon",
        "prop": "IsExternal",
        "kind": "property",
        "files": ["architecture", "structure"],
        "inherit": "occurrence",
        "none": "null",
        "all_token": "IFCBOOLEAN(.F.)",
        "all_value": False,
    },
]

INVARIANT_SPECS = [
    {
        "name": "Pipe segment records invert elevation",
        "entity": "IfcPipeSegment",
        "pset": "Pset_PipeSegmentOccurrence",
        "prop": "InvertElevation",
        "kind": "property",
        "files": ["plumbing"],
    },
    {
        "name": "Building element proxy is marked as external",
        "entity": "IfcBuildingElementProxy",
        "pset": "Pset_BuildingElementProxyCommon",
        "prop": "IsExternal",
        "kind": "property",
        "files": ["electrical", "plumbing"],
        "required": True,
    },
]


@dataclass
class Source:
    origin: str
    owner: Any
    definition: Any
    item: Any
    value: Any


@dataclass
class NullEdit:
    express_id: int
    ifc_type: str
    name: str
    old_value: Any
    new_token: str
    drop_from: int | None = None
    specs: set[str] = field(default_factory=set)
    objects: list[dict[str, Any]] = field(default_factory=list)


@dataclass
class InjectNeed:
    owner: Any
    definition: Any
    pset_name: str
    kind: str
    prop: str
    token: str
    value: Any
    spec: str
    objects: list[dict[str, Any]] = field(default_factory=list)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def display_value(raw: Any) -> Any:
    if raw is None:
        return None
    if hasattr(raw, "wrappedValue"):
        return raw.wrappedValue
    return raw


def split_step_args(inner: str) -> list[str]:
    args: list[str] = []
    buf: list[str] = []
    depth = 0
    in_str = False
    i = 0
    while i < len(inner):
        ch = inner[i]
        if in_str:
            buf.append(ch)
            if ch == "'":
                if i + 1 < len(inner) and inner[i + 1] == "'":
                    buf.append("'")
                    i += 2
                    continue
                in_str = False
            i += 1
            continue
        if ch == "'":
            in_str = True
            buf.append(ch)
        elif ch == "(":
            depth += 1
            buf.append(ch)
        elif ch == ")":
            depth -= 1
            buf.append(ch)
        elif ch == "," and depth == 0:
            args.append("".join(buf).strip())
            buf = []
        else:
            buf.append(ch)
        i += 1
    if buf:
        args.append("".join(buf).strip())
    return args


def parse_entity_line(line: str) -> tuple[int, str, list[str]] | None:
    stripped = line.rstrip("\r\n")
    match = ENTITY_LINE.match(stripped)
    if match is None:
        return None
    return int(match.group(1)), match.group(2), split_step_args(match.group(3))


def format_entity(express_id: int, ifc_type: str, args: list[str]) -> str:
    return f"#{express_id}={ifc_type}({','.join(args)});"


def newline_of(data: bytes) -> bytes:
    return b"\r\n" if b"\r\n" in data[:4096] else b"\n"


def item_value(item: Any, kind: str) -> Any:
    if item is None:
        return None
    if kind == "quantity":
        return getattr(item, "LengthValue", None)
    raw = getattr(item, "NominalValue", None)
    return display_value(raw)


def find_item(definition: Any, prop: str, kind: str) -> Any:
    if definition is None:
        return None
    items = definition.Quantities if kind == "quantity" else definition.HasProperties
    for item in items or []:
        if getattr(item, "Name", None) == prop:
            return item
    return None


def iter_definitions(product: Any) -> list[tuple[str, Any, Any]]:
    found: list[tuple[str, Any, Any]] = []
    relating_type = util_element.get_type(product)
    if relating_type is not None:
        for pset in getattr(relating_type, "HasPropertySets", None) or []:
            found.append(("type", relating_type, pset))
    for rel in getattr(product, "IsDefinedBy", None) or []:
        if rel.is_a("IfcRelDefinesByProperties"):
            found.append(("occurrence", product, rel.RelatingPropertyDefinition))
    return found


def sources_for(product: Any, spec: dict[str, Any]) -> list[Source]:
    rows: list[Source] = []
    for origin, owner, definition in iter_definitions(product):
        if getattr(definition, "Name", None) != spec["pset"]:
            continue
        item = find_item(definition, spec["prop"], spec["kind"])
        rows.append(Source(origin, owner, definition, item, item_value(item, spec["kind"])))
    return rows


def valued(source: Source) -> bool:
    value = source.value
    return value is not None and value != ""


def object_ref(entity: Any) -> dict[str, Any]:
    return {
        "expressId": entity.id(),
        "globalId": getattr(entity, "GlobalId", None),
        "ifcType": entity.is_a(),
    }


def owner_history_ref(ifc: Any) -> str:
    for pset in ifc.by_type("IfcPropertySet"):
        history = getattr(pset, "OwnerHistory", None)
        if history is not None:
            return f"#{history.id()}"
    return "$"


def stable_guid(key: str) -> str:
    return ifcopenshell.guid.compress(uuid.uuid5(uuid.NAMESPACE_URL, f"{SEED}:{key}").hex)


def hasproperties_index(ifc_type: str) -> int:
    if ifc_type == "IFCPROPERTYSET":
        return 4
    if ifc_type == "IFCELEMENTQUANTITY":
        return 5
    raise KeyError(ifc_type)


def haspropertysets_index(ifc_type: str) -> int:
    if ifc_type in {"IFCWALLTYPE", "IFCMEMBERTYPE", "IFCBEAMTYPE"}:
        return 5
    raise KeyError(ifc_type)


def tuple_append(existing: str, new_id: int) -> str:
    if existing == "$":
        return f"(#{new_id})"
    if existing.startswith("(") and existing.endswith(")"):
        inner = existing[1:-1].strip()
        if not inner:
            return f"(#{new_id})"
        return f"({inner},#{new_id})"
    raise ValueError(f"cannot append to STEP tuple {existing!r}")


def tuple_remove(existing: str, remove_id: int) -> str:
    if not existing.startswith("(") or not existing.endswith(")"):
        raise ValueError(f"cannot remove from STEP tuple {existing!r}")
    parts = [part.strip() for part in existing[1:-1].split(",") if part.strip()]
    target = f"#{remove_id}"
    kept = [part for part in parts if part != target]
    if len(kept) == len(parts):
        raise ValueError(f"{target} not in {existing}")
    if not kept:
        return "()"
    return f"({','.join(kept)})"


def plan_file(path: Path, specs: list[dict[str, Any]]) -> dict[str, Any]:
    print(f"planning {path.name}", flush=True)
    ifc = ifcopenshell.open(str(path))
    max_id = 0
    for entity in ifc:
        max_id = max(max_id, entity.id())
    nulls: dict[int, NullEdit] = {}
    injects: list[InjectNeed] = []
    spec_counts: dict[str, dict[str, int]] = {}
    for spec in specs:
        products = list(ifc.by_type(spec["entity"]))
        passed = 0
        failed = 0
        gaps: dict[tuple[int, str], InjectNeed] = {}
        for product in products:
            rows = sources_for(product, spec)
            valued_rows = [row for row in rows if valued(row)]
            if valued_rows:
                passed += 1
                for row in valued_rows:
                    edit = nulls.get(row.item.id())
                    if edit is None:
                        if spec["kind"] == "quantity":
                            new_token = "drop"
                        elif spec["none"] == "false":
                            new_token = "IFCBOOLEAN(.F.)"
                        else:
                            new_token = "$"
                        edit = NullEdit(
                            express_id=row.item.id(),
                            ifc_type=row.item.is_a(),
                            name=spec["prop"],
                            old_value=row.value,
                            new_token=new_token,
                            drop_from=row.definition.id() if spec["kind"] == "quantity" else None,
                        )
                        nulls[row.item.id()] = edit
                    edit.specs.add(spec["name"])
                    edit.objects.append(object_ref(product))
            else:
                failed += 1
                owner = util_element.get_type(product) if spec["inherit"] == "type" else product
                if owner is None:
                    owner = product
                wanted_origin = "type" if spec["inherit"] == "type" else "occurrence"
                definition = next(
                    (
                        row.definition
                        for row in rows
                        if row.origin == wanted_origin and row.definition is not None
                    ),
                    None,
                )
                key = (owner.id(), spec["pset"], spec["prop"])
                need = gaps.get(key)
                if need is None:
                    need = InjectNeed(
                        owner=owner,
                        definition=definition,
                        pset_name=spec["pset"],
                        kind=spec["kind"],
                        prop=spec["prop"],
                        token=spec["all_token"],
                        value=spec["all_value"],
                        spec=spec["name"],
                    )
                    gaps[key] = need
                    injects.append(need)
                need.objects.append(object_ref(product))
        spec_counts[spec["name"]] = {
            "applicable": len(products),
            "passed": passed,
            "failed": failed,
        }
    return {
        "max_id": max_id,
        "nulls": list(nulls.values()),
        "injects": injects,
        "spec_counts": spec_counts,
        "owner_history": owner_history_ref(ifc),
    }


def apply_null(args: list[str], ifc_type: str, new_token: str) -> list[str]:
    updated = list(args)
    if ifc_type == "IFCPROPERTYSINGLEVALUE":
        updated[2] = new_token
        return updated
    if ifc_type == "IFCQUANTITYLENGTH":
        updated[3] = new_token
        return updated
    raise KeyError(ifc_type)


def rewrite_bytes(original: bytes, plan: dict[str, Any], grade: str) -> tuple[bytes, list[dict[str, Any]]]:
    nl = newline_of(original)
    text = original.decode("latin-1")
    lines = text.splitlines()
    by_id: dict[int, int] = {}
    for index, line in enumerate(lines):
        parsed = parse_entity_line(line)
        if parsed is not None:
            by_id[parsed[0]] = index
    replacements: dict[int, str] = {}
    mutations: list[dict[str, Any]] = []
    next_id = plan["max_id"] + 1
    history = plan["owner_history"]

    if grade == "none":
        for edit in plan["nulls"]:
            line_index = by_id[edit.express_id]
            parsed = parse_entity_line(lines[line_index])
            if parsed is None:
                raise RuntimeError(f"missing entity #{edit.express_id}")
            express_id, ifc_type, args = parsed
            if edit.drop_from is not None:
                parent_index = by_id[edit.drop_from]
                parent_parsed = parse_entity_line(lines[parent_index])
                if parent_parsed is None:
                    raise RuntimeError(f"missing qto #{edit.drop_from}")
                parent_id, parent_type, parent_args = parent_parsed
                idx = hasproperties_index(parent_type)
                current = replacements.get(parent_index)
                if current is not None:
                    parent_parsed = parse_entity_line(current)
                    if parent_parsed is None:
                        raise RuntimeError(f"bad rewritten qto #{edit.drop_from}")
                    parent_id, parent_type, parent_args = parent_parsed
                parent_args = list(parent_args)
                parent_args[idx] = tuple_remove(parent_args[idx], edit.express_id)
                replacements[parent_index] = format_entity(parent_id, parent_type, parent_args)
            else:
                replacements[line_index] = format_entity(express_id, ifc_type, apply_null(args, ifc_type, edit.new_token))
            mutations.append(
                {
                    "grade": "none",
                    "kind": "drop_from_set" if edit.drop_from is not None else ("null_value" if edit.new_token == "$" else "set_false"),
                    "expressId": edit.express_id,
                    "ifcType": edit.ifc_type,
                    "name": edit.name,
                    "oldValue": edit.old_value,
                    "newValue": False if edit.new_token == "IFCBOOLEAN(.F.)" else None,
                    "specs": sorted(edit.specs),
                    "affectedObjects": edit.objects,
                }
            )

    appended: list[str] = []
    if grade == "all":
        grouped: dict[tuple[int, str], list] = defaultdict(list)
        for need in plan["injects"]:
            grouped[(need.owner.id(), need.pset_name)].append(need)
        for (owner_id, pset_name), needs in grouped.items():
            first = needs[0]
            definition = next((need.definition for need in needs if need.definition is not None), None)
            new_item_ids: list[int] = []
            for need in needs:
                item_id = next_id
                next_id += 1
                new_item_ids.append(item_id)
                if need.kind == "quantity":
                    appended.append(
                        f"#{item_id}=IFCQUANTITYLENGTH('{need.prop}',$,$,{need.token},$);"
                    )
                    item_type = "IfcQuantityLength"
                else:
                    appended.append(
                        f"#{item_id}=IFCPROPERTYSINGLEVALUE('{need.prop}',$,{need.token},$);"
                    )
                    item_type = "IfcPropertySingleValue"
                mutations.append(
                    {
                        "grade": "all",
                        "kind": "inject_item",
                        "expressId": item_id,
                        "ifcType": item_type,
                        "name": need.prop,
                        "oldValue": None,
                        "newValue": need.value,
                        "specs": [need.spec],
                        "affectedObjects": need.objects,
                        "owner": object_ref(need.owner),
                    }
                )
            if definition is not None:
                def_id = definition.id()
                line_index = by_id[def_id]
                parsed = parse_entity_line(lines[line_index])
                if parsed is None:
                    raise RuntimeError(f"missing pset #{def_id}")
                express_id, ifc_type, args = parsed
                idx = hasproperties_index(ifc_type)
                updated_args = list(args)
                for item_id in new_item_ids:
                    updated_args[idx] = tuple_append(updated_args[idx], item_id)
                replacements[line_index] = format_entity(express_id, ifc_type, updated_args)
            else:
                pset_id = next_id
                next_id += 1
                guid = stable_guid(f"all-pset:{owner_id}:{pset_name}")
                items = ",".join(f"#{item_id}" for item_id in new_item_ids)
                if first.kind == "quantity":
                    appended.append(
                        f"#{pset_id}=IFCELEMENTQUANTITY('{guid}',{history},'{pset_name}',$,$,({items}));"
                    )
                else:
                    appended.append(
                        f"#{pset_id}=IFCPROPERTYSET('{guid}',{history},'{pset_name}',$,({items}));"
                    )
                owner_index = by_id[owner_id]
                parsed = parse_entity_line(lines[owner_index])
                if parsed is None:
                    raise RuntimeError(f"missing owner #{owner_id}")
                express_id, ifc_type, args = parsed
                idx = haspropertysets_index(ifc_type)
                updated_args = list(args)
                updated_args[idx] = tuple_append(updated_args[idx], pset_id)
                replacements[owner_index] = format_entity(express_id, ifc_type, updated_args)
                mutations.append(
                    {
                        "grade": "all",
                        "kind": "inject_pset",
                        "expressId": pset_id,
                        "ifcType": "IfcElementQuantity" if first.kind == "quantity" else "IfcPropertySet",
                        "name": pset_name,
                        "oldValue": None,
                        "newValue": None,
                        "specs": sorted({need.spec for need in needs}),
                        "affectedObjects": [obj for need in needs for obj in need.objects],
                        "owner": object_ref(first.owner),
                    }
                )

    out_lines = [replacements.get(index, line.rstrip("\r\n")) for index, line in enumerate(lines)]
    if appended:
        data_end = None
        for index in range(len(out_lines) - 1, -1, -1):
            if out_lines[index].strip() == "ENDSEC;":
                data_end = index
                break
        if data_end is None:
            raise RuntimeError("DATA ENDSEC not found")
        insert_at = data_end
        if "DATA;" not in "\n".join(out_lines[: data_end + 1]).upper():
            raise RuntimeError("cannot locate DATA section")
        out_lines[insert_at:insert_at] = appended
    joined = nl.decode("ascii").join(out_lines)
    if original.endswith(nl) and not joined.endswith(nl.decode("ascii")):
        joined += nl.decode("ascii")
    return joined.encode("latin-1"), mutations


def expected_counts(partial: dict[str, int], grade: str) -> dict[str, int]:
    applicable = partial["applicable"]
    if grade == "partial":
        return dict(partial)
    if grade == "none":
        return {"applicable": applicable, "passed": 0, "failed": applicable}
    return {"applicable": applicable, "passed": applicable, "failed": 0}


def measure_invariant(ifc_dir: Path) -> dict[str, dict[str, int]]:
    counts: dict[str, dict[str, int]] = {}
    for spec in INVARIANT_SPECS:
        passed = 0
        failed = 0
        applicable = 0
        for file_key in spec["files"]:
            path = ifc_dir / f"snowdon-towers-{file_key}.ifc"
            print(f"measuring {spec['name']} on {path.name}", flush=True)
            ifc = ifcopenshell.open(str(path))
            for product in ifc.by_type(spec["entity"]):
                applicable += 1
                rows = sources_for(product, spec)
                valued_rows = [row for row in rows if valued(row)]
                if spec.get("required") is True:
                    ok = any(row.value is True for row in valued_rows)
                else:
                    ok = bool(valued_rows)
                if ok:
                    passed += 1
                else:
                    failed += 1
        counts[spec["name"]] = {"applicable": applicable, "passed": passed, "failed": failed, "invariant": True}
    return counts


def variant_name(grade: str, file_key: str) -> str:
    return f"snowdon-towers-{grade}-{file_key}.ifc"


def generate(ifc_dir: Path, out_dir: Path, files: list[str], write_oracle: bool) -> dict[str, Any]:
    seen: set[str] = set()
    for name in files:
        if name in seen:
            raise SystemExit(f"duplicate --files entry: {name}")
        seen.add(name)
    if write_oracle and seen != {"architecture", "structure"}:
        raise SystemExit(
            "writing the oracle requires --files architecture,structure. Pass --no-oracle for a subset."
        )
    out_dir.mkdir(parents=True, exist_ok=True)
    base_pin = json.loads(BASE_MANIFEST.read_text(encoding="utf-8"))
    pin_by = {model["discipline"]: model for model in base_pin["models"]}
    all_mutations: list[dict[str, Any]] = []
    grades: dict[str, dict[str, Any]] = {"none": {}, "all": {}}
    spec_table: dict[str, dict[str, Any]] = {}
    base_hashes: dict[str, Any] = {}

    for file_key in files:
        src = ifc_dir / f"snowdon-towers-{file_key}.ifc"
        if not src.is_file():
            raise SystemExit(f"missing {src}. Stage with node scripts/stage-snowdon-models.ts")
        original = src.read_bytes()
        digest = sha256_bytes(original)
        pinned = pin_by[file_key]["ifcSha256"]
        if digest != pinned:
            raise SystemExit(f"{src} hash {digest} != pinned {pinned}")
        base_hashes[file_key] = {"sha256": digest, "bytes": len(original)}
        file_specs = [spec for spec in SPECS if file_key in spec["files"]]
        plan = plan_file(src, file_specs)
        for spec_name, partial in plan["spec_counts"].items():
            row = spec_table.setdefault(spec_name, {})
            if "partial" not in row:
                row["partial"] = dict(partial)
            else:
                for key in ("applicable", "passed", "failed"):
                    row["partial"][key] += partial[key]
        for grade in ("none", "all"):
            rewritten, mutations = rewrite_bytes(original, plan, grade)
            dest = out_dir / variant_name(grade, file_key)
            dest.write_bytes(rewritten)
            digest = sha256_bytes(rewritten)
            try:
                rel = dest.relative_to(REPO_ROOT).as_posix()
            except ValueError:
                rel = dest.as_posix()
            grades[grade][file_key] = {"sha256": digest, "bytes": len(rewritten), "path": rel}
            for mutation in mutations:
                mutation["file"] = file_key
            all_mutations.extend(mutations)
            print(f"wrote {dest.name} {digest} {len(rewritten)} bytes {len(mutations)} mutations", flush=True)

    for spec_name, row in spec_table.items():
        row["none"] = expected_counts(row["partial"], "none")
        row["all"] = expected_counts(row["partial"], "all")

    if write_oracle:
        invariants = measure_invariant(ifc_dir)
        for spec_name, counts in invariants.items():
            spec_table[spec_name] = {
                "partial": {k: counts[k] for k in ("applicable", "passed", "failed")},
                "none": {k: counts[k] for k in ("applicable", "passed", "failed")},
                "all": {k: counts[k] for k in ("applicable", "passed", "failed")},
                "invariant": True,
            }

    oracle = {
        "schemaVersion": SCHEMA_VERSION,
        "seed": SEED,
        "pack": "snowdon-towers.ids",
        "base": base_hashes,
        "grades": grades,
        "specs": spec_table,
        "mutations": all_mutations,
        "notes": [
            "partial is the pinned Snowdon export. none/all are derived STEP rewrites of architecture and structure only.",
            "Electrical and plumbing are not rewritten. Deliveries reuse those revisions by id.",
            "MEP specs are invariant across grades.",
            "none nulls NominalValue on properties, drops Length from its quantity set, and sets the value-restricted beam LoadBearing to false.",
            "all injects passing properties onto the type or occurrence that currently lacks them.",
        ],
    }
    if write_oracle:
        ORACLE_PATH.write_text(json.dumps(oracle, indent=2) + "\n", encoding="utf-8")
        MANIFEST_PATH.write_text(
            json.dumps(
                {
                    "schemaVersion": SCHEMA_VERSION,
                    "seed": SEED,
                    "generatedFrom": {key: base_hashes[key]["sha256"] for key in base_hashes},
                    "grades": {
                        grade: {key: info["sha256"] for key, info in files.items()}
                        for grade, files in grades.items()
                    },
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        print(f"wrote {ORACLE_PATH.relative_to(REPO_ROOT)}", flush=True)
    return oracle


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ifc-dir", type=Path, default=DEFAULT_IFC_DIR)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUT_DIR)
    parser.add_argument("--files", default="architecture,structure")
    parser.add_argument("--no-oracle", action="store_true")
    args = parser.parse_args()
    files = [item.strip() for item in args.files.split(",") if item.strip()]
    generate(args.ifc_dir, args.output_dir, files, write_oracle=not args.no_oracle)


if __name__ == "__main__":
    main()
