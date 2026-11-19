import { Handlers } from "$fresh/server.ts";
import { cachedJson } from "../../lib/backend.ts";

const HOUR = 60 * 60 * 1000;

export const handler: Handlers = {
  GET: () => cachedJson("https://api.memegen.link/templates", HOUR),
};
