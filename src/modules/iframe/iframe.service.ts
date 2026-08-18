export const proxyUrl = async (targetUrl: string, incomingCookies?: string) => {
    const reqHeaders: Record<string, string> = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "cross-site",
    };
    if (incomingCookies) {
        reqHeaders["Cookie"] = incomingCookies;
    }

    const upstream = await fetch(targetUrl, {
        headers: reqHeaders,
        redirect: "follow",
    });

    const contentType = upstream.headers.get("content-type") || "text/html";
    const headers: Record<string, string> = {
        "Content-Type": contentType,
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Credentials": "true",
    };

    const setCookie = upstream.headers.get("set-cookie");
    if (setCookie) {
        headers["Set-Cookie"] = setCookie;
    }

    if (contentType.includes("text/html")) {
        let html = await upstream.text();
        let baseUrl = targetUrl;
        try {
            baseUrl = new URL(targetUrl).origin;
        } catch {}

        // Remove CSP / Frame Options meta tags
        html = html.replace(/<meta[^>]*http-equiv=["']?(content-security-policy|x-frame-options)["']?[^>]*>/gi, "");

        // Inject base tag
        if (html.includes("<head>")) {
            html = html.replace("<head>", `<head><base href="${baseUrl}/">`);
        } else if (html.includes("<Head>")) {
            html = html.replace("<Head>", `<Head><base href="${baseUrl}/">`);
        } else {
            html = `<base href="${baseUrl}/">` + html;
        }

        return { headers, body: html };
    } else {
        const buf = await upstream.arrayBuffer();
        return { headers, body: Buffer.from(buf) };
    }
};
