# ModelShelf

ModelShelf helps reviewers inspect BIM deliveries against project information requirements and understand changes between deliveries.

## Language

**Source model**: A persistent contribution to a project, such as Architecture East or Mechanical. Multiple source models may belong to the same discipline.
_Avoid_: Discipline slot

**Model revision**: An immutable version of one source model, including its original submitted file.
_Avoid_: Live model

**Delivery**: A dated collection of specified model revisions presented together for review. A delivery can reuse unchanged revisions from a previous delivery.

**Check pack**: A client's collection of information requirements, applicability scopes, priorities, and source references.

**Pack version**: An immutable edition of a check pack.

**Run**: An evaluation of exact model revisions against an exact pack version using recorded checking settings.

**Finding**: A grouped violation of one distinct requirement, with links to affected objects and evidence.
_Avoid_: One error per object

**Object occurrence**: One object's representation in one model revision. Its identity within that revision differs from the identity used to match it across revisions.

**Object match**: A correspondence between object occurrences in two revisions of the same source model. A match may be confirmed or uncertain.

**Fingerprint**: A deterministic description of an object's state used to detect changes. A fingerprint does not establish object identity.

**Incomplete review**: A review whose required evidence or supported evaluation is insufficient for a conclusion. It is distinct from a pass, a failure, and a requirement that does not apply.
