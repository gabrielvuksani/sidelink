import Foundation
import SwiftUI

struct TodayInteractionPolicy {
    let hasPairingCredential: Bool
    let hasCurrentCommandAuthority: Bool
    let isLoading: Bool

    var canInspectOperation: Bool {
        hasPairingCredential
    }

    var canIssueCommand: Bool {
        hasPairingCredential && hasCurrentCommandAuthority && !isLoading
    }
}

enum TodayLedgerTone {
    case accent
    case success
    case warning
    case danger
    case neutral

    var color: Color {
        switch self {
        case .accent: return .slAccent
        case .success: return .slSuccess
        case .warning: return .slWarning
        case .danger: return .slDanger
        case .neutral: return .secondary
        }
    }
}

struct TodayLedgerSectionHeader: View {
    let title: String
    let detail: String

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title)
                .font(.headline)
                .foregroundStyle(.primary)
                .textCase(nil)
            Text(detail)
                .font(.caption)
                .foregroundStyle(.secondary)
                .textCase(nil)
        }
        .padding(.bottom, 2)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}

struct TodayAuthorityStrip: View {
    let title: String
    let detail: String
    let snapshotDate: Date?
    let snapshotFallback: String
    let tone: TodayLedgerTone
    let systemImage: String
    let badge: String?

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: systemImage)
                .font(.body.weight(.semibold))
                .foregroundStyle(tone.color)
                .frame(minWidth: 24, minHeight: 24, alignment: .top)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 4) {
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(title)
                            .font(.subheadline.weight(.semibold))
                        if let badge {
                            TodayStatusBadge(label: badge, tone: tone)
                        }
                    }
                    .fixedSize(horizontal: true, vertical: false)

                    VStack(alignment: .leading, spacing: 6) {
                        Text(title)
                            .font(.subheadline.weight(.semibold))
                        if let badge {
                            TodayStatusBadge(label: badge, tone: tone)
                        }
                    }
                }

                Text(detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)

                if let snapshotDate {
                    (Text("Last checked ") + Text(snapshotDate, format: .relative(presentation: .named)))
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(.secondary)
                } else {
                    Text(snapshotFallback)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }

            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

struct TodayActionRow: View {
    let action: DailyOperationsActionDTO
    let enabled: Bool
    let onOpen: () -> Void

    var body: some View {
        Button(action: onOpen) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: icon)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(tone.color)
                    .frame(width: 24, height: 24)
                    .accessibilityHidden(true)

                VStack(alignment: .leading, spacing: 4) {
                    Text(action.title)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.primary)
                    Text(action.detail)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    HStack(spacing: 4) {
                        Text(action.action)
                        Image(systemName: "chevron.right")
                            .font(.caption2.weight(.semibold))
                    }
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Color.slAccent)
                }

                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.55)
        .accessibilityHint(enabled ? "Opens the related SideLink screen." : "Pair with the host to inspect this operation.")
    }

    private var tone: TodayLedgerTone {
        switch action.tone {
        case "critical": return .danger
        case "warning": return .warning
        default: return .accent
        }
    }

    private var icon: String {
        if action.target.kind == "job" { return "terminal.fill" }
        if action.tone == "critical" { return "exclamationmark.octagon.fill" }
        return "exclamationmark.triangle.fill"
    }
}

struct TodayOperationReceiptRow: View {
    let operation: DailyOperationDTO
    let recent: Bool
    let canInspect: Bool
    let canCancel: Bool
    let commandDisabledReason: String?
    let onOpen: () -> Void
    let onCancel: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Button(action: onOpen) {
                VStack(alignment: .leading, spacing: 9) {
                    ViewThatFits(in: .horizontal) {
                        HStack(alignment: .firstTextBaseline, spacing: 10) {
                            receiptIdentity
                            TodayStatusBadge(label: statusLabel, tone: statusTone)
                        }
                        .fixedSize(horizontal: true, vertical: false)

                        VStack(alignment: .leading, spacing: 2) {
                            receiptIdentity
                            TodayStatusBadge(label: statusLabel, tone: statusTone)
                        }
                    }

                    receiptField(
                        label: "Device",
                        value: operation.deviceName,
                        systemImage: "iphone"
                    )
                    receiptField(
                        label: recent ? "Last step" : "Current step",
                        value: stepLabel,
                        systemImage: "arrow.triangle.branch"
                    )

                    HStack(spacing: 5) {
                        Image(systemName: "clock")
                            .accessibilityHidden(true)
                        if let updatedAt = todayLedgerDate(from: operation.updatedAt) {
                            Text("Updated")
                            Text(updatedAt, style: .relative)
                        } else {
                            Text("Update age unavailable")
                        }
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(!canInspect)
            .opacity(canInspect ? 1 : 0.7)
            .accessibilityHint(canInspect ? "Opens the operation console." : "Pair with the host to open the operation console.")

            if !recent, operation.eligibleCommands.contains("cancel") {
                Divider()
                Button(role: .destructive, action: onCancel) {
                    Label("Request cancellation", systemImage: "xmark.circle")
                        .font(.subheadline.weight(.semibold))
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(!canCancel)

                if !canCancel, let commandDisabledReason {
                    Text(commandDisabledReason)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    @ViewBuilder
    private func receiptField(label: String, value: String, systemImage: String) -> some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Label(label, systemImage: systemImage)
                    .foregroundStyle(.secondary)
                Spacer(minLength: 8)
                Text(value)
                    .foregroundStyle(.primary)
                    .multilineTextAlignment(.trailing)
            }
            .fixedSize(horizontal: true, vertical: false)

            VStack(alignment: .leading, spacing: 2) {
                Label(label, systemImage: systemImage)
                    .foregroundStyle(.secondary)
                Text(value)
                    .foregroundStyle(.primary)
            }
        }
        .font(.caption)
    }

    private var receiptIdentity: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(operation.appName)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.primary)
            Text("\(operationLabel) · Receipt \(shortJobID) · r\(operation.revision)")
                .font(.caption2.monospacedDigit())
                .foregroundStyle(.secondary)
        }
    }

