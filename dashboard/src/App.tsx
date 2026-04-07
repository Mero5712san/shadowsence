import { CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { io, Socket } from "socket.io-client";
import { AlertItem, DashboardEvent, DashboardSnapshot, DashboardSummary, LiveUser } from "./types";

const API_BASE = import.meta.env.VITE_API_BASE ?? "https://shadowsence.onrender.com";
const CHART_POINTS = 10;

const EMPTY_SUMMARY: DashboardSummary = {
    totalUsers: 0,
    activeUsers: 0,
    totalEvents: 0,
};

function asArray<T>(value: unknown): T[] {
    return Array.isArray(value) ? (value as T[]) : [];
}

function asSummary(value: unknown): DashboardSummary {
    if (!value || typeof value !== "object") {
        return EMPTY_SUMMARY;
    }

    const data = value as Partial<DashboardSummary>;
    return {
        totalUsers: typeof data.totalUsers === "number" ? data.totalUsers : 0,
        activeUsers: typeof data.activeUsers === "number" ? data.activeUsers : 0,
        totalEvents: typeof data.totalEvents === "number" ? data.totalEvents : 0,
    };
}

function clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
}

function toFixedLength(values: number[], targetLength = CHART_POINTS) {
    if (values.length === 0) {
        return Array(targetLength).fill(0);
    }

    if (values.length === targetLength) {
        return values;
    }

    if (values.length < targetLength) {
        const filled = [...values];
        while (filled.length < targetLength) {
            filled.push(filled[filled.length - 1]);
        }
        return filled;
    }

    const step = values.length / targetLength;
    return Array.from({ length: targetLength }, (_v, i) => {
        const start = Math.floor(i * step);
        const end = Math.max(start + 1, Math.floor((i + 1) * step));
        const slice = values.slice(start, end);
        const total = slice.reduce((sum, item) => sum + item, 0);
        return total / slice.length;
    });
}

function normalizeSeries(values: number[], targetLength = CHART_POINTS) {
    const fixed = toFixedLength(values, targetLength);
    const maxValue = Math.max(...fixed);
    const minValue = Math.min(...fixed);

    if (maxValue === minValue) {
        const midpoint = clamp(maxValue + 10, 10, 40);
        return fixed.map(() => midpoint);
    }

    return fixed.map((value) => {
        const ratio = (value - minValue) / (maxValue - minValue);
        return 8 + ratio * 44;
    });
}

function bucketizeByTime(timestamps: string[], bucketCount = CHART_POINTS, windowMs = 10 * 60_000) {
    const now = Date.now();
    const start = now - windowMs;
    const bucketSize = windowMs / bucketCount;
    const buckets = Array(bucketCount).fill(0);

    for (const stamp of timestamps) {
        const time = new Date(stamp).getTime();
        if (Number.isNaN(time) || time < start || time > now) {
            continue;
        }
        const index = Math.min(bucketCount - 1, Math.floor((time - start) / bucketSize));
        buckets[index] += 1;
    }

    return buckets;
}

function severityScore(alertType: string) {
    const value = alertType.toLowerCase();
    if (value.includes("bruteforce") || value.includes("bot")) return 95;
    if (value.includes("multiple") || value.includes("suspicious")) return 75;
    return 55;
}

