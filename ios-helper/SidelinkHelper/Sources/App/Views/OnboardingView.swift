import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

struct OnboardingView: View {
    enum Step: Int, CaseIterable {
        case welcome
        case permissions
        case pairing
        case finish

        var title: String {
            switch self {
            case .welcome: return "Welcome"
            case .permissions: return "Permissions"
            case .pairing: return "Pair"
            case .finish: return "Start"
            }
        }
    }

    @ObservedObject var model: HelperViewModel
    @ObservedObject var permissions: PermissionCoordinator
    @Binding var completed: Bool

    @State private var step: Step = .welcome
    @State private var pairingFocusTrigger = 0
    @State private var showPairingTroubleshooting = false
    @AppStorage("backgroundRefreshEnabled") private var backgroundRefreshEnabled = true
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        NavigationStack {
            ZStack {
                SidelinkBackdrop(accent: .slAccent)
                    .ignoresSafeArea()

                VStack(spacing: 0) {
                    header

                    TabView(selection: $step) {
                        welcomeStep.tag(Step.welcome)
                        permissionsStep.tag(Step.permissions)
                        pairingStep.tag(Step.pairing)
                        finishStep.tag(Step.finish)
                    }
                    .tabViewStyle(.page(indexDisplayMode: .never))

                    footer
                }
            }
        }
        .interactiveDismissDisabled()
        .task {
            await permissions.requestAllIfNeeded()
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                HStack(spacing: 14) {
                    SidelinkBrandIcon(size: 44)

                    VStack(alignment: .leading, spacing: 4) {
                        Text("SideLink")
                            .font(.system(size: 26, weight: .bold, design: .rounded))
                        Text("iPhone companion")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(Color.slAccent)
                    }
                }
                Spacer()
                if step != .finish {
                    Button("Skip") {
                        completed = true
                    }
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.secondary)
                }
            }

            HStack(spacing: 10) {
                ForEach(Step.allCases, id: \.rawValue) { item in
                    VStack(alignment: .leading, spacing: 6) {
                        Capsule()
                            .fill(item.rawValue <= step.rawValue ? Color.slAccent : Color.secondary.opacity(0.18))
                            .frame(height: 5)
                        HStack(spacing: 4) {
                            Text("\(item.rawValue + 1)")
                                .font(.caption2.weight(.heavy).monospacedDigit())
                                .foregroundStyle(item == step ? Color.slAccent : .secondary)
                            Text(item.title)
                                .font(.caption2.weight(.semibold))
                                .foregroundStyle(item == step ? .primary : .secondary)
                        }
                    }
                }
            }

            Text("Step \(step.rawValue + 1) of \(Step.allCases.count)")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 24)
        .padding(.top, 14)
        .padding(.bottom, 8)
    }

    private var footer: some View {
        VStack(spacing: 12) {
            if let error = model.errorMessage, step == .pairing {
                VStack(alignment: .leading, spacing: 8) {
                    Label(error, systemImage: "exclamationmark.triangle")
                        .font(.footnote)
                        .foregroundStyle(Color.slDanger)

                    if showPairingTroubleshooting {
                        VStack(alignment: .leading, spacing: 6) {
                            pairingTip(icon: "wifi", text: "Make sure your iPhone and desktop are on the same Wi-Fi network")
                            pairingTip(icon: "desktopcomputer", text: "Confirm the SideLink desktop app is running and shows the pairing code")
                            pairingTip(icon: "number", text: "Double-check the 6-digit code matches the one shown on your desktop")
                            pairingTip(icon: "globe", text: "Try entering the backend URL manually if auto-discovery is not finding your desktop")
                            pairingTip(icon: "arrow.clockwise", text: "Restart the desktop app and try a fresh pairing code")
                        }
                        .padding(12)
                        .background(Color.slDanger.opacity(0.06), in: RoundedRectangle(cornerRadius: 12))
                    } else {
                        Button("Show troubleshooting tips") {
                            withAnimation { showPairingTroubleshooting = true }
                        }
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Color.slDanger)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 24)
            }

            Button {
                advance()
            } label: {
                Text(primaryButtonTitle)
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 6)
            }
            .buttonStyle(.borderedProminent)
            .tint(.slAccent)
            .padding(.horizontal, 24)

            if step == .pairing && !model.isPaired {
                Button("Continue without pairing") {
                    step = .finish
                }
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.secondary)
            }
        }
            .padding(.top, 8)
            .padding(.bottom, 16)
        .background(colorScheme == .dark ? Color.black.opacity(0.82) : Color.white.opacity(0.72))
    }

    private var welcomeStep: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 14) {
                    SidelinkSectionIntro(eyebrow: "Welcome", title: "Sideloading should feel deliberate", subtitle: "SideLink turns your iPhone into a premium control center for the desktop helper you already trust.")

                    HStack(spacing: 12) {
                        SidelinkMetricTile(label: "Home", value: "Curated")
                        SidelinkMetricTile(label: "Sources", value: "Pinned", tint: .slAccent2)
                    }
                }
                .liquidPanel()

                VStack(spacing: 12) {
                    onboardingFeatureRow(icon: "sparkles", title: "Beautiful discovery", message: "A real home feed, separate search, and source-powered app discovery.")
                    onboardingFeatureRow(icon: "arrow.triangle.2.circlepath", title: "Reliable refresh", message: "Track installed apps, expiry, and background refresh status from one place.")
                    onboardingFeatureRow(icon: "checkmark.shield", title: "One signing identity", message: "SideLink keeps one primary Apple ID in charge by default so installs stay predictable.")
                }
            }
            .padding(.horizontal, 24)
            .padding(.top, 8)
            .padding(.bottom, 24)
        }
    }

    private var permissionsStep: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                permissionsIntroCard
                permissionSummaryStrip

                permissionCard(
                    title: "Notifications",
                    icon: "bell.badge",
                    description: "Let SideLink tell you when background refresh succeeds or fails.",
                    state: permissions.notifications,
                    tint: .slAccent
                ) {
                    Task {
                        await permissions.requestNotificationsIfNeeded()
                        backgroundRefreshEnabled = true
                        BackgroundRefreshCoordinator.shared.setBackgroundRefreshEnabled(true)
                        await permissions.refreshStatuses()
                    }
                }

                permissionCard(
                    title: "Camera",
                    icon: "camera.viewfinder",
                    description: "Used when you choose the optional QR scanner. Prime it now so the pairing sheet stays uninterrupted.",
                    state: permissions.camera,
                    tint: .slAccent2
                ) {
                    Task {
                        await permissions.requestCameraIfNeeded()
                    }
                }

                permissionCard(
                    title: "Local Network",
                    icon: "dot.radiowaves.left.and.right",
                    description: "Needed to discover your desktop helper automatically and keep nearby desktops visible for manual code entry.",
                    state: permissions.localNetwork,
                    tint: .slSuccess
                ) {
                    permissions.requestLocalNetworkIfNeeded(force: true)
                }

                permissionCard(
                    title: "Background Refresh",
                    icon: "clock.arrow.circlepath",
                    description: "Keep refreshes running in the background so expiring apps can be renewed automatically.",
                    state: permissions.backgroundRefresh,
                    tint: .slWarning
                ) {
                    permissions.openSystemSettings()
                }
            }
            .padding(.horizontal, 24)
            .padding(.top, 8)
            .padding(.bottom, 24)
        }
    }

    private var permissionsIntroCard: some View {
        SidelinkSectionIntro(eyebrow: "Permissions", title: "Prime the essentials up front", subtitle: "Request the permissions SideLink actually uses before pairing so discovery, notifications, and the optional QR scanner do not interrupt the flow later.")
            .liquidPanel()
    }

    private var permissionSummaryStrip: some View {
        VStack(spacing: 12) {
            HStack(spacing: 12) {
                permissionSummaryTile(title: "Notify", state: permissions.notifications)
                permissionSummaryTile(title: "Camera", state: permissions.camera)
            }
            permissionSummaryTile(title: "Network", state: permissions.localNetwork)
        }
    }

    private var pairingStep: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                SidelinkSectionIntro(
                    eyebrow: "Pairing",
                    title: "Pair with your desktop helper",
                    subtitle: "Start with the 6-digit code. Use QR only when the camera handoff is more convenient."
                )
                .liquidPanel()
                .padding(.horizontal, 24)

                VStack(alignment: .leading, spacing: 14) {
                    SidelinkSectionIntro(
                        eyebrow: "Recommended",
                        title: "Choose your desktop and enter its code",
                        subtitle: "Manual code entry is the primary route now. It is faster when your desktop is already visible and keeps the backend address explicit."
                    )

                    HStack(spacing: 12) {
                        SidelinkStatusTile(
                            label: "Discovery",
                            value: model.discoveredBackends.isEmpty ? "Scanning" : "\(model.discoveredBackends.count) nearby",
                            detail: model.discoveredBackends.isEmpty ? "Searching the local network" : "Tap one to fill the desktop URL",
                            tint: .slAccent2
                        )
                        SidelinkStatusTile(
                            label: "Route",
                            value: "Code First",
                            detail: "QR stays optional below",
                            tint: .slAccent
                        )
                    }

                    if model.discoveredBackends.isEmpty {
                        HStack(spacing: 12) {
                            ProgressView()
                            Text("Scanning for nearby desktop helpers…")
                                .foregroundStyle(.secondary)
                        }
                        .padding(18)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .sidelinkInsetPanel()
                    } else {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("Detected nearby")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.secondary)

                            ForEach(model.discoveredBackends) { backend in
                                Button {
                                    model.applyDiscoveredBackend(backend)
                                    pairingFocusTrigger += 1
                                } label: {
                                    HStack(spacing: 12) {
                                        Image(systemName: "desktopcomputer")
                                            .foregroundStyle(Color.slAccent)
                                        VStack(alignment: .leading, spacing: 3) {
                                            Text(backend.name)
                                                .font(.subheadline.bold())
                                            Text(backend.url)
                                                .font(.caption)
                                                .foregroundStyle(.secondary)
                                                .lineLimit(1)
                                        }
                                        Spacer()
                                        Image(systemName: model.backendURL == backend.url ? "checkmark.circle.fill" : "arrow.up.left.and.arrow.down.right")
                                            .foregroundStyle(model.backendURL == backend.url ? Color.slSuccess : Color.secondary)
                                    }
                                    .padding(16)
                                    .sidelinkInsetPanel()
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }

                    TextField("http://your-computer-ip:4010", text: $model.backendURL)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                        .sidelinkField()

                    PairingCodeEntryView(
                        code: $model.pairingCode,
                        onSubmit: {
                            Task {
                                await model.pair()
                                if model.isPaired {
                                    step = .finish
                                }
                            }
                        },
                        isLoading: model.isLoading,
                        autoFocus: false,
                        focusTrigger: pairingFocusTrigger,
                        showsHeader: false,
                        buttonTitle: "Pair helper"
                    )
                }
                .padding(22)
                .liquidPanel()
                .padding(.horizontal, 24)

                VStack(alignment: .leading, spacing: 14) {
                    SidelinkSectionIntro(
                        eyebrow: "Optional",
                        title: "Use the desktop QR when you want camera handoff",
                        subtitle: "QR fills the helper address and code instantly, but it is now a secondary shortcut rather than the default path."
                    )

                    PairingPayloadActions(
                        title: "Scan desktop QR",
                        subtitle: "Open this only when scanning is quicker than entering the short code already shown on the desktop.",
                        onScanned: { payload in
                            Task {
                                let didPair = await model.pairUsingPayload(payload)
                                if didPair {
                                    step = .finish
                                }
                            }
                        }
                    )
                }
                .padding(22)
                .liquidPanel()
                .padding(.horizontal, 24)
            }
            .padding(.top, 8)
            .padding(.bottom, 24)
        }
    }

    private var finishStep: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                SidelinkSectionIntro(
                    eyebrow: model.isPaired ? "Connected" : "All Set",
                    title: model.isPaired ? "You're connected." : "You're ready to explore.",
                    subtitle: model.isPaired
                        ? "Home, Search, Sources, and Installed now keep your primary signing identity and target device visible while you work."
                        : "You can start exploring now, then return to Settings any time to pair and add signing accounts."
                )
                .liquidPanel()
                .padding(.horizontal, 24)

                VStack(spacing: 12) {
                    onboardingFeatureRow(icon: "sparkles", title: "Home", message: "A featured storefront built from your source feeds and uploaded apps.")
                    onboardingFeatureRow(icon: "magnifyingglass", title: "Search", message: "Dedicated search across both library IPAs and source apps.")
                    onboardingFeatureRow(icon: "checkmark.shield", title: "Installed", message: "Import, sign, refresh, and manage the apps already on your device.")
                    onboardingFeatureRow(icon: "square.stack.3d.up", title: "Sources", message: "Manage trusted feeds and browse AltStore-compatible app catalogs.")
                }
                .padding(.horizontal, 24)
            }
            .padding(.top, 16)
            .padding(.bottom, 24)
        }
    }

    private var primaryButtonTitle: String {
        switch step {
        case .welcome:
            return "Continue"
        case .permissions:
            return "Continue to Pairing"
        case .pairing:
            return model.isPaired ? "Continue" : "Skip Pairing For Now"
        case .finish:
            return "Enter SideLink"
        }
    }

    private func advance() {
        switch step {
        case .welcome:
            step = .permissions
        case .permissions:
            step = .pairing
        case .pairing:
            step = .finish
        case .finish:
            completed = true
        }
    }

    private var onboardingBackground: some View {
        LinearGradient(
            colors: [Color(red: 0.94, green: 0.97, blue: 1.0), Color.white, Color(red: 0.97, green: 0.99, blue: 0.98)],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
        .overlay(alignment: .topTrailing) {
            Circle()
                .fill(Color.slAccent.opacity(0.09))
                .frame(width: 260, height: 260)
                .blur(radius: 16)
                .offset(x: 80, y: -60)
        }
        .overlay(alignment: .bottomLeading) {
            RoundedRectangle(cornerRadius: 120, style: .continuous)
                .fill(Color.slAccent2.opacity(0.08))
                .frame(width: 220, height: 220)
                .rotationEffect(.degrees(30))
                .offset(x: -80, y: 80)
        }
    }

    private func onboardingFeatureRow(icon: String, title: String, message: String) -> some View {
        SidelinkFeatureCard(icon: icon, title: title, message: message)
    }

    private func permissionCard(
        title: String,
        icon: String,
        description: String,
        state: SidelinkPermissionState,
        tint: Color,
        action: (() -> Void)?
    ) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                Image(systemName: icon)
                    .font(.title3)
                    .foregroundStyle(tint)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.headline)
                    Text(state.statusLabel)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(state.tint)
                }
                Spacer()
                if state.isGranted {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(Color.slSuccess)
                }
            }

            Text(description)
                .font(.subheadline)
                .foregroundStyle(.secondary)

            if let action {
                Button(state.actionLabel) {
                    if state == .denied || state == .disabled {
                        permissions.openSystemSettings()
                    } else {
                        action()
                    }
                }
                    .buttonStyle(.borderedProminent)
                    .tint(state.isGranted ? .slSuccess : tint)
                    .disabled(state == .unavailable)
            } else {
                Text(state.actionLabel)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(state.tint)
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background((colorScheme == .dark ? Color.white.opacity(0.07) : Color.white.opacity(0.95)), in: RoundedRectangle(cornerRadius: 24, style: .continuous))
    }

    private func pairingTip(icon: String, text: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: icon)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(Color.slDanger)
                .frame(width: 18, height: 18)
            Text(text)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private func permissionSummaryTile(title: String, state: SidelinkPermissionState) -> some View {
        SidelinkStatusTile(label: title, value: state.statusLabel, detail: state.isGranted ? "Ready for use" : nil, tint: state.tint)
    }
}
