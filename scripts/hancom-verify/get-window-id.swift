#!/usr/bin/env swift
//
// get-window-id.swift — Hancom Office HWP 윈도우 ID를 찾습니다.
//
// macOS CoreGraphics API를 사용하여 pyobjc 없이 동작합니다.
// 사용법: swift get-window-id.swift [--wait SECONDS] [--app-name PATTERN] [--verbose]
//
import CoreGraphics
import Foundation

// ── Parse arguments ──
var waitSec: Double = 0
var appPattern = "hancom"
var verbose = false

var args = CommandLine.arguments.dropFirst()
while let arg = args.first {
    args = args.dropFirst()
    switch arg {
    case "--wait":
        if let next = args.first {
            args = args.dropFirst()
            waitSec = Double(next) ?? 0
        }
    case "--app-name":
        if let next = args.first {
            args = args.dropFirst()
            appPattern = next.lowercased()
        }
    case "--verbose":
        verbose = true
    default:
        break
    }
}

// ── Find window ──
func findWindow() -> Int? {
    guard let windowList = CGWindowListCopyWindowInfo(
        [.optionOnScreenOnly, .excludeDesktopElements],
        kCGNullWindowID
    ) as? [[String: Any]] else {
        return nil
    }

    for window in windowList {
        let ownerName = (window[kCGWindowOwnerName as String] as? String ?? "").lowercased()
        let windowName = (window[kCGWindowName as String] as? String ?? "").lowercased()
        let layer = window[kCGWindowLayer as String] as? Int ?? -1
        let windowNumber = window[kCGWindowNumber as String] as? Int ?? -1

        if verbose {
            fputs("  [\(windowNumber)] layer=\(layer) owner=\"\(ownerName)\" name=\"\(windowName)\"\n", stderr)
        }

        if layer == 0 && (ownerName.contains(appPattern) || windowName.contains(appPattern)) {
            return windowNumber
        }
    }
    return nil
}

// ── Poll with timeout ──
let deadline = Date().addingTimeInterval(waitSec)
let pollInterval: TimeInterval = 0.5

repeat {
    if let wid = findWindow() {
        print(wid)
        exit(0)
    }
    if Date() >= deadline { break }
    Thread.sleep(forTimeInterval: pollInterval)
} while true

fputs("ERROR: No window found matching '\(appPattern)'\n", stderr)
exit(1)
