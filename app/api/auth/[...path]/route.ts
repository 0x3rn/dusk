// app/api/auth/[...path]/route.ts
// Proxies every /api/auth/* call from the browser SDK to Neon Auth.
import { auth } from "@/lib/auth/server";

export const { GET, POST, PUT, PATCH, DELETE } = auth.handler();
