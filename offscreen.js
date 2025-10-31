let audioContext = null;
let mediaStream = null;
let micStream = null;
let mixedStream = null;
let transcriptionSession = null;
let transcriptionActive = false;
let currentTabId = null;
let transcriptionData = [];
let chunkCounter = 0;
let aiStatus = null;
let isInitializing = false;

const MIN_AUDIO_SIZE = 5 * 1024;

function sendStatusToUI(status, message = "") {
    aiStatus = status;
    chrome.runtime
        .sendMessage({
            type: "initialization-status",
            target: "ui",
            data: { status, message },
        })
        .catch((error) => {
            console.log("Could not send status to UI:", error);
        });
}

async function initializeTranscriptionSession() {
    if (isInitializing) {
        console.log("Initialization already in progress, waiting...");
        return false;
    }

    isInitializing = true;

    try {
        if (!("LanguageModel" in self)) {
            console.log("LanguageModel API not available");
            sendStatusToUI("error", "AI model not available in browser");
            isInitializing = false;
            return false;
        }

        const availability = await LanguageModel.availability();
        if (availability === "unavailable") {
            console.log("LanguageModel unavailable");
            sendStatusToUI("error", "AI model unavailable");
            isInitializing = false;
            return false;
        }

        if (availability === "after-download") {
            console.log("Model needs to be downloaded");
            sendStatusToUI("downloading", "Downloading AI model");
        }

        transcriptionSession = await LanguageModel.create({
            systemPrompt: `Act as a silent transcription service. Follow these rules exactly:
1.  **Task:** Transcribe the provided audio.
2.  **Translation:** If the source language is not English, translate the transcription to English.
3.  **Output Format:** Return *only* the final English text.
4.  **Empty Input:** If no audio is provided or no speech is detected, return a single empty string.
5.  **Strict Constraint:** Never output conversational text, apologies, or error messages (e.g., 'Please provide audio'). Your only valid outputs are the English text or an empty string.`,
            expectedInputs: [{ type: "audio" }],
            expectedOutputs: [{ type: "text", languages: ["en"] }],
        });

        sendStatusToUI("ready", "Transcription ready");
        isInitializing = false;
        return true;
    } catch (error) {
        console.error("Error initializing AI transcription:", error);
        sendStatusToUI("error", error.message || "Initialization failed");
        isInitializing = false;
        return false;
    }
}

function isValidTranscription(text) {
    if (!text || text.trim().length === 0) {
        return false;
    }

    if (text.trim().startsWith("<")) {
        console.log("Transcription starts with '<', likely invalid");
        return false;
    }

    const toSkipPhrases = [
        "[Silence]",
        "No speech detected",
        "This audio appears to contain only silence",
        "I am unable to process audio",
        "Please provide me with the audio!",
        "The audio contains a short phrase",
        "Please paste the audio here",
        "Please provide the audio!",
        "audio data is missing",
        "invalid audio data",
        "I'm sorry, I can't transcribe audio",
        "I'm sorry, but there's no audio",
        "I'm sorry, but I am unable to transcribe audio",
        "as a text-based AI",
    ];

    if (toSkipPhrases.some((phrase) => text.includes(phrase))) {
        console.log(`Transcription contains '${phrase}', likely invalid`);
        return false;
    }

    return true;
}

async function generateSummaryAndHeadline(text) {
    try {
        if (!("Summarizer" in self)) {
            console.log("Summarizer API not available");
            return null;
        }

        const availability = await Summarizer.availability();
        if (availability === "unavailable") {
            console.log("Summarizer model unavailable");
            return null;
        }

        console.log("Generating summary and headline...");

        // Create summarizer for key-points (medium length)
        const summarizer = await Summarizer.create({
            type: "key-points",
            format: "plain-text",
            length: "medium",
            sharedContext: "This is a transcription of an audio conversation or meeting.",
            monitor(m) {
                m.addEventListener("downloadprogress", (e) => {
                    console.log(`Summary model downloaded ${e.loaded * 100}%`);
                });
            },
        });

        // Generate key-points summary
        const summary = await summarizer.summarize(text);
        summarizer.destroy();

        // Create summarizer for headline
        const headlineSummarizer = await Summarizer.create({
            type: "headline",
            format: "plain-text",
            length: "short",
            sharedContext: "This is a transcription of an audio conversation or meeting.",
            monitor(m) {
                m.addEventListener("downloadprogress", (e) => {
                    console.log(`Headline model downloaded ${e.loaded * 100}%`);
                });
            },
        });

        // Generate headline
        const headline = await headlineSummarizer.summarize(text);
        headlineSummarizer.destroy();

        return {
            summary: summary.trim(),
            headline: headline.trim(),
        };
    } catch (error) {
        console.error("Error generating summary and headline:", error);
        return null;
    }
}

