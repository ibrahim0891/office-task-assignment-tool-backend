import webpush from "web-push";
import { prisma } from "../../config/prisma";

const vapidKeys = {
    publicKey: process.env.VAPID_PUBLIC_KEY || "",
    privateKey: process.env.VAPID_PRIVATE_KEY || "",
};

if (vapidKeys.publicKey && vapidKeys.privateKey) {
    webpush.setVapidDetails(
        process.env.VAPID_SUBJECT || "mailto:nijhum0891@gmail.com",
        vapidKeys.publicKey,
        vapidKeys.privateKey
    );
} else {
    console.warn("VAPID public/private keys not configured. Web Push notifications will not function.");
}

export const subscribeUser = async (userId: string, subscription: any) => {
    const { endpoint, keys } = subscription;
    if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
        throw new Error("Invalid push subscription object structure.");
    }

    return prisma.pushSubscription.upsert({
        where: { endpoint },
        update: {
            userId,
            p256dh: keys.p256dh,
            auth: keys.auth,
        },
        create: {
            userId,
            endpoint,
            p256dh: keys.p256dh,
            auth: keys.auth,
        },
    });
};

export const unsubscribeUser = async (endpoint: string) => {
    return prisma.pushSubscription.deleteMany({
        where: { endpoint },
    });
};

export const sendPushNotification = async (userId: string, title: string, body: string, url: string) => {
    if (!vapidKeys.publicKey || !vapidKeys.privateKey) return;

    const subscriptions = await prisma.pushSubscription.findMany({
        where: { userId },
    });

    if (subscriptions.length === 0) return;

    const payload = JSON.stringify({ title, body, url });

    const promises = subscriptions.map(async (sub: any) => {
        const pushSubscription = {
            endpoint: sub.endpoint,
            keys: {
                p256dh: sub.p256dh,
                auth: sub.auth,
            },
        };

        try {
            await webpush.sendNotification(pushSubscription, payload);
        } catch (error: any) {
            // Delete expired subscriptions (status 410 or 404)
            if (error.statusCode === 410 || error.statusCode === 404) {
                console.log(`[Push Notification] Deleting expired subscription for user ${userId}: ${sub.endpoint}`);
                await prisma.pushSubscription.delete({
                    where: { id: sub.id },
                }).catch(() => {});
            } else {
                console.error(`[Push Notification] Failed to send push to ${sub.endpoint}:`, error);
            }
        }
    });

    await Promise.all(promises);
};
