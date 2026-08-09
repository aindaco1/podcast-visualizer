import SwiftUI

struct ModelsSection: View {
    let store: AppStore

    var body: some View {
        SectionCard(title: "Models", systemImage: "cpu") {
            Text("Parakeet and alignment weights stay outside the app. Select an existing model directory once; Podcast Visualizer verifies and copies it into persistent app-owned storage. Large model imports can take several minutes.")
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            ForEach(ExternalModel.allCases) { model in
                modelRow(model)
                if model != ExternalModel.allCases.last { Divider() }
            }

            HStack {
                Text(store.modelLibrary.statusMessage)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
                Button("Refresh") { store.refreshModels() }
                    .disabled(store.isRunning)
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
                Text(check?.detail ?? model.purpose)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
            Spacer()
            if check?.ok != true {
                Button("Locate & Import…") { store.chooseModelSource(model) }
                    .disabled(store.isRunning)
                    .accessibilityLabel("Locate and import \(model.title)")
            } else {
                Text("Ready")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.green)
            }
        }
    }
}
