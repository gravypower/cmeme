import { Handlers } from "$fresh/server.ts";

const BACKEND_URL = Deno.env.get("BACKEND_URL") ?? "http://localhost:8001";

export const handler: Handlers = {
  async POST(req) {
    const formData = await req.formData();

    const backendReq = new Request(`${BACKEND_URL}/detect_faces`, {
      method: "POST",
      body: formData,
    });

    let backendRes: Response;
    try {
      backendRes = await fetch(backendReq);
    } catch (_err) {
      return new Response(
        JSON.stringify({ error: "Could not reach the face-swap backend. Is Docker running?" }),
        { status: 503, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!backendRes.ok) {
      const detail = await backendRes.text();
      return new Response(
        JSON.stringify({ error: detail }),
        { status: backendRes.status, headers: { "Content-Type": "application/json" } }
      );
    }

    const data = await backendRes.json();
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    });
  },
};
