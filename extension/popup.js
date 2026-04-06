const API_BASE = globalThis.SHADOWSENSE_API_BASE || "http://localhost:5000";

async function refresh() {
    const [liveRes, alertsRes] = await Promise.all([
        fetch(`${API_BASE}/api/live`),
        fetch(`${API_BASE}/api/alerts`),
    ]);

    const liveData = await liveRes.json();
    const alertsData = await alertsRes.json();

    document.getElementById("liveUsers").textContent = String(liveData.liveUsers.length);
    document.getElementById("alerts").textContent = String(alertsData.alerts.length);

    const list = document.getElementById("recentAlerts");
    list.innerHTML = "";
    alertsData.alerts.slice(0, 5).forEach((alert) => {
        const item = document.createElement("li");
        item.textContent = `${alert.type}: ${alert.message}`;
        list.appendChild(item);
    });
}

document.getElementById("refreshButton").addEventListener("click", refresh);

refresh().catch((error) => {
    document.getElementById("recentAlerts").innerHTML = `<li>Failed to load: ${error.message}</li>`;
});
