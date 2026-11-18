// app/api/auth/[...path]/route.ts
// Proxies every /api/auth/* call from the browser SDK to Neon Auth.
import { auth } from "@/lib/auth/server";

type Handlers = ReturnType<typeof auth.handler>;
type RouteContext = Parameters<Handlers["GET"]>[1];

// Created on the first request, not when the route is loaded: loading happens during the build,
// which has no secrets (see lib/auth/server.ts).
let handlers: Handlers | undefined;
const getHandlers = (): Handlers => (handlers ??= auth.handler());

export const GET = (request: Request, context: RouteContext) => getHandlers().GET(request, context);
export const POST = (request: Request, context: RouteContext) => getHandlers().POST(request, context);
export const PUT = (request: Request, context: RouteContext) => getHandlers().PUT(request, context);
export const PATCH = (request: Request, context: RouteContext) => getHandlers().PATCH(request, context);
export const DELETE = (request: Request, context: RouteContext) => getHandlers().DELETE(request, context);
