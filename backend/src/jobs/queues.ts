import { Queue } from "bullmq";

const redisUrlValue = process.env.REDIS_URL;

const redisConnection = redisUrlValue
    ? (() => {
        const parsed = new URL(redisUrlValue);
        return {
            host: parsed.hostname,
            port: Number(parsed.port || 6379),
        };
    })()
    : null;

export const queueEnabled = Boolean(redisConnection);

export const anomalyQueue = redisConnection
    ? new Queue("anomaly-events", {
        connection: redisConnection,
    })
    : null;

export async function enqueueAnomalyEvent(data: { sessionDbId: number; sessionId: string }) {
    if (!anomalyQueue) {
        return false;
    }

    try {
        await anomalyQueue.add("event", data);
        return true;
    } catch (error) {
        console.warn("Failed to enqueue anomaly job. Falling back to inline checks.", error);
        return false;
    }
}

export { redisConnection };
