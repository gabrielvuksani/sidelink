import SwiftUI
import UniformTypeIdentifiers

struct InstalledTab: View {
    @ObservedObject var model: HelperViewModel
    @State private var deleteConfirmation: DestructiveConfirmation?
    @State private var showImportOptions = false
    @State private var showImportURLSheet = false
    @State private var showFileImporter = false
    @State private var isRefreshingSurface = false
    @State private var isRefreshingAllInstalls = false

    private var activeApps: [InstalledAppDTO] {
        model.installedApps.filter { ($0.status ?? "active") != "deactivated" }
    }

    private var deactivatedApps: [InstalledAppDTO] {
        model.installedApps.filter { ($0.status ?? "active") == "deactivated" }
    }

    private var weeklyIdsUsed: Int {
        model.config?.freeAccountUsage?.weeklyAppIdsUsedByAccount?.values.reduce(0, +) ?? 0
    }

    private var hiddenConsumers: Int {
        model.appIds.filter { appId in
            !model.installedApps.contains(where: {
                $0.accountId == appId.accountId &&
                $0.originalBundleId == appId.originalBundleId &&
                ($0.status ?? "active") != "deactivated"
            })
        }.count
    }

    var body: some View {
        NavigationStack {
            ZStack {
                SidelinkBackdrop(accent: .slAccent)
                    .ignoresSafeArea()

                ScrollView {
                    installedContent
                        .padding(.vertical, 20)
                }
            }
            .refreshable {
                await refreshInstalledSurface()
            }
            .task {
                await refreshInstalledSurface()
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Text("Installed")
                        .font(.headline.weight(.semibold))
                }
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        Task { await refreshInstalledSurface() }
                    } label: {
                        if isRefreshingSurface {
                            ProgressView()
                                .controlSize(.small)
                        } else {
                            Image(systemName: "arrow.clockwise")
                        }
                    }
                    .disabled(isRefreshingSurface)
                }
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        showImportOptions = true
                    } label: {
                        Image(systemName: "plus")
                    }
                }
            }
            .onChange(of: model.selectedDeviceUdid) { _ in
                Task { await refreshInstalledSurface() }
            }
            .alert(
                deleteConfirmation?.title ?? "Confirm",
                isPresented: Binding(
                    get: { deleteConfirmation != nil },
                    set: { if !$0 { deleteConfirmation = nil } }
                )
            ) {
                Button(deleteConfirmation?.buttonLabel ?? "Remove", role: .destructive) {
                    deleteConfirmation?.action()
                    deleteConfirmation = nil
                }
                Button("Cancel", role: .cancel) { deleteConfirmation = nil }
            } message: {
                Text(deleteConfirmation?.message ?? "")
            }
            .confirmationDialog("Import App", isPresented: $showImportOptions, titleVisibility: .visible) {
                Button("Import from URL") {
                    showImportURLSheet = true
                }
                Button("Upload from Files") {
                    showFileImporter = true
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("Add an IPA from a remote URL or pick one from Files, then SideLink will open the install console automatically.")
            }
            .sheet(isPresented: $showImportURLSheet) {
                InstalledImportURLSheet(model: model)
            }
            .fileImporter(
                isPresented: $showFileImporter,
                allowedContentTypes: [UTType(filenameExtension: "ipa") ?? .data],
                allowsMultipleSelection: false
            ) { result in
                handleImportSelection(result)
            }
        }
    }

    private var installedContent: some View {
        VStack(spacing: 24) {
            installedHero
            installedControlStrip

            if !model.appIdUsage.isEmpty {
                quotaBoard
            }

            if let limits = model.config?.freeAccountLimits {
                signingLimitsCard(limits)
            }

            installedSections
            librarySection
        }
    }

    @ViewBuilder
    private var installedSections: some View {
        if model.isLoading && model.installedApps.isEmpty {
            VStack(spacing: 10) {
                SkeletonRow(lineCount: 2)
                SkeletonRow(lineCount: 2)
                SkeletonRow(lineCount: 2)
            }
            .padding(.horizontal, 20)
        } else if model.installedApps.isEmpty {
            VStack(spacing: 16) {
                ZStack {
                    Circle()
                        .fill(.secondary.opacity(0.08))
                        .frame(width: 120, height: 120)
                    Image(systemName: "checkmark.shield.fill")
                        .font(.system(size: 48))
                        .foregroundStyle(.secondary.opacity(0.4))
                }
                Text("No installed apps")
                    .font(.title3.bold())
                    .foregroundStyle(.secondary)
                Text("Import an IPA with the plus button, or install from Home, Search, or Sources. Signed apps will appear here with expiry tracking and refresh actions.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 40)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 40)
        } else if !activeApps.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                SidelinkSectionIntro(eyebrow: "Installed", title: "Active installs", subtitle: "Apps currently managed by SideLink, with expiry and refresh actions front and center.")
                    .padding(.horizontal, 20)

                LazyVStack(spacing: 12) {
                    ForEach(activeApps) { install in
                        installedAppCard(install)
                            .padding(.horizontal, 20)
                    }
                }
            }
        }

        if !deactivatedApps.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                SidelinkSectionIntro(eyebrow: "Archive", title: "Deactivated", subtitle: "Keep rarely used apps nearby without spending an active free-account slot.")
                    .padding(.horizontal, 20)

                LazyVStack(spacing: 12) {
                    ForEach(deactivatedApps) { install in
                        installedAppCard(install)
                            .padding(.horizontal, 20)
                    }
                }
            }
        }

        if !model.unmanagedInstalledApps.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                SidelinkSectionIntro(eyebrow: "Device Inventory", title: "Installed outside SideLink", subtitle: "These apps are present on the selected device but are not being tracked for signing or refresh. This mirrors the desktop installed audit view.")
                    .padding(.horizontal, 20)

                LazyVStack(spacing: 10) {
                    ForEach(model.unmanagedInstalledApps) { app in
                        HStack(spacing: 12) {
                            Image(systemName: "iphone.rear.camera")
                                .foregroundStyle(Color.slWarning)
                            VStack(alignment: .leading, spacing: 3) {
                                Text(app.name)
                                    .font(.subheadline.bold())
                                Text(app.bundleId)
                                    .font(.caption.monospaced())
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                            }
                            Spacer()
                            PillBadge(text: "Untracked", color: .slWarning, small: true)
                        }
                        .padding(16)
                        .liquidPanel()
                        .padding(.horizontal, 20)
                    }
                }
            }
        }
    }

    private var librarySection: some View {
        VStack(alignment: .leading, spacing: 12) {
            SidelinkSectionIntro(eyebrow: "Library", title: "Ready to install", subtitle: "Your imported IPAs stay here so you can jump back into signing without leaving this tab.")
                .padding(.horizontal, 20)

            if model.ipas.isEmpty {
                Text("Imported IPAs and uploaded files live here once you add them from the plus button.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 20)
            } else {
                LazyVStack(spacing: 0) {
                    ForEach(model.ipas) { ipa in
                        NavigationLink {
                            AppDetailView(model: model, ipa: ipa)
                        } label: {
                            libraryRow(ipa)
                        }
                        .buttonStyle(.plain)
                        .padding(.horizontal, 20)
                    }
                }
            }
        }
    }

    private var installedHero: some View {
        VStack(alignment: .leading, spacing: 18) {
            SidelinkSectionIntro(eyebrow: "Installed", title: "A sharper view of what SideLink manages", subtitle: "Active installs, expiry risk, and your ready-to-sign library stay visible without the clutter of every unrelated device app.")

            HStack(spacing: 12) {
                SidelinkStatusTile(label: "Active", value: "\(activeApps.count)", detail: "Managed installs", tint: .slAccent)
                SidelinkStatusTile(label: "Library", value: "\(model.ipas.count)", detail: "Ready to sign", tint: .slAccent2)
                SidelinkStatusTile(label: "Hidden", value: "\(hiddenConsumers)", detail: "Extra App IDs", tint: .slWarning)
            }
        }
        .liquidPanel()
        .padding(.horizontal, 20)
    }

    private var quotaBoard: some View {
        VStack(alignment: .leading, spacing: 14) {
            SidelinkSectionIntro(eyebrow: "Quota", title: "App ID consumers", subtitle: "Free-account pressure comes from App IDs, not just the installs you can see. Extensions and leftover identifiers surface here too.")
                .padding(.horizontal, 20)

            VStack(spacing: 12) {
                ForEach(model.appIdUsage) { usage in
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(usage.appleId)
                                    .font(.subheadline.bold())
                                Text(usage.teamId)
                                    .font(.caption.monospaced())
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            PillBadge(text: "\(appIdConsumers(for: usage.accountId).count) IDs", color: .slAccent2, small: true)
                        }

                        VStack(alignment: .leading, spacing: 8) {
                            quotaMeter(label: "Active App IDs", used: usage.active, limit: usage.maxActive)
                            quotaMeter(label: "Created This Week", used: usage.weeklyCreated, limit: usage.maxWeekly)
                        }

                        VStack(spacing: 8) {
                            ForEach(appIdConsumers(for: usage.accountId)) { consumer in
                                HStack(alignment: .top, spacing: 12) {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(consumer.name)
                                            .font(.caption.weight(.semibold))
                                        Text(consumer.originalBundleId)
                                            .font(.caption2.monospaced())
                                            .foregroundStyle(.secondary)
                                            .lineLimit(1)
                                    }
                                    Spacer()
                                    PillBadge(text: consumerBadgeText(for: consumer), color: consumerBadgeColor(for: consumer), small: true)
                                }
                                .padding(12)
                                .background((Color.white.opacity(0.05)), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                            }
                        }
                    }
                    .liquidPanel()
                    .padding(.horizontal, 20)
                }
            }
        }
    }

    private func signingLimitsCard(_ limits: HelperConfigDTO.FreeAccountLimitsDTO) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 20) {
                SlotGaugeRing(
                    used: activeApps.count,
                    total: limits.maxActiveApps,
                    size: 72
                )
                .accessibilityLabel("Installed app slots")

                VStack(alignment: .leading, spacing: 4) {
                    Text("Signing Status")
                        .font(.headline)
                    Text("\(activeApps.count) of \(limits.maxActiveApps) active slots in use")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    if model.isAtFreeSlotLimit {
                        PillBadge(text: "Limit Reached", color: .slWarning, small: true)
                    }
                }
                Spacer()
            }

            VStack(alignment: .leading, spacing: 8) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Weekly App IDs")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    LinearGaugeBar(
                        fraction: min(1, Double(weeklyIdsUsed) / Double(max(limits.maxNewAppIdsPerWeek, 1))),
                        height: 6
                    )
                    Text("\(weeklyIdsUsed) / \(limits.maxNewAppIdsPerWeek)")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)
                }

                Text("Certificates last \(limits.certValidityDays) days on free accounts.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .liquidPanel()
        .padding(.horizontal, 20)
    }

    private var installedControlStrip: some View {
        HStack(alignment: .center, spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                Text(controlStripTitle)
                    .font(.subheadline.weight(.semibold))
                Text(controlStripSubtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer(minLength: 12)

            Button {
                Task { await refreshAllInstalledApps() }
            } label: {
                HStack(spacing: 8) {
                    if isRefreshingAllInstalls {
                        ProgressView()
                            .controlSize(.small)
                    } else {
                        Image(systemName: "arrow.triangle.2.circlepath")
                    }
                    Text(isRefreshingAllInstalls ? "Refreshing" : "Refresh All")
                        .font(.caption.weight(.semibold))
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
            .disabled(!model.isPaired || activeApps.isEmpty || isRefreshingAllInstalls)
        }
        .overlay(alignment: .topTrailing) {
            if let mostUrgent = mostUrgentRefreshState {
                PillBadge(text: mostUrgentRefreshText(for: mostUrgent), color: mostUrgentRefreshColor(for: mostUrgent), small: true)
                    .padding(12)
            }
        }
        .liquidPanel()
        .padding(.horizontal, 20)
    }

    private func handleImportSelection(_ result: Result<[URL], Error>) {
        switch result {
        case .success(let urls):
            guard let url = urls.first else { return }
            Task {
                let didAccess = url.startAccessingSecurityScopedResource()
                defer {
                    if didAccess {
                        url.stopAccessingSecurityScopedResource()
                    }
                }

                do {
                    let fileName = url.lastPathComponent
                    let data = try await Task.detached(priority: .userInitiated) {
                        try Data(contentsOf: url, options: [.mappedIfSafe])
                    }.value
                    await model.importLocalIpa(fileName: fileName, fileData: data)
                } catch {
                    model.errorMessage = error.localizedDescription
                }
            }
        case .failure(let error):
            model.errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func refreshInstalledSurface() async {
        guard !isRefreshingSurface else { return }
        isRefreshingSurface = true
        defer { isRefreshingSurface = false }
        await model.refreshAll()
        await model.loadAppIds(sync: true)
    }

    @MainActor
    private func refreshAllInstalledApps() async {
        guard !isRefreshingAllInstalls else { return }
        isRefreshingAllInstalls = true
        defer { isRefreshingAllInstalls = false }
        await model.refreshAllApps()
    }

    private var controlStripTitle: String {
        if isRefreshingAllInstalls {
            return "Refreshing every managed app"
        }
        if isRefreshingSurface {
            return "Refreshing installed status"
        }
        if activeApps.isEmpty {
            return "Your install surface is ready"
        }
        return "Keep managed apps current"
    }

    private var controlStripSubtitle: String {
        if isRefreshingAllInstalls {
            return "SideLink is re-queueing refreshes across your managed installs."
        }
        if isRefreshingSurface {
            return "Pulling the latest device, expiry, and library state from your paired server."
        }
        if activeApps.isEmpty {
            return "Pull to refresh anytime, or use the plus button to import another IPA into your library."
        }
        return "Use Refresh All when certificates are getting close, and pull to refresh for a quick state sync."
    }

    // MARK: - App Card with Expiry Progress
    private func installedAppCard(_ install: InstalledAppDTO) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(install.appName ?? install.originalBundleId)
                        .font(.headline)
                    if let version = install.appVersion, !version.isEmpty {
                        Text("v\(version)")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 6) {
                    healthBadge(for: install.expiresAt)
                    if (install.status ?? "active") == "deactivated" {
                        PillBadge(text: "Deactivated", color: .slWarning, small: true)
                    }
                }
            }

            Text(install.bundleId)
                .font(.caption)
                .foregroundStyle(.secondary)

            // Expiry progress bar
            VStack(alignment: .leading, spacing: 4) {
                LinearGaugeBar(fraction: expiryFraction(for: install.expiresAt), height: 6)

                HStack(spacing: 4) {
                    Image(systemName: "clock")
                        .font(.caption2)
                    Text(countdownText(for: install.expiresAt))
                        .font(.caption)
                }
                .foregroundStyle(healthColor(for: install.expiresAt))
            }

            HStack(spacing: 16) {
                if let lastRefresh = install.lastRefreshAt {
                    Label(relativeDate(lastRefresh), systemImage: "arrow.clockwise")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                Label("\(install.refreshCount)×", systemImage: "repeat")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }

            if let refreshState = autoRefreshState(for: install) {
                HStack(spacing: 12) {
                    SidelinkStatusTile(
                        label: "Auto Refresh",
                        value: refreshState.refreshInProgress ? "Running" : (refreshState.needsRefresh ? "Due Soon" : "Scheduled"),
                        detail: refreshState.lastError ?? mostUrgentRefreshText(for: refreshState),
                        tint: mostUrgentRefreshColor(for: refreshState)
                    )
                    SidelinkStatusTile(
                        label: "Expiry",
                        value: refreshState.isExpired ? "Expired" : countdownText(for: refreshState.expiresAt),
                        detail: refreshState.lastRefreshAt.map(relativeDate) ?? "No refresh recorded yet",
                        tint: healthColor(for: refreshState.expiresAt)
                    )
                }
            }

            HStack(spacing: 12) {
                if (install.status ?? "active") == "deactivated" {
                    Button {
                        SidelinkHaptics.impact()
                        Task { await model.reactivateInstalledApp(install.id) }
                    } label: {
                        Label("Reactivate", systemImage: "bolt.badge.a")
                            .font(.caption.bold())
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.small)
                    .tint(.slAccent)
                } else {
                    Button {
                        SidelinkHaptics.impact()
                        Task { await model.triggerRefresh(installId: install.id) }
                    } label: {
                        Label("Refresh", systemImage: "arrow.triangle.2.circlepath")
                            .font(.caption.bold())
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.small)
                    .tint(.slAccent)
                    .accessibilityLabel("Refresh app signing")

                    Button {
                        SidelinkHaptics.impact(.light)
                        Task { await model.deactivateInstalledApp(install.id) }
                    } label: {
                        Label("Deactivate", systemImage: "pause.circle")
                            .font(.caption.bold())
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                }

                Button(role: .destructive) {
                    SidelinkHaptics.impact(.light)
                    deleteConfirmation = DestructiveConfirmation(
                        title: "Remove App",
                        message: "Remove \(install.appName ?? install.originalBundleId) from your installed apps? This cannot be undone.",
                        buttonLabel: "Remove"
                    ) {
                        Task { await model.deleteInstalledApp(install.id) }
                    }
                } label: {
                    Label("Remove", systemImage: "trash")
                        .font(.caption.bold())
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
            }
        }
        .liquidPanel()
    }

    private var mostUrgentRefreshState: AutoRefreshStateDTO? {
        model.autoRefreshStates.sorted { lhs, rhs in
            refreshPriority(lhs) > refreshPriority(rhs)
        }.first
    }

    // MARK: - Helpers
    private func expiryFraction(for iso: String) -> Double {
        guard let expires = SidelinkDateFormatting.parse(iso) else { return 0 }
        let totalDays: Double = 7
        let remaining = expires.timeIntervalSinceNow / 86_400
        if remaining <= 0 { return 1.0 }
        return max(0, 1.0 - (remaining / totalDays))
    }

    @ViewBuilder
    private func healthBadge(for iso: String) -> some View {
        let label = healthLabel(for: iso)
        let color = healthColor(for: iso)
        let icon = healthIcon(for: iso)

        Label(label.uppercased(), systemImage: icon)
            .font(.caption2.bold())
            .foregroundStyle(color)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(color.opacity(0.12))
            .clipShape(Capsule())
    }

    private func countdownText(for iso: String) -> String {
        guard let expires = SidelinkDateFormatting.parse(iso) else {
            return "Unknown"
        }
        let remaining = expires.timeIntervalSinceNow
        if remaining <= 0 {
            return "Expired"
        }
        let totalHours = Int(remaining / 3600)
        let days = totalHours / 24
        let hours = totalHours % 24
        if days > 0 {
            return "Expires in \(days)d \(hours)h"
        }
        let minutes = max(1, Int(remaining / 60))
        if totalHours > 0 {
            return "Expires in \(totalHours)h \(minutes % 60)m"
        }
        return "Expires in \(minutes)m"
    }

    private func healthLabel(for iso: String) -> String {
        guard let expires = SidelinkDateFormatting.parse(iso) else { return "unknown" }
        let remainingDays = expires.timeIntervalSinceNow / 86_400
        if remainingDays <= 0 { return "expired" }
        if remainingDays < 1 { return "critical" }
        if remainingDays <= 3 { return "expiring" }
        return "healthy"
    }

    private func healthIcon(for iso: String) -> String {
        switch healthLabel(for: iso) {
        case "healthy": return "checkmark.seal.fill"
        case "expiring": return "exclamationmark.triangle"
        case "critical": return "flame.fill"
        default: return "xmark.seal"
        }
    }

    private func healthColor(for iso: String) -> Color {
        switch healthLabel(for: iso) {
        case "healthy": return .slSuccess
        case "expiring": return .slWarning
        case "critical": return .slDanger
        default: return .slMuted
        }
    }

    private func relativeDate(_ iso: String) -> String {
        SidelinkDateFormatting.relativeDate(iso)
    }

    private func autoRefreshState(for install: InstalledAppDTO) -> AutoRefreshStateDTO? {
        model.autoRefreshStates.first { $0.installedAppId == install.id || $0.bundleId == install.bundleId }
    }

    private func refreshPriority(_ state: AutoRefreshStateDTO) -> Int {
        if state.lastError != nil { return 4 }
        if state.refreshInProgress { return 3 }
        if state.isExpired { return 2 }
        if state.needsRefresh { return 1 }
        return 0
    }

    private func mostUrgentRefreshText(for state: AutoRefreshStateDTO) -> String {
        if let lastError = state.lastError, !lastError.isEmpty {
            return "Refresh issue"
        }
        if state.refreshInProgress {
            return "Refresh running"
        }
        if state.isExpired {
            return "Expired app"
        }
        if state.needsRefresh {
            return "Needs refresh"
        }
        return "Refresh healthy"
    }

    private func mostUrgentRefreshColor(for state: AutoRefreshStateDTO) -> Color {
        if let lastError = state.lastError, !lastError.isEmpty {
            return .slDanger
        }
        if state.refreshInProgress {
            return .slAccent2
        }
        if state.isExpired || state.needsRefresh {
            return .slWarning
        }
        return .slSuccess
    }

    private func appIdConsumers(for accountId: String) -> [HelperAppIdDTO] {
        model.appIds
            .filter { $0.accountId == accountId }
            .sorted { $0.createdAt > $1.createdAt }
    }

    private func consumerBadgeText(for appId: HelperAppIdDTO) -> String {
        if model.installedApps.contains(where: { $0.accountId == appId.accountId && $0.originalBundleId == appId.originalBundleId && ($0.status ?? "active") == "deactivated" }) {
            return "Deactivated"
        }
        if model.installedApps.contains(where: { $0.accountId == appId.accountId && $0.originalBundleId == appId.originalBundleId && ($0.status ?? "active") != "deactivated" }) {
            return "Tracked"
        }
        if model.installedApps.contains(where: { $0.accountId == appId.accountId && appId.originalBundleId.hasPrefix($0.originalBundleId + ".") }) {
            return "Extension"
        }
        return "Hidden"
    }

    private func consumerBadgeColor(for appId: HelperAppIdDTO) -> Color {
        switch consumerBadgeText(for: appId) {
        case "Tracked": return .slSuccess
        case "Deactivated": return .slMuted
        case "Extension": return .slWarning
        default: return .slDanger
        }
    }

    private func quotaMeter(label: String, used: Int, limit: Int) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(label)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
                Text("\(used) / \(limit)")
                    .font(.caption.bold().monospacedDigit())
                    .foregroundStyle(.secondary)
            }
            LinearGaugeBar(
                fraction: min(1, Double(used) / Double(max(limit, 1))),
                height: 6
            )
        }
    }

    private func libraryRow(_ ipa: IpaArtifactDTO) -> some View {
        HStack(spacing: 12) {
            if let iconData = ipa.iconData,
               let data = Data(base64Encoded: iconData),
               let uiImage = UIImage(data: data) {
                Image(uiImage: uiImage)
                    .resizable()
                    .appIconStyle(size: 44)
            } else {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(.secondary.opacity(0.12))
                    .frame(width: 44, height: 44)
                    .overlay {
                        Image(systemName: "app.fill")
                            .foregroundStyle(.secondary)
                    }
            }

            VStack(alignment: .leading, spacing: 3) {
                Text(ipa.bundleName)
                    .font(.subheadline.bold())
                Text("\(ipa.bundleId) · v\(ipa.bundleShortVersion)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            Spacer()

            if model.installedApps.contains(where: { $0.bundleId == ipa.bundleId || $0.originalBundleId == ipa.bundleId }) {
                PillBadge(text: "Installed", color: .slSuccess, small: true)
            }

            Image(systemName: "chevron.right")
                .font(.caption)
                .foregroundStyle(.secondary.opacity(0.5))
        }
        .padding(.vertical, 10)
    }
}

private struct InstalledImportURLSheet: View {
    @ObservedObject var model: HelperViewModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("Import IPA from URL") {
                    TextField("https://example.com/app.ipa", text: $model.importURL)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)

                    Text("Paste a direct IPA download link. SideLink will import it and open the install console immediately.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)

                    Button {
                        Task {
                            await model.importFromURL()
                            if model.errorMessage == nil {
                                dismiss()
                            }
                        }
                    } label: {
                        Label("Import and Install", systemImage: "square.and.arrow.down")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(model.importURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || model.isLoading)
                }
            }
            .navigationTitle("Import App")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium])
    }
}