export function App() {
    const location = useLocation();
    const [themeMode, setThemeMode] = useState<"dark" | "light">(() => {
        if (typeof window === "undefined") {
            return "dark";
        }
        const saved = window.localStorage.getItem("shadowsense-theme");
        if (saved === "light" || saved === "dark") {
            return saved;
        }
        return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    });
    const [summary, setSummary] = useState<DashboardSummary>(EMPTY_SUMMARY);
    const [events, setEvents] = useState<DashboardEvent[]>([]);
    const [liveUsers, setLiveUsers] = useState<LiveUser[]>([]);
    const [alerts, setAlerts] = useState<AlertItem[]>([]);
    const [backendError, setBackendError] = useState<string | null>(null);

    const eventMix = useMemo(() => {
        const counts: Record<string, number> = {};
        for (const event of events) {
            counts[event.eventType] = (counts[event.eventType] ?? 0) + 1;
        }
        return Object.entries(counts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);
    }, [events]);

    const riskScore = useMemo(() => {
        return Math.min(100, Math.round(summary.activeUsers * 2 + alerts.length * 7 + eventMix.length * 4));
    }, [alerts.length, eventMix.length, summary.activeUsers]);

    const scoreStyle = {
        "--score": `${riskScore}`,
    } as CSSProperties;

    const applySnapshot = useCallback((snapshot: DashboardSnapshot) => {
        setSummary(asSummary(snapshot.summary));
        setEvents(asArray<DashboardEvent>(snapshot.recentEvents));
        setLiveUsers(asArray<LiveUser>(snapshot.liveUsers));
        setAlerts(asArray<AlertItem>(snapshot.alerts));
    }, []);

    useEffect(() => {
        document.documentElement.setAttribute("data-theme", themeMode);
        window.localStorage.setItem("shadowsense-theme", themeMode);
    }, [themeMode]);

    useEffect(() => {
        let disposed = false;

        async function bootstrap() {
            const [dashboardRes, liveRes, alertRes] = await Promise.all([
                fetch(`${API_BASE}/api/dashboard`),
                fetch(`${API_BASE}/api/live`),
                fetch(`${API_BASE}/api/alerts`),
            ]);

            if (!dashboardRes.ok || !liveRes.ok || !alertRes.ok) {
                const failing = [dashboardRes, liveRes, alertRes].find((response) => !response.ok);
                throw new Error(`Backend request failed (${failing?.status ?? "unknown"})`);
            }

            const dashboardData = await dashboardRes.json();
            const liveData = await liveRes.json();
            const alertData = await alertRes.json();

            if (disposed) {
                return;
            }

            applySnapshot({
                summary: asSummary(dashboardData?.summary),
                recentEvents: asArray<DashboardEvent>(dashboardData?.recentEvents),
                liveUsers: asArray<LiveUser>(liveData?.liveUsers),
                alerts: asArray<AlertItem>(alertData?.alerts),
            });

            setBackendError(null);
        }

        bootstrap().catch((error) => {
            console.error("Failed to load dashboard", error);
            setBackendError("Backend unavailable. Verify API server and DATABASE_URL.");
        });

        const socket = io(API_BASE, {
            transports: ["websocket", "polling"],
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 800,
            reconnectionDelayMax: 4000,
        });

        socket.on("dashboard_snapshot", (snapshot: DashboardSnapshot) => {
            applySnapshot(snapshot);
            setBackendError(null);
        });

        socket.on("new_event", (event: DashboardEvent) => {
            setEvents((prev) => [event, ...prev.filter((item) => item.id !== event.id)].slice(0, 60));
            setSummary((prev) => ({ ...prev, totalEvents: Math.max(prev.totalEvents, prev.totalEvents + 1) }));
        });

        socket.on("connect_error", (error) => {
            console.error("Socket connection failed", error.message);
            setBackendError("Realtime stream offline. Waiting for backend...");
        });

        return () => {
            disposed = true;
            socket.disconnect();
        };
    }, [applySnapshot]);

    return (
        <div className="layout dark">
            <header className="topbar">
                <div className="brand">
                    <strong>ShadowSense</strong>
                </div>

                <nav className="tabs">
                    <NavLink to="/dashboard" className={({ isActive }) => `tab tab-link${isActive ? " active" : ""}`}>
                        Dashboard
                    </NavLink>
                    <NavLink to="/findings" className={({ isActive }) => `tab tab-link${isActive ? " active" : ""}`}>
                        Findings
                    </NavLink>
                    <NavLink to="/attack-surface" className={({ isActive }) => `tab tab-link${isActive ? " active" : ""}`}>
                        Attack Surface
                    </NavLink>
                    <NavLink to="/threats" className={({ isActive }) => `tab tab-link${isActive ? " active" : ""}`}>
                        Threats
                    </NavLink>
                </nav>

                <div className="toolbar">
                    <button type="button" className="dot tool-btn" aria-label="Search">
                        <SearchIcon />
                    </button>
                    <button type="button" className="dot tool-btn" aria-label="Notification">
                        <BellIcon />
                    </button>
                    <button
                        type="button"
                        className="dot tool-btn"
                        aria-label={`Switch to ${themeMode === "dark" ? "light" : "dark"} mode`}
                        title={`Switch to ${themeMode === "dark" ? "light" : "dark"} mode`}
                        onClick={() => setThemeMode((prev) => (prev === "dark" ? "light" : "dark"))}
                    >
                        <SettingsIcon />
                    </button>
                </div>
            </header>

            <main className="route-stage" key={location.pathname}>
                {backendError ? (
                    <div
                        role="status"
                        style={{
                            marginBottom: "1rem",
                            border: "1px solid rgba(255, 93, 110, 0.45)",
                            background: "rgba(255, 93, 110, 0.12)",
                            color: "#ffe8eb",
                            borderRadius: "10px",
                            padding: "0.75rem 1rem",
                            fontSize: "0.92rem",
                        }}
                    >
                        {backendError}
                    </div>
                ) : null}
                <Routes>
                    <Route path="/" element={<Navigate to="/attack-surface" replace />} />
                    <Route
                        path="/dashboard"
                        element={
                            <DashboardPage
                                summary={summary}
                                riskScore={riskScore}
                                scoreStyle={scoreStyle}
                                eventMix={eventMix}
                                liveUsers={liveUsers}
                                events={events}
                                alerts={alerts}
                            />
                        }
                    />
                    <Route path="/findings" element={<FindingsPage alerts={alerts} eventMix={eventMix} />} />
                    <Route
                        path="/attack-surface"
                        element={
                            <AttackSurfacePage
                                summary={summary}
                                alerts={alerts}
                                events={events}
                                liveUsers={liveUsers}
                                eventMix={eventMix}
                                riskScore={riskScore}
                                scoreStyle={scoreStyle}
                            />
                        }
                    />
                    <Route path="/threats" element={<ThreatsPage alerts={alerts} events={events} />} />
                </Routes>
            </main>
        </div>
    );
}

