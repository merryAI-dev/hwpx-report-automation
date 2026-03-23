#!/usr/bin/env python3
"""Get the window ID of the frontmost Hancom Office HWP window.

Uses macOS Quartz API (CGWindowListCopyWindowInfo) to find the window.
This does NOT require Screen Recording permission — only the screenshot step does.

Usage:
    python3 get-window-id.py [--wait SECONDS] [--app-name PATTERN]

Output: prints the window ID (integer) to stdout, or exits with code 1 if not found.
"""
import sys
import time
import argparse

try:
    import Quartz
except ImportError:
    print("ERROR: pyobjc-framework-Quartz not available. Install via: pip3 install pyobjc-framework-Quartz", file=sys.stderr)
    sys.exit(2)


def find_hancom_window(app_pattern: str = "Hancom") -> int | None:
    """Return the CGWindowNumber for the first matching on-screen window."""
    window_list = Quartz.CGWindowListCopyWindowInfo(
        Quartz.kCGWindowListOptionOnScreenOnly | Quartz.kCGWindowListExcludeDesktopElements,
        Quartz.kCGNullWindowID,
    )
    if not window_list:
        return None

    for win in window_list:
        owner = win.get("kCGWindowOwnerName", "")
        name = win.get("kCGWindowName", "")
        layer = win.get("kCGWindowLayer", 999)
        # Match normal windows (layer 0) owned by Hancom
        if layer == 0 and (app_pattern.lower() in owner.lower() or app_pattern.lower() in name.lower()):
            return int(win["kCGWindowNumber"])
    return None


def main():
    parser = argparse.ArgumentParser(description="Get Hancom Office HWP window ID")
    parser.add_argument("--wait", type=float, default=0, help="Max seconds to wait for window to appear")
    parser.add_argument("--app-name", default="Hancom", help="Substring to match in window owner name")
    parser.add_argument("--verbose", action="store_true", help="Print all windows for debugging")
    args = parser.parse_args()

    if args.verbose:
        window_list = Quartz.CGWindowListCopyWindowInfo(
            Quartz.kCGWindowListOptionOnScreenOnly | Quartz.kCGWindowListExcludeDesktopElements,
            Quartz.kCGNullWindowID,
        )
        for win in (window_list or []):
            owner = win.get("kCGWindowOwnerName", "")
            name = win.get("kCGWindowName", "")
            layer = win.get("kCGWindowLayer", "?")
            wid = win.get("kCGWindowNumber", "?")
            print(f"  [{wid}] layer={layer} owner={owner!r} name={name!r}", file=sys.stderr)

    deadline = time.monotonic() + args.wait
    poll_interval = 0.5

    while True:
        wid = find_hancom_window(args.app_name)
        if wid is not None:
            print(wid)
            return
        if time.monotonic() >= deadline:
            break
        time.sleep(poll_interval)

    print(f"ERROR: No window found matching '{args.app_name}'", file=sys.stderr)
    sys.exit(1)


if __name__ == "__main__":
    main()
