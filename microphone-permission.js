document.getElementById("grantBtn").addEventListener("click", async () => {
    const status = document.getElementById("status");
    const grantBtn = document.getElementById("grantBtn");

    grantBtn.disabled = true;
    grantBtn.textContent = "Requesting permission...";

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop());

        status.textContent = "✓ Permission granted! You can close this window.";
        status.className = "show success";
        grantBtn.textContent = "✓ Permission Granted";

        setTimeout(() => window.close(), 2000);
    } catch (error) {
        status.textContent = "⚠ Permission denied. Extension will record tab audio only.";
        status.className = "show error";
        grantBtn.textContent = "Permission Denied";
        grantBtn.disabled = false;
    }
});
