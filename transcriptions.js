const transcriptionList = document.getElementById("transcriptionList");
const searchBox = document.getElementById("searchBox");
const clearAllBtn = document.getElementById("clearAllBtn");
const transcriptionModal = document.getElementById("transcriptionModal");
const modalTitle = document.getElementById("modalTitle");
const modalBody = document.getElementById("modalBody");
const closeModal = document.getElementById("closeModal");
const closeModalBtn = document.getElementById("closeModalBtn");
const downloadModalBtn = document.getElementById("downloadModalBtn");

let allTranscriptions = [];
let currentModalTranscription = null;

chrome.runtime.onMessage.addListener((message) => {
    if (message.target && message.target !== "ui" && message.target !== "transcriptions") return;

    switch (message.type) {
        case "new-transcription-saved":
            loadTranscriptions();
            break;
        case "transcription-summary-complete":
            const id = message.data.id;
            const newTitle = message.data.title;
            const transcription = allTranscriptions.find((t) => t.id === id);
            if (transcription) {
                transcription.title = newTitle;
                renderTranscriptions(allTranscriptions);
            }

            if (currentModalTranscription && currentModalTranscription.id === id) {
                closeModalFunc();
                openModal(transcription);
            }
            break;
    }
});

// Load all transcriptions
async function loadTranscriptions() {
    allTranscriptions = await getAllTranscriptions();
    renderTranscriptions(allTranscriptions);

    // Check if we need to open a specific transcription from URL
    const urlParams = new URLSearchParams(window.location.search);
    const transcriptionId = urlParams.get("id");
    if (transcriptionId) {
        const id = parseInt(transcriptionId);
        const transcription = allTranscriptions.find((t) => t.id === id);
        if (transcription) {
            openModal(transcription);
        }
    }
}

// Render transcriptions
function renderTranscriptions(transcriptions) {
    if (transcriptions.length === 0) {
        transcriptionList.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📝</div>
                <div>No transcriptions found</div>
            </div>
        `;
        return;
    }

    transcriptionList.innerHTML = "";

    transcriptions.forEach((trans, index) => {
        const date = new Date(trans.createdAt);
        const card = document.createElement("div");
        card.className = "transcription-card";
        card.dataset.id = trans.id;

        card.innerHTML = `
            <div class="card-header">
                <div>
                    <div class="card-title">${escapeHtml(trans.title)}</div>
                    <div class="card-meta">${date.toLocaleString()}</div>
                </div>
            </div>
            <div class="card-actions">
                <button class="btn-small btn-view-trans" data-id="${trans.id}">View</button>
                <button class="btn-small btn-download-trans" data-id="${trans.id}">Download</button>
                <button class="btn-small btn-red btn-delete-trans" data-id="${
                    trans.id
                }">Delete</button>
            </div>
        `;

        transcriptionList.appendChild(card);

        // Add event listeners to buttons
        const viewBtn = card.querySelector(".btn-view-trans");
        const downloadBtn = card.querySelector(".btn-download-trans");
        const deleteBtn = card.querySelector(".btn-delete-trans");

        viewBtn.addEventListener("click", () => viewTranscription(trans.id));
        downloadBtn.addEventListener("click", () => downloadTranscription(trans.id));
        deleteBtn.addEventListener("click", () => deleteTranscription(trans.id));
    });
}

// Open modal to view transcription
function viewTranscription(id) {
    const trans = allTranscriptions.find((t) => t.id === id);
    if (!trans) return;
    openModal(trans);
}

// Open modal with transcription content
function openModal(transcription) {
    currentModalTranscription = transcription;
    modalTitle.textContent = transcription.title;

    // convert markdown to HTML list
    let summaryHtml = "";

    if (transcription.summary) {
        summaryHtml = transcription.summary
            .split("\n")
            .map((line) => `<li>${escapeHtml(line.replace(/^\* /, ""))}</li>`)
            .join("");
    }

    modalBody.innerHTML = `
    <h3 class="entry-header">Key Points</h3>
    <ul class="entry-list">${summaryHtml || "No summary available."}</ul>
    <h3 class="entry-header">Full Transcription</h3>
    <p class="entry-text">${transcription.text}</p>`;
    transcriptionModal.classList.add("show");
}

// Close modal
function closeModalFunc() {
    transcriptionModal.classList.remove("show");
    currentModalTranscription = null;
    modalTitle.textContent = "";
    modalBody.innerHTML = "";
    const url = new URL(window.location);
    url.searchParams.delete("id");
    window.history.replaceState({}, document.title, url.toString());
}

closeModal.addEventListener("click", closeModalFunc);
closeModalBtn.addEventListener("click", closeModalFunc);

// Close modal when clicking outside
transcriptionModal.addEventListener("click", (e) => {
    if (e.target === transcriptionModal) {
        closeModalFunc();
    }
});

// Download from modal
downloadModalBtn.addEventListener("click", () => {
    if (currentModalTranscription) {
        downloadTranscription(currentModalTranscription.id);
    }
});

// Download transcription
function downloadTranscription(id) {
    const trans = allTranscriptions.find((t) => t.id === id);
    if (!trans) return;

    const date = new Date(trans.createdAt);
    let text = `${trans.title}\n`;
    text += `Date: ${date.toLocaleString()}\n\n`;
    if (trans.summary) {
        text += "Summary:\n";
        text += trans.summary + "\n\n";
    }
    text += "Transcription:\n";
    text += trans.text;

    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);

    const sanitizedTitle = trans.title
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, "") // Remove invalid filename characters
        .replace(/\s+/g, "-") // Replace spaces with hyphens
        .replace(/[^\w\-]/g, "_") // Replace remaining special chars with underscores
        .replace(/[-_]+/g, (match) => match[0]) // Replace consecutive hyphens or underscores with single one
        .substring(0, 40);

    const filename = `${sanitizedTitle}.txt`;

    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();

    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 100);
}

// Delete transcription
async function deleteTranscription(id) {
    if (!confirm("Are you sure you want to delete this transcription?")) {
        return;
    }

    try {
        await deleteTranscriptions([id]);

        // Close modal if it's open
        if (transcriptionModal.classList.contains("show")) {
            closeModalFunc();
        }

        // Reload the list
        await loadTranscriptions();
    } catch (error) {
        console.error("Error deleting transcription:", error);
        alert("Failed to delete transcription. Please try again.");
    }
}

// Clear all transcriptions
clearAllBtn.addEventListener("click", async () => {
    if (!confirm("Are you sure you want to delete ALL transcriptions? This cannot be undone.")) {
        return;
    }

    try {
        const allIds = allTranscriptions.map((t) => t.id);
        await deleteTranscriptions(allIds);

        // Close modal if it's open
        if (transcriptionModal.classList.contains("show")) {
            closeModalFunc();
        }

        // Reload the list
        await loadTranscriptions();
    } catch (error) {
        console.error("Error deleting all transcriptions:", error);
        alert("Failed to delete transcriptions. Please try again.");
    }
});

// Search functionality
searchBox.addEventListener("input", (e) => {
    const query = e.target.value.toLowerCase();

    if (!query) {
        renderTranscriptions(allTranscriptions);
        return;
    }

    const filtered = allTranscriptions.filter((trans) => {
        // Search in both title and text content
        return (
            trans.title.toLowerCase().includes(query) || trans.summary.toLowerCase().includes(query)
        );
    });

    renderTranscriptions(filtered);
});

// Escape HTML
function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

// Initialize
loadTranscriptions();
