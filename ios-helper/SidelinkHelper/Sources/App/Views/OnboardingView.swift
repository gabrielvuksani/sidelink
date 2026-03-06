import SwiftUI

struct OnboardingView: View {
    @ObservedObject var model: HelperViewModel
    @Binding var completed: Bool
    @State private var showTour = false
    @State private var tourPage = 0

    // Animation states
    @State private var logoScale: CGFloat = 0.3
    @State private var logoOpacity: Double = 0
    @State private var radarRing1: CGFloat = 0.4
    @State private var radarRing2: CGFloat = 0.3
    @State private var radarRing3: CGFloat = 0.2
    @State private var radarOpacity1: Double = 0.8
    @State private var radarOpacity2: Double = 0.6
    @State private var radarOpacity3: Double = 0.4
    @State private var showConfetti = false

    var body: some View {
        NavigationStack {
            if showTour {
                featureTourView
            } else {
                pairingView
            }
        }
        .onAppear {
            withAnimation(.spring(response: 0.8, dampingFraction: 0.6)) {
                logoScale = 1.0
                logoOpacity = 1.0
            }
            startRadarPulse()
        }
    }

    // MARK: - Pairing View
    private var pairingView: some View {
        ScrollView {
            VStack(spacing: 28) {
                // Logo animation
                VStack(spacing: 16) {
                    ZStack {
                        // Radar pulse rings
                        radarRingView(scale: radarRing1, opacity: radarOpacity1)
                        radarRingView(scale: radarRing2, opacity: radarOpacity2)
                        radarRingView(scale: radarRing3, opacity: radarOpacity3)

                        // Main logo
                        Image(systemName: "link.circle.fill")
                            .font(.system(size: 72))
                            .foregroundStyle(Color.slAccent)
                            .scaleEffect(logoScale)
                            .opacity(logoOpacity)
                    }
                    .frame(height: 160)

                    Text("Welcome to Sidelink")
                        .font(.title.bold())
                        .opacity(logoOpacity)
                    Text("Pair once with your desktop, then browse, install, and refresh apps directly from your iPhone.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 30)
                        .opacity(logoOpacity)
                }
                .padding(.top, 20)

                // MARK: - Auto-discovered servers
                VStack(alignment: .leading, spacing: 12) {
                    Text("Discovered servers")
                        .sectionHeader()

                    if model.discoveredBackends.isEmpty {
                        HStack(spacing: 12) {
                            ProgressView()
                            Text("Scanning local network...")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                    } else {
                        ForEach(model.discoveredBackends) { backend in
                            Button {
                                SidelinkHaptics.impact()
                                model.applyDiscoveredBackend(backend)
                                Task {
                                    if model.isPaired { showTour = true }
                                }
                            } label: {
                                HStack(spacing: 12) {
                                    Image(systemName: "desktopcomputer")
                                        .font(.title3)
                                        .foregroundStyle(Color.slAccent)
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(backend.name).font(.subheadline.bold())
                                        Text(backend.url)
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    Image(systemName: "chevron.right")
                                        .foregroundStyle(.secondary.opacity(0.5))
                                }
                                .sidelinkCard()
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                .padding(.horizontal)

                // MARK: - Pair by Code
                VStack(alignment: .leading, spacing: 12) {
                    Text("Pair by code")
                        .sectionHeader()
                    Text("Enter the 6-digit code shown on your desktop Sidelink app.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    PairingCodeEntryView(code: $model.pairingCode, onSubmit: {
                        Task {
                            await model.pair()
                            if model.isPaired { showTour = true }
                        }
                    }, isLoading: model.isLoading, autoFocus: false)

                    Text("Tap the code boxes to start typing.")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                .padding(.horizontal)

                // MARK: - Manual
                VStack(alignment: .leading, spacing: 8) {
                    Text("Manual server")
                        .font(.caption.bold())
                        .foregroundStyle(.secondary)
                    TextField("http://your-computer-ip:4010", text: $model.backendURL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .textFieldStyle(.roundedBorder)
                }
                .padding(.horizontal)

                if let error = model.errorMessage {
                    Label(error, systemImage: "exclamationmark.triangle")
                        .foregroundStyle(Color.slDanger)
                        .font(.footnote)
                        .padding(.horizontal)
                }

                Button("Skip for now") {
                    completed = true
                }
                .foregroundStyle(.secondary)
                .disabled(model.isLoading)
                .padding(.bottom, 20)
            }
        }
        .navigationTitle("Setup")
    }

    // MARK: - Feature Tour
    private var featureTourView: some View {
        TabView(selection: $tourPage) {
            tourCard(
                icon: "shippingbox.fill",
                color: .slAccent,
                title: "Browse & Install",
                body: "Browse your IPA library, search apps, and install them with one tap — all from your iPhone."
            )
            .tag(0)

            tourCard(
                icon: "clock.arrow.circlepath",
                color: .slSuccess,
                title: "Auto Refresh",
                body: "Free accounts expire every 7 days. Sidelink automatically refreshes your apps in the background."
            )
            .tag(1)

            tourCard(
                icon: "square.stack.3d.up.fill",
                color: .slAccent2,
                title: "App Sources",
                body: "Add external app sources to discover and install apps from community repositories."
            )
            .tag(2)

            completionCard
                .tag(3)
        }
        .tabViewStyle(.page)
        .indexViewStyle(.page(backgroundDisplayMode: .always))
    }

    // MARK: - Completion with Confetti
    private var completionCard: some View {
        ZStack {
            VStack(spacing: 20) {
                Spacer()
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 72))
                    .foregroundStyle(Color.slSuccess)
                    .scaleEffect(showConfetti ? 1.0 : 0.3)
                    .opacity(showConfetti ? 1.0 : 0.0)
                Text("You're all set!")
                    .font(.title.bold())
                    .opacity(showConfetti ? 1.0 : 0.0)
                Text("Start exploring apps, or head to Settings any time to reconfigure.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
                    .opacity(showConfetti ? 1.0 : 0.0)
                Button {
                    completed = true
                } label: {
                    Text("Get Started")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(.slAccent)
                .padding(.horizontal, 40)
                .padding(.top, 8)
                .opacity(showConfetti ? 1.0 : 0.0)
                Spacer()
                Spacer()
            }

            // Confetti overlay
            if showConfetti {
                ConfettiOverlay()
                    .allowsHitTesting(false)
            }
        }
        .onAppear {
            withAnimation(.spring(response: 0.7, dampingFraction: 0.5).delay(0.2)) {
                showConfetti = true
            }
            SidelinkHaptics.impact(.medium)
        }
    }

    private func tourCard(icon: String, color: Color, title: String, body: String) -> some View {
        VStack(spacing: 20) {
            Spacer()
            Image(systemName: icon)
                .font(.system(size: 72))
                .foregroundStyle(color)
                .shadow(color: color.opacity(0.3), radius: 16, y: 6)
            Text(title)
                .font(.title2.bold())
            Text(body)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
            Spacer()
            Spacer()
        }
    }

    // MARK: - Radar Pulse
    private func radarRingView(scale: CGFloat, opacity: Double) -> some View {
        Circle()
            .stroke(Color.slAccent.opacity(0.3), lineWidth: 2)
            .frame(width: 120, height: 120)
            .scaleEffect(scale)
            .opacity(opacity)
    }

    private func startRadarPulse() {
        withAnimation(.easeOut(duration: 2.0).repeatForever(autoreverses: false)) {
            radarRing1 = 2.0
            radarOpacity1 = 0
        }
        withAnimation(.easeOut(duration: 2.0).repeatForever(autoreverses: false).delay(0.5)) {
            radarRing2 = 2.0
            radarOpacity2 = 0
        }
        withAnimation(.easeOut(duration: 2.0).repeatForever(autoreverses: false).delay(1.0)) {
            radarRing3 = 2.0
            radarOpacity3 = 0
        }
    }
}

// MARK: - Confetti Overlay
private struct ConfettiOverlay: View {
    @State private var particles: [ConfettiParticle] = (0..<30).map { _ in ConfettiParticle() }

    var body: some View {
        GeometryReader { geo in
            ForEach(particles) { p in
                RoundedRectangle(cornerRadius: 2)
                    .fill(p.color)
                    .frame(width: p.size, height: p.size * 1.5)
                    .rotationEffect(.degrees(p.rotation))
                    .position(
                        x: geo.size.width * p.x,
                        y: p.fallen ? geo.size.height + 20 : -20
                    )
                    .animation(
                        .easeIn(duration: p.duration).delay(p.delay),
                        value: p.fallen
                    )
            }
        }
        .onAppear {
            for i in particles.indices {
                particles[i].fallen = true
            }
        }
    }
}

private struct ConfettiParticle: Identifiable {
    let id = UUID()
    let x: CGFloat = CGFloat.random(in: 0.05...0.95)
    let size: CGFloat = CGFloat.random(in: 4...8)
    let rotation: Double = Double.random(in: 0...360)
    let duration: Double = Double.random(in: 1.0...2.5)
    let delay: Double = Double.random(in: 0...0.8)
    let color: Color = [.slAccent, .slAccent2, .slSuccess, .yellow, .pink, .orange].randomElement()!
    var fallen: Bool = false
}
