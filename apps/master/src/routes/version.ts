import type { FastifyInstance } from "fastify";
import { readReleaseInfo } from "../release-info.js";

export function registerVersionRoutes(app: FastifyInstance): void {
  app.get("/api/version", async () => readReleaseInfo());
}
