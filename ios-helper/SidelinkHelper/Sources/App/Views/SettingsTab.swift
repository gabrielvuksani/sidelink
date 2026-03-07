import SwiftUI
#if canImport(VisionKit)
import VisionKit
#endif

struct SettingsTab: View {
    @ObservedObject var model: HelperViewModel
    @AppStorage("backgroundRefreshEnabled") private var backgroundRefreshEnabled = true
    @AppStorage("backgroundRefreshIntervalMinutes") private var backgroundRefreshIntervalMinutes = 30
    @State private var showPairingSheet = false
    @State private var appleSheetMode: AppleAccountSheetMode?
    @State private var deleteConfirmation: DestructiveConfirmation?
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        NavigationStack {
            ZStack {
                SidelinkBackdrop(accent: .slAccent)
                    .ignoresSafeArea()

                ScrollView {
                    VStack(spacing: 24) {
                        settingsHero
                        helperCard
                        appleAccountsCard
                        managementCard
                        backgroundRefreshCard
                        currentSetupCard
                        aboutCard

                        if let error = model.errorMessage {
                            VStack(alignment: .leading, spacing: 10) {
                                Text("Attention Needed")
                                    .font(.headline)
                                Label(error, systemImage: "exclamationmark.triangle.fill")
                                    .foregroundStyle(Color.slDanger)
                                    .font(.footnote)
                            }
                            .liquidPanel()
                            .padding(.horizontal, 20)
                        }

                        connectionCard
                    }
                    .padding(.vertical, 20)
                }
            }
            .refreshable {
                await model.refreshAll()
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Text("Settings")
                        .font(.headline.weight(.semibold))
                }
            }
            .sheet(isPresented: $showPairingSheet) {
                PairingSheet(model: model)
            }
            .sheet(item: $appleSheetMode) { mode in
                AppleAccountSheet(model: model, mode: mode)
            }
            .alert(
                deleteConfirmation?.title ?? "Confirm",
                isPresented: Binding(
                    get: { deleteConfirmation != nil },
                    set: { if !$0 { deleteConfirmation = nil } }
                )
            ) {
                Button(deleteConfirmation?.buttonLabel ?? "Delete", role: .destructive) {
                    deleteConfirmation?.action()
                    deleteConfirmation = nil
                }
                Button("Cancel", role: .cancel) { deleteConfirmation = nil }
            } message: {
                Text(deleteConfirmation?.message ?? "")
            }
        }
    }

    private var settingsHero: some View {
        VStack(alignment: .leading, spacing: 18) {
            SidelinkSectionIntro(eyebrow: "Settings", title: "Control center", subtitle: "Pairing, Apple ID health, helper diagnostics, and refresh behavior all live in one calmer place.")

            HStack(spacing: 12) {
                SidelinkMetricTile(label: "Accounts", value: "\(model.accounts.count)")
                SidelinkMetricTile(label: "Devices", value: "\(model.devices.count)", tint: .slAccent2)
                SidelinkMetricTile(label: "Status", value: model.isPaired ? "Connected" : "Unpaired", tint: model.isPaired ? .slSuccess : .slWarning)
            }
        }
        .liquidPanel()
        .padding(.horizontal, 20)
    }

    private var helperCard: some View {
        VStack(alignment: .leading, spacing: 16) {
            SidelinkSectionIntro(eyebrow: "Helper", title: model.isPaired ? "Connected helper" : "Pair your helper", subtitle: model.isPaired ? "Your iPhone is linked to \(model.serverName.isEmpty ? "Sidelink" : model.serverName)." : "Use the desktop pairing QR, the 6-digit code, or a discovered server to connect.")

            HStack(spacing: 12) {
                Label(model.sseConnected ? "Live" : (model.isPaired ? "Polling" : "Offline"), systemImage: model.isPaired ? "checkmark.shield.fill" : "iphone.slash")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(model.isPaired ? Color.slSuccess : Color.slWarning)
                if !model.serverVersion.isEmpty {
                    Text("v\(model.serverVersion)")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                }
            }

            Button {
                showPairingSheet = true
            } label: {
                Label(model.isPaired ? "Re-pair Helper" : "Pair Helper", systemImage: "key.horizontal")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.sidelinkQuickAction)

            VStack(alignment: .leading, spacing: 10) {
                Text("Discovered Servers")
                    .font(.headline)
                if model.discoveredBackends.isEmpty {
                    HStack(spacing: 10) {
                        ProgressView()
                            .controlSize(.small)
                        Text("Scanning your local network…")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                } else {
                    ForEach(model.discoveredBackends) { backend in
                        Button {
                            SidelinkHaptics.selection()
                            model.applyDiscoveredBackend(backend)
                            showPairingSheet = true
                        } label: {
                            HStack(spacing: 12) {
                                Image(systemName: "desktopcomputer")
                                    .foregroundStyle(Color.slAccent)
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(backend.name)
                                        .foregroundStyle(.primary)
                                    Text(backend.url)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                Spacer()
                                Image(systemName: "chevron.right")
                                    .font(.caption)
                                    .foregroundStyle(.tertiary)
                            }
                            .padding(14)
                            .background((colorScheme == .dark ? Color.white.opacity(0.06) : Color.white.opacity(0.72)), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
        .liquidPanel()
        .padding(.horizontal, 20)
    }

    private var appleAccountsCard: some View {
        VStack(alignment: .leading, spacing: 16) {
            SidelinkSectionIntro(eyebrow: "Apple IDs", title: "Signing identity", subtitle: model.isPaired ? "Keep your default account visible and surface any verification issues immediately." : "Pair first, then add the Apple IDs you want to use for signing.")

            if model.pendingAppleAuth != nil || !model.accountsNeedingAttention.isEmpty {
                VStack(alignment: .leading, spacing: 10) {
                    Label(
                        model.pendingAppleAuth != nil
                            ? "Verification code needed for \(model.pendingAppleAuth?.appleId ?? "your Apple ID")"
                            : "One or more Apple IDs need attention before they can sign apps reliably.",
                        systemImage: "exclamationmark.shield.fill"
                    )
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.slWarning)

                    Button {
                        if let pending = model.pendingAppleAuth, let accountId = pending.accountId {
                            appleSheetMode = .reauth(accountId: accountId)
                        }
                    } label: {
                        Text("Finish Verification")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.sidelinkQuickAction(tint: .slWarning))
                    .disabled(model.pendingAppleAuth?.accountId == nil)
                }
                .padding(16)
                .background(Color.orange.opacity(0.10), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            }

            if model.accounts.isEmpty {
                Text(model.isPaired ? "Add an Apple ID to sign and refresh apps directly from the helper." : "Pair the helper first, then add an Apple ID here.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            } else {
                if !model.activeAccounts.isEmpty {
                    Picker("Default Signing Account", selection: $model.selectedAccountId) {
                        ForEach(model.activeAccounts) { account in
                            Text(account.appleId).tag(account.id)
                        }
                    }
                    .pickerStyle(.menu)
                }

                ForEach(model.accounts) { account in
                    VStack(alignment: .leading, spacing: 12) {
                        HStack(alignment: .top, spacing: 12) {
                            Image(systemName: account.id == model.selectedAccountId ? "checkmark.circle.fill" : "person.crop.circle")
                                .foregroundStyle(account.id == model.selectedAccountId ? Color.slAccent : .secondary)

                            VStack(alignment: .leading, spacing: 4) {
                                Text(account.appleId)
                                    .font(.subheadline.weight(.semibold))
                                Text("\(account.teamName) · \(account.accountType.capitalized)")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }

                            Spacer()

                            PillBadge(text: appleStatusLabel(for: account), color: appleStatusColor(for: account), small: true)
                        }

                        if let lastAuthAt = account.lastAuthAt, !lastAuthAt.isEmpty {
                            Label("Last verified \(relativeDate(lastAuthAt))", systemImage: "clock.badge.checkmark")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        } else {
                            Label("This Apple ID has not completed verification in Sidelink yet.", systemImage: "clock.badge.exclamationmark")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }

                        HStack(spacing: 10) {
                            Button {
                                appleSheetMode = .reauth(accountId: account.id)
                            } label: {
                                Label(account.status == "active" ? "Re-auth" : "Verify", systemImage: "arrow.clockwise")
                                    .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.sidelinkQuickAction)

                            Button(role: .destructive) {
                                deleteConfirmation = DestructiveConfirmation(
                                    title: "Remove Apple ID",
                                    message: "Remove \(account.appleId)?",
                                    buttonLabel: "Remove"
                                ) {
                                    Task { await model.deleteAppleAccount(account.id) }
                                }
                            } label: {
                                Label("Remove", systemImage: "trash")
                                    .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.sidelinkQuickAction(tint: .slDanger))
                        }
                    }
                    .padding(16)
                    .background((colorScheme == .dark ? Color.white.opacity(0.06) : Color.white.opacity(0.72)), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                }
            }

            Button {
                appleSheetMode = .add
            } label: {
                Label(model.accounts.isEmpty ? "Add Apple ID" : "Add Another Apple ID", systemImage: "person.badge.plus")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.sidelinkQuickAction(tint: .slAccent2))
            .disabled(!model.isPaired)
        }
        .liquidPanel()
        .padding(.horizontal, 20)
    }

    private var managementCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            SidelinkSectionIntro(eyebrow: "Management", title: "Diagnostics and signing details", subtitle: "Jump into logs, App IDs, certificates, and scheduler state from one card.")

            NavigationLink {
                LogsView(model: model)
            } label: {
                settingsLinkRow("Logs", systemImage: "text.alignleft")
            }

            NavigationLink {
                AppIDsView(model: model)
            } label: {
                settingsLinkRow("App IDs", systemImage: "app.badge")
            }

            NavigationLink {
                CertificatesView(model: model)
            } label: {
                settingsLinkRow("Certificates", systemImage: "checkmark.seal")
            }

            if let interval = model.config?.schedulerCheckIntervalMs {
                HStack {
                    Label("Scheduler", systemImage: model.config?.schedulerEnabled == true ? "play.fill" : "pause.fill")
                    Spacer()
                    Text("\(interval / 60_000) min")
                        .foregroundStyle(.secondary)
                }
                .font(.subheadline)
            }
        }
        .liquidPanel()
        .padding(.horizontal, 20)
    }

    private var backgroundRefreshCard: some View {
        VStack(alignment: .leading, spacing: 16) {
            SidelinkSectionIntro(eyebrow: "Automation", title: "Background refresh", subtitle: "Keep refreshes alive without making this screen feel like a utility form.")

            Toggle(isOn: $backgroundRefreshEnabled) {
                Label("Enable Background Refresh", systemImage: "arrow.triangle.2.circlepath")
            }
            .onChange(of: backgroundRefreshEnabled) { enabled in
                if enabled {
                    Task {
                        await BackgroundRefreshCoordinator.shared.requestNotificationAuthorizationIfNeeded()
                        BackgroundRefreshCoordinator.shared.setBackgroundRefreshEnabled(true)
                    }
                } else {
                    BackgroundRefreshCoordinator.shared.setBackgroundRefreshEnabled(false)
                }
            }

            VStack(alignment: .leading, spacing: 8) {
                Text("Interval: \(backgroundRefreshIntervalMinutes) min")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Slider(
                    value: Binding(
                        get: { Double(backgroundRefreshIntervalMinutes) },
                        set: { backgroundRefreshIntervalMinutes = Int($0) }
                    ),
                    in: 15...180,
                    step: 15
                )
                .tint(.slAccent)
            }
            .onChange(of: backgroundRefreshIntervalMinutes) { _ in
                guard backgroundRefreshEnabled else { return }
                BackgroundRefreshCoordinator.shared.scheduleAppRefresh()
            }
        }
        .liquidPanel()
        .padding(.horizontal, 20)
    }

    private var currentSetupCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            SidelinkSectionIntro(eyebrow: "Current Setup", title: "What Sidelink will use", subtitle: "Keep your active signing context visible before you start any install or refresh job.")

            if let selected = model.selectedAccount {
                HStack {
                    Label("Apple ID", systemImage: "person.crop.circle")
                    Spacer()
                    Text(selected.appleId)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }

            if let selected = model.selectedDevice {
                HStack {
                    Label("Device", systemImage: "iphone")
                    Spacer()
                    Text(selected.name)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
        }
        .liquidPanel()
        .padding(.horizontal, 20)
    }

    private var aboutCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            SidelinkSectionIntro(eyebrow: "About", title: "App details", subtitle: "Versioning and platform information, presented without the default settings-list noise.")
            aboutRow("App", "Sidelink")
            aboutRow("Version", Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0.0")
            aboutRow("Build", Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1")
            aboutRow("Platform", UIDevice.current.systemName + " " + UIDevice.current.systemVersion)
        }
        .liquidPanel()
        .padding(.horizontal, 20)
    }

    private var connectionCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            SidelinkSectionIntro(eyebrow: "Connection", title: "Reload or disconnect", subtitle: "Use these only when you actually need to re-sync or intentionally clear the pairing state.")

            Button {
                Task { await model.refreshAll() }
            } label: {
                Label("Reload Data", systemImage: "arrow.clockwise")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.sidelinkQuickAction)
            .disabled(model.isLoading || !model.isPaired)

            Button(role: .destructive) {
                SidelinkHaptics.impact(.light)
                deleteConfirmation = DestructiveConfirmation(
                    title: "Disconnect Helper",
                    message: "Disconnect from the Sidelink server? You will need to pair again.",
                    buttonLabel: "Disconnect"
                ) {
                    model.clearPairing()
                }
            } label: {
                Label("Disconnect Helper", systemImage: "link.badge.plus")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.sidelinkQuickAction(tint: .slDanger))
        }
        .liquidPanel()
        .padding(.horizontal, 20)
    }

    private func aboutRow(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
            Spacer()
            Text(value)
                .font(.caption)
        }
        .padding(.vertical, 2)
    }

    private func settingsLinkRow(_ title: String, systemImage: String) -> some View {
        HStack {
            Label(title, systemImage: systemImage)
            Spacer()
            Image(systemName: "chevron.right")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(14)
        .background((colorScheme == .dark ? Color.white.opacity(0.06) : Color.white.opacity(0.72)), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .contentShape(Rectangle())
    }

    private func appleStatusLabel(for account: AccountDTO) -> String {
        switch account.status {
        case "active": return "Active"
        case "requires_2fa": return "Needs Code"
        case "session_expired": return "Expired"
        default:
            return account.status.replacingOccurrences(of: "_", with: " ").capitalized
        }
    }

    private func appleStatusColor(for account: AccountDTO) -> Color {
        switch account.status {
        case "active": return .slSuccess
        case "requires_2fa": return .slWarning
        case "session_expired": return .slDanger
        default: return .slWarning
        }
    }

    private func relativeDate(_ iso: String) -> String {
        guard let date = SidelinkDateFormatting.parse(iso) else { return iso }
        return date.formatted(.relative(presentation: .named))
    }
}

private enum AppleAccountSheetMode: Identifiable {
    case add
    case reauth(accountId: String)

    var id: String {
        switch self {
        case .add:
            return "add"
        case .reauth(let accountId):
            return "reauth-\(accountId)"
        }
    }
}

struct PairingPayloadActions: View {
    let onScanned: (String) -> Void
    @State private var showScanner = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Instant Pairing")
                .font(.headline)

            pairingActionButton(
                title: "Scan Desktop QR",
                subtitle: "Open the pairing card on the desktop app and scan to fill the helper address and code instantly.",
                systemImage: "qrcode.viewfinder",
                tint: .slAccent,
                disabled: !PairingQRScannerSheet.isSupported
            ) {
                showScanner = true
            }

            if !PairingQRScannerSheet.isSupported {
                Text("QR scanning is unavailable on this device. Use the detected helper or the 6-digit pairing code instead.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .sheet(isPresented: $showScanner) {
            PairingQRScannerSheet { payload in
                showScanner = false
                onScanned(payload)
            }
        }
    }

    private func pairingActionButton(
        title: String,
        subtitle: String,
        systemImage: String,
        tint: Color,
        disabled: Bool = false,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 10) {
                Image(systemName: systemImage)
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(tint)
                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.primary)
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.leading)
            }
            .frame(maxWidth: .infinity, minHeight: 136, alignment: .topLeading)
        }
        .buttonStyle(.sidelinkQuickAction(tint: tint))
        .disabled(disabled)
        .opacity(disabled ? 0.55 : 1)
    }
}

struct PairingQRScannerSheet: View {
    static var isSupported: Bool {
#if canImport(VisionKit)
        if #available(iOS 16.0, *) {
            return DataScannerViewController.isSupported && DataScannerViewController.isAvailable
        }
#endif
        return false
    }

    let onPayload: (String) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                if Self.isSupported {
                    PairingQRScannerRepresentable { payload in
                        onPayload(payload)
                    }
                } else {
                    VStack(spacing: 12) {
                        Image(systemName: "qrcode.viewfinder")
                            .font(.system(size: 36))
                            .foregroundStyle(.secondary)
                        Text("Scanner Unavailable")
                            .font(.headline)
                        Text("Use the detected helper or the 6-digit pairing code on this device.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .padding(24)
                }
            }
            .navigationTitle("Scan Pairing QR")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}

#if canImport(VisionKit)
@available(iOS 16.0, *)
private struct PairingQRScannerRepresentable: UIViewControllerRepresentable {
    typealias UIViewControllerType = DataScannerViewController

    let onPayload: (String) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onPayload: onPayload)
    }

    func makeUIViewController(context: Context) -> DataScannerViewController {
        let controller = DataScannerViewController(
            recognizedDataTypes: [.barcode(symbologies: [.qr])],
            qualityLevel: .balanced,
            recognizesMultipleItems: false,
            isHighFrameRateTrackingEnabled: false,
            isHighlightingEnabled: true
        )
        controller.delegate = context.coordinator
        try? controller.startScanning()
        return controller
    }

    func updateUIViewController(_ uiViewController: DataScannerViewController, context: Context) {}

    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        private let onPayload: (String) -> Void
        private var hasScannedPayload = false

        init(onPayload: @escaping (String) -> Void) {
            self.onPayload = onPayload
        }

        func dataScanner(_ dataScanner: DataScannerViewController, didTapOn item: RecognizedItem) {
            handle(item)
        }

        func dataScanner(_ dataScanner: DataScannerViewController, didAdd addedItems: [RecognizedItem], allItems: [RecognizedItem]) {
            guard let firstItem = addedItems.first else {
                return
            }
            handle(firstItem)
        }

        private func handle(_ item: RecognizedItem) {
            guard !hasScannedPayload else {
                return
            }
            guard case .barcode(let barcode) = item,
                  let payload = barcode.payloadStringValue,
                  !payload.isEmpty
            else {
                return
            }

            hasScannedPayload = true
            onPayload(payload)
        }
    }
}
#endif

