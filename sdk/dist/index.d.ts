type EventType = "session_start" | "session_end" | "page_view" | "click" | "scroll" | "tab_switch" | "login_failed";
type InitConfig = {
    apiBaseUrl?: string;
    siteId: string;
    consent?: boolean;
};
declare class ShadowSenseSDK {
    private apiBaseUrl;
    private siteId;
    private consent;
    private sessionId;
    private anonymousId;
    private scrollBucket;
    init(config: InitConfig): void;
    optOut(): void;
    optIn(): void;
    sendEvent(eventType: EventType, eventData: Record<string, unknown>): void;
    private shouldTrack;
}
declare const shadowSense: ShadowSenseSDK;
export { ShadowSenseSDK, shadowSense };
declare global {
    interface Window {
        ShadowSense?: ShadowSenseSDK;
    }
}
