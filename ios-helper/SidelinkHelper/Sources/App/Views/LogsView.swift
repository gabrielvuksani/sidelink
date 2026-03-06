import SwiftUI

struct LogsView: View {
    @ObservedObject var model: HelperViewModel
    @State private var selectedLevel = ""
    @State private var searchText = ""

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
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Helper Activity")
                        .font(.title3.bold())
                    Text("Inspect recent helper events plus in-app activity like source imports, then filter by severity to spot failures quickly.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)

                    HStack(spacing: 10) {
                        summaryPill(title: "Total", value: "\(model.visibleLogs.count)", color: .slAccent)
                        summaryPill(title: "Warn", value: String(count(for: "warn")), color: .slWarning)
                        summaryPill(title: "Errors", value: String(count(for: "error")), color: .slDanger)
                    }
                }
                .sidelinkCard()

                VStack(alignment: .leading, spacing: 12) {
                    Text("Filter")
                        .font(.headline)

                    Picker("Level", selection: $selectedLevel) {
                        Text("All").tag("")
                        Text("Info").tag("info")
                        Text("Warn").tag("warn")
                        Text("Error").tag("error")
                        Text("Debug").tag("debug")
                    }
                    .pickerStyle(.segmented)
                }
                .sidelinkCard()

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
                    .sidelinkCard()
                } else {
                    LazyVStack(spacing: 12) {
                        ForEach(filteredLogs) { entry in
                            VStack(alignment: .leading, spacing: 10) {
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
                            .sidelinkCard()
                        }
                    }
                }
            }
            .padding()
        }
        .navigationTitle("Logs")
        .searchable(text: $searchText, prompt: "Search logs")
        .refreshable {
            await model.loadHelperLogs(level: selectedLevel.isEmpty ? nil : selectedLevel)
        }
        .toolbar {
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

    private func summaryPill(title: String, value: String, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.headline.bold())
                .foregroundStyle(color)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(color.opacity(0.1), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
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