type PageData = {
    summary: DashboardSummary;
    riskScore: number;
    scoreStyle: CSSProperties;
    eventMix: Array<[string, number]>;
    liveUsers: LiveUser[];
    events: DashboardEvent[];
    alerts: AlertItem[];
};

type GraphKind = "bars" | "line" | "combo" | "area" | "step" | "pulse";

function SearchIcon() {
    return (
        <svg className="tool-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="11" cy="11" r="6" stroke="currentColor" strokeWidth="1.7" />
            <path d="M16 16L21 21" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
    );
}

function BellIcon() {
    return (
        <svg className="tool-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M6 10a6 6 0 1112 0v4l2 2H4l2-2v-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M10 18a2 2 0 004 0" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
    );
}

function SettingsIcon() {
    return (
        <svg className="tool-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.7" />
            <path
                d="M12 3l1.2 2.2 2.5.5-.8 2.4 1.7 1.8-1.7 1.8.8 2.4-2.5.5L12 21l-1.2-2.2-2.5-.5.8-2.4-1.7-1.8 1.7-1.8-.8-2.4 2.5-.5L12 3z"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinejoin="round"
            />
        </svg>
    );
}

function MiniGraph({ points, kind }: { points: number[]; kind: GraphKind }) {
    const width = 160;
    const height = 58;
    const normalized = points.map((value) => Math.max(4, Math.min(54, value)));
    const step = width / Math.max(1, normalized.length - 1);
    const linePath = normalized
        .map((value, index) => `${index === 0 ? "M" : "L"} ${Math.round(index * step)} ${height - value}`)
        .join(" ");
    const stepPath = normalized
        .map((value, index) => {
            const x = Math.round(index * step);
            const y = height - value;
            if (index === 0) {
                return `M ${x} ${y}`;
            }
            const prevX = Math.round((index - 1) * step);
            const prevY = height - normalized[index - 1];
            return `L ${x} ${prevY} L ${x} ${y}`;
        })
        .join(" ");

    return (
        <svg
            className={`mini-graph kind-${kind}`}
            viewBox={`0 0 ${width} ${height}`}
            preserveAspectRatio="none"
            aria-hidden="true"
        >
            <defs>
                <linearGradient id="graphArea" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="rgba(229,152,255,0.55)" />
                    <stop offset="100%" stopColor="rgba(229,152,255,0)" />
                </linearGradient>
            </defs>
            <path d={`M0 ${height - 2} H${width}`} className="graph-grid" />

            {(kind === "bars" || kind === "combo") &&
                normalized.map((value, index) => {
                    const x = index * step - 3;
                    return <rect key={`b-${index}`} x={x} y={height - value} width="6" height={value} className="graph-bar" />;
                })}

            {(kind === "line" || kind === "combo" || kind === "area") && (
                <>
                    <path d={`${linePath} L ${width} ${height} L 0 ${height} Z`} className="graph-area" />
                    <path d={linePath} className="graph-line" />
                </>
            )}

            {kind === "step" && (
                <>
                    <path d={`${stepPath} L ${width} ${height} L 0 ${height} Z`} className="graph-area" />
                    <path d={stepPath} className="graph-line" />
                </>
            )}

            {kind === "pulse" && (
                <>
                    <path d={linePath} className="graph-line" />
                    {normalized.map((value, index) => (
                        <circle
                            key={`p-${index}`}
                            cx={Math.round(index * step)}
                            cy={height - value}
                            r="2.1"
                            className="graph-dot"
                        />
                    ))}
                </>
            )}
        </svg>
    );
}

