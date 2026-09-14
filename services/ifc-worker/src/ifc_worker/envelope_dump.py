from __future__ import annotations

import json

from ifc_worker.protocol import dump_envelope_goldens


def main() -> None:
    print(json.dumps(dump_envelope_goldens()))


if __name__ == "__main__":
    main()
