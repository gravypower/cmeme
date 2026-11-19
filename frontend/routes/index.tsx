import { Head } from "$fresh/runtime.ts";
import SwapForm from "../islands/SwapForm.tsx";

export default function Home() {
  return (
    <>
      <Head>
        <title>CMeme – AI Meme Face Swapper</title>
        <meta name="description" content="Swap faces into any meme with a choice of AI face-swap, restoration and upscaling models." />
      </Head>

      <div class="app">
        {/* Header */}
        <header class="header">
          <div class="header-inner">
            <div class="logo">
              <span class="logo-icon">😂</span>
              <span class="logo-text">C<span class="logo-accent">Meme</span></span>
            </div>
            <p class="header-tagline">AI Meme Face Swapper</p>
          </div>
        </header>

        {/* Main */}
        <main class="main">
          <SwapForm />
        </main>

        {/* Footer */}
        <footer class="footer">
          <p>Built with 🦕 Deno Fresh + 🐍 ONNX Runtime · <a href="/tos">Terms</a></p>
        </footer>
      </div>
    </>
  );
}
