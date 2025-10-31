const db = new Dexie("PDTranscriptionDB");

db.version(1).stores({
    transcriptions: "++id,title,text,createdAt,summary",
});

async function addTranscription(title = "", text = "", summary = "") {
    const id = await db.transcriptions.add({
        title,
        text,
        summary,
        createdAt: new Date().toISOString(),
    });
    return id;
}

async function updateTranscription(id, updates) {
    await db.transcriptions.update(id, updates);
}

async function getRecentTranscriptions(limit = 3) {
    return await db.transcriptions.orderBy("createdAt").reverse().limit(limit).toArray();
}

async function getAllTranscriptions() {
    return await db.transcriptions.orderBy("createdAt").reverse().toArray();
}

async function deleteTranscriptions(ids) {
    await db.transcriptions.bulkDelete(ids);
}
