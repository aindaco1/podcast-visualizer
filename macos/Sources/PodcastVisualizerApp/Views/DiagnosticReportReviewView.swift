import SwiftUI

struct DiagnosticReportReviewView: View {
    let review: DiagnosticReportReviewStore
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Review Failure Reports").font(.title2)
            Text("Sending publishes the information below to Podcast Visualizer's GitHub repository through Dust Wave's report service. Similar reports are grouped into one issue. Media, transcripts, file paths, raw logs, and crash stacks are excluded.")
            if !review.enabled {
                Text("Sending is unavailable in this build. Export Diagnostic Log remains available.").foregroundStyle(.secondary)
            }
            ScrollView {
                Text(review.preview).font(.system(.caption, design: .monospaced))
                    .textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                    .padding(12)
            }
            .background(.quaternary.opacity(0.4))
            .accessibilityLabel("Exact report information to be sent")
            if let message = review.message { Text(message).font(.callout) }
            ForEach(review.issueNumbers, id: \.self) { number in
                Link("View issue #\(number)", destination: URL(string: "https://github.com/aindaco1/podcast-visualizer/issues/\(number)")!)
            }
            HStack {
                Button("Close") { dismiss() }.keyboardShortcut(.cancelAction).disabled(review.isBusy)
                Spacer()
                if review.isBusy { ProgressView().controlSize(.small) }
                Button("Send Reviewed Reports") { Task { await review.sendReviewedReports() } }
                    .disabled(!review.enabled || review.isBusy || review.reports.isEmpty)
            }
        }
        .padding(24).frame(width: 680, height: 560)
        .task { await review.load() }
        .interactiveDismissDisabled(review.isBusy)
    }
}
