import "@/styles/globals.css";
import type { AppProps } from "next/app";
import { SettingsProvider } from "@/providers/Settings";
import { TensorFlowProvider, useTensorFlow } from "@/providers/TensorFlow";
import { PoseDetectorProvider } from "@/providers/PoseDetector";

const TensorFlowDetectorWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const isTfReady = useTensorFlow();
  return (
    <PoseDetectorProvider isTfReady={isTfReady}>
      {children}
    </PoseDetectorProvider>
  );
};

export default function App({ Component, pageProps }: AppProps) {
  return (
    <SettingsProvider>
      <TensorFlowProvider>
        <TensorFlowDetectorWrapper>
          <Component {...pageProps} />
        </TensorFlowDetectorWrapper>
      </TensorFlowProvider>
    </SettingsProvider>
  );
}
