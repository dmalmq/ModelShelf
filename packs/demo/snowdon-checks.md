# Snowdon Towers demo pack: check traceability

Every check below was authored by inspecting the four IFC4 exports in
`samples/ifc/snowdon-towers-*.ifc` (see `samples/snowdon-towers/`). Property
names and measure types were read from the files with IfcOpenShell 0.8.5, not
assumed from Revit parameter names. Citations are the buildingSMART IFC4 ADD2
TC1 property-set pages. Scope is pack metadata `disciplines`, so an
architectural rule is not evaluated against the electrical or plumbing
SourceModels.

Measured on the pinned exports (`samples/snowdon-towers/manifest.json`).
`minOccurs="0"` so a discipline with no matching entities is not applicable
rather than a universal fail.

| # | Check | Entity | Real IFC property | Source | Scope | Priority | Category | Why | Observed in the export |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Wall declares a fire rating | `IfcWall` | `Pset_WallCommon.FireRating` (`IfcLabel`) | [Pset_WallCommon](https://standards.buildingsmart.org/IFC/RELEASE/IFC4/ADD2_TC1/HTML/schema/ifcsharedbldgelements/pset/pset_wallcommon.htm) | ARCH | High | Regulatory | Fire rating is the join to the national classification for compartmentation. | Architecture: 683 of 1,078 walls carry a value (sample `"2 HR"`). 395 are an honest gap. |
| 2 | Wall declares whether it is external | `IfcWall` | `Pset_WallCommon.IsExternal` (`IfcBoolean`) | same Pset_WallCommon page | ARCH | Medium | Classification | External vs internal is the basic envelope classification. | Architecture: 1,078 of 1,078. |
| 3 | Wall declares load-bearing | `IfcWall` | `Pset_WallCommon.LoadBearing` (`IfcBoolean`) | same Pset_WallCommon page | ARCH | High | Structural | A wall not marked load-bearing is either non-structural or missing required data. | Architecture: 1,061 of 1,078. |
| 4 | Wall records thermal transmittance | `IfcWall` | `Pset_WallCommon.ThermalTransmittance` (`IfcThermalTransmittanceMeasure`) | same Pset_WallCommon page | ARCH | Advisory | Data completeness | U-value is the envelope thermal performance figure. | Architecture: 1,060 of 1,078. |
| 5 | Wall records a length quantity | `IfcWall` | `Qto_WallBaseQuantities.Length` (`IfcLengthMeasure`) | [Qto_WallBaseQuantities](https://standards.buildingsmart.org/IFC/RELEASE/IFC4/ADD2_TC1/HTML/schema/ifcsharedbldgelements/qto/qto_wallbasequantities.htm) | ARCH | Medium | Data completeness | Base quantities are the SI-normalized measures the imperial export must survive. | Architecture: 1,061 of 1,078. Sample 18.652 ft → 5.685 m (`siMultiplier` 0.3048). GrossSideArea and GrossVolume on the same walls convert with 0.09290304 and 0.028316846592. |
| 6 | Beam records its span | `IfcBeam` | `Pset_BeamCommon.Span` (`IfcPositiveLengthMeasure`) | [Pset_BeamCommon](https://standards.buildingsmart.org/IFC/RELEASE/IFC4/ADD2_TC1/HTML/schema/ifcsharedbldgelements/pset/pset_beamcommon.htm) | STRUCT | Medium | Structural | Span is basic structural-adequacy information. | Structure: 917 of 917. Architecture has no `IfcBeam`. |
| 7 | Beam declares load-bearing | `IfcBeam` | `Pset_BeamCommon.LoadBearing = true` | same Pset_BeamCommon page | STRUCT | High | Structural | A beam not marked load-bearing is miscategorized. | Structure: 917 of 917, all true. |
| 8 | Member declares whether it is external | `IfcMember` | `Pset_MemberCommon.IsExternal` (`IfcBoolean`) | [Pset_MemberCommon](https://standards.buildingsmart.org/IFC/RELEASE/IFC4/ADD2_TC1/HTML/schema/ifcsharedbldgelements/pset/pset_membercommon.htm) | ARCH, STRUCT | Medium | Classification | Members (stringers, braces) need the same envelope flag as walls. | Architecture: 1,625 of 1,625. Structure: 25 of 25. `LoadBearing` is present on structure members only and is not required here. |
| 9 | Pipe segment records invert elevation | `IfcPipeSegment` | `Pset_PipeSegmentOccurrence.InvertElevation` (`IfcLengthMeasure`) | [Pset_PipeSegmentOccurrence](https://standards.buildingsmart.org/IFC/RELEASE/IFC4/ADD2_TC1/HTML/schema/ifcsharedbldgserviceelements/pset/pset_pipesegmentoccurrence.htm) | MEP | Medium | Data completeness | Invert elevation is the drainage reference the plumbing model must carry. | Plumbing: 3,051 of 3,051. Electrical has no `IfcPipeSegment` (not applicable). Sample −5.231 ft → −1.594 m. |
| 10 | Building element proxy is marked as external | `IfcBuildingElementProxy` | `Pset_BuildingElementProxyCommon.IsExternal = true` | [Pset_BuildingElementProxyCommon](https://standards.buildingsmart.org/IFC/RELEASE/IFC4/ADD2_TC1/HTML/schema/ifcproductextension/pset/pset_buildingelementproxycommon.htm) | MEP | Advisory | Classification | Client rule that equipment proxies on the envelope are flagged external. The property is populated on every proxy; almost all values are false, so this is the rule that produces a finding spanning the two MEP SourceModels. | Electrical: 934 proxies. Plumbing: 35 proxies. `IsExternal` present on all of them. |

Electrical and plumbing are two SourceModels that share the MEP discipline. ARCH
rules are omitted from both. The 17 GlobalIds shared between those two files
are mostly relationships; the product-level collisions are two `IfcGrid` and
two `IfcBuildingStorey` rows. Selection and finding membership stay
revision-qualified.

The architectural ingest reports 1,197 skipped unsupported property
definitions (`IfcPhysicalComplexQuantity`, `IfcDoorLiningProperties`,
`IfcWindowLiningProperties`). Those stay diagnostics, never passes.
