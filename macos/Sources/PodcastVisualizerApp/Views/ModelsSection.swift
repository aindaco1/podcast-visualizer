import SwiftUI

struct ModelsSection: View {
    let store: AppStore

    var body: some View {
        SectionCard(title: "Models", systemImage: "cpu") {
            Text("Podcast Visualizer automatically checks its private model store and Downloads. Missing models can be downloaded from pinned sources or imported from an existing copy.")
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            ForEach(ExternalModel.allCases) { model in
                modelRow(model)
                if model != ExternalModel.allCases.last { Divider() }
            }

            if store.isManagingModels {
                OperationProgressView(store: store)
            }

            HStack {
                Text(store.modelLibrary.statusMessage)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
                if store.isManagingModels {
                    Button("Cancel", role: .cancel) { store.cancel() }
                } else {
                    Button("Refresh") { store.refreshModels() }
                        .disabled(store.isRunning)
                }
            }
        }
    }

    @ViewBuilder
    private func modelRow(_ model: ExternalModel) -> some View {
        let check = store.modelLibrary.check(for: model)
        HStack(alignment: .center, spacing: 12) {
            Image(systemName: check?.ok == true ? "checkmark.circle.fill" : "exclamationmark.circle")
                .foregroundStyle(check?.ok == true ? .green : .orange)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text(model.title).font(.subheadline.weight(.semibold))
                Text(check?.ok == true ? (check?.detail ?? model.purpose) : "Not installed — download it or import an existing copy.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                if check?.ok != true {
                    HStack(spacing: 5) {
                        Text("\(ByteCountFormatter.string(fromByteCount: model.downloadBytes, countStyle: .file)) · \(model.license)")
                        Text("·")
                        Link(model.publisher, destination: model.sourcePage)
                    }
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
                }
            }
            Spacer()
            if check?.ok != true {
                HStack(spacing: 8) {
                    Button("Import Existing…") { store.chooseModelSource(model) }
                        .accessibilityLabel("Import an existing \(model.title) model")
                    Button("Download") { store.confirmModelDownload(model) }
                        .buttonStyle(.borderedProminent)
                        .accessibilityLabel("Download \(model.title)")
                }
                .disabled(store.isRunning)
            } else {
                Text("Ready")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.green)
            }
        }
    }

}
