#!/usr/bin/env python3
"""
PyInstaller build script for the Sidelink Python binary.

Produces a single-file executable containing:
  - Python runtime
  - anisette, srp, pbkdf2, requests, cryptography, pymobiledevice3
  - GSA auth helper logic

Usage:
  python build.py                          # Build for current platform
  python build.py --output-dir ./dist      # Custom output directory

The output binary is named:
  sidelink-python        (macOS/Linux)
  sidelink-python.exe    (Windows)
"""

import os
import sys
import shutil
import platform
import subprocess
import argparse

def get_platform_arch():
    """Get platform-arch identifier matching Node.js conventions."""
    plat = os.environ.get('SIDELINK_PLATFORM') or sys.platform
    if plat == 'linux':
        plat = 'linux'
    elif plat == 'darwin':
        plat = 'darwin'
    elif plat == 'win32':
        plat = 'win32'

    requested_arch = os.environ.get('SIDELINK_ARCH')
    if requested_arch:
        arch = requested_arch
    else:
        machine = platform.machine().lower()
        if machine in ('x86_64', 'amd64'):
            arch = 'x64'
        elif machine in ('arm64', 'aarch64'):
            arch = 'arm64'
        elif machine in ('i386', 'i686', 'x86'):
            arch = 'ia32'
        else:
            arch = machine

    return f'{plat}-{arch}'

def main():
    parser = argparse.ArgumentParser(description='Build Sidelink Python binary')
    parser.add_argument('--output-dir', default=None, help='Output directory for the binary')
    parser.add_argument('--onefile', action='store_true', default=True, help='Build as single file (default)')
    parser.add_argument('--onedir', action='store_true', help='Build as directory')
    args = parser.parse_args()

    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(script_dir)
    entry_point = os.path.join(script_dir, 'entry.py')
    gsa_helper = os.path.join(project_root, 'scripts', 'gsa-auth-helper.py')

    platform_arch = get_platform_arch()
    output_dir = args.output_dir or os.path.join(script_dir, 'dist', platform_arch)
    os.makedirs(output_dir, exist_ok=True)

    print(f'Building sidelink-python for {platform_arch}...')
    print(f'Output dir: {output_dir}')

    # Ensure PyInstaller is installed
    try:
        import PyInstaller
    except ImportError:
        print('Installing PyInstaller...')
        subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'pyinstaller'])

    # Build hidden imports list for pymobiledevice3 (it has many submodules)
    hidden_imports = [
        'anisette',
        'srp',
        'srp._pysrp',
        'pbkdf2',
        'requests',
        'cryptography',
        'pymobiledevice3',
        'pymobiledevice3.cli',
        'pymobiledevice3.lockdown',
        'pymobiledevice3.usbmux',
        'pymobiledevice3.services.installation_proxy',
    ]

    # Build PyInstaller command
    cmd = [
        sys.executable, '-m', 'PyInstaller',
        '--clean',
        '--noconfirm',
        '--name', 'sidelink-python',
        '--distpath', output_dir,
        '--workpath', os.path.join(script_dir, 'build'),
        '--specpath', os.path.join(script_dir, 'build'),
    ]

    if args.onedir:
        cmd.append('--onedir')
    else:
        cmd.append('--onefile')
        if sys.platform != 'win32':
            cmd.append('--strip')

    # Add hidden imports
    for hi in hidden_imports:
        cmd.extend(['--hidden-import', hi])

    # Add the GSA helper as additional data
    if os.path.exists(gsa_helper):
        sep = ';' if sys.platform == 'win32' else ':'
        cmd.extend(['--add-data', f'{gsa_helper}{sep}sidelink_gsa_auth'])

    # Entry point
    cmd.append(entry_point)

    print(f'Running: {" ".join(cmd[:10])}...')
    result = subprocess.run(cmd, cwd=project_root)

    if result.returncode != 0:
        print(f'PyInstaller failed with exit code {result.returncode}')
        sys.exit(1)

    # Verify output
    exe_name = 'sidelink-python.exe' if sys.platform == 'win32' else 'sidelink-python'
    output_path = os.path.join(output_dir, exe_name)

    if not os.path.exists(output_path):
        # PyInstaller might put it in a subdirectory
        alt_path = os.path.join(output_dir, 'sidelink-python', exe_name)
        if os.path.exists(alt_path):
            shutil.move(alt_path, output_path)
            shutil.rmtree(os.path.join(output_dir, 'sidelink-python'), ignore_errors=True)

    if os.path.exists(output_path):
        size_mb = os.path.getsize(output_path) / (1024 * 1024)
        print(f'Built {output_path} ({size_mb:.1f} MB)')
    else:
        print(f'Output not found at {output_path}')
        sys.exit(1)

if __name__ == '__main__':
    main()
