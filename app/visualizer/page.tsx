import type { Metadata } from 'next';
import { AudioVisualizer } from '@/components/studio/AudioVisualizer';

export const metadata: Metadata = {
  title: 'XYP3RN TECH — Audio Reactive Visualizer',
  description: 'A local, audio-reactive XYP3RN orb visualizer with live microphone and custom-file input.',
};

export default function VisualizerPage() {
  return <AudioVisualizer />;
}
