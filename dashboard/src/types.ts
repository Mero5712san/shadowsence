export type DashboardSummary = {
    totalUsers: number;
    activeUsers: number;
    totalEvents: number;
};

export type DashboardEvent = {
    id: number;
    sessionId: string;
    eventType: string;
    eventData: Record<string, unknown>;
    page: string | null;
    timestamp: string;
};

export type LiveUser = {
    sessionId: string;
    currentPage: string | null;
    ipAddress: string | null;
    browser: string | null;
    device: string | null;
    lastSeenAt: string;
};

export type AlertItem = {
    id: number;
    sessionId: string;
    type: string;
    message: string;
    createdAt: string;
};

export type DashboardSnapshot = {
    summary: DashboardSummary;
    recentEvents: DashboardEvent[];
    liveUsers: LiveUser[];
    alerts: AlertItem[];
};
