import "@/styles/globals.css";
import type { AppProps } from "next/app";
import { SettingsProvider } from "@/providers/Settings";
import { PoseDetectorProvider } from "@/providers/PoseDetector";

export default function App({ Component, pageProps }: AppProps) {
  return (
    <SettingsProvider>
      <PoseDetectorProvider>
        <Component {...pageProps} />
      </PoseDetectorProvider>
    </SettingsProvider>
  );
}
