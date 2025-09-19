// src/lib/initServer.ts
import dns from "node:dns";

// Paksa pakai IPv4 dulu (hindari ECONNRESET karena IPv6 broken)
dns.setDefaultResultOrder?.("ipv4first");
