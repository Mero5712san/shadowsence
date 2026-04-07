import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import http from "node:http";
import { Server } from "socket.io";
import { PrismaClient } from "@prisma/client";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { runAnomalyChecks } from "./anomaly.js";
import { enqueueAnomalyEvent } from "./jobs/queues.js";
import { startAnomalyWorker } from "./jobs/workers.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const prisma = new PrismaClient();
const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: true,
    },
});

type AsyncRouteHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

function asyncHandler(handler: AsyncRouteHandler) {
    return (req: Request, res: Response, next: NextFunction) => {
        handler(req, res, next).catch(next);
    };
}

function isPrismaInitializationError(error: unknown): boolean {
    return Boolean(
        error &&
        typeof error === "object" &&
        "name" in error &&
        (error as { name?: string }).name === "PrismaClientInitializationError",
    );
}

const trackEventSchema = z.object({
    sessionId: z.string().min(8),
    anonymousId: z.string().min(8),
    eventType: z.enum([
        "session_start",
        "session_end",
        "page_view",
        "click",
        "scroll",
        "tab_switch",
        "login_failed",
    ]),
    eventData: z.record(z.any()).default({}),
    metadata: z
        .object({
            page: z.string().optional(),
            device: z.string().optional(),
            browser: z.string().optional(),
            ipAddress: z.string().optional(),
        })
        .optional(),
});

app.use(
    cors({
        origin: true,
    }),
);
app.use(express.json({ limit: "500kb" }));

app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
});

async function fetchDashboardData() {
    const [totalUsers, totalEvents, activeUsers, recentEvents] = await Promise.all([
        prisma.user.count(),
        prisma.event.count(),
        prisma.session.count({ where: { lastSeenAt: { gte: new Date(Date.now() - 5 * 60_000) } } }),
        prisma.event.findMany({
            orderBy: { timestamp: "desc" },
            take: 30,
            include: {
                session: {
                    select: {
                        sessionId: true,
                        currentPage: true,
                    },
                },
            },
        }),
    ]);

    return {
        summary: { totalUsers, totalEvents, activeUsers },
        recentEvents: recentEvents.map((event: (typeof recentEvents)[number]) => ({
            id: event.id,
            sessionId: event.session.sessionId,
            eventType: event.eventType,
            eventData: event.eventData,
            page: event.session.currentPage,
            timestamp: event.timestamp,
        })),
    };
}

async function fetchLiveUsers() {
    const sessions = await prisma.session.findMany({
        where: { lastSeenAt: { gte: new Date(Date.now() - 5 * 60_000) } },
        orderBy: { lastSeenAt: "desc" },
        take: 100,
        select: {
            sessionId: true,
            currentPage: true,
            ipAddress: true,
            browser: true,
            device: true,
            lastSeenAt: true,
        },
    });

    return { liveUsers: sessions };
}

async function fetchAlerts() {
    const alerts = await prisma.alert.findMany({
        orderBy: { createdAt: "desc" },
        take: 100,
        include: {
            session: {
                select: { sessionId: true },
            },
        },
    });

    return {
        alerts: alerts.map((alert: (typeof alerts)[number]) => ({
            id: alert.id,
            sessionId: alert.session.sessionId,
            type: alert.type,
            message: alert.message,
            createdAt: alert.createdAt,
        })),
    };
}

async function buildRealtimeSnapshot() {
    const [dashboard, live, alerts] = await Promise.all([fetchDashboardData(), fetchLiveUsers(), fetchAlerts()]);
    return {
        summary: dashboard.summary,
        recentEvents: dashboard.recentEvents,
        liveUsers: live.liveUsers,
        alerts: alerts.alerts,
    };
}

async function broadcastRealtimeSnapshot() {
    const snapshot = await buildRealtimeSnapshot();
    io.emit("dashboard_snapshot", snapshot);
}

function isPrismaP2002(error: unknown): boolean {
    return Boolean(
        error &&
        typeof error === "object" &&
        "code" in error &&
        (error as { code?: string }).code === "P2002",
    );
}

async function getOrCreateUser(anonymousId: string) {
    try {
        return await prisma.user.upsert({
            where: { anonymousId },
            create: { anonymousId },
            update: {},
        });
    } catch (error) {
        // Concurrent first events can race on user creation. Recover by reading the created row.
        if (isPrismaP2002(error)) {
            const existingUser = await prisma.user.findUnique({ where: { anonymousId } });
            if (existingUser) {
                return existingUser;
            }
        }

        throw error;
    }
}

app.post("/api/events", asyncHandler(async (req, res) => {
    const parsed = trackEventSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
    }

    const { sessionId, anonymousId, eventType, eventData, metadata } = parsed.data;

    const user = await getOrCreateUser(anonymousId);

    const session = await prisma.session.upsert({
        where: { sessionId },
        create: {
            sessionId,
            userId: user.id,
            ipAddress: metadata?.ipAddress,
            device: metadata?.device,
            browser: metadata?.browser,
            currentPage: metadata?.page,
            startTime: new Date(),
            lastSeenAt: new Date(),
            endTime: eventType === "session_end" ? new Date() : null,
        },
        update: {
            userId: user.id,
            ipAddress: metadata?.ipAddress,
            device: metadata?.device,
            browser: metadata?.browser,
            currentPage: metadata?.page,
            lastSeenAt: new Date(),
            endTime: eventType === "session_end" ? new Date() : undefined,
        },
    });

    const savedEvent = await prisma.event.create({
        data: {
            sessionId: session.id,
            eventType,
            eventData,
        },
    });

    const queued = await enqueueAnomalyEvent({
        sessionDbId: session.id,
        sessionId,
    });

    if (!queued) {
        await runAnomalyChecks(prisma, session.id, sessionId);
    }

    io.emit("new_event", {
        id: savedEvent.id,
        sessionId,
        eventType,
        eventData,
        timestamp: savedEvent.timestamp,
    });

    if (eventType === "session_end") {
        io.emit("session_ended", { sessionId });
    }

    broadcastRealtimeSnapshot().catch((error) => {
        console.error("Failed to broadcast realtime snapshot", error);
    });

    return res.status(202).json({ success: true });
}));

app.get("/api/dashboard", asyncHandler(async (_req, res) => {
    const dashboard = await fetchDashboardData();
    res.json(dashboard);
}));

app.get("/api/live", asyncHandler(async (_req, res) => {
    const live = await fetchLiveUsers();
    res.json(live);
}));

app.get("/api/alerts", asyncHandler(async (_req, res) => {
    const data = await fetchAlerts();
    res.json(data);
}));

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error("API request failed", error);

    if (isPrismaInitializationError(error)) {
        return res.status(503).json({
            error: "Database is unavailable. Check DATABASE_URL and database network access.",
        });
    }

    return res.status(500).json({
        error: "Internal server error",
    });
});

io.on("connection", (socket) => {
    socket.emit("connected", { message: "ShadowSense real-time stream connected" });
    buildRealtimeSnapshot()
        .then((snapshot) => socket.emit("dashboard_snapshot", snapshot))
        .catch((error) => {
            console.error("Failed to build realtime snapshot", error);
        });
});

setInterval(() => {
    broadcastRealtimeSnapshot().catch((error) => {
        console.error("Failed to stream periodic snapshot", error);
    });
}, 3000);

const port = Number(process.env.PORT ?? 5000);

startAnomalyWorker();

server.listen(port, () => {
    console.log(`ShadowSense backend running on http://localhost:${port}`);
});