function DashboardPage({ summary, riskScore, scoreStyle, eventMix, liveUsers, events, alerts }: PageData) {
    const [logLines, setLogLines] = useState<string[]>(["[BOOT] awaiting active user stream..."]);
    const logRef = useRef<HTMLDivElement | null>(null);
    const logCursorRef = useRef(0);

    const identitySeries = normalizeSeries(liveUsers.map((user) => user.sessionId.length));
    const sessionVelocitySeries = normalizeSeries(bucketizeByTime(liveUsers.map((user) => user.lastSeenAt), CHART_POINTS, 5 * 60_000));
    const eventHeatSeries = normalizeSeries(bucketizeByTime(events.map((event) => event.timestamp), CHART_POINTS, 10 * 60_000));
    const riskDriftSeries = normalizeSeries([riskScore, summary.activeUsers * 2, alerts.length * 8, ...eventMix.map(([, value]) => value)]);

    const dashboardGraphs = [
        {
            label: "Identity Drift",
            value: `${Math.min(99, Math.round(summary.totalUsers * 1.2 + liveUsers.length))}%`,
            hint: "Behavior profile variance",
            kind: "area" as GraphKind,
            points: identitySeries,
        },
        {
            label: "Session Velocity",
            value: `${Math.min(99, Math.round(summary.activeUsers * 8 + 12))}%`,
            hint: "Session acceleration trend",
            kind: "line" as GraphKind,
            points: sessionVelocitySeries,
        },
        {
            label: "Event Heat",
            value: `${Math.min(99, Math.round(summary.totalEvents / 3) + 15)}%`,
            hint: "Interaction intensity",
            kind: "step" as GraphKind,
            points: eventHeatSeries,
        },
        {
            label: "Risk Drift",
            value: `${riskScore}%`,
            hint: "Weighted risk movement",
            kind: "pulse" as GraphKind,
            points: riskDriftSeries,
        },
    ];

    useEffect(() => {
        const timer = setInterval(() => {
            const now = new Date();
            const stamp = now.toLocaleTimeString();

            if (liveUsers.length === 0) {
                setLogLines((prev) => [...prev.slice(-119), `[${stamp}] idle: no active sessions detected`]);
                return;
            }

            const user = liveUsers[logCursorRef.current % liveUsers.length];
            logCursorRef.current += 1;

            const line = `[${stamp}] session ${user.sessionId.slice(0, 12)}... | page=${user.currentPage ?? "/"} | browser=${user.browser ?? "unknown"} | device=${user.device ?? "unknown"}`;

            setLogLines((prev) => [...prev.slice(-119), line]);
        }, 1500);

        return () => clearInterval(timer);
    }, [liveUsers]);

    useEffect(() => {
        const logEl = logRef.current;
        if (!logEl) {
            return;
        }
        logEl.scrollTop = logEl.scrollHeight;
    }, [logLines]);

    return (
        <section className="grid page-grid">
            <section className="hero-grid">
                <article className="panel metrics-panel">
                    <div className="panel-head">
                        <h2>Executive View</h2>
                        <span className="pill">Realtime</span>
                    </div>
                    <div className="cards">
                        {dashboardGraphs.map((graph) => (
                            <article className="metric-card" key={graph.label}>
                                <h3>{graph.label}</h3>
                                <p>{graph.value}</p>
                                <small>{graph.hint}</small>
                                <MiniGraph kind={graph.kind} points={graph.points} />
                            </article>
                        ))}
                    </div>
                </article>

                <article className="panel risk-panel">
                    <div className="panel-head">
                        <h2>Risk Score</h2>
                    </div>
                    <div className="gauge" style={scoreStyle}>
                        <div className="gauge-inner">
                            <span>Score</span>
                            <strong>{riskScore}%</strong>
                        </div>
                    </div>
                    <div className="gauge-scale">
                        <span>0</span>
                        <span>100</span>
                    </div>
                </article>
            </section>

            <section className="panel terminal-log-panel">
                <div className="panel-head terminal-head">
                    <h2>Active User Logs</h2>
                    <span className="pill">Live stream</span>
                </div>
                <div className="terminal-window" ref={logRef}>
                    {logLines.map((line, index) => (
                        <p className="terminal-line" key={`${index}-${line.slice(0, 18)}`}>
                            <span className="terminal-prompt">$</span> {line}
                        </p>
                    ))}
                </div>
            </section>
        </section>
    );
}

