import SwiftUI

struct LogsView: View {
    @ObservedObject var model: HelperViewModel
    @State private var selectedLevel = ""
    @State private var searchText = ""

    private var levelLabel: String {
        selectedLevel.isEmpty ? "All Levels" : selectedLevel.capitalized
    }

    private var filteredLogs: [HelperLogEntryDTO] {
        model.visibleLogs.filter { entry in
            guard !searchText.isEmpty else {
                return true
            }

            let query = searchText.lowercased()
            return entry.message.lowercased().contains(query)
                || entry.code.lowercased().contains(query)
                || entry.level.lowercased().contains(query)
        }
    }

    var body: some View {
        ZStack {
            SidelinkBackdrop(accent: .slAccent)
                .ignoresSafeArea()

            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    VStack(alignment: .leading, spacing: 18) {
                        SidelinkSectionIntro(
                            eyebrow: "Diagnostics",
                            title: "Helper activity",
                            subtitle: "Inspect recent helper events plus in-app activity like source imports, then filter by severity to spot failures quickly."
                        )

                        HStack(spacing: 12) {
                            SidelinkMetricTile(label: "Total", value: "\(model.visibleLogs.count)")
                            SidelinkMetricTile(label: "Warn", value: String(count(for: "warn")), tint: .slWarning)
                            SidelinkMetricTile(label: "Errors", value: String(count(for: "error")), tint: .slDanger)
                        }
                    }
                    .liquidPanel()

                    VStack(alignment: .leading, spacing: 14) {
                        SidelinkSectionIntro(
                            eyebrow: "Filter",
                            title: levelLabel,
                            subtitle: "Change the helper log severity without leaving the screen."
                        )

                        Picker("Level", selection: $selectedLevel) {
                            Text("All").tag("")
                            Text("Info").tag("info")
                            Text("Warn").tag("warn")
                            Text("Error").tag("error")
                            Text("Debug").tag("debug")
                        }
                        .pickerStyle(.segmented)
                    }
                    .liquidPanel()

                    if filteredLogs.isEmpty {
                        VStack(spacing: 12) {
                            Image(systemName: "text.magnifyingglass")
                                .font(.system(size: 30))
                                .foregroundStyle(.secondary)
                            Text(searchText.isEmpty ? "No logs yet" : "No matching logs")
                                .font(.headline)
                            Text(searchText.isEmpty
                                 ? "Run a helper action or refresh to populate recent events."
                                 : "Try a broader search or switch the severity filter.")
                                .font(.subheadline)
                                .multilineTextAlignment(.center)
                                .foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 28)
                        .liquidPanel()
                    } else {
                        LazyVStack(spacing: 12) {
                            ForEach(filteredLogs) { entry in
                                VStack(alignment: .leading, spacing: 12) {
                                    HStack(alignment: .top) {
                                        PillBadge(text: entry.level.uppercased(), color: color(for: entry.level), small: true)
                                        Spacer()
                                        Text(relativeDate(entry.at))
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }

                                    Text(entry.message)
                                        .font(.subheadline)
                                        .foregroundStyle(.primary)

                                    HStack(spacing: 8) {
                                        Image(systemName: icon(for: entry.level))
                                            .foregroundStyle(color(for: entry.level))
                                        Text(entry.code)
                                            .font(.caption.monospaced())
                                            .foregroundStyle(.secondary)
                                    }
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .liquidPanel()
                            }
                        }
                    }
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 20)
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $searchText, prompt: "Search logs")
        .refreshable {
            await model.loadHelperLogs(level: selectedLevel.isEmpty ? nil : selectedLevel)
        }
        .toolbar {
            ToolbarItem(placement: .principal) {
                Text("Logs")
                    .font(.headline.weight(.semibold))
            }
            ToolbarItem(placement: .primaryAction) {
                Button {
                    Task {
                        await model.loadHelperLogs(level: selectedLevel.isEmpty ? nil : selectedLevel)
                    }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
            }
        }
        .task { await model.loadHelperLogs() }
        .onChange(of: selectedLevel) { newValue in
            Task { await model.loadHelperLogs(level: newValue.isEmpty ? nil : newValue) }
        }
    }

    private func count(for level: String) -> Int {
        model.visibleLogs.filter { $0.level == level }.count
    }

    private func color(for level: String) -> Color {
        switch level {
        case "warn": return .slWarning
        case "error": return .slDanger
        case "debug": return .slMuted
        default: return .slAccent
        }
    }

    private func icon(for level: String) -> String {
        switch level {
        case "warn": return "exclamationmark.triangle.fill"
        case "error": return "xmark.octagon.fill"
        case "debug": return "ladybug.fill"
        default: return "info.circle.fill"
        }
    }

    private func relativeDate(_ iso: String) -> String {
        SidelinkDateFormatting.relativeDate(iso)
    }
}