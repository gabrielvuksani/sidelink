import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

struct TodayTab: View {
    @ObservedObject var model: HelperViewModel
    let onNavigate: (DailyOperationsTargetDTO) -> Void
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    private var commandsEnabled: Bool {
        model.hostReachable && !model.dailyOperationsAreStale
    }

    private var versionedJobCommandsEnabled: Bool {
        commandsEnabled && model.supportsExactJobCommandPreconditions
    }

    private var interactionPolicy: TodayInteractionPolicy {
        TodayInteractionPolicy(
            hasPairingCredential: model.hasPairingCredential,
            hasCurrentCommandAuthority: commandsEnabled,
            isLoading: model.isLoading
        )
    }

    var body: some View {
        NavigationStack {
            List {
                overviewSection

                if let message = model.dailyOperationsError {
                    updateFailureSection(message)
                }

                if let snapshot = model.dailyOperations {
                    actionSection(snapshot)
                    hostCommandSection
                    operationsSection(snapshot)
                    pressureSection(snapshot)
                    environmentSection(snapshot)
                    recentSection(snapshot)
                } else {
                    unavailableSection
                }

                activitySection
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.visible)
            .background(Color(uiColor: .systemGroupedBackground))
            .refreshable {
                await model.refreshAll()
            }
            .navigationTitle("Today")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task { await model.refreshAll() }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                            .frame(minWidth: 44, minHeight: 44)
                    }
                    .disabled(model.isLoading)
                    .accessibilityLabel("Refresh Today from paired host")
                }
            }
        }
    }

    private var overviewSection: some View {
        Section {
            VStack(alignment: .leading, spacing: 6) {
                if !dynamicTypeSize.isAccessibilitySize {
                    Text("OPERATIONS LEDGER")
                        .font(.caption2.weight(.semibold))
                        .tracking(1.0)
                        .foregroundStyle(.secondary)
                }
                Text(model.dailyOperations?.headline ?? "Your SideLink day")
                    .font(dynamicTypeSize.isAccessibilitySize ? .headline.bold() : .title2.bold())
                    .foregroundStyle(.primary)
                Text(model.dailyOperations?.summary ?? "Pair with a host to see current operations, pressure, and outcomes.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)

            authorityStrip
        }
    }

    private var authorityStrip: some View {
        let hasSnapshot = model.dailyOperations != nil
        return TodayAuthorityStrip(
            title: authorityTitle(hasSnapshot: hasSnapshot),
            detail: authorityDetail(hasSnapshot: hasSnapshot),
            snapshotDate: model.dailyOperations.flatMap { todayLedgerDate(from: $0.generatedAt) },
            snapshotFallback: hasSnapshot ? "Snapshot age unavailable" : "No snapshot received",
            tone: authorityTone(hasSnapshot: hasSnapshot),
            systemImage: authorityIcon(hasSnapshot: hasSnapshot),
            badge: authorityBadge(hasSnapshot: hasSnapshot)
        )
    }

    private func authorityTitle(hasSnapshot: Bool) -> String {
        if commandsEnabled { return "Host reachable" }
        if hasSnapshot { return "Last known host state" }
        if !model.hasPairingCredential { return "No paired host" }
        return "Host state unavailable"
    }

    private func authorityDetail(hasSnapshot: Bool) -> String {
        if commandsEnabled {
            return "This host snapshot is current and can authorize command requests."
        }
        if hasSnapshot {
            return commandDisabledReason
                ?? "Cached ledger data remains visible, but commands require a fresh host response."
        }
        if !model.hasPairingCredential {
            return "Pair in Settings before SideLink can read or change host state."
        }
        return "Refresh when the paired host is reachable. No command can run without current host state."
    }

    private func authorityTone(hasSnapshot: Bool) -> TodayLedgerTone {
        if commandsEnabled { return .success }
        return hasSnapshot ? .warning : .neutral
    }

    private func authorityIcon(hasSnapshot: Bool) -> String {
        if commandsEnabled { return "checkmark.circle.fill" }
        if hasSnapshot { return "clock.badge.exclamationmark" }
        return model.hasPairingCredential ? "wifi.exclamationmark" : "link.badge.plus"
    }

    private func authorityBadge(hasSnapshot: Bool) -> String? {
        if commandsEnabled { return nil }
        return hasSnapshot ? "Stale" : "No snapshot"
    }

    private func updateFailureSection(_ message: String) -> some View {
        Section {
            Label {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Latest update failed")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.primary)
                    Text(message)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            } icon: {
                Image(systemName: "wifi.exclamationmark")
                    .foregroundStyle(Color.slWarning)
            }
            .accessibilityElement(children: .combine)
        }
    }

    private func actionSection(_ snapshot: DailyOperationsSnapshotDTO) -> some View {
        Section {
            if snapshot.actions.isEmpty {
                Label {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Nothing needs a response")
                            .font(.subheadline.weight(.semibold))
                        Text("The snapshot contains no confirmed decision, credential, or recovery request.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                } icon: {
                    Image(systemName: "minus.circle")
                        .foregroundStyle(.secondary)
                }
                .accessibilityElement(children: .combine)
            } else {
                ForEach(snapshot.actions) { action in
                    TodayActionRow(
                        action: action,
                        enabled: action.target.kind != "job" || interactionPolicy.canInspectOperation,
                        onOpen: { perform(target: action.target) }
                    )
                }
            }
        } header: {
            TodayLedgerSectionHeader(
                title: "Action required",
                detail: snapshot.actions.isEmpty
                    ? "No confirmed intervention in this snapshot."
                    : "\(snapshot.actions.count) confirmed item\(snapshot.actions.count == 1 ? "" : "s"), ordered by consequence."
            )
        } footer: {
            if !commandsEnabled {
                Text("These last-known items remain inspectable. Host-changing commands stay disabled until authority is fresh.")
            }
        }
    }

    private var hostCommandSection: some View {
        Section {
            if model.devices.count > 1 {
                Picker("Target for new commands", selection: $model.selectedDeviceUdid) {
                    ForEach(model.devices) { device in
                        Text(device.name).tag(device.id)
                    }
                }
                .pickerStyle(.menu)
            }

            Button {
                Task { await model.refreshAllApps() }
            } label: {
                Label {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Request refreshes")
                            .font(.headline)
                        Text("Runs on the paired host")
                            .font(.caption)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                } icon: {
                    Image(systemName: "arrow.triangle.2.circlepath")
                }
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            }
            .sidelinkProminentButton()
            .controlSize(.large)
            .disabled(!interactionPolicy.canIssueCommand)

            if let commandDisabledReason {
                Text(commandDisabledReason)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        } header: {
            TodayLedgerSectionHeader(
                title: "Host command",
                detail: "Requests are admitted by the paired desktop, never executed by this phone."
            )
        } footer: {
            if model.devices.count > 1 {
                Text("The selected target applies to new commands only; ledger counts remain fleet-wide.")
            }
        }
    }

    private func operationsSection(_ snapshot: DailyOperationsSnapshotDTO) -> some View {
        Section {
            if snapshot.operations.isEmpty {
                Label("No queued, running, or 2FA-blocked operations", systemImage: "tray")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(snapshot.operations) { operation in
                    TodayOperationReceiptRow(
                        operation: operation,
                        recent: false,
                        canInspect: interactionPolicy.canInspectOperation,
                        canCancel: versionedJobCommandsEnabled && !model.isLoading,
                        commandDisabledReason: jobCommandDisabledReason,
                        onOpen: {
                            Task { await model.openDailyOperation(jobId: operation.jobId) }
                        },
                        onCancel: {
                            Task {
                                await model.cancelDailyOperation(
                                    jobId: operation.jobId,
                                    expectedRevision: operation.revision,
                                    expectedUpdatedAt: operation.updatedAt
                                )
                            }
                        }
                    )
                }
            }
        } header: {
            TodayLedgerSectionHeader(
                title: "Active operations",
                detail: "Durable host receipts show the app, device, pipeline step, and update age."
            )
        } footer: {
            Text("Opening a receipt preserves the existing operation console and live progress flow.")
        }
    }

    private var activitySection: some View {
        Section {
            NavigationLink {
                ActivityView(model: model)
            } label: {
                Label {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("View all activity")
                            .font(.subheadline.weight(.semibold))
                        Text("Open the expanded host receipt history without replacing the install console.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                } icon: {
                    Image(systemName: "list.bullet.rectangle")
                        .foregroundStyle(Color.slAccent)
                }
                .frame(minHeight: 44)
            }
            .accessibilityHint("Shows verification requests, active work, and recent operation outcomes.")
        }
    }

    private func pressureSection(_ snapshot: DailyOperationsSnapshotDTO) -> some View {
        Section {
            Label("Installed apps", systemImage: "clock.badge.exclamationmark")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.secondary)

            if snapshot.expiryPressure.isEmpty {
                Text("No active app is inside the \(snapshot.expiryHorizonDays)-day refresh horizon.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(snapshot.expiryPressure) { pressure in
                    TodayExpiryPressureRow(
                        pressure: pressure,
                        onOpen: { perform(target: pressure.target) }
                    )
                }
            }

            Label("Weekly App IDs", systemImage: "gauge.with.dots.needle.33percent")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.secondary)

            if snapshot.quotaAvailability == "unknown" {
                Text("Quota data is not present in this snapshot.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            } else if snapshot.quotaPressure.isEmpty {
                Text("No free-account quota applies to the current accounts.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(snapshot.quotaPressure) { quota in
                    TodayQuotaPressureRow(
                        quota: quota,
                        onOpen: { perform(target: quota.target) }
                    )
                }
            }
        } header: {
            TodayLedgerSectionHeader(
                title: "Coming next",
                detail: "Expiry pressure first, then the current weekly App ID window."
            )
        }
    }

    private func environmentSection(_ snapshot: DailyOperationsSnapshotDTO) -> some View {
        Section {
            LabeledContent("Signing accounts", value: "\(snapshot.fleet.accounts.active) active · \(snapshot.fleet.accounts.total) total")
            LabeledContent("Devices", value: "\(snapshot.fleet.devices.online) online · \(snapshot.fleet.devices.detected) detected")
            LabeledContent("Managed", value: "\(snapshot.fleet.devices.managed) managed · \(snapshot.fleet.devices.paired) paired")
            LabeledContent("Apps", value: "\(snapshot.fleet.apps.active) active · \(snapshot.fleet.apps.total) tracked")
            LabeledContent("Library", value: "\(snapshot.fleet.library.total) artifacts")

            readinessSummary(snapshot)

            ForEach(snapshot.readiness.issues) { issue in
                Button {
                    perform(target: issue.target)
                } label: {
                    Label(issue.title, systemImage: "exclamationmark.triangle.fill")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Color.slWarning)
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(issue.target.kind == "job" && !interactionPolicy.canInspectOperation)
            }

            if let attempt = BackgroundRefreshCoordinator.shared.latestAttemptSummary() {
                backgroundAttemptReceipt(attempt)
            }
        } header: {
            TodayLedgerSectionHeader(
                title: "Environment and readiness",
                detail: "Compact inventory and measured host checks from this snapshot."
            )
        }
    }

    private func readinessSummary(_ snapshot: DailyOperationsSnapshotDTO) -> some View {
        let presentation = readinessPresentation(snapshot.readiness.status)
        return Label {
            VStack(alignment: .leading, spacing: 3) {
                Text(presentation.title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.primary)
                Text(readinessDetail(snapshot.readiness.helperPairing))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        } icon: {
            Image(systemName: presentation.icon)
                .foregroundStyle(presentation.tone.color)
        }
        .accessibilityElement(children: .combine)
    }

    private func backgroundAttemptReceipt(_ attempt: BackgroundRefreshAttemptSummary) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Label("Last background request", systemImage: "clock.arrow.circlepath")
                .font(.subheadline.weight(.semibold))
            Text("Requested \(attempt.requested) of \(attempt.candidates) on the paired host; \(attempt.failed) failed\(attempt.cancelled ? "; request cancelled" : "").")
                .font(.caption)
                .foregroundStyle(.secondary)
            if let attemptedAt = todayLedgerDate(from: attempt.attemptedAt) {
                Text("\(attemptedAt, style: .relative) · Request receipt only, not completion confirmation.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            } else {
                Text("Time unavailable · Request receipt only, not completion confirmation.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    private func recentSection(_ snapshot: DailyOperationsSnapshotDTO) -> some View {
        Section {
            if snapshot.recentOutcomes.isEmpty {
                Text("Completed and failed operation receipts will appear here.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(snapshot.recentOutcomes) { operation in
                    TodayOperationReceiptRow(
                        operation: operation,
                        recent: true,
                        canInspect: interactionPolicy.canInspectOperation,
                        canCancel: false,
                        commandDisabledReason: nil,
                        onOpen: {
                            Task { await model.openDailyOperation(jobId: operation.jobId) }
                        },
                        onCancel: {}
                    )
                }
            }
        } header: {
            TodayLedgerSectionHeader(
                title: "Recent outcomes",
                detail: "Terminal host receipts, newest first."
            )
        }
    }

    private var unavailableSection: some View {
        Section {
            Label {
                VStack(alignment: .leading, spacing: 4) {
                    Text(model.hasPairingCredential ? "Waiting for the host" : "Pair a host to begin")
                        .font(.headline)
                    Text(model.hasPairingCredential
                        ? "Refresh when the paired desktop is reachable. No cached operations ledger is available yet."
                        : "Open Settings and enter the pairing code shown by SideLink on your desktop.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            } icon: {
                Image(systemName: model.hasPairingCredential ? "desktopcomputer.trianglebadge.exclamationmark" : "link.badge.plus")
                    .foregroundStyle(Color.slAccent)
            }
            .accessibilityElement(children: .combine)
        }
    }

    private var commandDisabledReason: String? {
        if !model.hasPairingCredential {
            return "Commands are disabled because no paired-host credential is available. Pair again in Settings."
        }
        if model.dailyOperations == nil {
            return "Commands are disabled because no current host snapshot is available. Refresh when the host is reachable."
        }
        if !model.hostReachable {
            return "Commands are disabled because the paired host is unavailable. Last-known ledger data remains inspectable."
        }
        if model.dailyOperationsAreStale {
            return "Commands are disabled because the host snapshot is stale. Refresh successfully before making changes."
        }
        if model.isLoading {
            return "Commands are temporarily disabled while another host request is in progress."
        }
        return nil
    }

    private var jobCommandDisabledReason: String? {
        if let commandDisabledReason {
            return commandDisabledReason
        }
        if !model.supportsExactJobCommandPreconditions {
            return "Update SideLink on the paired Mac before sending receipt commands. This host has not confirmed exact-version enforcement."
        }
        return nil
    }

    private func readinessPresentation(_ status: String) -> (title: String, icon: String, tone: TodayLedgerTone) {
        switch status {
        case "ready": return ("Ready", "checkmark.circle.fill", .success)
        case "attention": return ("Readiness needs attention", "exclamationmark.triangle.fill", .warning)
        default: return ("Not fully measured", "questionmark.circle", .neutral)
        }
    }

    private func readinessDetail(_ helperPairing: String) -> String {
        switch helperPairing {
        case "paired": return "Helper pairing is reported as paired."
        case "unpaired": return "Helper pairing is reported as unpaired."
        default: return "Helper pairing has not been measured."
        }
    }

    private func perform(target: DailyOperationsTargetDTO) {
        if target.kind == "job", let jobId = target.jobId {
            Task { await model.openDailyOperation(jobId: jobId) }
            return
        }
        onNavigate(target)
    }
}
