const SESSION_KEY = "shadowsense_session_id";
const ANON_KEY = "shadowsense_anon_id";
const OPT_OUT_KEY = "shadowsense_opt_out";
const API_URL = "http://localhost:5000/api/events";
function uid(prefix) {
    return `${prefix}_${crypto.randomUUID()}`;
}
function browserName(userAgent) {
    if (userAgent.includes("Edg"))
        return "Edge";
    if (userAgent.includes("Chrome"))
        return "Chrome";
    if (userAgent.includes("Safari"))
        return "Safari";
    if (userAgent.includes("Firefox"))
        return "Firefox";
    return "Unknown";
}
class ShadowSenseSDK {
    constructor() {
        this.apiBaseUrl = "";
        this.siteId = "";
        this.consent = false;
        this.sessionId = "";
        this.anonymousId = "";
        this.scrollBucket = 0;
    }
    init(config) {
        var _a, _b, _c;
        this.apiBaseUrl = (_a = config.apiBaseUrl) !== null && _a !== void 0 ? _a : "http://localhost:5000";
        this.siteId = config.siteId;
        this.consent = Boolean(config.consent);
        this.sessionId = (_b = localStorage.getItem(SESSION_KEY)) !== null && _b !== void 0 ? _b : uid("ssn");
        this.anonymousId = (_c = localStorage.getItem(ANON_KEY)) !== null && _c !== void 0 ? _c : uid("anon");
        localStorage.setItem(SESSION_KEY, this.sessionId);
        localStorage.setItem(ANON_KEY, this.anonymousId);
        if (!this.shouldTrack()) {
            return;
        }
        this.sendEvent("session_start", { siteId: this.siteId });
        this.sendEvent("page_view", { href: location.href, title: document.title });
        document.addEventListener("click", (event) => {
            const target = event.target;
            this.sendEvent("click", {
                tag: target === null || target === void 0 ? void 0 : target.tagName,
                id: target === null || target === void 0 ? void 0 : target.id,
                className: target === null || target === void 0 ? void 0 : target.className,
            });
        });
        window.addEventListener("scroll", () => {
            const scrollHeight = document.documentElement.scrollHeight - window.innerHeight;
            if (scrollHeight <= 0) {
                return;
            }
            const depth = Math.round((window.scrollY / scrollHeight) * 100);
            const bucket = Math.floor(depth / 25);
            if (bucket !== this.scrollBucket) {
                this.scrollBucket = bucket;
                this.sendEvent("scroll", { depth });
            }
        });
        document.addEventListener("visibilitychange", () => {
            this.sendEvent("tab_switch", { state: document.visibilityState });
        });
        window.addEventListener("beforeunload", () => {
            this.sendEvent("session_end", { reason: "unload" });
        });
    }
    optOut() {
        localStorage.setItem(OPT_OUT_KEY, "1");
    }
    optIn() {
        localStorage.removeItem(OPT_OUT_KEY);
    }
    sendEvent(eventType, eventData) {
        var _a;
        if (!this.shouldTrack()) {
            return;
        }
        const payload = {
            sessionId: this.sessionId,
            anonymousId: this.anonymousId,
            eventType,
            eventData,
            metadata: {
                page: location.pathname,
                device: /Mobi|Android/i.test(navigator.userAgent) ? "mobile" : "desktop",
                browser: browserName(navigator.userAgent),
            },
        };
        const url = this.apiBaseUrl ? `${this.apiBaseUrl.replace(/\/$/, "")}/api/events` : API_URL;
        (_a = navigator.sendBeacon) === null || _a === void 0 ? void 0 : _a.call(navigator, url, JSON.stringify(payload));
        fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            keepalive: true,
        }).catch(() => {
            // no-op for best-effort client telemetry
        });
    }
    shouldTrack() {
        if (!this.consent) {
            return false;
        }
        return localStorage.getItem(OPT_OUT_KEY) !== "1";
    }
}
const shadowSense = new ShadowSenseSDK();
export { ShadowSenseSDK, shadowSense };
window.ShadowSense = shadowSense;