async function transcribeAudioChunk(audioBlob, chunkIndex) {
    try {
        if (!transcriptionActive) return;

        if (isInitializing) return;

        if (audioBlob.size < MIN_AUDIO_SIZE) {
            console.log(
                `Skipping small audio chunk ${chunkIndex} (${audioBlob.size} bytes) - likely silence`
            );
            return;
        }

        const timestamp = new Date().toLocaleTimeString();

        console.log(
            `Processing audio chunk ${chunkIndex} of ${audioBlob.size} bytes at ${timestamp}`
        );

        if (!transcriptionSession) {
            const initialized = await initializeTranscriptionSession();
            if (!initialized) return;
        }

        const clonedSession = await transcriptionSession.clone();

        let transcriptionText = "";

        try {
            const stream = clonedSession.promptStreaming([
                {
                    role: "user",
                    content: [
                        { type: "text", value: "transcribe this audio" },
                        { type: "audio", value: audioBlob },
                    ],
                },
            ]);

            for await (const chunk of stream) {
                transcriptionText += chunk;
            }

            transcriptionText = transcriptionText.trim();

            if (!isValidTranscription(transcriptionText)) {
                console.log(`Chunk ${chunkIndex} produced invalid transcription, skipping`);
                clonedSession.destroy();
                return;
            }

            console.log(`AI transcription result for chunk ${chunkIndex}:`, transcriptionText);
        } catch (aiError) {
            clonedSession.destroy();
            return;
        }

        clonedSession.destroy();

        const transcriptionEntry = {
            timestamp: timestamp,
            text: transcriptionText,
            tabId: currentTabId,
            chunkIndex: chunkIndex,
        };

        transcriptionData.push(transcriptionEntry);

        chrome.runtime
            .sendMessage({
                type: "new-transcription-entry",
                target: "ui",
                data: transcriptionEntry,
            })
            .catch((error) => {
                console.log("Could not send message to popup:", error);
            });
    } catch (error) {
        console.error(`Error transcribing chunk ${chunkIndex}:`, error);
    }
}

async function mixAudioStreams(tabStream, micStream) {
    audioContext = new AudioContext();

    const tabSource = audioContext.createMediaStreamSource(tabStream);
    const micSource = audioContext.createMediaStreamSource(micStream);

    const tabGain = audioContext.createGain();
    const micGain = audioContext.createGain();

    tabGain.gain.value = 1.0;
    micGain.gain.value = 1.5;

    const destination = audioContext.createMediaStreamDestination();

    tabSource.connect(tabGain);
    micGain.connect(tabGain);
    tabGain.connect(destination);
    micSource.connect(micGain);

    tabSource.connect(audioContext.destination);

    console.log("Audio streams mixed successfully");
    return destination.stream;
}

async function processAudioStream(stream) {
    try {
        const recordAndTranscribe = async () => {
            if (!transcriptionActive) return;

            return new Promise((resolve) => {
                const chunks = [];

                const recorder = new MediaRecorder(stream, {
                    mimeType: "audio/webm; codecs=opus",
                });

                recorder.ondataavailable = (event) => {
                    if (event.data.size > 0) {
                        chunks.push(event.data);
                    }
                };

                recorder.onstop = async () => {
                    console.log(`Recording cycle complete, ${chunks.length} fragments collected`);

                    if (chunks.length > 0) {
                        const completeBlob = new Blob(chunks, { type: "audio/webm; codecs=opus" });
                        console.log(`Combined blob size: ${completeBlob.size} bytes`);

                        await transcribeAudioChunk(completeBlob, chunkCounter++);
                    }

                    resolve();
                };

                recorder.onerror = (event) => {
                    console.error("MediaRecorder error:", event.error);
                    resolve();
                };

                recorder.start();

                setTimeout(() => {
                    if (recorder.state === "recording") {
                        recorder.stop();
                    }
                }, 5000);
            });
        };

        await initializeTranscriptionSession();

        const runRecordingCycle = async () => {
            while (transcriptionActive) {
                if (aiStatus === "error") {
                    console.log("AI error detected, stopping transcription");
                    await stopTranscription();
                    break;
                }

                if (aiStatus === "ready") {
                    await recordAndTranscribe();
                }

                if (transcriptionActive) {
                    await new Promise((resolve) => setTimeout(resolve, 100));
                }
            }
        };

        runRecordingCycle();
        console.log("Audio processing started: 5s cycles with tab + mic audio");
    } catch (error) {
        console.error("Error in processAudioStream:", error);
        transcriptionActive = false;
    }
}

