"""Version strings recorded in every manifest, so a caller can tell which engine
produced an artifact without re-deriving it from the environment.
"""

from __future__ import annotations

import ifcopenshell
import ifctester

WORKER_VERSION = "0.1.0"
EXTRACTION_VERSION = "inspect-v1"
SCOPE_SEMANTICS_VERSION = "ids-scope-v1"


def engine_versions() -> dict[str, str]:
    return {
        "worker": WORKER_VERSION,
        "ifcOpenShell": ifcopenshell.version,
        "ifcTester": getattr(ifctester, "__version__", "0.8.5"),
        "extraction": EXTRACTION_VERSION,
        "scopeSemantics": SCOPE_SEMANTICS_VERSION,
    }
