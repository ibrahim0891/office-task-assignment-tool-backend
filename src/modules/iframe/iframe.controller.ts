import { Request, Response } from "express";
import * as iframeService from "./iframe.service";

export const proxy = async (req: Request, res: Response) => {
    const targetUrl = req.query.url as string;
    if (!targetUrl) return res.status(400).send("URL required");

    try {
        const result = await iframeService.proxyUrl(targetUrl, req.headers.cookie);
        // Apply headers
        for (const [key, value] of Object.entries(result.headers)) {
            res.setHeader(key, value);
        }
        // Explicitly remove frame headers from Express if set
        res.removeHeader("X-Frame-Options");
        res.removeHeader("Content-Security-Policy");
        res.removeHeader("Content-Security-Policy-Report-Only");

        res.send(result.body);
    } catch (e: any) {
        res.status(200).send(`<!DOCTYPE html><html><head><style>body{font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#FAFAF9;color:#888883;flex-direction:column;gap:8px;}</style></head><body><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M13.828 10.172a4 4 0 0 0-5.656 0l-4 4a4 4 0 1 0 5.656 5.656l1.102-1.101m-.758-4.899a4 4 0 0 0 5.656 0l4-4a4 4 0 0 0-5.656-5.656l-1.1 1.1"/></svg><p style="font-size:12px;">Unable to preview this site</p><a href="${targetUrl}" target="_blank" style="font-size:11px;color:#1A1A1A;">Open in new tab →</a></body></html>`);
    }
};
