import SwiftUI

struct SourceSection: View {
    let store: AppStore

    var body: some View {
        SectionCard(title: "Source", systemImage: "waveform") {
            LabeledContent("Media") {
                HStack {
                    Text(store.state.sourceURL?.lastPathComponent ?? "No source selected")
                        .foregroundStyle(store.state.sourceURL == nil ? .secondary : .primary)
                        .lineLimit(1)
                    Button("Choose…") { store.chooseSource() }
                        .disabled(store.isRunning)
                }
            }
            LabeledContent("Project") {
                HStack {
                    Text(store.projectSelection?.path(percentEncoded: false) ?? "Choose a new project directory")
                        .foregroundStyle(store.projectSelection == nil ? .secondary : .primary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                    Button("Choose…") { store.chooseProjectLocation() }
                        .disabled(store.isRunning)
                }
            }
            Toggle("Use the full file", isOn: Bindable(store).useFullFile)
                .disabled(store.state.mediaProbe == nil || store.isRunning)
            if !store.useFullFile {
                HStack {
                    TextField("Start", value: Bindable(store).clipStartSeconds, format: .number.precision(.fractionLength(3)))
                        .frame(width: 110)
                    Text("seconds to")
                    TextField("End", value: Bindable(store).clipEndSeconds, format: .number.precision(.fractionLength(3)))
                        .frame(width: 110)
                    Text("seconds")
                }
                .accessibilityElement(children: .contain)
            }
        }
    }
}
