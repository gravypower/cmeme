import { Handlers } from "$fresh/server.ts";
import { proxy } from "../../lib/backend.ts";

export const handler: Handlers = {
  POST: (req) => proxy(req, "/detect_faces"),
};
