import { Head } from "$fresh/runtime.ts";

export default function Error404() {
  return (
    <>
      <Head>
        <title>Page not found – CMeme</title>
      </Head>
      <main class="main simple-page">
        <h1 class="stage-title">404 — Page not found</h1>
        <p class="stage-subtitle">That page doesn't exist.</p>
        <a href="/" class="use-meme-btn">Back to CMeme</a>
      </main>
    </>
  );
}
