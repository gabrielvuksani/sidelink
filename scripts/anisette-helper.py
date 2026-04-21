#!/usr/bin/env python3
"""
Anisette header generator for SideLink.

Generates Apple anisette (machine provisioning) data required for
Apple GSA authentication. Uses the `anisette` Python package which
emulates Apple's ADI (Apple Device Identity) protocol.

Usage:
  python3 scripts/anisette-helper.py

Outputs:
  JSON object with anisette headers to stdout.

On first run the library bundle (~3 MB) is downloaded from a CDN
and cached automatically by the anisette package.
"""

import json
import sys

# Use the OS trust store so Apple Root CA is trusted on macOS
try:
    import truststore
    truststore.inject_into_ssl()
except ImportError:
    pass


def main():
    try:
        from anisette import Anisette
    except ImportError:
        print(
            json.dumps({
                "error": "Python 'anisette' package not installed. "
                         "Run: npm install (or .venv/bin/pip install anisette)"
            }),
            file=sys.stdout,
        )
        sys.exit(1)

    try:
        ani = Anisette.init()
        data = ani.get_data()
        print(json.dumps(data))
    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stdout)
        sys.exit(1)


if __name__ == "__main__":
    main()
