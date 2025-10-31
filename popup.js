const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const statusDiv = document.getElementById("status");
const currentSection = document.getElementById("currentSection");
const liveTranscription = document.getElementById("liveTranscription");
const savedList = document.getElementById("savedList");
const viewAllBtn = document.getElementById("viewAllBtn");
const toggleSidepanelBtn = document.getElementById("toggleSidepanel");

let currentSessionData = [];

chrome.runtime.onMessage.addListener((message) => {
    if (message.target && message.target !== "ui" && message.target !== "popup") return;

    switch (message.type) {
        case "new-transcription-entry":
            addLiveTranscription(message.data, liveTranscription);
            break;
        case "current-session-data":
            if (message.data && message.data.active && message.data.aiStatus === "ready") {
                setIsRecording(true);
                currentSessionData = message.data.transcriptions || [];
                if (currentSessionData.length > 0) {
                    liveTranscription.innerHTML = "";
                    currentSessionData.forEach((entry) => {
                        addLiveTranscription(entry, liveTranscription);
                    });
                }
            }
            break;
        case "new-transcription-saved":
            load3Transcriptions();
            break;
        case "transcription-summary-complete":
            const id = message.data.id;
            const newTitle = message.data.title;

            if (!id || !newTitle) break;
            const savedItem = savedList.querySelector(`.saved-item[data-id='${id}']`);
            if (savedItem) {
                const titleElement = savedItem.querySelector(".title");
                if (titleElement) {
                    titleElement.textContent = newTitle;
                }
            }
            break;
        case "initialization-status":
            handleInitializationStatus(message.data);
            break;
    }
});

function handleInitializationStatus(data) {
    const { status, message } = data;

    switch (status) {
        case "downloading":
            if (startBtn) startBtn.disabled = true;
            if (stopBtn) stopBtn.disabled = true;
            setStatus(status, message);
            break;
        case "error":
            if (startBtn) startBtn.disabled = false;
            if (stopBtn) stopBtn.disabled = true;
            setStatus(status, message);
            break;
        case "ready":
            if (startBtn) startBtn.disabled = false;
            if (stopBtn) stopBtn.disabled = true;
            setStatus("transcribing");
            break;
    }
}

// Start capture
startBtn.addEventListener("click", async () => {
    try {
        currentSessionData = [];
        await startTranscription("popup");
    } catch (error) {
        console.error("Error starting capture:", error);
    }
});

// Stop capture
stopBtn.addEventListener("click", async () => {
    try {
        const response = await stopTranscription("popup");

        if (response && response.success) {
            setTimeout(() => {
                load3Transcriptions();
            }, 500);
        }
    } catch (error) {
        console.error("Error stopping capture:", error);
    }
});

async function load3Transcriptions() {
    try {
        const transcriptions = await getRecentTranscriptions(3);

        if (transcriptions.length === 0) {
            savedList.innerHTML = '<div class="empty-state">No saved transcriptions</div>';
            return;
        }

        savedList.innerHTML = "";
        transcriptions.forEach((trans) => {
            const item = document.createElement("div");
            item.className = "saved-item";
            item.dataset.id = trans.id;

            const date = new Date(trans.createdAt);
            const preview = trans.text.substring(0, 50) || "Empty transcription";

            item.innerHTML = `
                <h4 class="title">${escapeHtml(trans.title)}</h4>
                <div class="meta">
                    <div class="saved-item-date">${date.toLocaleString()}</div>
                    <div class="btns">
                        <button class="btn-small btn-view" data-id="${trans.id}">View</button>
                        <button class="btn-small btn-delete" data-id="${trans.id}">Delete</button>
                    </div>
                </div>
            `;

            savedList.appendChild(item);
        });

        // Add event listeners to action buttons
        savedList.querySelectorAll(".btn-small").forEach((btn) => {
            btn.addEventListener("click", async (e) => {
                const id = parseInt(e.target.dataset.id);
                const transcription = transcriptions.find((t) => t.id === id);

                if (e.target.classList.contains("btn-view")) {
                    // Open transcriptions page with specific transcription ID to show modal
                    chrome.tabs.create({ url: `transcriptions.html?id=${id}` });
                } else if (e.target.classList.contains("btn-delete")) {
                    if (confirm("Delete this transcription?")) {
                        await deleteTranscriptions([id]);
                        load3Transcriptions();
                    }
                }
            });
        });
    } catch (error) {
        console.error("Error loading saved transcriptions:", error);
        savedList.innerHTML = '<div class="empty-state">Error loading transcriptions</div>';
    }
}

viewAllBtn.addEventListener("click", () => {
    chrome.tabs.create({ url: "transcriptions.html" });
});

// Initialize popup
async function initializePopup() {
    await load3Transcriptions();
    await initMicToggle();
    await requestCurrentSession("popup");
}

toggleSidepanelBtn.addEventListener("click", () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs.length > 0) {
            const tabId = tabs[0].id;
            chrome.sidePanel.open({ tabId });
            window.close();
        }
    });
});

initializePopup();
