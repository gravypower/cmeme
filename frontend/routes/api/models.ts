import { Handlers } from "$fresh/server.ts";
import { proxy } from "../../lib/backend.ts";

export const handler: Handlers = {
  GET: (req) => proxy(req, "/models"),
};
