/**
 * Latency Gantt Chart Component
 * 
 * Visualizes the latency breakdown of voice agent responses in a Gantt chart style.
 * Shows overlapping phases: ASR, LLM (first token, streaming), TTS chunks, and audio playback.
 */

import { useEffect, useRef, useState } from 'react';
import './LatencyGantt.css';

export interface LatencyPhase {
  phase: string;
  timestamp: number;
  duration?: number;
  ttfs?: number;
  tokenCount?: number;
  chunkIndex?: number;
  text?: string;
}

interface LatencyGanttProps {
  phases: LatencyPhase[];
  responseId?: string;
}

interface GanttBar {
  label: string;
  start: number;
  end: number;
  color: string;
  sublabel?: string;
}

export function LatencyGantt({ phases, responseId }: LatencyGanttProps) {
  const [bars, setBars] = useState<GanttBar[]>([]);
  const [totalDuration, setTotalDuration] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (phases.length === 0) return;

    // Find start time (first phase)
    const startTime = phases[0].timestamp;
    
    // Build Gantt bars from phases
    const newBars: GanttBar[] = [];
    let llmStart = 0;
    let llmEnd = 0;
    let firstToken = 0;
    const ttsChunks: { start: number; end: number; index: number }[] = [];

    for (const phase of phases) {
      const relativeTime = phase.timestamp - startTime;

      switch (phase.phase) {
        case 'llm_start':
          llmStart = relativeTime;
          break;

        case 'llm_first_token':
          firstToken = relativeTime;
          break;

        case 'llm_end':
          llmEnd = relativeTime;
          // Add LLM bar
          newBars.push({
            label: 'LLM Stream',
            start: llmStart,
            end: llmEnd,
            color: '#3b82f6',
            sublabel: phase.tokenCount ? `${phase.tokenCount} tokens` : undefined,
          });
          // Add first token marker
          if (firstToken > llmStart) {
            newBars.push({
              label: 'First Token',
              start: llmStart,
              end: firstToken,
              color: '#8b5cf6',
              sublabel: `${firstToken - llmStart}ms`,
            });
          }
          break;

        case 'tts_chunk_start':
          ttsChunks.push({
            start: relativeTime,
            end: relativeTime, // Will be updated on chunk_end
            index: phase.chunkIndex ?? ttsChunks.length,
          });
          break;

        case 'tts_chunk_end':
          const chunkIndex = phase.chunkIndex ?? ttsChunks.length - 1;
          if (ttsChunks[chunkIndex]) {
            ttsChunks[chunkIndex].end = relativeTime;
            newBars.push({
              label: `TTS Chunk ${chunkIndex + 1}`,
              start: ttsChunks[chunkIndex].start,
              end: ttsChunks[chunkIndex].end,
              color: '#10b981',
              sublabel: `${phase.duration}ms`,
            });
          }
          break;

        case 'first_audio':
          // Add TTFS marker
          if (phase.ttfs && phase.ttfs > 0) {
            newBars.push({
              label: 'TTFS',
              start: Math.max(0, relativeTime - phase.ttfs),
              end: relativeTime,
              color: '#f59e0b',
              sublabel: `${phase.ttfs}ms`,
            });
          }
          break;
      }
    }

    setBars(newBars);

    // Calculate total duration
    const maxEnd = Math.max(...newBars.map(b => b.end), 0);
    setTotalDuration(maxEnd);
  }, [phases]);

  useEffect(() => {
    if (!canvasRef.current || bars.length === 0) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    // Clear canvas
    ctx.clearRect(0, 0, rect.width, rect.height);

    // Draw bars
    const padding = 10;
    const barHeight = 30;
    const barSpacing = 10;
    const labelWidth = 120;
    const chartWidth = rect.width - labelWidth - padding * 2;

    bars.forEach((bar, index) => {
      const y = padding + index * (barHeight + barSpacing);
      const x = labelWidth + (bar.start / totalDuration) * chartWidth;
      const width = ((bar.end - bar.start) / totalDuration) * chartWidth;

      // Draw bar
      ctx.fillStyle = bar.color;
      ctx.fillRect(x, y, width, barHeight);

      // Draw label
      ctx.fillStyle = '#fff';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(bar.label, labelWidth - 10, y + barHeight / 2 + 4);

      // Draw sublabel (duration)
      if (bar.sublabel) {
        ctx.fillStyle = '#fff';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(bar.sublabel, x + width / 2, y + barHeight / 2 + 3);
      }
    });

    // Draw time axis
    const axisY = padding + bars.length * (barHeight + barSpacing);
    ctx.strokeStyle = '#4b5563';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(labelWidth, axisY);
    ctx.lineTo(rect.width - padding, axisY);
    ctx.stroke();

    // Draw time labels
    const timeSteps = 5;
    for (let i = 0; i <= timeSteps; i++) {
      const time = (totalDuration / timeSteps) * i;
      const x = labelWidth + (time / totalDuration) * chartWidth;
      
      ctx.fillStyle = '#9ca3af';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${Math.round(time)}ms`, x, axisY + 15);
    }
  }, [bars, totalDuration]);

  if (phases.length === 0) {
    return (
      <div className="latency-gantt-empty">
        <p>No latency data yet. Make a request to see the breakdown.</p>
      </div>
    );
  }

  return (
    <div className="latency-gantt">
      <div className="latency-gantt-header">
        <h3>Response Latency Breakdown</h3>
        <span className="latency-gantt-total">{Math.round(totalDuration)}ms total</span>
      </div>
      <canvas ref={canvasRef} className="latency-gantt-canvas" />
      <div className="latency-gantt-legend">
        <div className="legend-item">
          <span className="legend-color" style={{ backgroundColor: '#8b5cf6' }}></span>
          <span>First Token</span>
        </div>
        <div className="legend-item">
          <span className="legend-color" style={{ backgroundColor: '#3b82f6' }}></span>
          <span>LLM Stream</span>
        </div>
        <div className="legend-item">
          <span className="legend-color" style={{ backgroundColor: '#10b981' }}></span>
          <span>TTS Synthesis</span>
        </div>
        <div className="legend-item">
          <span className="legend-color" style={{ backgroundColor: '#f59e0b' }}></span>
          <span>TTFS</span>
        </div>
      </div>
    </div>
  );
}


