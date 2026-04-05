import { Head } from "$fresh/runtime.ts";

export default function TOS() {
  return (
    <>
      <Head>
        <title>Terms of Service - CMeme</title>
      </Head>
      <div class="app">
        <header class="header">
          <div class="header-inner">
            <div class="logo">
              <a href="/" style="text-decoration: none; color: inherit;">
                <span class="logo-icon">😂</span>
                <span class="logo-text">C<span class="logo-accent">Meme</span></span>
              </a>
            </div>
          </div>
        </header>

        <main class="main" style="max-width: 800px; margin: 0 auto; padding: 40px 20px;">
          <h1 style="margin-bottom: 24px;">Terms of Service</h1>
          <section style="line-height: 1.6; color: rgba(255,255,255,0.9);">
            <p style="margin-bottom: 16px;">Welcome to CMeme. By using our service, you agree to these terms.</p>
            <h2 style="margin-top: 32px; margin-bottom: 16px;">Acceptable Use</h2>
            <p style="margin-bottom: 16px;">You agree that you will not use CMeme to generate any content that is:</p>
            <ul style="list-style: disc; margin-left: 24px; margin-bottom: 16px;">
              <li style="margin-bottom: 8px;">Used for bullying, harassment, or intimidation of any individual.</li>
              <li style="margin-bottom: 8px;">Non-consensual explicit or sexually suggestive content (e.g., "deepfakes").</li>
              <li style="margin-bottom: 8px;">Defamatory, malicious, or otherwise harmful to real people.</li>
              <li style="margin-bottom: 8px;">Illegal or depicting illegal activities.</li>
            </ul>
            <h2 style="margin-top: 32px; margin-bottom: 16px;">User Responsibility</h2>
            <p style="margin-bottom: 16px;">You are solely responsible for all images you upload and generate. CMeme claims no ownership over your source images or the final output. However, we reserve the right to ban users who abuse the platform or violate these terms.</p>
            <h2 style="margin-top: 32px; margin-bottom: 16px;">Privacy & Data Storage</h2>
            <p style="margin-bottom: 16px;">We take your privacy seriously. Here is exactly how we use the images you supply:</p>
            <ul style="list-style: disc; margin-left: 24px; margin-bottom: 16px;">
              <li style="margin-bottom: 8px;"><strong>Face Swapping Only:</strong> Uploaded images are used exclusively to extract facial features and apply them to the selected meme.</li>
              <li style="margin-bottom: 8px;"><strong>No Data Stored:</strong> We do not store, save, or log any of your uploaded photos or the resulting generated memes on our servers or databases.</li>
              <li style="margin-bottom: 8px;"><strong>In-Memory Processing:</strong> Your images are processed securely within active memory (RAM) and are immediately and permanently discarded once the face swap is complete.</li>
              <li style="margin-bottom: 8px;"><strong>Local Storage Only:</strong> Any persistence of your uploaded faces and recent creations across sessions is stored entirely and exclusively in your own web browser's local storage on your personal device.</li>
            </ul>
          </section>
        </main>
      </div>
    </>
  );
}
