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
import importlib.util
import os
import warnings

warnings.filterwarnings(
    'ignore',
    message='Unable to find acceptable character detection dependency.*',
)

def load_gsa_helper_module():
    """Load the bundled GSA helper module in both frozen and development modes."""
    try:
        return importlib.import_module('sidelink_gsa_auth')
    except ImportError:
        pass

    search_roots = []
    current_dir = os.path.dirname(os.path.abspath(__file__))
    search_roots.append(current_dir)

    meipass = getattr(sys, '_MEIPASS', None)
    if meipass:
        search_roots.append(meipass)

    search_roots.extend([
        os.path.dirname(current_dir),
        os.path.join(os.path.dirname(current_dir), 'python-bundle'),
    ])

    candidate_paths = []
    seen = set()
    for root in search_roots:
        if not root:
            continue
        for candidate in [
            os.path.join(root, 'gsa_helper_assets', 'gsa-auth-helper.py'),
            os.path.join(root, 'sidelink_gsa_auth', 'gsa-auth-helper.py'),
            os.path.join(root, 'scripts', 'gsa-auth-helper.py'),
        ]:
            normalized = os.path.normpath(candidate)
            if normalized in seen:
                continue
            seen.add(normalized)
            candidate_paths.append(normalized)

    for helper_path in candidate_paths:
        if not os.path.isfile(helper_path):
            continue

        spec = importlib.util.spec_from_file_location('sidelink_gsa_auth_runtime', helper_path)
        if spec is None or spec.loader is None:
            continue

        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    raise ImportError('Could not locate bundled GSA auth helper script')

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

        try:
            helper_module = load_gsa_helper_module()
            handle_command = getattr(helper_module, 'handle_command', None)
            if not callable(handle_command):
                raise RuntimeError('handle_command is missing')
            result = handle_command({'command': '__self_check__'})
            checks['gsa_auth'] = result == {'ok': True}
        except Exception as e:
            checks['gsa_auth'] = str(e)

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

    try:
        helper_module = load_gsa_helper_module()
        handle_command = getattr(helper_module, 'handle_command')
        result = handle_command(request)
        print(json.dumps(result))
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