private struct PairingSheet: View {
    @ObservedObject var model: HelperViewModel
    @Environment(\.dismiss) private var dismiss
    @State private var pairingFocusTrigger = 0
    @State private var localError: String?
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        NavigationStack {
            ZStack {
                SidelinkBackdrop(accent: .slAccent)
                    .ignoresSafeArea()

                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        VStack(alignment: .leading, spacing: 16) {
                            SidelinkSectionIntro(
                                eyebrow: "Pair Helper",
                                title: model.isPaired ? "Repair your connection" : "Connect in one pass",
                                subtitle: "Scan the desktop QR first, or choose the helper manually with its address and 6-digit code."
                            )

                            HStack(spacing: 12) {
                                SidelinkMetricTile(label: "Connection", value: model.isPaired ? "Paired" : "Waiting", tint: model.isPaired ? .slSuccess : .slWarning)
                                SidelinkMetricTile(label: "Discovery", value: model.discoveredBackends.isEmpty ? "Scanning" : "\(model.discoveredBackends.count) found", tint: .slAccent2)
                            }
                        }
                        .liquidPanel()

                        PairingPayloadActions(
                            onScanned: { payload in
                                Task {
                                    localError = nil
                                    let didPair = await model.pairUsingPayload(payload)
                                    if didPair {
                                        dismiss()
                                    } else {
                                        localError = model.errorMessage
                                    }
                                }
                            }
                        )
                        .liquidPanel()

                        VStack(alignment: .leading, spacing: 14) {
                            SidelinkSectionIntro(
                                eyebrow: "Manual Pairing",
                                title: "Direct desktop address",
                                subtitle: "Use this when you want explicit control over the backend URL and the 6-digit code from the desktop app."
                            )

                            TextField("Backend URL", text: $model.backendURL)
                                .autocorrectionDisabled()
                                .textInputAutocapitalization(.never)
                                .sidelinkField()

                            if !model.discoveredBackends.isEmpty {
                                VStack(alignment: .leading, spacing: 10) {
                                    Text("Discovered Servers")
                                        .font(.caption.weight(.semibold))
                                        .foregroundStyle(.secondary)

                                    ForEach(model.discoveredBackends) { backend in
                                        Button {
                                            model.applyDiscoveredBackend(backend)
                                            pairingFocusTrigger += 1
                                        } label: {
                                            HStack(spacing: 14) {
                                                Image(systemName: "desktopcomputer")
                                                    .font(.headline)
                                                    .foregroundStyle(Color.slAccent)
                                                VStack(alignment: .leading, spacing: 4) {
                                                    Text(backend.name)
                                                        .font(.subheadline.weight(.semibold))
                                                        .foregroundStyle(.primary)
                                                    Text(backend.url)
                                                        .font(.caption)
                                                        .foregroundStyle(.secondary)
                                                        .lineLimit(1)
                                                }
                                                Spacer()
                                                Image(systemName: model.backendURL == backend.url ? "checkmark.circle.fill" : "arrow.up.left.and.arrow.down.right")
                                                    .foregroundStyle(model.backendURL == backend.url ? Color.slSuccess : Color.secondary.opacity(0.6))
                                            }
                                        }
                                        .buttonStyle(.plain)
                                        .sidelinkInsetPanel()
                                    }
                                }
                            }

                            PairingCodeEntryView(code: $model.pairingCode, onSubmit: {
                                Task {
                                    localError = nil
                                    await model.pair()
                                    if model.isPaired {
                                        dismiss()
                                    } else {
                                        localError = model.errorMessage
                                    }
                                }
                            }, isLoading: model.isLoading, autoFocus: false, focusTrigger: pairingFocusTrigger, showsHeader: false, buttonTitle: "Pair helper")
                        }
                        .liquidPanel()

                        if let error = localError {
                            Label(error, systemImage: "exclamationmark.triangle.fill")
                                .font(.footnote.weight(.semibold))
                                .foregroundStyle(Color.slDanger)
                                .padding(16)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background((colorScheme == .dark ? Color.red.opacity(0.16) : Color.red.opacity(0.10)), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.vertical, 18)
                }
            }
            .navigationTitle("Pair Helper")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}

private struct AppleAccountSheet: View {
    @ObservedObject var model: HelperViewModel
    let mode: AppleAccountSheetMode
    @Environment(\.dismiss) private var dismiss
    @State private var appleId = ""
    @State private var password = ""
    @State private var twoFACode = ""
    @State private var startedReauth = false

