import SwiftUI

struct VoiceInputBar: View {
    @Binding var textInput: String
    let isStreaming: Bool
    let onSend: (String, _ interrupt: Bool) -> Void

    @Environment(SpeechRecognizer.self) private var speechRecognizer

    @State private var micDragOffset: CGFloat = 0
    @State private var micInterruptMode: Bool = false
    private let interruptThreshold: CGFloat = 40

    var body: some View {
        VStack(spacing: 0) {
            // Live transcription preview
            if speechRecognizer.isRecording && !speechRecognizer.transcript.isEmpty {
                HStack(spacing: 6) {
                    Circle()
                        .fill(micInterruptMode ? .orange : .red)
                        .frame(width: 6, height: 6)
                    Text(speechRecognizer.transcript)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                    Spacer()
                    if micInterruptMode {
                        HStack(spacing: 2) {
                            Image(systemName: "bolt.fill")
                                .font(.caption2)
                            Text("Interrupt")
                                .font(.caption2.weight(.medium))
                        }
                        .foregroundStyle(.orange)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
                .background(.bar)

                Divider()
            }

            // Input bar
            HStack(alignment: .bottom, spacing: 8) {
                // Text field
                TextField("Message...", text: $textInput, axis: .vertical)
                    .lineLimit(1...4)
                    .textFieldStyle(.plain)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(.fill.tertiary, in: RoundedRectangle(cornerRadius: 20))
                    .disabled(isStreaming)

                // Mic button with drag-to-interrupt gesture
                #if os(iOS)
                Image(systemName: speechRecognizer.isRecording ? "mic.fill" : "mic")
                    .font(.body.weight(.medium))
                    .foregroundStyle(
                        speechRecognizer.isRecording
                            ? Color.white
                            : (micInterruptMode ? Color.orange : Color.accentColor)
                    )
                    .frame(width: 36, height: 36)
                    .background(
                        speechRecognizer.isRecording
                            ? (micInterruptMode ? Color.orange : Color.red)
                            : Color.clear,
                        in: Circle()
                    )
                    .scaleEffect(micInterruptMode ? 1.2 : 1.0)
                    .offset(y: micDragOffset)
                    .contentTransition(.symbolEffect(.replace))
                    .animation(.easeOut(duration: 0.15), value: micInterruptMode)
                    .gesture(
                        DragGesture(minimumDistance: 0)
                            .onChanged { value in
                                guard !isStreaming else { return }
                                if speechRecognizer.isRecording {
                                    // While recording, track upward drag for interrupt
                                    micDragOffset = min(0, value.translation.height)
                                    micInterruptMode = -value.translation.height >= interruptThreshold
                                }
                            }
                            .onEnded { value in
                                guard !isStreaming else { return }
                                let draggedUp = -value.translation.height >= interruptThreshold
                                if speechRecognizer.isRecording {
                                    // Stop recording and send with interrupt flag
                                    let finalText = speechRecognizer.stopRecording()
                                    if !finalText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                                        textInput = finalText
                                        let interrupt = draggedUp
                                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
                                            sendMessage(interrupt: interrupt)
                                        }
                                    }
                                } else {
                                    // Tap: start recording
                                    if !speechRecognizer.isAuthorized {
                                        speechRecognizer.requestAuthorization()
                                    } else {
                                        speechRecognizer.startRecording()
                                    }
                                }
                                micDragOffset = 0
                                micInterruptMode = false
                            }
                    )
                    .disabled(isStreaming)
                    .accessibilityLabel(speechRecognizer.isRecording ? "Stop recording" : "Start recording")
                    .accessibilityHint("Drag up while recording to interrupt the agent")
                #endif

                // Send button
                Button {
                    sendMessage()
                } label: {
                    Image(systemName: "paperplane.fill")
                        .font(.body.weight(.medium))
                        .foregroundStyle(.white)
                        .frame(width: 36, height: 36)
                        .background(canSend ? Color.accentColor : Color.gray, in: Circle())
                }
                .buttonStyle(.plain)
                .disabled(!canSend)
                .accessibilityLabel("Send message")
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(.bar)
        }
    }

    private var canSend: Bool {
        !textInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isStreaming
    }

    private func sendMessage(interrupt: Bool = false) {
        let message = textInput.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !message.isEmpty else { return }
        textInput = ""
        onSend(message, interrupt)
    }
}