function FindingsPage({ alerts, eventMix }: { alerts: AlertItem[]; eventMix: Array<[string, number]> }) {
    const findingsVolumeSeries = normalizeSeries(bucketizeByTime(alerts.map((alert) => alert.createdAt), CHART_POINTS, 60 * 60_000));
    const evidenceSeries = normalizeSeries(alerts.map((alert) => alert.message.length + alert.type.length));
    const patternSeries = normalizeSeries(eventMix.map(([, value]) => value));
    const resolutionSeries = normalizeSeries(findingsVolumeSeries.map((value) => Math.max(1, 56 - value)));

    const findingsGraphs = [
        {
            label: "Findings Volume",
            value: `${alerts.length}`,
            hint: "Detected issue records",
            kind: "bars" as GraphKind,
            points: findingsVolumeSeries,
        },
        {
            label: "Evidence Score",
            value: `${Math.min(98, Math.round(evidenceSeries.reduce((sum, item) => sum + item, 0) / evidenceSeries.length))}%`,
            hint: "Confidence trend",
            kind: "step" as GraphKind,
            points: evidenceSeries,
        },
        {
            label: "Top Pattern",
            value: `${eventMix[0]?.[1] ?? 0}`,
            hint: eventMix[0]?.[0] ?? "page_view",
            kind: "bars" as GraphKind,
            points: patternSeries,
        },
        {
            label: "Resolution Pace",
            value: `${Math.max(22, 80 - alerts.length * 3)}%`,
            hint: "Recent closure velocity",
            kind: "area" as GraphKind,
            points: resolutionSeries,
        },
    ];

    return (
        <section className="grid page-grid">
            <section className="cards page-cards">
                {findingsGraphs.map((graph) => (
                    <article className="metric-card" key={graph.label}>
                        <h3>{graph.label}</h3>
                        <p>{graph.value}</p>
                        <small>{graph.hint}</small>
                        <MiniGraph kind={graph.kind} points={graph.points} />
                    </article>
                ))}
            </section>

            <section className="grid bottom-grid">
                <article className="panel">
                    <h2>Event Mix</h2>
                    <div className="scrollable">
                        {eventMix.map(([name, value]) => (
                            <div key={name} className="timeline-item">
                                <strong>{name}</strong>
                                <span>{value} events</span>
                            </div>
                        ))}
                    </div>
                </article>

                <article className="panel">
                    <h2>Findings</h2>
                    <div className="scrollable">
                        {alerts.length === 0 ? <p className="muted">No findings yet.</p> : null}
                        {alerts.map((alert) => (
                            <div key={alert.id} className="alert-item">
                                <strong>{alert.type}</strong>
                                <p>{alert.message}</p>
                                <small>{new Date(alert.createdAt).toLocaleString()}</small>
                            </div>
                        ))}
                    </div>
                </article>
            </section>
        </section>
    );
}

