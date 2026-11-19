import { Handlers } from "$fresh/server.ts";
import { proxy } from "../../../../lib/backend.ts";

export const handler: Handlers = {
  POST: (req, ctx) =>
    proxy(req, `/models/${encodeURIComponent(ctx.params.id)}/download`),
};
