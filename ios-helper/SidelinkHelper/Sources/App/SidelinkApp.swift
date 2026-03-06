import SwiftUI

struct SidelinkAppRootView: View {
    enum RootTab: Hashable {
        case browse
        case search
        case installed
        case sources
        case settings
    }

    @StateObject private var model = HelperViewModel()
    @AppStorage("didCompleteOnboarding") private var didCompleteOnboarding = false
    @State private var selectedTab: RootTab = .browse
    @State private var pendingSourceImport: PendingSourceImport?

    var body: some View {
        TabView(selection: $selectedTab) {
            BrowseTab(model: model)
                .tag(RootTab.browse)
                .tabItem { Label("Home", systemImage: "sparkles") }
            SearchTab(model: model)
                .tag(RootTab.search)
                .tabItem { Label("Search", systemImage: "magnifyingglass") }
            SourcesTab(model: model)
                .tag(RootTab.sources)
                .tabItem { Label("Sources", systemImage: "square.stack.3d.up") }
            InstalledTab(model: model)
                .tag(RootTab.installed)
                .tabItem { Label("Installed", systemImage: "checkmark.shield") }
                .badge(model.installedAttentionCount)
            SettingsTab(model: model)
                .tag(RootTab.settings)
                .tabItem { Label("Settings", systemImage: "gearshape") }
                .badge(model.settingsAttentionCount)
        }
        .onOpenURL { incomingURL in
            guard let components = URLComponents(url: incomingURL, resolvingAgainstBaseURL: false) else {
                return
            }

            let normalizedScheme = (components.scheme ?? "").lowercased()
            let normalizedHost = (components.host ?? "").lowercased()
            guard normalizedScheme == "sidelink" && normalizedHost == "source" else {
                return
            }

            guard let sourceURL = components.queryItems?.first(where: { $0.name.lowercased() == "url" })?.value,
                  !sourceURL.isEmpty
            else {
                model.toastMessage = "Invalid source deep link"
                return
            }

            selectedTab = .sources
            pendingSourceImport = PendingSourceImport(url: sourceURL)
        }
        .task {
            await model.refreshAll()
        }
        .tint(.slAccent)
        .fullScreenCover(isPresented: Binding(
            get: { !didCompleteOnboarding },
            set: { value in didCompleteOnboarding = !value }
        )) {
            OnboardingView(model: model, completed: $didCompleteOnboarding)
        }
        .sheet(item: $pendingSourceImport) { pending in
            ImportSourceSheet(
                sourceURL: pending.url,
                onCancel: { pendingSourceImport = nil },
                onImport: {
                    Task {
                        await model.addSourceFromDeepLink(pending.url)
                        pendingSourceImport = nil
                    }
                }
            )
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

private struct PendingSourceImport: Identifiable {
    let id = UUID()
    let url: String
}

private struct ImportSourceSheet: View {
    let sourceURL: String
    let onCancel: () -> Void
    let onImport: () -> Void

    var body: some View {
        NavigationStack {
            Form {
                Section("Import Source") {
                    Text("Use this source in Sidelink?")
                        .font(.subheadline)
                    Text(sourceURL)
                        .font(.footnote.monospaced())
                        .textSelection(.enabled)
                        .foregroundStyle(.secondary)
                }

                Section {
                    Button {
                        onImport()
                    } label: {
                        Label("Import Source", systemImage: "square.and.arrow.down")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                }
            }
            .navigationTitle("Import Source")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { onCancel() }
                }
            }
        }
        .presentationDetents([.medium])
    }
}
