import { Worker } from "bullmq";
import { PrismaClient } from "@prisma/client";
import { queueEnabled, redisConnection } from "./queues.js";
import { runAnomalyChecks } from "../anomaly.js";

const prisma = new PrismaClient();

export function startAnomalyWorker() {
    if (!queueEnabled || !redisConnection) {
        console.log("Redis queue disabled: anomaly checks will run inline.");
        return null;
    }

    const worker = new Worker(
        "anomaly-events",
        async (job) => {
            const { sessionDbId, sessionId } = job.data as { sessionDbId: number; sessionId: string };
            await runAnomalyChecks(prisma, sessionDbId, sessionId);
        },
        { connection: redisConnection },
    );

    worker.on("failed", (job, error) => {
        console.error("Anomaly worker failed", job?.id, error);
    });

    return worker;
}
