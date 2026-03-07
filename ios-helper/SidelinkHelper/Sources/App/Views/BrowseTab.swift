import SwiftUI

struct BrowseTab: View {
    @ObservedObject var model: HelperViewModel
    @Environment(\.colorScheme) private var colorScheme

    private var featuredSourceApps: [SourceAppDTO] {
        var seen = Set<String>()
        let apps = model.sourceCatalogs.flatMap { catalog -> [SourceAppDTO] in
            let featuredIDs = Set(catalog.manifest.featuredApps ?? [])
            if featuredIDs.isEmpty {
                return Array(catalog.manifest.apps.prefix(2))
            }
            return catalog.manifest.apps.filter { featuredIDs.contains($0.bundleIdentifier) }
        }

        return apps.filter { app in
            seen.insert(app.bundleIdentifier).inserted
        }
    }

    private var newsCards: [SourceNewsDTO] {
        model.sourceCatalogs
            .compactMap { $0.manifest.news }
            .flatMap { $0 }
            .sorted { ($0.date ?? "") > ($1.date ?? "") }
    }

    private var recentLibrary: [IpaArtifactDTO] {
        Array(model.ipas.prefix(6))
    }

    var body: some View {
        NavigationStack {
            ZStack {
                SidelinkBackdrop()
                    .ignoresSafeArea()

                ScrollView {
                    VStack(alignment: .leading, spacing: 28) {
                        homeHero

                        if let readiness = model.installReadinessMessage {
                            attentionBanner(readiness)
                        }

                        if !model.sourceCatalogs.isEmpty || !model.ipas.isEmpty {
                            summaryRail
                                .padding(.horizontal, 20)
                        }

                        if !newsCards.isEmpty {
                            sectionHeader("Updates", subtitle: "Fresh notes from the sources you trust")

                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack(spacing: 14) {
                                    ForEach(newsCards.prefix(8)) { item in
                                        newsCard(item)
                                    }
                                }
                                .padding(.horizontal, 20)
                            }
                        }

                        if !featuredSourceApps.isEmpty {
                            sectionHeader("Featured Apps", subtitle: "A storefront view of what matters right now")

                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack(spacing: 14) {
                                    ForEach(featuredSourceApps.prefix(12)) { app in
                                        NavigationLink {
                                            SourceAppShowcaseView(model: model, app: app)
                                        } label: {
                                            featuredAppCard(app)
                                        }
                                        .buttonStyle(.plain)
                                    }
                                }
                                .padding(.horizontal, 20)
                            }
                        }

                        if let latest = model.latestUploadedIpa {
                            sectionHeader("Your Library", subtitle: "Pick up from the latest IPA you added")

                            NavigationLink {
                                AppDetailView(model: model, ipa: latest)
                            } label: {
                                latestUploadCard(latest)
                            }
                            .buttonStyle(.plain)
                            .padding(.horizontal, 20)
                        }

                        if !recentLibrary.isEmpty {
                            sectionHeader("Recent IPAs", subtitle: "Ready to sign whenever you are")

                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack(spacing: 14) {
                                    ForEach(recentLibrary) { ipa in
                                        NavigationLink {
                                            AppDetailView(model: model, ipa: ipa)
                                        } label: {
                                            libraryCard(ipa)
                                        }
                                        .buttonStyle(.plain)
                                    }
                                }
                                .padding(.horizontal, 20)
                            }
                        }

                        if !model.sourceCatalogs.isEmpty {
                            sectionHeader("Collections", subtitle: "Browse your source catalogs like curated shelves")

                            VStack(spacing: 14) {
                                ForEach(model.sourceCatalogs) { catalog in
                                    NavigationLink {
                                        SourceCatalogShowcaseView(model: model, catalog: catalog)
                                    } label: {
                                        sourceCollectionCard(catalog)
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                            .padding(.horizontal, 20)
                        }

                        if model.sourceCatalogs.isEmpty && model.ipas.isEmpty {
                            emptyHomeState
                                .padding(.horizontal, 20)
                        }
                    }
                    .padding(.vertical, 20)
                }
                .refreshable {
                    await model.refreshAll()
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Text("Home")
                        .font(.headline.weight(.semibold))
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task { await model.refreshAll() }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                }
            }
        }
    }

