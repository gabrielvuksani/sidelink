import SwiftUI

struct ActivityView: View {
    @ObservedObject var model: HelperViewModel
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    private var projection: OperationActivityProjection {
        model.operationActivity
    }

    var body: some View {
        List {
            overviewSection

            if let message = model.activityError {
                updateFailureSection(message)
            }

            if projection.isEmpty {
                emptySection
            } else {
                receiptSection(
                    title: "Needs attention",
                    detail: "Verification and failed receipts, ordered by consequence.",
                    jobs: projection.attention
                )
                receiptSection(
                    title: "Needs review",
                    detail: "These receipts use a status this version of SideLink does not recognize. Inspect them before acting.",
                    jobs: projection.needsReview
                )
                receiptSection(
                    title: "In progress",
                    detail: "Queued and running work on the paired Mac.",
                    jobs: projection.active
                )
                receiptSection(
                    title: "Recent outcomes",
                    detail: "Completed host receipts, newest first.",
                    jobs: projection.recent
                )
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.visible)
        .background(Color(uiColor: .systemGroupedBackground))
        .navigationTitle("Activity")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable {
            await model.refreshOperationActivity()
        }
        .task {
            await model.refreshOperationActivity()
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    Task { await model.refreshOperationActivity() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                        .frame(minWidth: 44, minHeight: 44)
                }
                .disabled(model.isLoadingOp("activity"))
                .accessibilityLabel("Refresh Activity from paired host")
            }
        }
    }

    private var overviewSection: some View {
        let presentation = authorityPresentation

        return Section {
            VStack(alignment: .leading, spacing: 6) {
                if !dynamicTypeSize.isAccessibilitySize {
                    Text("OPERATION RECEIPTS")
                        .font(.caption2.weight(.semibold))
                        .tracking(1.0)
                        .foregroundStyle(.secondary)
                }
                Text("Recent operation receipts")
                    .font(dynamicTypeSize.isAccessibilitySize ? .headline.bold() : .title2.bold())
                Text("Inspect verification requests, work in progress, and durable outcomes without giving stale data command authority.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)

            TodayAuthorityStrip(
                title: presentation.title,
                detail: presentation.detail,
                snapshotDate: model.activityLastSyncedAt,
                snapshotFallback: projection.isEmpty ? "No activity sync yet" : "Receipt age unavailable",
                tone: presentation.tone,
                systemImage: presentation.systemImage,
                badge: presentation.badge
            )
        }
    }

    private var emptySection: some View {
        Section {
            if model.isLoadingOp("activity") {
                HStack(spacing: 12) {
                    ProgressView()
                    Text("Checking the paired host for operation receipts…")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .frame(minHeight: 44)
            } else {
                Label {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("No operation receipts yet")
                            .font(.subheadline.weight(.semibold))
                        Text("Installs, refreshes, and reactivations will appear here after the host accepts them.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                } icon: {
                    Image(systemName: "tray")
                        .foregroundStyle(.secondary)
                }
                .accessibilityElement(children: .combine)
            }
        }
    }

    @ViewBuilder
    private func receiptSection(
        title: String,
        detail: String,
        jobs: [InstallJobDetailDTO]
    ) -> some View {
        if !jobs.isEmpty {
            Section {
                ForEach(jobs) { job in
                    ActivityReceiptRow(
                        job: job,
                        authorityState: model.activityAuthorityState(for: job)
                    ) {
                        Task { await model.openDailyOperation(jobId: job.id) }
                    }
                }
            } header: {
                TodayLedgerSectionHeader(
                    title: title,
                    detail: "\(jobs.count) receipt\(jobs.count == 1 ? "" : "s"). \(detail)"
                )
            }
        }
    }

    private func updateFailureSection(_ message: String) -> some View {
        Section {
            Label {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Latest activity update failed")
                        .font(.subheadline.weight(.semibold))
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

    private var authorityPresentation: ActivityAuthorityPresentation {
        if model.isLoadingOp("activity"), model.activityLastSyncedAt == nil {
            return ActivityAuthorityPresentation(
                title: "Checking the paired host",
                detail: "SideLink is requesting the latest operation receipts.",
                tone: .neutral,
                systemImage: "arrow.triangle.2.circlepath",
                badge: "Checking"
            )
        }
        if model.hasCurrentActivitySnapshot {
            return ActivityAuthorityPresentation(
                title: "Receipts updated from the host",
                detail: "Current and last-known labels show which exact receipt versions the paired Mac confirmed.",
                tone: .success,
                systemImage: "checkmark.circle.fill",
                badge: nil
            )
        }
        if !projection.isEmpty {
            return ActivityAuthorityPresentation(
                title: "Last known host receipts",
                detail: "Cached receipts remain inspectable. No host-changing command can run without a fresh authority check.",
                tone: .warning,
                systemImage: "clock.badge.exclamationmark",
                badge: "Last known"
            )
        }
        if model.hasPairingCredential {
            return ActivityAuthorityPresentation(
                title: "Host activity unavailable",
                detail: "Refresh when the paired host is reachable.",
                tone: .neutral,
                systemImage: "wifi.exclamationmark",
                badge: "Unavailable"
            )
        }
        return ActivityAuthorityPresentation(
            title: "No paired host",
            detail: "Pair in Settings before SideLink can read host activity.",
            tone: .neutral,
            systemImage: "link.badge.plus",
            badge: "Unavailable"
        )
    }
}

private struct ActivityAuthorityPresentation {
    let title: String
    let detail: String
    let tone: TodayLedgerTone
    let systemImage: String
    let badge: String?
}

private struct ActivityReceiptRow: View {
    let job: InstallJobDetailDTO
    let authorityState: ActivityReceiptAuthorityState
    let onOpen: () -> Void
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        Button(action: onOpen) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: icon)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(tone.color)
                    .frame(width: 24, height: 24, alignment: .top)
                    .accessibilityHidden(true)

                VStack(alignment: .leading, spacing: 7) {
                    ViewThatFits(in: .horizontal) {
                        HStack(alignment: .firstTextBaseline, spacing: 10) {
                            identity
                            Spacer(minLength: 8)
                            TodayStatusBadge(label: statusLabel, tone: tone)
                        }

                        VStack(alignment: .leading, spacing: 5) {
                            identity
                            TodayStatusBadge(label: statusLabel, tone: tone)
                        }
                    }

                    Text(job.detail)
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    Label(authorityState.label, systemImage: authorityIcon)
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(authorityColor)

                    receiptMetadata
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(.secondary)
                }

                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityHint(authorityHint)
    }

    @ViewBuilder
    private var receiptMetadata: some View {
        if dynamicTypeSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 5) {
                    branchIcon
                    Text(stepLabel)
                }
                updateAge
                    .padding(.leading, 18)
            }
        } else {
            HStack(spacing: 5) {
                branchIcon
                Text(stepLabel)
                Text("·")
                updateAge
            }
        }
    }

    private var branchIcon: some View {
        Image(systemName: "arrow.triangle.branch")
            .accessibilityHidden(true)
    }

    @ViewBuilder
    private var updateAge: some View {
        if let updatedAt = todayLedgerDate(from: job.updatedAt) {
            Text(updatedAt, style: .relative)
        } else {
            Text("Update age unavailable")
        }
    }

    private var identity: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(job.title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.primary)
            Text(receiptIdentityLabel)
                .font(.caption2.monospacedDigit())
                .foregroundStyle(.secondary)
        }
    }

