import SwiftUI

struct AppDetailView: View {
    @ObservedObject var model: HelperViewModel
    let ipa: IpaArtifactDTO
    @State private var showFullDescription = false

    /// Check if this IPA is already installed
    private var isInstalled: Bool {
        model.installedApps.contains { $0.bundleId == ipa.bundleId || $0.originalBundleId == ipa.bundleId }
    }

    private var installButtonLabel: String {
        if isInstalled { return "Reinstall" }
        return "Install"
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                // MARK: - Hero Gradient + Icon
                ZStack(alignment: .bottom) {
                    LinearGradient(
                        colors: [.slAccent, .slAccent2.opacity(0.6), .clear],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                    .frame(height: 200)

                    HStack(spacing: 16) {
                        if let iconData = ipa.iconData,
                           let data = Data(base64Encoded: iconData),
                           let uiImage = UIImage(data: data) {
                            Image(uiImage: uiImage)
                                .resizable()
                                .appIconStyle(size: 80)
                                .shadow(color: .black.opacity(0.2), radius: 8, y: 4)
                        } else {
                            RoundedRectangle(cornerRadius: 18, style: .continuous)
                                .fill(.secondary.opacity(0.15))
                                .frame(width: 80, height: 80)
                                .overlay {
                                    Image(systemName: "app.fill")
                                        .font(.title)
                                        .foregroundStyle(.secondary)
                                }
                        }
                        VStack(alignment: .leading, spacing: 4) {
                            Text(ipa.bundleName)
                                .font(.title2.bold())
                                .foregroundStyle(.white)
                            Text(ipa.bundleId)
                                .font(.caption)
                                .foregroundStyle(.white.opacity(0.7))
                            if let version = ipa.bundleVersion {
                                Text("v\(ipa.bundleShortVersion) (\(version))")
                                    .font(.caption2)
                                    .foregroundStyle(.white.opacity(0.6))
                            }
                        }
                        Spacer()
                    }
                    .padding(.horizontal, 20)
                    .padding(.bottom, 20)
                }

                VStack(spacing: 20) {
                    // MARK: - Quick Info Row
                    HStack(spacing: 0) {
                        infoCell("Version", ipa.bundleShortVersion)
                        Divider().frame(height: 30)
                        if let size = ipa.fileSize, size > 0 {
                            infoCell("Size", formatFileSize(size))
                            Divider().frame(height: 30)
                        }
                        if let minOS = ipa.minOsVersion, !minOS.isEmpty {
                            infoCell("Min iOS", minOS)
                        }
                    }
                    .padding(.vertical, 8)

                    // MARK: - Description (expandable)
                    if let desc = matchingSourceApp?.localizedDescription, !desc.isEmpty {
                        VStack(alignment: .leading, spacing: 6) {
                            Text(desc)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                                .lineLimit(showFullDescription ? nil : 3)
                            Button(showFullDescription ? "Show Less" : "More") {
                                withAnimation { showFullDescription.toggle() }
                            }
                            .font(.subheadline.bold())
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal)
                    }

                    // MARK: - Screenshot Carousel
                    if let screenshots = matchingSourceApp?.screenshots?.iphone, !screenshots.isEmpty {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("Screenshots")
                                .sectionHeader()
                                .padding(.horizontal)

                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack(spacing: 10) {
                                    ForEach(screenshots) { ss in
                                        AsyncImage(url: URL(string: ss.imageURL)) { phase in
                                            if case .success(let image) = phase {
                                                image.resizable().aspectRatio(contentMode: .fit)
                                            } else {
                                                RoundedRectangle(cornerRadius: 12)
                                                    .fill(.secondary.opacity(0.1))
                                            }
                                        }
                                        .frame(width: screenshotWidth, height: screenshotHeight)
                                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                                    }
                                }
                                .padding(.horizontal)
                            }
                        }
                    }

                    // MARK: - Version History
                    if let versions = matchingSourceApp?.versions, versions.count > 1 {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("Version History")
                                .sectionHeader()
                                .padding(.horizontal)

                            ForEach(versions.prefix(5)) { ver in
                                VStack(alignment: .leading, spacing: 4) {
                                    HStack {
                                        Text("v\(ver.version)")
                                            .font(.subheadline.bold())
                                        Spacer()
                                        if let date = ver.date {
                                            Text(date)
                                                .font(.caption)
                                                .foregroundStyle(.secondary)
                                        }
                                    }
                                    if let desc = ver.localizedDescription, !desc.isEmpty {
                                        Text(desc)
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                            .lineLimit(3)
                                    }
                                }
                                .padding(.horizontal)
                                Divider().padding(.horizontal)
                            }
                        }
                    }

                    // MARK: - Details
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Details")
                            .sectionHeader()
                            .padding(.horizontal)