    private var homeHero: some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 10) {
                    Text("A calmer control center for sideloading")
                        .font(.system(size: 32, weight: .bold, design: .rounded))
                        .foregroundStyle(.primary)

                    Text("Browse sources, track installs, and keep signing status visible without wading through noise.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                Spacer(minLength: 16)

                SidelinkBrandIcon(size: 54)
            }

            HStack(spacing: 10) {
                statusChip(systemImage: "person.crop.circle.fill", text: model.selectedAccount?.appleId ?? "No Apple ID")
                statusChip(systemImage: "iphone.gen3", text: model.selectedDevice?.name ?? "No Device")
            }
        }
        .liquidPanel()
        .padding(.horizontal, 20)
    }

    private var summaryRail: some View {
        HStack(spacing: 12) {
            SidelinkMetricTile(label: "Sources", value: "\(model.sourceCatalogs.count)")
            SidelinkMetricTile(label: "Library", value: "\(model.ipas.count)", tint: .slAccent2)
            SidelinkMetricTile(label: "Slots", value: "\(model.activeAppSlotUsage)/\(model.maxActiveAppSlots)", tint: .slWarning)
        }
    }

    private func attentionBanner(_ message: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "exclamationmark.shield")
                .foregroundStyle(Color.slWarning)
            Text(message)
                .font(.subheadline)
                .foregroundStyle(.primary)
            Spacer()
        }
        .padding(18)
        .background((colorScheme == .dark ? Color.white.opacity(0.08) : Color.white.opacity(0.82)), in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .padding(.horizontal, 20)
    }

    private func sectionHeader(_ title: String, subtitle: String) -> some View {
        SidelinkSectionIntro(title: title, subtitle: subtitle)
        .padding(.horizontal, 20)
    }

    private var emptyHomeState: some View {
        VStack(alignment: .leading, spacing: 18) {
            SidelinkSectionIntro(eyebrow: "Get Started", title: "Build your first collection", subtitle: "Add the official source or upload an IPA to make Home feel alive.")

            HStack(spacing: 12) {
                SidelinkMetricTile(label: "Sources", value: "0")
                SidelinkMetricTile(label: "Library", value: "0", tint: .slAccent2)
            }
        }
        .liquidPanel()
    }

    private func statusChip(systemImage: String, text: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: systemImage)
                .foregroundStyle(Color.slAccent)
            Text(text)
                .font(.caption.weight(.semibold))
                .lineLimit(1)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background((colorScheme == .dark ? Color.white.opacity(0.08) : Color.white.opacity(0.76)), in: Capsule())
    }

    private func newsCard(_ item: SourceNewsDTO) -> some View {
        let tint = Color(hex: item.tintColor) ?? .slAccent

        return VStack(alignment: .leading, spacing: 12) {
            PillBadge(text: item.date ?? "Source update", color: tint, small: true)
            Text(item.title)
                .font(.headline)
                .foregroundStyle(.primary)
            if let caption = item.caption, !caption.isEmpty {
                Text(caption)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(4)
            }
            Spacer()
        }
        .frame(width: 260, height: 170, alignment: .topLeading)
        .padding(18)
        .background((colorScheme == .dark ? Color.white.opacity(0.07) : Color.white.opacity(0.95)), in: RoundedRectangle(cornerRadius: 24, style: .continuous))
    }

    private func featuredAppCard(_ app: SourceAppDTO) -> some View {
        let tint = Color(hex: app.tintColor) ?? .slAccent

        return VStack(alignment: .leading, spacing: 12) {
            SidelinkAsyncImage(url: app.iconURL, size: 62)

            VStack(alignment: .leading, spacing: 4) {
                Text(app.name)
                    .font(.headline)
                    .foregroundStyle(.primary)
                Text(app.subtitle ?? app.bundleIdentifier)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(3)
            }

            Spacer()

            HStack {
                PillBadge(text: app.displayVersion, color: tint, small: true)
                Spacer()
                Image(systemName: "arrow.right.circle.fill")
                    .foregroundStyle(tint)
            }
        }
        .frame(width: 220, height: 250, alignment: .topLeading)
        .padding(18)
        .background((colorScheme == .dark ? Color.white.opacity(0.07) : Color.white.opacity(0.95)), in: RoundedRectangle(cornerRadius: 24, style: .continuous))
    }

    private func latestUploadCard(_ ipa: IpaArtifactDTO) -> some View {
        HStack(spacing: 16) {
            appIcon(for: ipa, size: 70)

            VStack(alignment: .leading, spacing: 5) {
                Text(ipa.bundleName)
                    .font(.title3.bold())
                    .foregroundStyle(.primary)
                Text(ipa.bundleId)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                if let uploadedAt = ipa.uploadedAt {
                    Text("Uploaded \(SidelinkDateFormatting.relativeDate(uploadedAt))")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }

            Spacer()

            Image(systemName: "chevron.right")
                .foregroundStyle(.secondary)
        }
        .padding(18)
        .background((colorScheme == .dark ? Color.white.opacity(0.07) : Color.white.opacity(0.95)), in: RoundedRectangle(cornerRadius: 24, style: .continuous))
    }

    private func libraryCard(_ ipa: IpaArtifactDTO) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            appIcon(for: ipa, size: 58)

            VStack(alignment: .leading, spacing: 4) {
                Text(ipa.bundleName)
                    .font(.headline)
                    .foregroundStyle(.primary)
                Text(ipa.bundleId)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }

            Spacer()

            Text("v\(ipa.bundleShortVersion)")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
        }
        .frame(width: 190, height: 210, alignment: .topLeading)
        .padding(16)
        .background((colorScheme == .dark ? Color.white.opacity(0.07) : Color.white.opacity(0.95)), in: RoundedRectangle(cornerRadius: 24, style: .continuous))
    }

    private func sourceCollectionCard(_ catalog: SourceCatalog) -> some View {
        let tint = Color(hex: catalog.manifest.tintColor) ?? .slAccent

        return HStack(spacing: 14) {
            SidelinkAsyncImage(url: catalog.manifest.iconURL, size: 54)

            VStack(alignment: .leading, spacing: 4) {
                Text(catalog.manifest.name)
                    .font(.headline)
                    .foregroundStyle(.primary)
                Text(catalog.manifest.subtitle ?? catalog.manifest.description ?? "\(catalog.manifest.apps.count) apps available")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }

            Spacer()

            PillBadge(text: "\(catalog.manifest.apps.count) apps", color: tint, small: true)
        }
        .padding(16)
        .background((colorScheme == .dark ? Color.white.opacity(0.07) : Color.white.opacity(0.95)), in: RoundedRectangle(cornerRadius: 24, style: .continuous))
    }

    @ViewBuilder
    private func appIcon(for ipa: IpaArtifactDTO, size: CGFloat) -> some View {
        if let iconData = ipa.iconData,
           let data = Data(base64Encoded: iconData),
           let uiImage = UIImage(data: data) {
            Image(uiImage: uiImage)
                .resizable()
                .appIconStyle(size: size)
        } else {
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(Color.secondary.opacity(0.12))
                .frame(width: size, height: size)
                .overlay {
                    Image(systemName: "app.fill")
                        .foregroundStyle(.secondary)
                }
        }
    }

}