    private var receiptIdentityLabel: String {
        let revisionLabel = job.revision.map { "r\($0)" } ?? "Revision unavailable"
        return "\(job.operationKind.noun) · Receipt \(job.id.prefix(8)) · \(revisionLabel)"
    }

    private var stepLabel: String {
        guard let step = job.currentStep, !step.isEmpty else {
            return InstallJobSnapshotOrdering.isTerminal(job.status) ? "Final receipt" : "Awaiting first step"
        }
        return step.replacingOccurrences(of: "_", with: " ").capitalized
    }

    private var statusLabel: String {
        switch job.status {
        case "queued": return "Queued"
        case "running": return "In progress"
        case "waiting_2fa": return "Needs verification"
        case "completed": return job.outcome == "not_needed" ? "No renewal needed" : "Completed"
        case "failed": return "Failed"
        default: return "Needs review"
        }
    }

    private var tone: TodayLedgerTone {
        switch job.status {
        case "waiting_2fa": return .warning
        case "failed": return .danger
        case "completed": return .success
        case "queued", "running": return .accent
        default: return .warning
        }
    }

    private var icon: String {
        switch job.status {
        case "waiting_2fa": return "lock.shield.fill"
        case "failed": return "xmark.octagon.fill"
        case "completed": return "checkmark.circle.fill"
        case "queued", "running": return "terminal.fill"
        default: return "exclamationmark.triangle.fill"
        }
    }

    private var authorityIcon: String {
        switch authorityState {
        case .current: return "checkmark.shield.fill"
        case .checking: return "arrow.triangle.2.circlepath"
        case .commandSubmitting: return "arrow.up.circle.fill"
        case .commandAccepted: return "clock.badge.checkmark"
        case .commandOutcomeUnknown: return "questionmark.diamond.fill"
        case .lastKnown: return "clock.badge.exclamationmark"
        }
    }

    private var authorityColor: Color {
        switch authorityState {
        case .current: return .slSuccess
        case .checking: return .secondary
        case .commandSubmitting, .commandAccepted, .commandOutcomeUnknown, .lastKnown: return .slWarning
        }
    }

    private var authorityHint: String {
        switch authorityState {
        case .current:
            return "Opens the existing operation console and rechecks this exact receipt with the paired host."
        case .checking:
            return "Opens the existing operation console. Commands stay unavailable while SideLink checks the paired host."
        case .commandSubmitting:
            return "Opens the existing operation console. A command is being sent and cannot be submitted twice."
        case .commandAccepted:
            return "Opens the existing operation console. Commands stay unavailable until the host returns a newer receipt."
        case .commandOutcomeUnknown:
            return "Opens the existing operation console. The prior command may have reached the host, so commands stay unavailable until a newer receipt arrives."
        case .lastKnown:
            return "Opens the cached operation console for inspection. Commands stay unavailable until this exact receipt is refreshed."
        }
    }
}
