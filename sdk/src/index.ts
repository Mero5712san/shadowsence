type EventType =
    | "session_start"
    | "session_end"
    | "page_view"
    | "click"
    | "scroll"
    | "tab_switch"
    | "login_failed";

type InitConfig = {
    apiBaseUrl?: string;
    siteId: string;
    consent?: boolean;
};

type Payload = {
    sessionId: string;
    anonymousId: string;
    eventType: EventType;
    eventData: Record<string, unknown>;
    metadata: {
        page: string;
        device: string;
        browser: string;
    };
};

const SESSION_KEY = "shadowsense_session_id";
const ANON_KEY = "shadowsense_anon_id";
const OPT_OUT_KEY = "shadowsense_opt_out";
const API_URL = "http://localhost:5000/api/events";

function uid(prefix: string) {
    return `${prefix}_${crypto.randomUUID()}`;
}

function browserName(userAgent: string) {
    if (userAgent.includes("Edg")) return "Edge";
    if (userAgent.includes("Chrome")) return "Chrome";
    if (userAgent.includes("Safari")) return "Safari";
    if (userAgent.includes("Firefox")) return "Firefox";
    return "Unknown";
}

class ShadowSenseSDK {
    private apiBaseUrl = "";
    private siteId = "";
    private consent = false;
    private sessionId = "";
    private anonymousId = "";
    private scrollBucket = 0;

    init(config: InitConfig) {
        this.apiBaseUrl = config.apiBaseUrl ?? "http://localhost:5000";
        this.siteId = config.siteId;
        this.consent = Boolean(config.consent);

        this.sessionId = localStorage.getItem(SESSION_KEY) ?? uid("ssn");
        this.anonymousId = localStorage.getItem(ANON_KEY) ?? uid("anon");

        localStorage.setItem(SESSION_KEY, this.sessionId);
        localStorage.setItem(ANON_KEY, this.anonymousId);

        if (!this.shouldTrack()) {
            return;
        }

        this.sendEvent("session_start", { siteId: this.siteId });
        this.sendEvent("page_view", { href: location.href, title: document.title });

        document.addEventListener("click", (event) => {
            const target = event.target as HTMLElement | null;
            this.sendEvent("click", {
                tag: target?.tagName,
                id: target?.id,
                className: target?.className,
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

    sendEvent(eventType: EventType, eventData: Record<string, unknown>) {
        if (!this.shouldTrack()) {
            return;
        }

        const payload: Payload = {
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
        navigator.sendBeacon?.(url, JSON.stringify(payload));

        fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            keepalive: true,
        }).catch(() => {
            // no-op for best-effort client telemetry
        });
    }

    private shouldTrack() {
        if (!this.consent) {
            return false;
        }

        return localStorage.getItem(OPT_OUT_KEY) !== "1";
    }
}

const shadowSense = new ShadowSenseSDK();

export { ShadowSenseSDK, shadowSense };

declare global {
    interface Window {
        ShadowSense?: ShadowSenseSDK;
    }
}

window.ShadowSense = shadowSense;