    private var shortJobID: String {
        String(operation.jobId.prefix(8))
    }

    private var operationLabel: String {
        operation.operation.replacingOccurrences(of: "_", with: " ").capitalized
    }

    private var stepLabel: String {
        guard let currentStep = operation.currentStep, !currentStep.isEmpty else {
            return operation.detail
        }
        return currentStep.replacingOccurrences(of: "_", with: " ").capitalized
    }

    private var statusLabel: String {
        switch operation.status {
        case "queued": return "Queued"
        case "running": return "In progress"
        case "waiting_2fa": return "Needs verification"
        case "completed": return operation.outcome == "not_needed" ? "No renewal needed" : "Completed"
        case "failed": return "Failed"
        default: return operation.status.replacingOccurrences(of: "_", with: " ").capitalized
        }
    }

    private var statusTone: TodayLedgerTone {
        switch operation.status {
        case "failed": return .danger
        case "completed": return .success
        case "waiting_2fa": return .warning
        default: return .accent
        }
    }
}

/// One tracked app on Today: when its signature runs out and whether renewal is due.
struct TodayAppExpiry: Identifiable {
    enum Status {
        case upToDate
        case due
        case renewing
        case expired
        case needsReview
    }

    let id: String
    let appName: String
    let deviceName: String?
    let expiresAt: Date?
    let status: Status
    let target: DailyOperationsTargetDTO

    /// Merges the host's installed-app inventory with the snapshot's expiry
    /// pressure. Pressure entries win for status because the host computed
    /// them against its renewal horizon; apps outside the horizon are up to date.
    static func list(
        installedApps: [InstalledAppDTO],
        expiryPressure: [DailyOperationsExpiryDTO],
        deviceNames: [String: String],
        now: Date = Date()
    ) -> [TodayAppExpiry] {
        let pressureById = Dictionary(expiryPressure.map { ($0.installedAppId, $0) }, uniquingKeysWith: { first, _ in first })
        let tracked = installedApps.filter { ($0.status ?? "active") == "active" }

        let fromInventory = tracked.map { app -> TodayAppExpiry in
            let pressure = pressureById[app.id]
            let expiresAt = todayLedgerDate(from: pressure?.expiresAt ?? app.expiresAt)
            return TodayAppExpiry(
                id: app.id,
                appName: app.appName ?? app.bundleId,
                deviceName: pressure?.deviceName ?? deviceNames[app.deviceUdid],
                expiresAt: expiresAt,
                status: status(
                    pressure: pressure,
                    repairRequired: app.renewalRepairRequired == true,
                    expired: expiresAt.map { $0 <= now } ?? false
                ),
                target: DailyOperationsTargetDTO(kind: "installed_app", jobId: nil, installedAppId: app.id)
            )
        }

        let inventoryIds = Set(tracked.map(\.id))
        let pressureOnly = expiryPressure
            .filter { !inventoryIds.contains($0.installedAppId) }
            .map { pressure in
                TodayAppExpiry(
                    id: pressure.installedAppId,
                    appName: pressure.appName,
                    deviceName: pressure.deviceName,
                    expiresAt: todayLedgerDate(from: pressure.expiresAt),
                    status: status(pressure: pressure, repairRequired: false, expired: pressure.expired),
                    target: pressure.target
                )
            }

        return (fromInventory + pressureOnly).sorted { lhs, rhs in
            (lhs.expiresAt ?? .distantFuture) < (rhs.expiresAt ?? .distantFuture)
        }
    }

    private static func status(
        pressure: DailyOperationsExpiryDTO?,
        repairRequired: Bool,
        expired: Bool
    ) -> Status {
        if pressure?.recoveryInFlight == true { return .renewing }
        if repairRequired { return .needsReview }
        if pressure?.expired == true || expired { return .expired }
        if pressure != nil { return .due }
        return .upToDate
    }
}

struct TodayAppExpiryRow: View {
    let app: TodayAppExpiry
    let onOpen: () -> Void

