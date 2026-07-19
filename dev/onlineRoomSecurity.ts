import { createHmac, randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { isIP } from "node:net";
import type { ConnectionContext } from "./onlineRoomTypes";

const ipHashSalt = process.env.IP_HASH_SALT;
const configuredOrigins = new Set([
  "https://cachito.web.app",
  "https://cachito--ian-duclos.europe-west4.hosted.app",
  "https://cachito.ianduclos.com",
  ...(process.env.ONLINE_ALLOWED_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean),
]);

function headerValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value.join(",") : value;
}

function forwardedAddresses(request: IncomingMessage) {
  return (headerValue(request.headers["x-forwarded-for"]) ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function isAllowedRoomOrigin(request: IncomingMessage) {
  const origin = headerValue(request.headers.origin);
  if (!origin) return true;
  if (configuredOrigins.has(origin)) return true;
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    if (["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) return true;
    const requestedHost = (headerValue(request.headers["x-forwarded-host"]) ?? headerValue(request.headers.host))
      ?.split(",")[0]
      ?.trim()
      .toLocaleLowerCase();
    return Boolean(requestedHost && parsed.host.toLocaleLowerCase() === requestedHost);
  } catch {
    return false;
  }
}

export function createConnectionContext(request: IncomingMessage): ConnectionContext {
  const forwardedFor = forwardedAddresses(request);
  const ip = (forwardedFor[0] ?? request.socket.remoteAddress ?? "").replace(/^::ffff:/, "");
  const userAgent = headerValue(request.headers["user-agent"]);
  const hash = (value: string) => ipHashSalt ? createHmac("sha256", ipHashSalt).update(value).digest("base64url") : null;
  const version = isIP(ip);
  return {
    connectionId: randomUUID(),
    ipHash: ip ? hash(`ip:v1:${ip}`) : null,
    ipVersion: version === 4 ? "ipv4" : version === 6 ? "ipv6" : "unknown",
    forwardedForCount: forwardedFor.length,
    userAgentHash: userAgent ? hash(`user-agent:v1:${userAgent}`) : null,
    ...(headerValue(request.headers.origin) ? { origin: headerValue(request.headers.origin) } : {}),
    ...(headerValue(request.headers["accept-language"]) ? { language: headerValue(request.headers["accept-language"])!.split(",")[0] } : {}),
    ...(headerValue(request.headers["x-forwarded-proto"]) ? { protocol: headerValue(request.headers["x-forwarded-proto"]) } : {}),
    hashConfigured: Boolean(ipHashSalt),
  };
}

export function requestAddress(request: IncomingMessage) {
  return (forwardedAddresses(request)[0] ?? request.socket.remoteAddress ?? "unknown").replace(/^::ffff:/, "");
}

export function hasConnectionHashSalt() {
  return Boolean(ipHashSalt);
}
