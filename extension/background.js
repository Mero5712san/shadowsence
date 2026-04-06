importScripts("config.js");

const API_BASE = globalThis.SHADOWSENSE_API_BASE || "http://localhost:5000";
let lastAlertId = 0;

async function pollAlerts() {
    try {
        const response = await fetch(`${API_BASE}/api/alerts`);
        const data = await response.json();
        const newest = data.alerts?.[0];
        const count = Array.isArray(data.alerts) ? data.alerts.length : 0;

        chrome.action.setBadgeBackgroundColor({ color: "#6e3df2" });
        chrome.action.setBadgeText({ text: count > 0 ? String(Math.min(count, 99)) : "" });

        if (newest && newest.id !== lastAlertId) {
            lastAlertId = newest.id;
        }
    } catch {
        // best-effort polling
    }
}

setInterval(pollAlerts, 10000);
pollAlerts();
