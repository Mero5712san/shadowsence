import { PrismaClient } from "@prisma/client";

const TEN_SECONDS = 10_000;
const FIVE_MINUTES = 5 * 60_000;

export async function runAnomalyChecks(prisma: PrismaClient, sessionDbId: number, sessionId: string) {
    const now = new Date();
    const tenSecondsAgo = new Date(now.getTime() - TEN_SECONDS);
    const fiveMinutesAgo = new Date(now.getTime() - FIVE_MINUTES);

    const rapidClicks = await prisma.event.count({
        where: {
            sessionId: sessionDbId,
            eventType: "click",
            timestamp: { gte: tenSecondsAgo },
        },
    });

    if (rapidClicks > 50) {
        await prisma.alert.create({
            data: {
                sessionId: sessionDbId,
                type: "bot_like_clicking",
                message: `Session ${sessionId} triggered ${rapidClicks} clicks in 10 seconds`,
            },
        });
    }

    const session = await prisma.session.findUnique({
        where: { id: sessionDbId },
        select: { ipAddress: true },
    });

    if (session?.ipAddress) {
        const sameIpSessions = await prisma.session.count({
            where: {
                ipAddress: session.ipAddress,
                lastSeenAt: { gte: fiveMinutesAgo },
            },
        });

        if (sameIpSessions >= 5) {
            await prisma.alert.create({
                data: {
                    sessionId: sessionDbId,
                    type: "multiple_sessions_same_ip",
                    message: `IP ${session.ipAddress} has ${sameIpSessions} active sessions in 5 minutes`,
                },
            });
        }
    }

    const loginFails = await prisma.event.count({
        where: {
            sessionId: sessionDbId,
            eventType: "login_failed",
            timestamp: { gte: fiveMinutesAgo },
        },
    });

    if (loginFails >= 5) {
        await prisma.alert.create({
            data: {
                sessionId: sessionDbId,
                type: "bruteforce_suspected",
                message: `Session ${sessionId} had ${loginFails} failed logins in 5 minutes`,
            },
        });
    }
}
