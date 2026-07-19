/**
 * Cloudflare Worker Backend - tRPC Server
 * This worker hosts the tRPC API for the Auditor dashboard
 */

import { initTRPC } from "@trpc/server";
import { z } from "zod";

const t = initTRPC.create();

/**
 * Example tRPC Router
 * In production, split into separate routers for meta, dv360, etc.
 */
const appRouter = t.router({
  hello: t.procedure
    .input(z.object({ name: z.string() }))
    .query(({ input }) => {
      return {
        greeting: `Hello ${input.name}!`,
      };
    }),

  meta: t.router({
    getHealthScore: t.procedure
      .input(z.object({ pixelId: z.string() }))
      .query(async ({ input }) => {
        // In production, fetch from Meta API
        return {
          score: 78,
          status: "healthy",
          components: {
            pixelHealth: 78,
            emqScore: 72,
            capiHealth: 80,
            funnelHealth: 75,
          },
        };
      }),

    getPixelData: t.procedure
      .input(z.object({ pixelId: z.string() }))
      .query(async ({ input }) => {
        return {
          pixelId: input.pixelId,
          status: "active",
          eventCount: 125000,
          eventFiringConsistency: 95,
          duplicateEvents: 2500,
          averageLatency: 350,
          matchRate: 78,
          lastUpdated: new Date(),
        };
      }),
  }),

  dv360: t.router({
    getHealthScore: t.procedure
      .input(z.object({ customerId: z.string() }))
      .query(async ({ input }) => {
        // In production, fetch from Google APIs
        return {
          score: 85,
          status: "healthy",
          components: {
            conversionHealth: 85,
            gaHealth: 82,
            gtmHealth: 88,
          },
        };
      }),

    getConversionMetrics: t.procedure
      .input(z.object({ customerId: z.string() }))
      .query(async ({ input }) => {
        return {
          conversions: 8500,
          conversionValue: 425000,
          conversionRate: 0.068,
          costPerConversion: 50,
        };
      }),
  }),

  recommendations: t.router({
    getList: t.procedure
      .input(z.object({ platform: z.enum(["meta", "dv360"]) }))
      .query(async ({ input }) => {
        return [
          {
            id: "1",
            priority: "critical",
            issue: "Fix pixel deduplication",
            impact: 8,
            action: "Update Event Manager settings",
            effort: "quick",
          },
          {
            id: "2",
            priority: "high",
            issue: "Implement phone hash parameter",
            impact: 5,
            action: "Add phone field to pixel base code",
            effort: "medium",
          },
        ];
      }),
  }),
});

export type AppRouter = typeof appRouter;

/**
 * Cloudflare Worker Handler
 * Entry point for HTTP requests to the worker
 */
export default {
  async fetch(request: Request, env: any, ctx: any): Promise<Response> {
    // CORS headers
    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers });
    }

    // tRPC endpoint routing
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/trpc")) {
      // Route tRPC requests
      // In production, use @trpc/server/adapters/fetch
      return new Response(
        JSON.stringify({
          error: "tRPC adapter not yet configured",
        }),
        {
          status: 501,
          headers: { ...headers, "Content-Type": "application/json" },
        }
      );
    }

    return new Response("Not Found", { status: 404, headers });
  },
};

/**
 * Durable Object for Real-time Event Streaming
 * This is a placeholder - WebSocketPair is only available in Cloudflare Workers runtime
 */
// export class EventStream {
//   async fetch(request: Request) {
//     return new Response("WebSocket not configured", { status: 501 });
//   }
// }
