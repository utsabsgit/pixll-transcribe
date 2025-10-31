const stopBtn = document.getElementById("stopBtn");
const viewBtn = document.getElementById("viewBtn");
const liveTranscription = document.getElementById("liveTranscription");
let currentSessionData = [];
let savedTranscriptionId = null;

chrome.runtime.onMessage.addListener((message) => {
    if (message.target && message.target !== "ui" && message.target !== "sidepanel") return;

    switch (message.type) {
        case "new-transcription-entry":
            addLiveTranscription(message.data, liveTranscription);
            break;
        case "current-session-data":
            currentSessionData = message.data.transcriptions || [];
            stopBtn.classList.remove("hidden");
            if (currentSessionData.length > 0) {
                liveTranscription.innerHTML = "";
                currentSessionData.forEach((entry) => {
                    addLiveTranscription(entry, liveTranscription);
                });
            }
            break;
        case "new-transcription-saved":
            savedTranscriptionId = message.id;
            viewBtn.classList.remove("hidden");
            stopBtn.classList.add("hidden");
            break;
    }
});

stopBtn.addEventListener("click", async () => {
    try {
        await stopTranscription("sidepanel");
    } catch (error) {
        console.error("Error stopping capture:", error);
    }
});

viewBtn.addEventListener("click", () => {
    if (savedTranscriptionId) {
        chrome.tabs.create({ url: `transcriptions.html?id=${savedTranscriptionId}` });
        window.close();
    }
});

async function initializeSidepanel() {
    await requestCurrentSession("sidepanel");
}

initializeSidepanel();