function AttackSurfacePage({
    summary,
    alerts,
    events,
    liveUsers,
    eventMix,
    riskScore,
    scoreStyle,
}: {
    summary: DashboardSummary;
    alerts: AlertItem[];
    events: DashboardEvent[];
    liveUsers: LiveUser[];
    eventMix: Array<[string, number]>;
    riskScore: number;
    scoreStyle: CSSProperties;
}) {
    const threatSeries = normalizeSeries(bucketizeByTime(alerts.map((alert) => alert.createdAt), CHART_POINTS, 30 * 60_000));
    const activeUserSeries = normalizeSeries(bucketizeByTime(liveUsers.map((user) => user.lastSeenAt), CHART_POINTS, 5 * 60_000));
    const eventSeries = normalizeSeries(bucketizeByTime(events.map((event) => event.timestamp), CHART_POINTS, 15 * 60_000));
    const topSignalSeries = normalizeSeries(eventMix.map(([, value]) => value));

    const attackGraphs = [
        {
            label: "Total Threats",
            value: `${alerts.length.toLocaleString()}`,
            hint: "Detected anomalies",
            kind: "combo" as GraphKind,
            points: threatSeries,
        },
        {
            label: "Active Users",
            value: `${summary.activeUsers.toLocaleString()}`,
            hint: "Sessions in last 5 min",
            kind: "pulse" as GraphKind,
            points: activeUserSeries,
        },
        {
            label: "Total Events",
            value: `${summary.totalEvents.toLocaleString()}`,
            hint: "Tracked interactions",
            kind: "combo" as GraphKind,
            points: eventSeries,
        },
        {
            label: "Top Signal",
            value: `${eventMix[0]?.[0] ?? "page_view"}`,
            hint: `${eventMix[0]?.[1] ?? 0} hits`,
            kind: "line" as GraphKind,
            points: topSignalSeries,
        },
    ];

    return (
        <>
            <section className="hero-grid">
                <article className="panel metrics-panel">
                    <div className="panel-head">
                        <h2>Your Attack Surface</h2>
                        <span className="pill">Live</span>
                    </div>

                    <div className="cards">
                        {attackGraphs.map((graph) => (
                            <article className="metric-card" key={graph.label}>
                                <h3>{graph.label}</h3>
                                <p>{graph.value}</p>
                                <small>{graph.hint}</small>
                                <MiniGraph kind={graph.kind} points={graph.points} />
                            </article>
                        ))}
                    </div>
                </article>

                <article className="panel risk-panel">
                    <div className="panel-head">
                        <h2>Risk Score</h2>
                    </div>
                    <div className="gauge" style={scoreStyle}>
                        <div className="gauge-inner">
                            <span>Score</span>
                            <strong>{riskScore}%</strong>
                        </div>
                    </div>
                    <div className="gauge-scale">
                        <span>0</span>
                        <span>100</span>
                    </div>
                </article>
            </section>

            <section className="panel full attack-overview-card">
                <div className="panel-head">
                    <h2>Attack Surface Overview</h2>
                    <div className="panel-search">Search</div>
                </div>
                <div className="table-wrap">
                    <table>
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th>Connector</th>
                                <th>Workload</th>
                                <th>Security Score</th>
                                <th>Browser</th>
                                <th>Device</th>
                                <th>Last Seen</th>
                            </tr>
                        </thead>
                        <tbody>
                            {liveUsers.map((user) => (
                                <tr key={user.sessionId}>
                                    <td>{user.sessionId.slice(0, 14)}...</td>
                                    <td>{user.ipAddress ?? "sandbox"}</td>
                                    <td>{user.currentPage ?? "/"}</td>
                                    <td>
                                        <div className="score-track">
                                            <span
                                                className="score-fill"
                                                style={{
                                                    width: `${Math.max(12, Math.min(95, (riskScore + user.sessionId.length) % 100))}%`,
                                                }}
                                            />
                                        </div>
                                    </td>
                                    <td>{user.browser ?? "unknown"}</td>
                                    <td>{user.device ?? "unknown"}</td>
                                    <td>{new Date(user.lastSeenAt).toLocaleTimeString()}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>

            <section className="grid bottom-grid">
                <article className="panel">
                    <h2>Alerts</h2>
                    <div className="scrollable">
                        {alerts.length === 0 ? <p className="muted">No alerts yet.</p> : null}
                        {alerts.map((alert) => (
                            <div key={alert.id} className="alert-item">
                                <strong>{alert.type}</strong>
                                <p>{alert.message}</p>
                                <small>{new Date(alert.createdAt).toLocaleString()}</small>
                            </div>
                        ))}
                    </div>
                </article>

                <article className="panel">
                    <h2>Session Timeline</h2>
                    <div className="timeline">
                        {events.map((event) => (
                            <div key={event.id} className="timeline-item">
                                <div>
                                    <strong>{event.eventType}</strong>
                                    <p>{event.sessionId}</p>
                                </div>
                                <div>
                                    <p>{event.page ?? "-"}</p>
                                    <small>{new Date(event.timestamp).toLocaleString()}</small>
                                </div>
                            </div>
                        ))}
                    </div>
                </article>
            </section>
        </>
    );
}

function ThreatsPage({ alerts, events }: { alerts: AlertItem[]; events: DashboardEvent[] }) {
    const burstSeries = normalizeSeries(bucketizeByTime(alerts.map((alert) => alert.createdAt), CHART_POINTS, 30 * 60_000));
    const severitySeries = normalizeSeries(alerts.map((alert) => severityScore(alert.type)));
    const correlationSeries = normalizeSeries(bucketizeByTime(events.map((event) => event.timestamp), CHART_POINTS, 30 * 60_000).map((count, i) => count + (burstSeries[i] ?? 0) / 6));
    const containmentSeries = normalizeSeries(burstSeries.map((value) => Math.max(1, 56 - value)));

    const threatGraphs = [
        {
            label: "Threat Burst",
            value: `${alerts.length}`,
            hint: "Current threat spikes",
            kind: "bars" as GraphKind,
            points: burstSeries,
        },
        {
            label: "Severity Curve",
            value: `${Math.min(97, Math.round(severitySeries.reduce((sum, item) => sum + item, 0) / severitySeries.length))}%`,
            hint: "Escalation trend",
            kind: "pulse" as GraphKind,
            points: severitySeries,
        },
        {
            label: "Event Correlation",
            value: `${Math.min(99, events.length)}%`,
            hint: "Threat-event relation",
            kind: "step" as GraphKind,
            points: correlationSeries,
        },
        {
            label: "Containment",
            value: `${Math.max(18, 86 - alerts.length * 2)}%`,
            hint: "Mitigation progress",
            kind: "area" as GraphKind,
            points: containmentSeries,
        },
    ];

    return (
        <section className="grid page-grid">
            <section className="cards page-cards">
                {threatGraphs.map((graph) => (
                    <article className="metric-card" key={graph.label}>
                        <h3>{graph.label}</h3>
                        <p>{graph.value}</p>
                        <small>{graph.hint}</small>
                        <MiniGraph kind={graph.kind} points={graph.points} />
                    </article>
                ))}
            </section>

            <section className="panel full">
                <div className="panel-head">
                    <h2>Threat Feed</h2>
                    <span className="pill">{alerts.length} active</span>
                </div>
                <div className="timeline">
                    {alerts.map((alert) => (
                        <div key={alert.id} className="alert-item">
                            <strong>{alert.type}</strong>
                            <p>{alert.message}</p>
                            <small>{new Date(alert.createdAt).toLocaleString()}</small>
                        </div>
                    ))}
                    {alerts.length === 0 ? <p className="muted">No threat alerts in this window.</p> : null}
                </div>
            </section>

            <section className="panel full">
                <h2>Related Events</h2>
                <div className="timeline">
                    {events.slice(0, 20).map((event) => (
                        <div key={event.id} className="timeline-item">
                            <strong>{event.eventType}</strong>
                            <span>{event.sessionId.slice(0, 14)}...</span>
                        </div>
                    ))}
                </div>
            </section>
        </section>
    );
}
