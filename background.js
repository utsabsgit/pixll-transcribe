chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.target && message.target !== "background") return;

    switch (message.type) {
        case "start-recording":
            startCapture(message.tabId, message.recordMic)
                .then(() => sendResponse({ success: true }))
                .catch((error) => {
                    console.error("Capture error:", error);
                    sendResponse({ success: false, error: error.message });
                });
            return true;
        case "stop-recording":
            stopCapture()
                .then(() => sendResponse({ success: true }))
                .catch((error) => sendResponse({ success: false, error: error.message }));
            return true;
    }
});

async function startCapture(tabId, recordMic = false) {
    console.log("Starting capture for tab:", tabId, "with mic:", recordMic);

    try {
        const existingContexts = await chrome.runtime.getContexts({
            contextTypes: ["OFFSCREEN_DOCUMENT"],
        });

        if (existingContexts.length === 0) {
            await chrome.offscreen.createDocument({
                url: "offscreen.html",
                reasons: ["USER_MEDIA"],
                justification: "Recording and transcribing audio from chrome.tabCapture API",
            });
            console.log("Offscreen document created");
        }

        const streamId = await chrome.tabCapture.getMediaStreamId({
            targetTabId: tabId,
        });

        console.log("Stream ID obtained:", streamId);

        chrome.runtime.sendMessage({
            type: "start-recording",
            target: "offscreen",
            data: { streamId, tabId, recordMic },
        });

        console.log("Message sent to offscreen document");
    } catch (error) {
        console.error("Error in startCapture:", error);
        throw error;
    }
}

async function stopCapture() {
    console.log("Stopping capture");
    chrome.runtime.sendMessage({
        type: "stop-recording",
        target: "offscreen",
    });
}
