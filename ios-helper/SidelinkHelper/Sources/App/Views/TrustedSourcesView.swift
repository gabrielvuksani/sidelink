import SwiftUI

struct TrustedSourcesView: View {
    @ObservedObject var model: HelperViewModel
    @State private var searchText = ""
    @State private var addingSourceID: String?

    private var filteredSources: [TrustedSourceDTO] {
        model.trustedSources.filter { source in
            guard !searchText.isEmpty else {
                return true
            }

            let query = searchText.lowercased()
            return source.name.lowercased().contains(query)
                || source.url.lowercased().contains(query)
                || (source.description?.lowercased().contains(query) ?? false)
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Curated Sources")
                        .font(.title3.bold())
                    Text("Quickly add established AltStore-compatible feeds without pasting URLs manually.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)

                    HStack(spacing: 10) {
                        statCard(title: "Available", value: "\(model.trustedSources.count)", tint: .slAccent)
                        statCard(title: "Filtered", value: "\(filteredSources.count)", tint: .slAccent2)
                    }
                }
                .sidelinkCard()

                if filteredSources.isEmpty {
                    VStack(spacing: 12) {
                        Image(systemName: "square.stack.3d.up.slash")
                            .font(.system(size: 30))
                            .foregroundStyle(.secondary)
                        Text(searchText.isEmpty ? "No trusted sources available" : "No matching trusted sources")
                            .font(.headline)
                        Text(searchText.isEmpty
                             ? "Refresh to load curated feeds from the desktop server or bundled defaults."
                             : "Try a broader search query.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 28)
                    .sidelinkCard()
                } else {
                    LazyVStack(spacing: 12) {
                        ForEach(filteredSources) { source in
                            VStack(alignment: .leading, spacing: 12) {
                                HStack(alignment: .top, spacing: 12) {
                                    SidelinkAsyncImage(url: source.iconURL, size: 52)

                                    VStack(alignment: .leading, spacing: 6) {
                                        Text(source.name)
                                            .font(.headline)
                                        if let description = source.description, !description.isEmpty {
                                            Text(description)
                                                .font(.footnote)
                                                .foregroundStyle(.secondary)
                                        }
                                    }
                                    Spacer(minLength: 0)
                                }

                                Text(source.url)
                                    .font(.caption.monospaced())
                                    .foregroundStyle(.secondary)
                                    .textSelection(.enabled)

                                Button {
                                    addingSourceID = source.id
                                    Task {
                                        await model.addTrustedSource(source)
                                        addingSourceID = nil
                                    }
                                } label: {
                                    Label(addingSourceID == source.id ? "Adding..." : "Add Source", systemImage: "plus.circle.fill")
                                        .frame(maxWidth: .infinity)
                                }
                                .buttonStyle(.sidelink)
                                .disabled(addingSourceID != nil)
                            }
                            .sidelinkCard()
                        }
                    }
                }
            }
            .padding()
        }
        .navigationTitle("Trusted Sources")
        .searchable(text: $searchText, prompt: "Search trusted sources")
        .refreshable {
            await model.refreshTrustedSources()
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    Task { await model.refreshTrustedSources() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
            }
        }
        .task { await model.refreshTrustedSources() }
    }

    private func statCard(title: String, value: String, tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.headline.bold())
                .foregroundStyle(tint)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(tint.opacity(0.1), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}