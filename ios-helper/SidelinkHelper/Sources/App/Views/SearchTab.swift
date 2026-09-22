import SwiftUI

struct SearchTab: View {
    enum Scope: String, CaseIterable, Identifiable {
        case all = "All"
        case library = "Library"
        case sources = "Sources"

        var id: String { rawValue }
    }

    @ObservedObject var model: HelperViewModel
    @State private var query = ""
    @State private var debouncedQuery = ""
    @State private var debounceTask: Task<Void, Never>?
    @State private var scope: Scope = .all
    @Environment(\.colorScheme) private var colorScheme

    private var sourceApps: [SourceAppDTO] {
        model.sourceApps
    }

    private var filteredIpas: [IpaArtifactDTO] {
        guard !queryTrimmed.isEmpty else { return model.ipas }
        return model.ipas.filter { ipa in
            ipa.bundleName.localizedCaseInsensitiveContains(queryTrimmed)
            || ipa.bundleId.localizedCaseInsensitiveContains(queryTrimmed)
        }
    }

    private var filteredSourceApps: [SourceAppDTO] {
        guard !queryTrimmed.isEmpty else { return sourceApps }
        return sourceApps.filter { app in
            app.name.localizedCaseInsensitiveContains(queryTrimmed)
            || app.bundleIdentifier.localizedCaseInsensitiveContains(queryTrimmed)
            || (app.developerName?.localizedCaseInsensitiveContains(queryTrimmed) ?? false)
        }
    }

