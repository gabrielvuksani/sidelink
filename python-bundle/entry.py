#!/usr/bin/env python3
"""
Sidelink Unified Python Entry Point
====================================
Single binary that bundles anisette, GSA auth, and pymobiledevice3.
Dispatched via --command argument.

This gets compiled into a standalone executable via PyInstaller so
end users never need to install Python.

Usage:
  sidelink-python --command anisette
  sidelink-python --command gsa-auth      < request.json
  sidelink-python --command pmd3 usbmux list --usb
  sidelink-python --command version
"""

import sys
import json
import argparse
import importlib
import os

def main():
    parser = argparse.ArgumentParser(description='Sidelink Python Helper')
    parser.add_argument('--command', required=True,
                        choices=['anisette', 'gsa-auth', 'pmd3', 'version', 'check'],
                        help='Which helper to run')
    parser.add_argument('rest', nargs='*', help='Additional arguments for pmd3')

    args = parser.parse_args()

    if args.command == 'version':
        print(json.dumps({
            'python': sys.version,
            'platform': sys.platform,
            'arch': os.uname().machine if hasattr(os, 'uname') else 'unknown',
            'bundled': getattr(sys, 'frozen', False),
        }))
        return

    if args.command == 'check':
        # Verify all dependencies are available
        checks = {}
        for mod_name in ['anisette', 'srp', 'pbkdf2', 'requests', 'cryptography', 'pymobiledevice3']:
            try:
                importlib.import_module(mod_name)
                checks[mod_name] = True
            except ImportError as e:
                checks[mod_name] = str(e)
        print(json.dumps({'ok': all(v is True for v in checks.values()), 'modules': checks}))
        return

    if args.command == 'anisette':
        run_anisette()
        return

    if args.command == 'gsa-auth':
        run_gsa_auth()
        return

    if args.command == 'pmd3':
        run_pmd3(args.rest)
        return

def run_anisette():
    """Generate anisette headers — same logic as scripts/anisette-helper.py"""
    try:
        from anisette import Anisette
    except ImportError:
        print(json.dumps({'error': 'anisette package not installed'}))
        sys.exit(1)

    try:
        ani = Anisette()
        headers = ani.generate_headers()
        print(json.dumps(headers))
    except Exception as e:
        print(json.dumps({'error': str(e)}))
        sys.exit(1)

def run_gsa_auth():
    """Run GSA auth commands — reads JSON from stdin, writes JSON to stdout.
    
    This is the same protocol as scripts/gsa-auth-helper.py but imported
    directly rather than spawned as a separate script.
    """
    # Read request from stdin
    input_data = sys.stdin.read()
    if not input_data.strip():
        print(json.dumps({'error': 'No input provided'}))
        sys.exit(1)

    try:
        request = json.loads(input_data)
    except json.JSONDecodeError as e:
        print(json.dumps({'error': f'Invalid JSON input: {str(e)}'}))
        sys.exit(1)

    # Import the GSA auth module
    # When bundled, the gsa_auth module is included alongside this entry point
    try:
        # Try importing from bundled location first
        from sidelink_gsa_auth import handle_command
        result = handle_command(request)
        print(json.dumps(result))
    except ImportError:
        # Fallback: try running the original script logic directly
        try:
            # Add scripts directory to path for development mode
            scripts_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'scripts')
            if os.path.isdir(scripts_dir):
                sys.path.insert(0, scripts_dir)
            from gsa_auth_helper import handle_command
            result = handle_command(request)
            print(json.dumps(result))
        except ImportError:
            print(json.dumps({'error': 'GSA auth module not found'}))
            sys.exit(1)
    except Exception as e:
        print(json.dumps({'error': str(e), 'error_type': type(e).__name__}))
        sys.exit(1)

def run_pmd3(extra_args):
    """Run pymobiledevice3 commands by delegating to its CLI."""
    try:
        from pymobiledevice3.__main__ import cli
    except ImportError:
        print(json.dumps({'error': 'pymobiledevice3 not installed'}), file=sys.stderr)
        sys.exit(1)

    # pymobiledevice3 uses Click for its CLI
    # Prepend --no-color for consistent output parsing
    cli_args = ['--no-color'] + extra_args
    sys.argv = ['pymobiledevice3'] + cli_args

    try:
        cli(standalone_mode=False)
    except SystemExit as e:
        sys.exit(e.code or 0)
    except Exception as e:
        print(json.dumps({'error': str(e)}), file=sys.stderr)
        sys.exit(1)

if __name__ == '__main__':
    main()
