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
                    HStack(spacing: 4) {
                        Text("Snapshot")
                        Text(snapshotDate, style: .relative)
                    }
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

struct TodayExpiryPressureRow: View {
    let pressure: DailyOperationsExpiryDTO
    let onOpen: () -> Void

    var body: some View {
        Button(action: onOpen) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: pressure.expired ? "exclamationmark.octagon.fill" : "clock")
                    .foregroundStyle(tone.color)
                    .frame(minWidth: 24, minHeight: 24, alignment: .top)
                    .accessibilityHidden(true)

                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .top, spacing: 10) {
                        expiryIdentity
                        Text(statusLabel)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(tone.color)
                            .multilineTextAlignment(.trailing)
                    }
                    .fixedSize(horizontal: true, vertical: false)

                    VStack(alignment: .leading, spacing: 6) {
                        expiryIdentity
                        Text(statusLabel)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(tone.color)
                    }
                }

                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityHint("Opens the installed app.")
    }

    private var expiryIdentity: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(pressure.appName)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.primary)
            Text(pressure.deviceName)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private var tone: TodayLedgerTone {
        if pressure.recoveryInFlight { return .accent }
        return pressure.expired ? .danger : .warning
    }

    private var statusLabel: String {
        if pressure.recoveryInFlight { return "Recovering" }
        if pressure.expired { return "Expired" }
        return "\(pressure.daysRemaining)d remaining"
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