    private var queryTrimmed: String {
        debouncedQuery.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var shouldShowLibrarySection: Bool {
        (scope == .all || scope == .library) && !filteredIpas.isEmpty
    }

    private var shouldShowSourceSection: Bool {
        (scope == .all || scope == .sources) && !filteredSourceApps.isEmpty
    }

    private var hasResults: Bool {
        shouldShowLibrarySection || shouldShowSourceSection
    }

    private var searchHeroTitle: String {
        queryTrimmed.isEmpty ? "Find apps without digging" : "Results for \"\(queryTrimmed)\""
    }

    private var searchHeroSubtitle: String {
        if queryTrimmed.isEmpty {
            return "Search spans uploaded IPAs and source catalogs in one place, with less list noise."
        }

        let libraryLabel = filteredIpas.count == 1 ? "library match" : "library matches"
        let sourceLabel = filteredSourceApps.count == 1 ? "source match" : "source matches"
        return "\(filteredIpas.count) \(libraryLabel) and \(filteredSourceApps.count) \(sourceLabel) so far."
    }

    var body: some View {
        NavigationStack {
            ZStack {
                SidelinkBackdrop(accent: .slAccent2)
                    .ignoresSafeArea()

                ScrollView {
                    VStack(alignment: .leading, spacing: 24) {
                        searchHero

                        VStack(alignment: .leading, spacing: 12) {
                            Text("Search Scope")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.secondary)
                            Picker("Scope", selection: $scope) {
                                ForEach(Scope.allCases) { item in
                                    Text(item.rawValue).tag(item)
                                }
                            }
                            .pickerStyle(.segmented)
                        }
                        .liquidPanel()
                        .padding(.horizontal, 20)

                        if shouldShowLibrarySection {
                            SidelinkSectionIntro(
                                eyebrow: "Library",
                                title: "Uploaded IPAs",
                                subtitle: queryTrimmed.isEmpty ? "Everything in your signed-app library stays searchable here." : "Matching uploads from your local library."
                            )
                            .padding(.horizontal, 20)

                            LazyVStack(spacing: 12) {
                                ForEach(filteredIpas) { ipa in
                                    NavigationLink {
                                        AppDetailView(model: model, ipa: ipa)
                                    } label: {
                                        ipaResultRow(ipa)
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                            .padding(.horizontal, 20)
                        }

                        if shouldShowSourceSection {
                            SidelinkSectionIntro(
                                eyebrow: "Sources",
                                title: "Source apps",
                                subtitle: queryTrimmed.isEmpty ? "Browse every app exposed by your connected feeds." : "Matching apps from your connected source catalogs."
                            )
                            .padding(.horizontal, 20)

                            LazyVStack(spacing: 12) {
                                ForEach(filteredSourceApps) { app in
                                    NavigationLink {
                                        SourceAppShowcaseView(model: model, app: app)
                                    } label: {
                                        sourceResultRow(app)
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                            .padding(.horizontal, 20)
                        }

                        if !hasResults {
                            EmptyStateCard(
                                icon: "magnifyingglass",
                                title: queryTrimmed.isEmpty ? "Search your library and sources" : "No matches",
                                message: queryTrimmed.isEmpty
                                    ? "Search across uploaded IPAs and every app exposed by your connected AltStore-compatible feeds."
                                    : "Try another app name, bundle identifier, or developer name."
                            )
                            .padding(.horizontal, 20)
                        }
                    }
                    .padding(.vertical, 20)
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Text("Search")
                        .font(.headline.weight(.semibold))
                }
            }
            .searchable(text: $query, prompt: "Search apps and sources")
            .onChange(of: query) { _, newValue in
                debounceTask?.cancel()
                debounceTask = Task {
                    try? await Task.sleep(nanoseconds: 300_000_000) // 300ms
                    guard !Task.isCancelled else { return }
                    debouncedQuery = newValue
                }
            }
            .onDisappear {
                debounceTask?.cancel()
            }
        }
    }

    private var searchHero: some View {
        VStack(alignment: .leading, spacing: 18) {
            SidelinkSectionIntro(
                eyebrow: "Search",
                title: searchHeroTitle,
                subtitle: searchHeroSubtitle
            )

            HStack(spacing: 12) {
                SidelinkMetricTile(label: "Library", value: "\(filteredIpas.count)")
                SidelinkMetricTile(label: "Sources", value: "\(filteredSourceApps.count)", tint: .slAccent2)
            }
        }
        .liquidPanel()
        .padding(.horizontal, 20)
    }

    private func ipaResultRow(_ ipa: IpaArtifactDTO) -> some View {
        HStack(spacing: 14) {
            if let uiImage = SidelinkImageDecoder.decodeBoundedBase64(ipa.iconData) {
                Image(uiImage: uiImage)
                    .resizable()
                    .appIconStyle(size: 52)
            } else {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(Color.secondary.opacity(0.12))
                    .frame(width: 52, height: 52)
                    .overlay {
                        Image(systemName: "app.fill")
                            .foregroundStyle(.secondary)
                    }
            }

            VStack(alignment: .leading, spacing: 3) {
                Text(ipa.bundleName)
                    .font(.headline)
                Text(ipa.bundleId)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }

            Spacer()
            PillBadge(text: "Library", color: .slAccent, small: true)
        }
        .liquidPanel()
    }

    private func sourceResultRow(_ app: SourceAppDTO) -> some View {
        let tint = Color(hex: app.tintColor) ?? .slAccent

        return HStack(spacing: 14) {
            SidelinkAsyncImage(url: app.iconURL, size: 52)

            VStack(alignment: .leading, spacing: 3) {
                Text(app.name)
                    .font(.headline)
                Text(app.subtitle ?? app.bundleIdentifier)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }

            Spacer()
            PillBadge(text: "Source", color: tint, small: true)
        }
        .liquidPanel()
    }
}

private struct EmptyStateCard: View {
    let icon: String
    let title: String
    let message: String
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: icon)
                .font(.system(size: 42))
                .foregroundStyle(Color.slAccent)
            Text(title)
                .font(.headline)
            Text(message)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding(24)
        .frame(maxWidth: .infinity)
        .background((colorScheme == .dark ? Color.white.opacity(0.07) : Color.white.opacity(0.95)), in: RoundedRectangle(cornerRadius: 24, style: .continuous))
    }
}

private struct SourceAppShowcaseView: View {
    @ObservedObject var model: HelperViewModel
    let app: SourceAppDTO
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 14) {
                    HStack(spacing: 16) {
                        SidelinkAsyncImage(url: app.iconURL, size: 76)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(app.name)
                                .font(.system(size: 30, weight: .bold, design: .rounded))
                            Text(app.subtitle ?? app.bundleIdentifier)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                            if let developer = app.developerName {
                                Text(developer)
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(Color(hex: app.tintColor) ?? .slAccent)
                            }
                        }
                    }

                    if let description = app.localizedDescription, !description.isEmpty {
                        Text(description)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }

                    HStack(spacing: 10) {
                        PillBadge(text: app.displayVersion, color: Color(hex: app.tintColor) ?? .slAccent, small: true)
                        if let category = app.category, !category.isEmpty {
                            PillBadge(text: category, color: .slAccent2, small: true)
                        }
                    }
                }
                .padding(.horizontal, 20)

                if let screenshots = app.screenshots?.iphone, !screenshots.isEmpty {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Screenshots")
                            .font(.headline)
                            .padding(.horizontal, 20)

                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 12) {
                                ForEach(screenshots) { item in
                                    AsyncImage(url: URL(string: item.imageURL)) { phase in
                                        if case .success(let image) = phase {
                                            image.resizable().aspectRatio(contentMode: .fill)
                                        } else {
                                            RoundedRectangle(cornerRadius: 20, style: .continuous)
                                                .fill(Color.slAccent.opacity(0.12))
                                        }
                                    }
                                    .frame(width: 180, height: 360)
                                    .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                                }
                            }
                            .padding(.horizontal, 20)
                        }
                    }
                }

                if let versions = app.versions, !versions.isEmpty {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Release Notes")
                            .font(.headline)
                            .padding(.horizontal, 20)

                        VStack(spacing: 10) {
                            ForEach(versions.prefix(4)) { version in
                                VStack(alignment: .leading, spacing: 6) {
                                    HStack {
                                        Text("v\(version.version)")
                                            .font(.subheadline.bold())
                                        Spacer()
                                        if let date = version.date {
                                            Text(date)
                                                .font(.caption)
                                                .foregroundStyle(.secondary)
                                        }
                                    }
                                    if let description = version.localizedDescription, !description.isEmpty {
                                        Text(description)
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                }
                                .padding(16)
                                .background((colorScheme == .dark ? Color.white.opacity(0.07) : Color.white), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                            }
                        }
                        .padding(.horizontal, 20)
                    }
                }

                if let permissions = app.appPermissions {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Permissions")
                            .font(.headline)
                            .padding(.horizontal, 20)

                        VStack(alignment: .leading, spacing: 8) {
                            if let entitlements = permissions.entitlements {
                                ForEach(entitlements, id: \.self) { entitlement in
                                    Label(entitlement, systemImage: "lock.shield")
                                        .font(.caption)
                                }
                            }
                            if let privacy = permissions.privacy {
                                ForEach(privacy.keys.sorted(), id: \.self) { key in
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(key)
                                            .font(.caption.bold())
                                        Text(privacy[key] ?? "")
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                }
                            }
                        }
                        .padding(16)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background((colorScheme == .dark ? Color.white.opacity(0.07) : Color.white), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                        .padding(.horizontal, 20)
                    }
                }
            }
            .padding(.vertical, 18)
        }
        .safeAreaInset(edge: .bottom) {
            VStack(spacing: 6) {
                if let readiness = model.installReadinessMessage {
                    Label(readiness, systemImage: "info.circle")
                        .font(.caption2)
                        .foregroundStyle(Color.slWarning)
                } else {
                    Text(model.primarySigningSummary)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }

                Button {
                    Task { await model.installFromSource(app) }
                } label: {
                    Label("Install", systemImage: "arrow.down.app.fill")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 6)
                }
                .sidelinkProminentButton(customTint: Color(hex: app.tintColor))
                .disabled(!model.canStartInstall || app.primaryDownloadURL.isEmpty)
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
            .background(colorScheme == .dark ? Color.black.opacity(0.88) : Color.white.opacity(0.82))
        }
        .background(Color(uiColor: .systemGroupedBackground))
        .navigationBarTitleDisplayMode(.inline)
    }
}