struct SearchTab: View {
    enum Scope: String, CaseIterable, Identifiable {
        case all = "All"
        case library = "Library"
        case sources = "Sources"

        var id: String { rawValue }
    }

    @ObservedObject var model: HelperViewModel
    @State private var query = ""
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
        query.trimmingCharacters(in: .whitespacesAndNewlines)
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
            if let iconData = ipa.iconData,
               let data = Data(base64Encoded: iconData),
               let uiImage = UIImage(data: data) {
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

private struct SourceCatalogShowcaseView: View {
    @ObservedObject var model: HelperViewModel
    let catalog: SourceCatalog
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 12) {
                        SidelinkAsyncImage(url: catalog.manifest.iconURL, size: 60)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(catalog.manifest.name)
                                .font(.system(size: 28, weight: .bold, design: .rounded))
                            Text(catalog.manifest.subtitle ?? catalog.manifest.description ?? catalog.sourceURL)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                    }
                    Text("\(catalog.manifest.apps.count) apps available")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                }
                .padding(.horizontal, 20)

                VStack(spacing: 10) {
                    ForEach(catalog.manifest.apps) { app in
                        NavigationLink {
                            SourceAppShowcaseView(model: model, app: app)
                        } label: {
                            HStack(spacing: 14) {
                                SidelinkAsyncImage(url: app.iconURL, size: 48)
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(app.name)
                                        .font(.headline)
                                    Text(app.subtitle ?? app.bundleIdentifier)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(2)
                                }
                                Spacer()
                                Image(systemName: "chevron.right")
                                    .font(.caption.bold())
                                    .foregroundStyle(.secondary)
                            }
                            .padding(16)
                            .background((colorScheme == .dark ? Color.white.opacity(0.07) : Color.white), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 20)
            }
            .padding(.vertical, 18)
        }
        .background(Color(uiColor: .systemGroupedBackground))
        .navigationTitle(catalog.manifest.name)
        .navigationBarTitleDisplayMode(.inline)
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
            Button {
                Task { await model.installFromSource(app) }
            } label: {
                Label("Install", systemImage: "arrow.down.app.fill")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 6)
            }
            .buttonStyle(.borderedProminent)
            .tint(Color(hex: app.tintColor) ?? .slAccent)
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
            .background(colorScheme == .dark ? Color.black.opacity(0.88) : Color.white.opacity(0.82))
            .disabled(!model.canStartInstall || app.primaryDownloadURL.isEmpty)
        }
        .background(Color(uiColor: .systemGroupedBackground))
        .navigationBarTitleDisplayMode(.inline)
    }
}