    var body: some View {
        Button(action: onOpen) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: icon)
                    .foregroundStyle(tone.color)
                    .frame(minWidth: 24, minHeight: 24, alignment: .top)
                    .accessibilityHidden(true)

                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .top, spacing: 10) {
                        identity
                        TodayStatusBadge(label: statusLabel, tone: tone)
                    }
                    .fixedSize(horizontal: true, vertical: false)

                    VStack(alignment: .leading, spacing: 6) {
                        identity
                        TodayStatusBadge(label: statusLabel, tone: tone)
                    }
                }

                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityHint("Opens the installed app.")
    }

    private var identity: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(app.appName)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.primary)
            expiryText
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private var expiryText: Text {
        let device = app.deviceName.map { " · \($0)" } ?? ""
        guard let expiresAt = app.expiresAt else {
            return Text("Expiry date unavailable\(device)")
        }
        let prefix = app.status == .expired ? "Expired" : "Expires"
        return Text("\(prefix) ") + Text(expiresAt, format: .relative(presentation: .named)) + Text(device)
    }

    private var tone: TodayLedgerTone {
        switch app.status {
        case .upToDate: return .success
        case .due: return .warning
        case .renewing: return .accent
        case .expired, .needsReview: return .danger
        }
    }

    private var icon: String {
        switch app.status {
        case .upToDate: return "checkmark.circle.fill"
        case .due: return "clock"
        case .renewing: return "arrow.triangle.2.circlepath"
        case .expired: return "exclamationmark.octagon.fill"
        case .needsReview: return "exclamationmark.triangle.fill"
        }
    }

    private var statusLabel: String {
        switch app.status {
        case .upToDate: return "Up to date"
        case .due: return "Renewal due"
        case .renewing: return "Renewing"
        case .expired: return "Expired"
        case .needsReview: return "Needs review"
        }
    }
}

/// The newest terminal receipt, phrased as what happened to the app.
struct TodayLatestOutcome: View {
    let operation: DailyOperationDTO

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: icon)
                .font(.body.weight(.semibold))
                .foregroundStyle(tone.color)
                .frame(minWidth: 24, minHeight: 24, alignment: .top)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 2) {
                Text(sentence)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.primary)
                if let updatedAt = todayLedgerDate(from: operation.updatedAt) {
                    (Text(detailPrefix) + Text(updatedAt, format: .relative(presentation: .named)))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    private var isNotNeeded: Bool {
        operation.status == "completed" && operation.outcome == "not_needed"
    }

    private var sentence: String {
        let app = operation.appName
        switch operation.status {
        case "completed":
            if isNotNeeded { return "\(app): no renewal needed yet" }
            switch operation.operation {
            case "refresh", "reactivation": return "\(app) renewed"
            case "repair": return "\(app) repaired"
            default: return "\(app) installed"
            }
        case "failed":
            return operation.operation == "refresh" ? "\(app) renewal failed" : "\(operation.title) failed"
        default:
            return operation.title
        }
    }

    private var detailPrefix: String {
        if isNotNeeded { return "Checked by your Mac " }
        return operation.status == "failed" ? "Stopped " : "Finished "
    }

    private var tone: TodayLedgerTone {
        if operation.status == "failed" { return .danger }
        return isNotNeeded ? .neutral : .success
    }

    private var icon: String {
        if operation.status == "failed" { return "xmark.octagon.fill" }
        return isNotNeeded ? "calendar.badge.checkmark" : "checkmark.seal.fill"
    }
}

struct TodayQuotaPressureRow: View {
    let quota: DailyOperationsQuotaDTO
    let onOpen: () -> Void

    var body: some View {
        Button(action: onOpen) {
            VStack(alignment: .leading, spacing: 7) {
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 10) {
                        quotaTitle
                        quotaValue
                    }
                    .fixedSize(horizontal: true, vertical: false)

                    VStack(alignment: .leading, spacing: 4) {
                        quotaTitle
                        quotaValue
                    }
                }
                ProgressView(value: max(0, min(1, quota.ratio)))
                    .tint(tone.color)
                    .accessibilityLabel("Weekly App ID usage")
                    .accessibilityValue("\(quota.used) of \(quota.limit)")
            }
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityHint("Opens Apple ID settings.")
    }

    private var quotaTitle: some View {
        Text("Signing account quota")
            .font(.subheadline)
            .foregroundStyle(.primary)
    }

    private var quotaValue: some View {
        Text("\(quota.used) of \(quota.limit)")
            .font(.subheadline.weight(.semibold).monospacedDigit())
            .foregroundStyle(tone.color)
    }

    private var tone: TodayLedgerTone {
        switch quota.tone {
        case "critical": return .danger
        case "warning": return .warning
        default: return .accent
        }
    }
}

struct TodayStatusBadge: View {
    let label: String
    let tone: TodayLedgerTone

    var body: some View {
        Text(label)
            .font(.caption2.weight(.semibold))
            .foregroundStyle(tone.color)
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .overlay {
                Capsule()
                    .stroke(tone.color, lineWidth: 1)
            }
            .fixedSize()
    }
}

func todayLedgerDate(from raw: String) -> Date? {
    let fractionalParser = ISO8601DateFormatter()
    fractionalParser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return fractionalParser.date(from: raw) ?? ISO8601DateFormatter().date(from: raw)
}
