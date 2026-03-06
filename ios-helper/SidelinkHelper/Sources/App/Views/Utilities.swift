import SwiftUI

// MARK: - Shared ISO8601 Formatter

enum SidelinkDateFormatting {
    private static let iso8601: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    private static let iso8601Plain: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        return f
    }()

    static func parse(_ iso: String) -> Date? {
        iso8601.date(from: iso) ?? iso8601Plain.date(from: iso)
    }

    private static let relativeFormatter: RelativeDateTimeFormatter = {
        let f = RelativeDateTimeFormatter()
        f.unitsStyle = .abbreviated
        return f
    }()

    static func relativeDate(_ iso: String) -> String {
        guard let date = parse(iso) else { return iso }
        return relativeFormatter.localizedString(for: date, relativeTo: Date())
    }

    static func formattedDate(_ iso: String) -> String {
        guard let date = parse(iso) else { return iso }
        return DateFormatter.localizedString(from: date, dateStyle: .medium, timeStyle: .short)
    }
}

// MARK: - File Size Formatting

enum SidelinkFormatting {
    static func fileSize(_ bytes: Double) -> String {
        let mb = bytes / (1024 * 1024)
        if mb >= 1024 {
            return String(format: "%.1f GB", mb / 1024)
        }
        if mb >= 1 {
            return String(format: "%.1f MB", mb)
        }
        return String(format: "%.0f KB", max(1, bytes / 1024))
    }
}

// MARK: - Local Host Check

enum SidelinkNetworkUtil {
    static func isLocalHost(_ host: String) -> Bool {
        let lower = host.lowercased()
        if lower == "localhost" || lower.hasSuffix(".local") {
            return true
        }

        let parts = lower.split(separator: ".")
        guard parts.count == 4,
              let a = Int(parts[0]),
              let b = Int(parts[1]) else {
            return false
        }

        if a == 10 || a == 127 || (a == 192 && b == 168) {
            return true
        }
        return a == 172 && (16...31).contains(b)
    }
}

// MARK: - Confirmation Dialog Helper

struct DestructiveConfirmation: Identifiable {
    let id = UUID()
    let title: String
    let message: String
    let buttonLabel: String
    let action: () -> Void
}
