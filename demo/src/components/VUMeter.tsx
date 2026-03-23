/**
 * VU Meter Component
 * 
 * Visual audio level meter to verify microphone input
 */

import { useEffect, useRef } from 'react';
import './VUMeter.css';

interface VUMeterProps {
  audioContext: AudioContext | null;
  mediaStream: MediaStream | null;
}

export function VUMeter({ audioContext, mediaStream }: VUMeterProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const analyzerRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!audioContext || !mediaStream || !canvasRef.current) {
      // Clean up if no audio
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      return;
    }

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Create analyzer
    const analyzer = audioContext.createAnalyser();
    analyzer.fftSize = 2048;
    analyzer.smoothingTimeConstant = 0.8;

    const source = audioContext.createMediaStreamSource(mediaStream);
    source.connect(analyzer);

    analyzerRef.current = analyzer;

    const bufferLength = analyzer.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    // Draw function
    const draw = () => {
      if (!analyzer || !ctx) return;

      analyzer.getByteTimeDomainData(dataArray);

      // Calculate RMS (Root Mean Square) for volume level
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        const normalized = (dataArray[i] - 128) / 128;
        sum += normalized * normalized;
      }
      const rms = Math.sqrt(sum / bufferLength);
      const level = Math.min(1, rms * 5); // Scale up for visibility

      // Clear canvas
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Draw level bar
      const barWidth = canvas.width * level;
      
      // Gradient color based on level
      let color;
      if (level < 0.3) {
        color = '#4ade80'; // Green
      } else if (level < 0.7) {
        color = '#facc15'; // Yellow
      } else {
        color = '#ef4444'; // Red
      }

      ctx.fillStyle = color;
      ctx.fillRect(0, 0, barWidth, canvas.height);

      // Draw level markers
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 1;
      for (let i = 0; i <= 10; i++) {
        const x = (canvas.width / 10) * i;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
      }

      // Draw level percentage
      ctx.fillStyle = level > 0.5 ? '#000' : '#fff';
      ctx.font = '12px monospace';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${Math.round(level * 100)}%`, canvas.width - 5, canvas.height / 2);

      animationFrameRef.current = requestAnimationFrame(draw);
    };

    draw();

    // Cleanup
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      source.disconnect();
    };
  }, [audioContext, mediaStream]);

  if (!audioContext || !mediaStream) {
    return (
      <div className="vu-meter-container">
        <div className="vu-meter-label">🎤 Microphone Level</div>
        <canvas ref={canvasRef} className="vu-meter-canvas disabled" width={300} height={40} />
        <div className="vu-meter-status">Not connected</div>
      </div>
    );
  }

  return (
    <div className="vu-meter-container">
      <div className="vu-meter-label">🎤 Microphone Level</div>
      <canvas ref={canvasRef} className="vu-meter-canvas" width={300} height={40} />
      <div className="vu-meter-status">Active - Speak to test</div>
    </div>
  );
}

