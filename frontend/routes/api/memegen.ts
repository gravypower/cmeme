import { Handlers } from "$fresh/server.ts";

type MemegenTemplate = {
  id: string;
  name: string;
  lines: number;
  example: { text: string[]; url: string };
  blank: string;
};

export const handler: Handlers = {
  async GET() {
    const res = await fetch("https://api.memegen.link/templates");
    if (!res.ok) {
      return new Response(JSON.stringify({ error: "Failed to fetch templates" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }
    const templates: MemegenTemplate[] = await res.json();
    return new Response(JSON.stringify(templates), {
      headers: { "Content-Type": "application/json" },
    });
  },
};
