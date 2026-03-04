import { Handlers } from "$fresh/server.ts";

const BACKEND_URL = Deno.env.get("BACKEND_URL") ?? "http://localhost:8001";

export const handler: Handlers = {
  async POST(req) {
    // Forward the multipart form data directly to the Python backend
    const formData = await req.formData();

    const backendReq = new Request(`${BACKEND_URL}/swap`, {
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

    // Return the PNG bytes directly to the browser
    const imageBytes = await backendRes.arrayBuffer();
    return new Response(imageBytes, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Content-Disposition": "inline; filename=swapped.png",
      },
    });
  },
};