                        VStack(spacing: 0) {
                            DetailRow(label: "File", value: ipa.originalName, icon: "doc.zipper")
                            if let build = ipa.bundleVersion, build != ipa.bundleShortVersion {
                                DetailRow(label: "Build", value: build, icon: "hammer")
                            }
                            if let exts = ipa.extensions, !exts.isEmpty {
                                DetailRow(label: "Extensions", value: "\(exts.count)", icon: "puzzlepiece.extension")
                            }
                        }
                        .padding(.horizontal)
                    }

                    // MARK: - App Extensions
                    if let exts = ipa.extensions, !exts.isEmpty {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("App Extensions")
                                .sectionHeader()
                                .padding(.horizontal)

                            ForEach(exts) { ext in
                                HStack {
                                    Image(systemName: "puzzlepiece")
                                        .foregroundStyle(.secondary)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(ext.name).font(.subheadline)
                                        Text(ext.bundleId)
                                            .font(.caption2)
                                            .foregroundStyle(.secondary)
                                    }
                                }
                                .padding(.horizontal)
                            }
                        }
                    }

                    // MARK: - Permissions / Entitlements
                    if let entitlements = ipa.entitlements, !entitlements.isEmpty {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("Entitlements")
                                .sectionHeader()
                                .padding(.horizontal)

                            ForEach(Array(entitlements.keys).sorted(), id: \.self) { key in
                                HStack {
                                    Text(key)
                                        .font(.caption)
                                        .lineLimit(1)
                                    Spacer()
                                    Text(describeEntitlement(entitlements[key]?.value))
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(1)
                                }
                                .padding(.horizontal)
                            }
                        }
                    }

                    // MARK: - Source Permissions
                    if let perms = matchingSourceApp?.appPermissions {
                        if let ents = perms.entitlements, !ents.isEmpty {
                            VStack(alignment: .leading, spacing: 8) {
                                Text("App Permissions")
                                    .sectionHeader()
                                    .padding(.horizontal)
                                ForEach(ents, id: \.self) { ent in
                                    Label(ent, systemImage: "lock.shield")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                        .padding(.horizontal)
                                }
                            }
                        }
                    }

                    if !ipa.warnings.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Warnings")
                                .sectionHeader()
                                .padding(.horizontal)
                            ForEach(ipa.warnings, id: \.self) { warning in
                                Label(warning, systemImage: "exclamationmark.triangle")
                                    .font(.footnote)
                                    .foregroundStyle(.orange)
                                    .padding(.horizontal)
                            }
                        }
                    }

                    Spacer(minLength: 80)
                }
                .padding(.top, 16)
            }
        }
        .ignoresSafeArea(edges: .top)
        .safeAreaInset(edge: .bottom) {
            VStack(spacing: 6) {
                if model.isAtFreeSlotLimit && !isInstalled {
                    Label(
                        "Slot limit reached (\(model.activeAppSlotUsage)/\(model.maxActiveAppSlots))",
                        systemImage: "exclamationmark.triangle.fill"
                    )
                    .font(.caption2)
                    .foregroundStyle(.orange)
                }
                Button {
                    Task { await model.startInstall(ipaId: ipa.id) }
                } label: {
                    Label(installButtonLabel, systemImage: isInstalled ? "arrow.clockwise" : "arrow.down.app.fill")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 6)
                }
                .buttonStyle(.borderedProminent)
                .tint(.slAccent)
                .disabled(!model.canStartInstall)
                .accessibilityLabel(isInstalled ? "Reinstall app" : "Install app")
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
            .background(.ultraThinMaterial)
        }
        .navigationBarTitleDisplayMode(.inline)
    }

    // MARK: - Helpers
    private var matchingSourceApp: SourceAppDTO? {
        model.sourceCatalogs
            .flatMap { $0.manifest.apps }
            .first { $0.bundleIdentifier == ipa.bundleId }
    }

    private func infoCell(_ label: String, _ value: String) -> some View {
        VStack(spacing: 2) {
            Text(label)
                .font(.caption2)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.subheadline.bold())
        }
        .frame(maxWidth: .infinity)
    }

    private func formatFileSize(_ bytes: Double) -> String {
        SidelinkFormatting.fileSize(bytes)
    }

    private var screenshotWidth: CGFloat {
        UIDevice.current.userInterfaceIdiom == .pad ? 220 : 140
    }

    private var screenshotHeight: CGFloat {
        UIDevice.current.userInterfaceIdiom == .pad ? 392 : 248
    }

    private func describeEntitlement(_ value: Any?) -> String {
        switch value {
        case let b as Bool: return b ? "true" : "false"
        case let s as String: return s
        case let a as [Any]: return "[\(a.count) items]"
        case let d as [String: Any]: return "{\(d.count) keys}"
        case let n as NSNumber: return n.stringValue
        default: return "–"
        }
    }
}

private struct DetailRow: View {
    let label: String
    let value: String
    let icon: String

    var body: some View {
        HStack {
            Label(label, systemImage: icon)
                .foregroundStyle(.secondary)
            Spacer()
            Text(value)
                .font(.subheadline)
        }
        .padding(.vertical, 4)
    }
}
