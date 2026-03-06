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
    @Binding var completed: Bool

    @State private var step: Step = .welcome
    @State private var pairingFocusTrigger = 0
    @State private var notificationsRequested = false
    @AppStorage("backgroundRefreshEnabled") private var backgroundRefreshEnabled = true

    var body: some View {
        NavigationStack {
            ZStack {
                onboardingBackground
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
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                HStack(spacing: 14) {
                    SidelinkBrandIcon(size: 54)

                    VStack(alignment: .leading, spacing: 4) {
                        Text("SideLink")
                            .font(.system(size: 32, weight: .bold, design: .rounded))
                        Text("iPhone companion")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(Color.slAccent)
                    }
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text("A calmer setup for sideloading from your iPhone.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
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
                            .frame(height: 6)
                        Text(item.title)
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(item == step ? .primary : .secondary)
                    }
                }
            }
        }
        .padding(.horizontal, 24)
        .padding(.top, 20)
        .padding(.bottom, 10)
    }

    private var footer: some View {
        VStack(spacing: 12) {
            if let error = model.errorMessage, step == .pairing {
                Label(error, systemImage: "exclamationmark.triangle")
                    .font(.footnote)
                    .foregroundStyle(Color.slDanger)
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
        .padding(.top, 10)
        .padding(.bottom, 20)
        .background(.ultraThinMaterial)
    }

    private var welcomeStep: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                ZStack {
                    RoundedRectangle(cornerRadius: 36, style: .continuous)
                        .fill(
                            LinearGradient(
                                colors: [Color.slAccent, Color.slAccent2, Color(red: 0.04, green: 0.17, blue: 0.25)],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                        .frame(height: 300)

                    VStack(alignment: .leading, spacing: 18) {
                        SidelinkBrandIcon(size: 64)
                        Text("Install, refresh, and manage apps without leaving your phone.")
                            .font(.system(size: 32, weight: .bold, design: .rounded))
                            .foregroundStyle(.white)
                        Text("SideLink turns your iPhone into a polished control center for the desktop helper you already trust.")
                            .font(.subheadline)
                            .foregroundStyle(.white.opacity(0.82))
                    }
                    .padding(28)
                }

                VStack(spacing: 12) {
                    onboardingFeatureRow(icon: "sparkles", title: "Beautiful discovery", message: "A real home feed, separate search, and source-powered app discovery.")
                    onboardingFeatureRow(icon: "arrow.triangle.2.circlepath", title: "Reliable refresh", message: "Track installed apps, expiry, and background refresh status from one place.")
                    onboardingFeatureRow(icon: "checkmark.shield", title: "Safer account handling", message: "Apple ID verification and re-authentication stay visible instead of being buried.")
                }
            }
            .padding(.horizontal, 24)
            .padding(.top, 8)
        }
    }

    private var permissionsStep: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                permissionsIntroCard

                permissionCard(
                    title: "Notifications",
                    icon: "bell.badge",
                    description: "Let SideLink tell you when background refresh succeeds or fails.",
                    actionTitle: notificationsRequested ? "Requested" : "Enable Notifications",
                    tint: .slAccent
                ) {
                    Task {
                        notificationsRequested = true
                        await BackgroundRefreshCoordinator.shared.requestNotificationAuthorizationIfNeeded()
                        backgroundRefreshEnabled = true
                        BackgroundRefreshCoordinator.shared.setBackgroundRefreshEnabled(true)
                    }
                }

                permissionCard(
                    title: "Camera",
                    icon: "camera.viewfinder",
                    description: "Used only when you scan the desktop pairing QR code. iOS will ask the first time you open the scanner.",
                    actionTitle: "Ask When Scanning",
                    tint: .slAccent2,
                    action: nil
                )

                permissionCard(
                    title: "Local Network",
                    icon: "dot.radiowaves.left.and.right",
                    description: "Needed to discover your desktop helper on the same network. iOS prompts when SideLink first connects or scans.",
                    actionTitle: "Triggered During Pairing",
                    tint: .slSuccess,
                    action: nil
                )

                permissionCard(
                    title: "Background Refresh",
                    icon: "clock.arrow.circlepath",
                    description: "Keep refreshes running in the background so expiring apps can be renewed automatically.",
                    actionTitle: "Open Settings",
                    tint: .slWarning
                ) {
#if canImport(UIKit)
                    guard let settingsURL = URL(string: UIApplication.openSettingsURLString) else { return }
                    UIApplication.shared.open(settingsURL)
#endif
                }
            }
            .padding(.horizontal, 24)
            .padding(.top, 8)
        }
    }

    private var permissionsIntroCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Only the permissions SideLink actually uses.")
                .font(.system(size: 26, weight: .bold, design: .rounded))
            Text("We request notification access directly here. Camera and local network prompts appear only when you use the pairing tools that need them.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .padding(22)
        .background(Color.white.opacity(0.95), in: RoundedRectangle(cornerRadius: 28, style: .continuous))
    }

    private var pairingStep: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Pair with your desktop helper")
                        .font(.system(size: 28, weight: .bold, design: .rounded))
                    Text("Choose a discovered server, scan the QR payload, or paste the payload directly from the desktop app.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .padding(.horizontal, 24)

                VStack(alignment: .leading, spacing: 12) {
                    Text("Discovered Servers")
                        .font(.headline)

                    if model.discoveredBackends.isEmpty {
                        HStack(spacing: 12) {
                            ProgressView()
                            Text("Scanning your local network…")
                                .foregroundStyle(.secondary)
                        }
                        .padding(18)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.white.opacity(0.95), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
                    } else {
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
                                    }
                                    Spacer()
                                    Image(systemName: "arrow.up.left.and.arrow.down.right")
                                        .foregroundStyle(.secondary)
                                }
                                .padding(16)
                                .background(Color.white.opacity(0.95), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                .padding(.horizontal, 24)

                VStack(alignment: .leading, spacing: 14) {
                    Text("Fast Pair")
                        .font(.headline)

                    PairingPayloadActions(
                        onScanned: { payload in
                            Task {
                                let didPair = await model.pairUsingPayload(payload)
                                if didPair {
                                    step = .finish
                                }
                            }
                        },
                        onPasted: { payload in
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
                .background(Color.white.opacity(0.95), in: RoundedRectangle(cornerRadius: 28, style: .continuous))
                .padding(.horizontal, 24)

                VStack(alignment: .leading, spacing: 12) {
                    Text("Manual Pairing")
                        .font(.headline)

                    TextField("http://your-computer-ip:4010", text: $model.backendURL)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                        .textFieldStyle(.roundedBorder)

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
                        focusTrigger: pairingFocusTrigger
                    )
                }
                .padding(22)
                .background(Color.white.opacity(0.95), in: RoundedRectangle(cornerRadius: 28, style: .continuous))
                .padding(.horizontal, 24)
            }
            .padding(.top, 8)
        }
    }

    private var finishStep: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 12) {
                    Text(model.isPaired ? "You’re connected." : "You’re ready to explore.")
                        .font(.system(size: 30, weight: .bold, design: .rounded))
                    Text(model.isPaired
                         ? "Home, Search, Sources, and Installed are set up to feel like a real iPhone control center for sideloading."
                         : "You can start exploring now, then return to Settings any time to pair and add signing accounts.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
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
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: icon)
                .font(.title3)
                .foregroundStyle(Color.slAccent)
                .frame(width: 36)
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.headline)
                Text(message)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            Spacer()
        }
        .padding(18)
        .background(Color.white.opacity(0.95), in: RoundedRectangle(cornerRadius: 24, style: .continuous))
    }

    private func permissionCard(
        title: String,
        icon: String,
        description: String,
        actionTitle: String,
        tint: Color,
        action: (() -> Void)?
    ) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                Image(systemName: icon)
                    .font(.title3)
                    .foregroundStyle(tint)
                Text(title)
                    .font(.headline)
            }

            Text(description)
                .font(.subheadline)
                .foregroundStyle(.secondary)

            if let action {
                Button(actionTitle, action: action)
                    .buttonStyle(.borderedProminent)
                    .tint(tint)
            } else {
                Text(actionTitle)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(tint)
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.white.opacity(0.95), in: RoundedRectangle(cornerRadius: 24, style: .continuous))
    }
}
