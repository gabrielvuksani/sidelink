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
                    appsSection(snapshot)
                    if !snapshot.operations.isEmpty {
                        operationsSection(snapshot)
                    }
                    hostCommandSection
                    recentSection(snapshot)
                    activitySection
                    connectionSection(snapshot)
                } else {
                    unavailableSection
                    activitySection
                    connectionOnlySection
                }
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
                Text(model.dailyOperations.map(statusHeadline) ?? "Your apps")
                    .font(dynamicTypeSize.isAccessibilitySize ? .headline.bold() : .title2.bold())
                    .foregroundStyle(.primary)
                Text(model.dailyOperations.map(statusSummary)
                    ?? "Pair this iPhone with SideLink on your Mac to see when your apps expire.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                if model.dailyOperations != nil, !commandsEnabled {
                    Label(lastKnownNotice, systemImage: "clock.badge.exclamationmark")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Color.slWarning)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)

            if let latest = model.dailyOperations?.recentOutcomes.first {
                TodayLatestOutcome(operation: latest)
            }
        }
    }

    private var lastKnownNotice: String {
        if let generatedAt = model.dailyOperations.flatMap({ todayLedgerDate(from: $0.generatedAt) }) {
            return "Last known status from \(generatedAt.formatted(.relative(presentation: .named))). Your Mac hasn't confirmed it since."
        }
        return "Last known status. Your Mac hasn't confirmed it since."
    }

    /// Plain answer to "will my apps keep working?", derived only from the snapshot.
    private func statusHeadline(_ snapshot: DailyOperationsSnapshotDTO) -> String {
        let actions = snapshot.actions.count
        if actions > 0 {
            return actions == 1 ? "1 thing needs you" : "\(actions) things need you"
        }
        let expired = snapshot.expiryPressure.filter { $0.expired && !$0.recoveryInFlight }.count
        if expired > 0 {
            return expired == 1 ? "1 app has expired" : "\(expired) apps have expired"
        }
        if !snapshot.operations.isEmpty {
            let count = snapshot.operations.count
            return count == 1 ? "Your Mac is working on 1 app" : "Your Mac is working on \(count) apps"
        }
        let due = snapshot.expiryPressure.count
        if due > 0 {
            return due == 1 ? "1 app is due for renewal" : "\(due) apps are due for renewal"
        }
        return snapshot.fleet.apps.active == 0 ? "No apps to keep signed yet" : "All apps are up to date"
    }

    private func statusSummary(_ snapshot: DailyOperationsSnapshotDTO) -> String {
        if !snapshot.actions.isEmpty {
            return "Renewals that depend on these wait until you respond."
        }
        if snapshot.expiryPressure.contains(where: { $0.expired && !$0.recoveryInFlight }) {
            return "Expired apps won't open until your Mac renews them."
        }
        if !snapshot.operations.isEmpty {
            return "You can follow progress below. Nothing is needed from you."
        }
        if !snapshot.expiryPressure.isEmpty {
            return "Your Mac can renew them while this iPhone is on the same network. Tap Renew now to start."
        }
        if snapshot.fleet.apps.active == 0 {
            return "Apps you install through SideLink on your Mac will show up here."
        }
        return "None expires in the next \(snapshot.expiryHorizonDays) days."
    }

    private var authorityStrip: some View {
        let hasSnapshot = model.dailyOperations != nil
        return TodayAuthorityStrip(
            title: authorityTitle(hasSnapshot: hasSnapshot),
            detail: authorityDetail(hasSnapshot: hasSnapshot),
            snapshotDate: model.dailyOperations.flatMap { todayLedgerDate(from: $0.generatedAt) },
            snapshotFallback: hasSnapshot ? "Last check time unavailable" : "Not checked yet",
            tone: authorityTone(hasSnapshot: hasSnapshot),
            systemImage: authorityIcon(hasSnapshot: hasSnapshot),
            badge: authorityBadge(hasSnapshot: hasSnapshot)
        )
    }

    private func authorityTitle(hasSnapshot: Bool) -> String {
        if commandsEnabled { return "Mac connected" }
        if hasSnapshot { return "Showing last known status" }
        if !model.hasPairingCredential { return "Not paired with a Mac" }
        return "Can't reach your Mac"
    }

    private func authorityDetail(hasSnapshot: Bool) -> String {
        if commandsEnabled {
            return "Your Mac answered and can renew apps when you ask."
        }
        if hasSnapshot {
            return commandDisabledReason
                ?? "You can still look around, but renewing waits until your Mac answers again."
        }
        if !model.hasPairingCredential {
            return "Pair in Settings so SideLink can check your apps."
        }
        return "Pull to refresh when your Mac is on and on the same network. Nothing changes until it answers."
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
        return hasSnapshot ? "Out of date" : "Not checked"
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
                        Text("Nothing needs you")
                            .font(.subheadline.weight(.semibold))
                        Text("No decision, sign-in, or repair is waiting.")
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
                title: "Needs you",
                detail: snapshot.actions.isEmpty
                    ? "You're all caught up."
                    : "\(snapshot.actions.count) item\(snapshot.actions.count == 1 ? "" : "s"), most important first."
            )
        } footer: {
            if !commandsEnabled {
                Text("You can still open these. Changes wait until your Mac answers again.")
            }
        }
    }

    private var hostCommandSection: some View {
        Section {
            if model.devices.count > 1 {
                Picker("Device to renew", selection: $model.selectedDeviceUdid) {
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
                        Text("Renew now")
                            .font(.headline)
                        Text("Your Mac does the work")
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
                title: "Renew",
                detail: "Your Mac signs and reinstalls apps that are due. This iPhone only sends the request."
            )
        } footer: {
            if model.devices.count > 1 {
                Text("The selected device applies to new requests only; the lists above cover every device.")
            }
        }
    }

    private func operationsSection(_ snapshot: DailyOperationsSnapshotDTO) -> some View {
        Section {
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
        } header: {
            TodayLedgerSectionHeader(
                title: "In progress",
                detail: "What your Mac is doing right now. Tap one to follow along."
            )
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
                        Text("Every renewal and install your Mac has run.")
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

    private func appsSection(_ snapshot: DailyOperationsSnapshotDTO) -> some View {
        let apps = TodayAppExpiry.list(
            installedApps: model.installedApps,
            expiryPressure: snapshot.expiryPressure,
            deviceNames: Dictionary(model.devices.map { ($0.id, $0.name) }, uniquingKeysWith: { first, _ in first })
        )
        return Section {
            if apps.isEmpty {
                Label {
                    Text(snapshot.fleet.apps.active == 0
                        ? "No apps are being kept signed yet."
                        : "\(snapshot.fleet.apps.active) app\(snapshot.fleet.apps.active == 1 ? "" : "s") tracked. None expires in the next \(snapshot.expiryHorizonDays) days.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                } icon: {
                    Image(systemName: "checkmark.circle")
                        .foregroundStyle(snapshot.fleet.apps.active == 0 ? Color.secondary : Color.slSuccess)
                }
            } else {
                ForEach(apps) { app in
                    TodayAppExpiryRow(app: app, onOpen: { perform(target: app.target) })
                }
            }
        } header: {
            TodayLedgerSectionHeader(
                title: "Your apps",
                detail: "Verified expiry from your Mac. Renewal is due inside \(snapshot.expiryHorizonDays) days."
            )
        }
    }

    private func connectionSection(_ snapshot: DailyOperationsSnapshotDTO) -> some View {
        Section {
            authorityStrip

            quotaRows(snapshot)

            LabeledContent("Signing accounts", value: "\(snapshot.fleet.accounts.active) active · \(snapshot.fleet.accounts.total) total")
            LabeledContent("Devices", value: "\(snapshot.fleet.devices.online) online · \(snapshot.fleet.devices.detected) detected")
            LabeledContent("Managed", value: "\(snapshot.fleet.devices.managed) managed · \(snapshot.fleet.devices.paired) paired")
            LabeledContent("Apps", value: "\(snapshot.fleet.apps.active) active · \(snapshot.fleet.apps.total) tracked")
            LabeledContent("Library", value: "\(snapshot.fleet.library.total) saved IPAs")

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
                title: "Your Mac",
                detail: "Connection, Apple ID limits, and setup details."
            )
        }
    }

    private var connectionOnlySection: some View {
        Section {
            authorityStrip
        } header: {
            TodayLedgerSectionHeader(
                title: "Your Mac",
                detail: "Connection to SideLink on your Mac."
            )
        }
    }

    @ViewBuilder
    private func quotaRows(_ snapshot: DailyOperationsSnapshotDTO) -> some View {
        if snapshot.quotaAvailability == "unknown" {
            LabeledContent("Weekly App IDs", value: "Not reported")
        } else if snapshot.quotaPressure.isEmpty {
            LabeledContent("Weekly App IDs", value: "No free-account limit")
        } else {
            ForEach(snapshot.quotaPressure) { quota in
                TodayQuotaPressureRow(
                    quota: quota,
                    onOpen: { perform(target: quota.target) }
                )
            }
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
            Label("Last background check", systemImage: "clock.arrow.circlepath")
                .font(.subheadline.weight(.semibold))
            Text("Asked your Mac to renew \(attempt.requested) of \(attempt.candidates) apps; \(attempt.failed) failed\(attempt.cancelled ? "; request cancelled" : "").")
                .font(.caption)
                .foregroundStyle(.secondary)
            if let attemptedAt = todayLedgerDate(from: attempt.attemptedAt) {
                Text("\(attemptedAt, style: .relative) ago · Confirms the request, not the renewal.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            } else {
                Text("Time unavailable · Confirms the request, not the renewal.")
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
                Text("Finished renewals and installs will appear here.")
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
                title: "Recent activity",
                detail: "Newest first."
            )
        }
    }

    private var unavailableSection: some View {
        Section {
            Label {
                VStack(alignment: .leading, spacing: 4) {
                    Text(model.hasPairingCredential ? "Waiting for your Mac" : "Pair with your Mac to begin")
                        .font(.headline)
                    Text(model.hasPairingCredential
                        ? "Pull to refresh when your Mac is on and on the same network. Nothing has been received yet."
                        : "Open Settings and enter the pairing code shown by SideLink on your Mac.")
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
            return "Renewing is off because this iPhone isn't paired with a Mac. Pair again in Settings."
        }
        if model.dailyOperations == nil {
            return "Renewing is off until your Mac sends its status. Pull to refresh when your Mac is reachable."
        }
        if !model.hostReachable {
            return "Renewing is off because your Mac isn't reachable. The last known status stays visible."
        }
        if model.dailyOperationsAreStale {
            return "Renewing is off because this status is out of date. Pull to refresh first."
        }
        if model.isLoading {
            return "Renewing is paused while another request to your Mac finishes."
        }
        return nil
    }

    private var jobCommandDisabledReason: String? {
        if let commandDisabledReason {
            return commandDisabledReason
        }
        if !model.supportsExactJobCommandPreconditions {
            return "Update SideLink on your Mac to cancel from this iPhone. This version can't confirm it is cancelling the right run."
        }
        return nil
    }

    private func readinessPresentation(_ status: String) -> (title: String, icon: String, tone: TodayLedgerTone) {
        switch status {
        case "ready": return ("Setup looks good", "checkmark.circle.fill", .success)
        case "attention": return ("Setup needs attention", "exclamationmark.triangle.fill", .warning)
        default: return ("Setup not fully checked", "questionmark.circle", .neutral)
        }
    }

    private func readinessDetail(_ helperPairing: String) -> String {
        switch helperPairing {
        case "paired": return "Your Mac lists this iPhone as paired."
        case "unpaired": return "Your Mac doesn't list this iPhone as paired."
        default: return "Your Mac hasn't reported this iPhone's pairing."
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