    var body: some View {
        NavigationStack {
            Form {
                if let pending = pendingContext {
                    Section("Two-Factor Authentication") {
                        Text("Finish verifying \(pending.appleId) to use it for signing in Sidelink.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)

                        TextField("123456", text: $twoFACode)
                            .keyboardType(.numberPad)
                            .textInputAutocapitalization(.never)

                        if let authType = pending.authType, !authType.isEmpty {
                            Text("Verification method: \(authType)")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }

                        Button {
                            Task {
                                await model.submitPendingAppleAccount2FA(code: twoFACode)
                                if model.pendingAppleAuth == nil {
                                    dismiss()
                                }
                            }
                        } label: {
                            Label("Verify Apple ID", systemImage: "checkmark.shield")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(twoFACode.trimmingCharacters(in: .whitespacesAndNewlines).count != 6 || model.isLoading)
                    }
                } else if case .reauth(let accountId) = mode {
                    Section("Re-authenticate Apple ID") {
                        if let account = model.accounts.first(where: { $0.id == accountId }) {
                            Text(account.appleId)
                                .font(.headline)
                            if let lastAuthAt = account.lastAuthAt, !lastAuthAt.isEmpty {
                                Text("Last verified \(relativeDate(lastAuthAt)). Re-authentication refreshes the Apple session before new installs or refreshes.")
                                    .font(.footnote)
                                    .foregroundStyle(.secondary)
                            }
                        }

                        if model.isLoading {
                            HStack(spacing: 12) {
                                ProgressView()
                                Text("Checking whether Apple needs a verification code…")
                                    .foregroundStyle(.secondary)
                            }
                        } else {
                            Button {
                                Task { await beginReauth(accountId: accountId, forceRestart: true) }
                            } label: {
                                Label("Request Verification Code", systemImage: "arrow.clockwise")
                                    .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.borderedProminent)
                        }
                    }
                } else {
                    Section("Apple ID Sign In") {
                        TextField("name@example.com", text: $appleId)
                            .textInputAutocapitalization(.never)
                            .keyboardType(.emailAddress)
                            .autocorrectionDisabled()

                        SecureField("Password", text: $password)

                        Text("Your Apple ID is used by the paired Sidelink server to sign apps for this device.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)

                        Button {
                            Task {
                                await model.signInAppleAccount(appleId: appleId, password: password)
                                if model.pendingAppleAuth == nil, model.errorMessage == nil {
                                    dismiss()
                                }
                            }
                        } label: {
                            Label("Sign In", systemImage: "person.badge.key")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(appleId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || password.isEmpty || model.isLoading)
                    }
                }

                if let error = model.errorMessage {
                    Section {
                        Label(error, systemImage: "exclamationmark.triangle")
                            .foregroundStyle(Color.slDanger)
                            .font(.footnote)
                    }
                }
            }
            .navigationTitle(navigationTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .task {
            if case .reauth(let accountId) = mode {
                await beginReauth(accountId: accountId, forceRestart: false)
            }
        }
    }

    private var pendingContext: PendingAppleAuthContext? {
        guard let pending = model.pendingAppleAuth else { return nil }
        switch mode {
        case .add:
            return pending.mode == .signIn ? pending : nil
        case .reauth(let accountId):
            return pending.mode == .reauth && pending.accountId == accountId ? pending : nil
        }
    }

    private var navigationTitle: String {
        switch mode {
        case .add:
            return pendingContext == nil ? "Add Apple ID" : "Verify Apple ID"
        case .reauth:
            return pendingContext == nil ? "Re-authenticate" : "Enter Verification Code"
        }
    }

    private func beginReauth(accountId: String, forceRestart: Bool) async {
        guard forceRestart || !startedReauth else { return }
        startedReauth = true
        await model.reauthenticateAppleAccount(accountId: accountId)
        if model.pendingAppleAuth == nil, model.errorMessage == nil {
            dismiss()
        }
    }

    private func relativeDate(_ iso: String) -> String {
        guard let date = SidelinkDateFormatting.parse(iso) else { return iso }
        return date.formatted(.relative(presentation: .named))
    }
}
