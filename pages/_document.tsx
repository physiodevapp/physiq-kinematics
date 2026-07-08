import { Html, Head, Main, NextScript } from "next/document";

export default function Document() {
  return (
    <Html lang="es" className="dark">
      <Head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Serif+Display&family=Outfit:wght@300;400;500;600&display=swap" rel="stylesheet" />
      </Head>
      <body className="antialiased dark overflow-hidden bg-black text-white">
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
