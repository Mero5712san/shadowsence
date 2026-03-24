(() => {
    const API_URL = "http://localhost:5000/api/events";
    const SESSION_KEY = "shadowsense_ext_session_id";
    const ANON_KEY = "shadowsense_ext_anon_id";

    function uid(prefix) {
        return `${prefix}_${crypto.randomUUID()}`;
    }

    function browserName(userAgent) {
        if (userAgent.includes("Edg")) return "Edge";
        if (userAgent.includes("Chrome")) return "Chrome";
        if (userAgent.includes("Safari")) return "Safari";
        if (userAgent.includes("Firefox")) return "Firefox";
        return "Unknown";
    }

    const sessionId = localStorage.getItem(SESSION_KEY) || uid("ssn");
    const anonymousId = localStorage.getItem(ANON_KEY) || uid("anon");
    localStorage.setItem(SESSION_KEY, sessionId);
    localStorage.setItem(ANON_KEY, anonymousId);

    function sendEvent(eventType, eventData) {
        chrome.storage.local.get("tracking", (res) => {
            if (res.tracking === false) {
                return;
            }

            const payload = {
                sessionId,
                anonymousId,
                eventType,
                eventData,
                metadata: {
                    page: location.pathname,
                    device: /Mobi|Android/i.test(navigator.userAgent) ? "mobile" : "desktop",
                    browser: browserName(navigator.userAgent),
                },
            };

            navigator.sendBeacon?.(API_URL, JSON.stringify(payload));
            fetch(API_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
                keepalive: true,
            }).catch(() => {
                // best-effort telemetry
            });
        });
    }

    console.log("ShadowSense SDK loaded");

    sendEvent("session_start", { source: "extension" });
    sendEvent("page_view", { href: location.href, title: document.title });

    document.addEventListener("click", (event) => {
        const target = event.target;
        sendEvent("click", {
            tag: target?.tagName,
            id: target?.id,
            className: target?.className,
        });
    });

    document.addEventListener("visibilitychange", () => {
        sendEvent("tab_switch", { state: document.visibilityState });
    });

    let scrollBucket = 0;
    window.addEventListener("scroll", () => {
        const scrollHeight = document.documentElement.scrollHeight - window.innerHeight;
        if (scrollHeight <= 0) return;

        const depth = Math.round((window.scrollY / scrollHeight) * 100);
        const bucket = Math.floor(depth / 25);
        if (bucket !== scrollBucket) {
            scrollBucket = bucket;
            sendEvent("scroll", { depth });
        }
    });

    window.addEventListener("beforeunload", () => {
        sendEvent("session_end", { reason: "unload" });
    });
})();