async function stopTranscription() {
    console.log("Offscreen: Stopping recording");
    transcriptionActive = false;
    aiStatus = null;

    if (audioContext) {
        audioContext.close();
        audioContext = null;
    }

    if (mediaStream) {
        mediaStream.getTracks().forEach((track) => track.stop());
        mediaStream = null;
    }

    if (micStream) {
        micStream.getTracks().forEach((track) => track.stop());
        micStream = null;
    }

    if (mixedStream) {
        mixedStream.getTracks().forEach((track) => track.stop());
        mixedStream = null;
    }

    if (transcriptionSession) {
        try {
            await transcriptionSession.destroy();
        } catch (error) {
            console.log("Note: Error destroying base session:", error.message);
        }
        transcriptionSession = null;
    }

    if (transcriptionData.length > 0) {
        const title = "Generating title...";
        const text = transcriptionData.map((entry) => `${entry.text}`).join("\n");

        try {
            const id = await addTranscription(title, text);
            console.log("Transcription saved with ID:", id);

            chrome.runtime
                .sendMessage({
                    type: "new-transcription-saved",
                    target: "ui",
                    id: id,
                })
                .catch((error) => {
                    console.log("Could not send message to popup:", error);
                });

            console.log("Starting summarization process...");
            const summaryResult = await generateSummaryAndHeadline(text);

            if (summaryResult) {
                await updateTranscription(id, {
                    title: summaryResult.headline,
                    summary: summaryResult.summary,
                });

                console.log("Transcription updated with summary and headline");

                chrome.runtime
                    .sendMessage({
                        type: "transcription-summary-complete",
                        target: "ui",
                        data: {
                            id: id,
                            title: summaryResult.headline,
                        },
                    })
                    .catch((error) => {
                        console.log("Could not send summary update to popup:", error);
                    });
            } else {
                console.log("Summary generation failed or unavailable");
            }
        } catch (error) {
            console.error("Error saving transcription:", error);
        }
    }

    transcriptionData = [];
    currentTabId = null;
    chunkCounter = 0;
    console.log("Offscreen: Recording stopped successfully");
}

chrome.runtime.onMessage.addListener(async (message) => {
    if (message.target && message.target !== "offscreen") return;

    switch (message.type) {
        case "start-recording":
            try {
                console.log("Offscreen: Starting recording with stream ID:", message.data.streamId);
                console.log("Offscreen: Record microphone:", message.data.recordMic);

                currentTabId = message.data.tabId;
                transcriptionActive = true;
                chunkCounter = 0;
                initRetryCount = 0; // Reset retry count for new recording

                mediaStream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        mandatory: {
                            chromeMediaSource: "tab",
                            chromeMediaSourceId: message.data.streamId,
                        },
                    },
                    video: false,
                });

                console.log("Offscreen: Successfully captured tab audio stream");

                if (message.data.recordMic) {
                    try {
                        micStream = await navigator.mediaDevices.getUserMedia({
                            audio: {
                                echoCancellation: true,
                                noiseSuppression: true,
                                autoGainControl: true,
                            },
                        });

                        console.log("Offscreen: Successfully captured microphone stream");

                        mixedStream = await mixAudioStreams(mediaStream, micStream);

                        await processAudioStream(mixedStream);
                    } catch (micError) {
                        console.warn(
                            "Could not access microphone, continuing with tab audio only:",
                            micError
                        );

                        audioContext = new AudioContext();
                        const source = audioContext.createMediaStreamSource(mediaStream);
                        source.connect(audioContext.destination);

                        await processAudioStream(mediaStream);
                    }
                } else {
                    console.log("Offscreen: Microphone recording disabled, using tab audio only");
                    audioContext = new AudioContext();
                    const source = audioContext.createMediaStreamSource(mediaStream);
                    source.connect(audioContext.destination);

                    await processAudioStream(mediaStream);
                }
            } catch (error) {
                console.error("Offscreen: Error capturing audio:", error);
                transcriptionActive = false;
            }
            break;
        case "stop-recording":
            await stopTranscription();
            break;
        case "get-current-session":
            console.log("Offscreen: Requesting current session");
            chrome.runtime.sendMessage({
                type: "current-session-data",
                target: message.from,
                data: {
                    active: transcriptionActive,
                    aiStatus: aiStatus,
                    tabId: currentTabId,
                    transcriptions: transcriptionData,
                },
            });
            break;
        default:
            console.log("Offscreen: Unknown message type:", message.type);
            break;
    }
});
