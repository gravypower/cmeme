import { Handlers } from "$fresh/server.ts";

type ImgflipMeme = {
  id: string;
  name: string;
  url: string;
  width: number;
  height: number;
  box_count: number;
};

export const handler: Handlers = {
  async GET() {
    const res = await fetch("https://api.imgflip.com/get_memes");
    if (!res.ok) {
      return new Response(JSON.stringify({ error: "Failed to fetch memes" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }
    const json = await res.json();
    const memes: ImgflipMeme[] = json?.data?.memes ?? [];
    return new Response(JSON.stringify(memes), {
      headers: { "Content-Type": "application/json" },
    });
  },
};
