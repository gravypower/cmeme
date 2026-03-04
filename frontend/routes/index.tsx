import { Head } from "$fresh/runtime.ts";
import SwapForm from "../islands/SwapForm.tsx";

export default function Home() {
  return (
    <>
      <Head>
        <title>CMeme – AI Meme Face Swapper</title>
        <meta name="description" content="Replace faces in any meme with someone else's face using AI. Powered by InsightFace." />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
        <link rel="stylesheet" href="/styles.css" />
      </Head>

      <div class="app">
        {/* Header */}
        <header class="header">
          <div class="header-inner">
            <div class="logo">
              <span class="logo-icon">😂</span>
              <span class="logo-text">C<span class="logo-accent">Meme</span></span>
            </div>
            <p class="header-tagline">AI Meme Face Swapper — powered by InsightFace</p>
          </div>
        </header>

        {/* Main */}
        <main class="main">
          <SwapForm />
        </main>

        {/* Footer */}
        <footer class="footer">
          <p>Built with 🦕 Deno Fresh + 🐍 Python InsightFace</p>
        </footer>
      </div>
    </>
  );
}
