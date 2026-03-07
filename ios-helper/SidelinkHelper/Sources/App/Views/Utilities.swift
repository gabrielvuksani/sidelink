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

enum SidelinkSourceURLUtil {
    static let canonicalOfficialSourceURL = "https://raw.githubusercontent.com/gabrielvuksani/sidelink/main/docs/source/source.json"
    private static let legacyOfficialSourceURL = "https://raw.githubusercontent.com/gabrielvuksani/sidelink/main/docs/source.json"

    static func normalized(_ raw: String) -> String {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.caseInsensitiveCompare(legacyOfficialSourceURL) == .orderedSame || isLegacyOfficialGitHubSourceURL(trimmed) {
            return canonicalOfficialSourceURL
        }
        return trimmed
    }

    private static func isLegacyOfficialGitHubSourceURL(_ raw: String) -> Bool {
        guard let url = URL(string: raw), url.host?.caseInsensitiveCompare("raw.githubusercontent.com") == .orderedSame else {
            return false
        }

        let segments = url.path.split(separator: "/").map(String.init)
        guard segments.count >= 5 else {
            return false
        }

        let owner = segments[0]
        let sourcePath = segments[3...].joined(separator: "/")
        guard owner.caseInsensitiveCompare("gabrielvuksani") == .orderedSame else {
            return false
        }

        return sourcePath.caseInsensitiveCompare("docs/source.json") == .orderedSame ||
            sourcePath.caseInsensitiveCompare("docs/source/source.json") == .orderedSame
    }
}

enum SidelinkLogRedaction {
    static func sanitize(_ raw: String) -> String {
        var sanitized = raw
        let replacements: [(String, String)] = [
            ("(?i)(authorization\\s*[:=]\\s*bearer\\s+)[^\\s,;]+", "$1[redacted]"),
            ("(?i)(password[\"']?\\s*[:=]\\s*[\"']?)[^\"'\\s,}]+", "$1[redacted]"),
            ("(?i)(token[\"']?\\s*[:=]\\s*[\"']?)[^\"'\\s,}]+", "$1[redacted]"),
            ("(?i)(session[\"']?\\s*[:=]\\s*[\"']?)[^\"'\\s,}]+", "$1[redacted]"),
            ("(?i)(apple\\s*id\\s*[:=]\\s*)[^\\s,;]+@[^\\s,;]+", "$1[redacted]"),
            ("(?i)([A-Z0-9._%+-]+)@([A-Z0-9.-]+\\.[A-Z]{2,})", "[redacted-email]"),
            ("(?i)((?:verification|pairing|2fa|two-factor|auth)\\s*(?:code)?\\s*[:=]?\\s*)(\\d{6})", "$1[redacted]")
        ]

        for (pattern, template) in replacements {
            sanitized = sanitized.replacingOccurrences(
                of: pattern,
                with: template,
                options: .regularExpression
            )
        }

        return sanitized
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
