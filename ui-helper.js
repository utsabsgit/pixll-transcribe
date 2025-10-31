const MEETING_SITES = [
    "meet.google.com",
    "zoom.us",
    "teams.microsoft.com",
    "teams.live.com",
    "webex.com",
    "discord.com",
    "skype.com",
];

function isMeetingSite(url) {
    try {
        const urlObj = new URL(url);
        return MEETING_SITES.some((site) => urlObj.hostname.includes(site));
    } catch {
        return false;
    }
}

function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

async function setStatus(text, message) {
    if (statusDiv) {
        statusDiv.textContent = text;
    }
    document.body.setAttribute("data-status", text.toLowerCase().replace(/ /g, "-"));

    const statusMessageDiv = document.querySelector(".status-message");
    if (statusMessageDiv && message) {
        statusMessageDiv.textContent = message || "";
    }
}

async function setIsRecording(isRecording = false) {
    if (isRecording) {
        if (startBtn) startBtn.disabled = true;
        if (stopBtn) stopBtn.disabled = false;
        setStatus("transcribing");
    } else {
        if (startBtn) startBtn.disabled = false;
        if (stopBtn) stopBtn.disabled = true;
        setStatus("ready");
    }
}

function addLiveTranscription(entry, container) {
    currentSessionData.push(entry);

    if (container.querySelector(".empty-state")) {
        container.innerHTML = "";
    }

    const entryDiv = document.createElement("div");
    entryDiv.className = "transcription-entry";
    entryDiv.innerHTML = `
    <div class="text">${escapeHtml(entry.text)}</div>
    <div class="timestamp">${entry.timestamp}</div>
    `;

    container.appendChild(entryDiv);
    container.scrollTop = container.scrollHeight;
}

async function startTranscription(from = "ui") {
    const liveTranscription = document.getElementById("liveTranscription");
    liveTranscription.innerHTML = '<div class="empty-state">No transcription yet...</div>';

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab) {
        if (statusDiv) {
            statusDiv.textContent = "Error: No active tab";
        }
        return;
    }

    const micToggle = document.getElementById("micToggle");
    const recordMic = micToggle?.checked;

    if (recordMic) {
        const permissionResult = await navigator.permissions.query({ name: "microphone" });

        if (permissionResult.state !== "granted") {
            chrome.windows.create({
                url: chrome.runtime.getURL("microphone-permission.html"),
                type: "popup",
                width: 460,
                height: 420,
            });
            return;
        }
    }

    const response = await chrome.runtime.sendMessage({
        type: "start-recording",
        target: "background",
        tabId: tab.id,
        recordMic: recordMic,
        from: from,
    });

    if (response && response.success) {
        setIsRecording(true);
    }

    return response;
}

async function stopTranscription(from = "ui") {
    const response = await chrome.runtime.sendMessage({
        type: "stop-recording",
        target: "background",
        from: from,
    });

    if (response && response.success) {
        setIsRecording(false);
    }
}

async function requestCurrentSession(from = "ui") {
    const response = await chrome.runtime.sendMessage({
        type: "get-current-session",
        target: "offscreen",
        from: from,
    });

    return response;
}

async function initMicToggle() {
    const micToggle = document.getElementById("micToggle");
    if (!micToggle) return;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (tab && isMeetingSite(tab.url)) {
        micToggle.checked = true;
    } else {
        const result = await chrome.storage.local.get(["micToggleEnabled"]);
        micToggle.checked = result.micToggleEnabled ?? false;
    }

    micToggle.addEventListener("change", () => {
        chrome.storage.local.set({ micToggleEnabled: micToggle.checked });
    });
}
