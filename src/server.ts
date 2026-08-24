import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { randomBytes } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DiffRequest } from "./git.ts";
import { generateDiff } from "./git.ts";
import { isPathInside } from "./paths.ts";

const ASSETS_DIRECTORY = fileURLToPath(new URL("../dist/client", import.meta.url));
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

function applySecurityHeaders(response: ServerResponse): void {
  response.setHeader("Content-Security-Policy", CSP);
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(body));
}

function methodNotAllowed(response: ServerResponse, allowed: string): void {
  response.setHeader("Allow", allowed);
  sendJson(response, 405, { error: "Method not allowed." });
}

export class DiffViewerServer {
  readonly token = randomBytes(24).toString("hex");
  private server: Server | undefined;
  private request: DiffRequest | undefined;
  private baseUrl: string | undefined;
  private starting: Promise<string> | undefined;
  private closing: Promise<void> | undefined;

  constructor(private readonly pi: ExtensionAPI) {}

  setRequest(request: DiffRequest): void {
    this.request = request;
  }

  start(): Promise<string> {
    if (this.baseUrl) return Promise.resolve(this.baseUrl);
    if (this.starting) return this.starting;

    const starting = this.startServer();
    this.starting = starting;
    const clearStarting = () => {
      if (this.starting === starting) this.starting = undefined;
    };
    void starting.then(clearStarting, clearStarting);
    return starting;
  }

  private async startServer(): Promise<string> {
    await readFile(resolve(ASSETS_DIRECTORY, "index.html"));

    const server = createServer((request, response) => {
      void this.handleRequest(request, response).catch((error: unknown) => {
        if (!response.headersSent) applySecurityHeaders(response);
        sendJson(response, 500, { error: error instanceof Error ? error.message : "Unexpected server error." });
      });
    });
    this.server = server;

    await new Promise<void>((resolveListen, reject) => {
      const onError = (error: Error) => reject(error);
      server.once("error", onError);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", onError);
        resolveListen();
      });
    });

    const address = server.address();
    if (!address || typeof address === "string") {
      await this.close();
      throw new Error("Could not determine the diff viewer port.");
    }
    this.baseUrl = `http://127.0.0.1:${address.port}/${this.token}/`;
    return this.baseUrl;
  }

  getUrl(): string | undefined {
    return this.baseUrl;
  }

  async close(): Promise<void> {
    if (this.closing) return this.closing;
    const server = this.server;
    this.server = undefined;
    this.baseUrl = undefined;
    if (!server) return;
    this.closing = new Promise<void>((resolveClose) => {
      server.close(() => resolveClose());
      server.closeAllConnections?.();
    }).finally(() => {
      this.closing = undefined;
    });
    return this.closing;
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    applySecurityHeaders(response);
    const method = request.method ?? "GET";
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const prefix = `/${this.token}/`;
    if (!url.pathname.startsWith(prefix)) {
      sendJson(response, 404, { error: "Not found." });
      return;
    }

    let route: string;
    try {
      route = decodeURIComponent(url.pathname.slice(prefix.length));
    } catch {
      sendJson(response, 404, { error: "Not found." });
      return;
    }

    if (route === "api/diff") {
      if (method !== "GET") {
        methodNotAllowed(response, "GET");
        return;
      }
      if (!this.request) {
        sendJson(response, 409, { error: "No diff request is active." });
        return;
      }
      try {
        sendJson(response, 200, await generateDiff(this.pi, this.request));
      } catch (error) {
        sendJson(response, 422, { error: error instanceof Error ? error.message : "Could not generate the Git diff." });
      }
      return;
    }

    if (method !== "GET") {
      methodNotAllowed(response, "GET");
      return;
    }

    const relativeAsset = route === "" ? "index.html" : route;
    if (relativeAsset.includes("\0") || relativeAsset.startsWith("/") || relativeAsset.split("/").includes("..")) {
      sendJson(response, 404, { error: "Not found." });
      return;
    }
    const assetsRoot = await realpath(ASSETS_DIRECTORY);
    const assetPath = resolve(assetsRoot, relativeAsset);
    if (!isPathInside(assetsRoot, assetPath)) {
      sendJson(response, 404, { error: "Not found." });
      return;
    }

    let body: Buffer;
    try {
      const canonicalAssetPath = await realpath(assetPath);
      if (!isPathInside(assetsRoot, canonicalAssetPath)) {
        sendJson(response, 404, { error: "Not found." });
        return;
      }
      body = await readFile(canonicalAssetPath);
    } catch {
      sendJson(response, 404, { error: "Not found." });
      return;
    }
    response.statusCode = 200;
    response.setHeader("Content-Type", CONTENT_TYPES[extname(assetPath)] ?? "application/octet-stream");
    response.setHeader("Cache-Control", relativeAsset === "index.html" ? "no-store" : "public, max-age=31536000, immutable");
    response.end(body);
  }
}
