import SwiftUI

struct SidelinkAppRootView: View {
    enum RootTab: Hashable {
        case browse
        case installed
        case sources
        case settings
    }

    @StateObject private var model = HelperViewModel()
    @AppStorage("didCompleteOnboarding") private var didCompleteOnboarding = false
    @State private var selectedTab: RootTab = .browse

    var body: some View {
        TabView(selection: $selectedTab) {
            BrowseTab(model: model)
                .tag(RootTab.browse)
                .tabItem { Label("Browse", systemImage: "shippingbox") }
            InstalledTab(model: model)
                .tag(RootTab.installed)
                .tabItem { Label("Installed", systemImage: "checkmark.shield") }
            SourcesTab(model: model)
                .tag(RootTab.sources)
                .tabItem { Label("Sources", systemImage: "square.stack.3d.up") }
            SettingsTab(model: model)
                .tag(RootTab.settings)
                .tabItem { Label("Settings", systemImage: "gearshape") }
        }
        .onOpenURL { incomingURL in
            guard let components = URLComponents(url: incomingURL, resolvingAgainstBaseURL: false) else {
                return
            }

            let normalizedScheme = (components.scheme ?? "").lowercased()
            let normalizedHost = (components.host ?? "").lowercased()
            guard normalizedScheme == "altstore" && normalizedHost == "source" else {
                return
            }

            guard let sourceURL = components.queryItems?.first(where: { $0.name.lowercased() == "url" })?.value,
                  !sourceURL.isEmpty
            else {
                model.toastMessage = "Invalid source deep link"
                return
            }

            selectedTab = .sources
            Task {
                await model.addSourceFromDeepLink(sourceURL)
            }
        }
        .task {
            await model.refreshAll()
        }
        .tint(.indigo)
        .fullScreenCover(isPresented: Binding(
            get: { !didCompleteOnboarding },
            set: { value in didCompleteOnboarding = !value }
        )) {
            OnboardingView(model: model, completed: $didCompleteOnboarding)
        }
        .alert("Message", isPresented: Binding(
            get: { model.toastMessage != nil },
            set: { _ in model.toastMessage = nil }
        )) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(model.toastMessage ?? "")
        }
    }
}
