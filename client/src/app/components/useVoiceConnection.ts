'use client';

import { useState, useRef, useCallback, useEffect, useReducer } from 'react';

import { agentReducer, initialAgentView, type AgentEvent } from '@/voice/agentTurns';

export interface VoiceConnectionState {
  isConnected: boolean;
  isListening: boolean;
  isMuted: boolean;
  status: string;
  error: string | null;
}

function getBaseUrl(): { ws: string; http: string } {
  if (typeof window === 'undefined') {
    return { ws: 'ws://localhost:8000', http: '' };
  }
  const host = window.location.host;
  if (host.includes('localhost') || host.includes('127.0.0.1')) {
    return { ws: 'ws://localhost:8000', http: '' };
  }
  const wProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return { ws: `${wProto}//${host}`, http: '' };
}

async function fetchWsToken(httpBase: string): Promise<string> {
  const res = await fetch(`${httpBase}/api/token`, { method: 'POST' });
  if (!res.ok) throw new Error(`Token request failed: ${res.status}`);
  const data = await res.json();
  return data.token;
}

export function useVoiceConnection(wsUrl?: string) {
  const baseUrls = getBaseUrl();
  const wsBase = wsUrl ?? baseUrls.ws;
  const httpBase = baseUrls.http;
  const [state, setState] = useState<VoiceConnectionState>({
    isConnected: false,
    isListening: false,
    isMuted: false,
    status: 'Disconnected',
    error: null,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // The kit's view of the call (src/voice/agentTurns.ts), fed from the same messages
  const [view, dispatch] = useReducer(agentReducer, initialAgentView);
  // The voice ring's level, 0..1: the louder of the caller's mic and the agent's playback
  const levelRef = useRef(0);
  const micLevelRef = useRef(0);

  // The agent's audio: one context, with each chunk scheduled to start where the last one ends
  const playbackCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourcesRef = useRef(new Set<AudioBufferSourceNode>());
  const playheadRef = useRef(0);
  const playingRef = useRef(false);
  const endedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelEndedTimer = () => {
    if (endedTimerRef.current) {
      clearTimeout(endedTimerRef.current);
      endedTimerRef.current = null;
    }
  };

  /** Created on Connect, from the click, so the browser lets it play */
  const openPlayback = useCallback(() => {
    if (playbackCtxRef.current) return;
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.connect(ctx.destination);
    playbackCtxRef.current = ctx;
    analyserRef.current = analyser;
    playheadRef.current = 0;
  }, []);

  /** Drop everything queued: the caller interrupted ("clear"), or the call ended */
  const stopPlayback = useCallback(() => {
    cancelEndedTimer();
    for (const source of sourcesRef.current) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // Not started yet
      }
    }
    sourcesRef.current.clear();
    playheadRef.current = 0;
    if (playingRef.current) {
      playingRef.current = false;
      dispatch({ type: 'PlaybackEnded' });
    }
  }, []);

  const closePlayback = useCallback(() => {
    stopPlayback();
    playbackCtxRef.current?.close();
    playbackCtxRef.current = null;
    analyserRef.current = null;
  }, [stopPlayback]);

  const playAudio = useCallback((base64Data: string, sampleRate: number) => {
    const ctx = playbackCtxRef.current;
    const analyser = analyserRef.current;
    if (!ctx || !analyser) return;
    try {
      const binaryStr = atob(base64Data);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }

      const int16 = new Int16Array(bytes.buffer);
      const float32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) {
        float32[i] = int16[i] / 32768.0;
      }

      // The buffer keeps its own rate; the context resamples it
      const buffer = ctx.createBuffer(1, float32.length, sampleRate);
      buffer.getChannelData(0).set(float32);

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(analyser);
      // Right after what's queued, or a moment from now if the queue has run dry
      const startAt = Math.max(ctx.currentTime + 0.05, playheadRef.current);
      source.start(startAt);
      playheadRef.current = startAt + buffer.duration;
      sourcesRef.current.add(source);
      cancelEndedTimer();
      if (!playingRef.current) {
        playingRef.current = true;
        dispatch({ type: 'PlaybackStarted' });
      }

      source.onended = () => {
        sourcesRef.current.delete(source);
        if (sourcesRef.current.size > 0) return;
        // Wait a beat in case the next chunk is on its way, then tell the server the agent
        // has actually finished talking (it holds BotStoppedSpeaking until it hears this)
        endedTimerRef.current = setTimeout(() => {
          endedTimerRef.current = null;
          if (sourcesRef.current.size > 0) return;
          playingRef.current = false;
          dispatch({ type: 'PlaybackEnded' });
          const ws = wsRef.current;
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'playback-ended' }));
          }
        }, 150);
      };
    } catch (e) {
      console.error('Audio playback error:', e);
    }
  }, []);

  const startMicrophone = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      streamRef.current = stream;

      const audioContext = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      sourceRef.current = source;

      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      scriptProcessorRef.current = processor;

      processor.onaudioprocess = (e) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          const inputData = e.inputBuffer.getChannelData(0);
          const int16 = new Int16Array(inputData.length);
          let sum = 0;
          for (let i = 0; i < inputData.length; i++) {
            const s = Math.max(-1, Math.min(1, inputData[i]));
            int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
            sum += s * s;
          }
          micLevelRef.current = Math.max(micLevelRef.current, Math.sqrt(sum / inputData.length));
          wsRef.current.send(int16.buffer);
        }
      };

      source.connect(processor);
      processor.connect(audioContext.destination);
    } catch (e) {
      console.error('Microphone error:', e);
      setState(prev => ({ ...prev, error: `Microphone error: ${e}` }));
    }
  }, []);

  const stopMicrophone = useCallback(() => {
    if (scriptProcessorRef.current) {
      scriptProcessorRef.current.disconnect();
      scriptProcessorRef.current = null;
    }
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
  }, []);

  const connect = useCallback(async () => {
    try {
      setState(prev => ({ ...prev, status: 'Connecting...', error: null }));
      dispatch({ type: 'reset' });
      openPlayback();

      const token = await fetchWsToken(httpBase);
      const ws = new WebSocket(`${wsBase}/ws/voice?token=${encodeURIComponent(token)}`);
      wsRef.current = ws;

      ws.onopen = async () => {
        setState(prev => ({
          ...prev,
          isConnected: true,
          isListening: true,
          status: 'Listening',
        }));
        await startMicrophone();

        pingIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, 15000);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          dispatch(data as AgentEvent);

          switch (data.type) {
            case 'audio':
              playAudio(data.data, data.sampleRate || 16000);
              break;
            case 'clear':
              // The caller started talking over the agent: stop it mid-word
              stopPlayback();
              break;
            case 'status':
              setState(prev => ({ ...prev, status: data.message || data.status }));
              break;
            case 'error':
              setState(prev => ({ ...prev, error: data.message }));
              break;
            case 'disconnect':
              ws.close();
              break;
            case 'pong':
              break;
          }
        } catch (e) {
          console.error('Message parse error:', e);
        }
      };

      ws.onclose = () => {
        setState(prev => ({
          ...prev,
          isConnected: false,
          isListening: false,
          status: 'Disconnected',
        }));
        stopMicrophone();
        closePlayback();
        if (pingIntervalRef.current) {
          clearInterval(pingIntervalRef.current);
          pingIntervalRef.current = null;
        }
      };

      ws.onerror = (e) => {
        console.error('WebSocket error:', e);
        setState(prev => ({ ...prev, error: 'Connection error' }));
      };
    } catch (e) {
      setState(prev => ({
        ...prev,
        error: `Connection failed: ${e}`,
        status: 'Error',
      }));
    }
  }, [wsBase, httpBase, openPlayback, playAudio, stopPlayback, closePlayback, startMicrophone, stopMicrophone]);

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    stopMicrophone();
    closePlayback();
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }
    setState(prev => ({
      ...prev,
      isConnected: false,
      isListening: false,
      isMuted: false,
      status: 'Disconnected',
    }));
  }, [stopMicrophone, closePlayback]);

  const toggleMute = useCallback(() => {
    if (streamRef.current) {
      const track = streamRef.current.getAudioTracks()[0];
      if (track) {
        track.enabled = !track.enabled;
        const muted = !track.enabled;
        setState(prev => ({
          ...prev,
          isMuted: muted,
          status: muted ? 'Muted' : 'Listening',
        }));
      }
    }
  }, []);

  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      stopMicrophone();
      closePlayback();
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
      }
    };
  }, [stopMicrophone, closePlayback]);

  /** A clicked prompt: the server handles it as if the caller had said it */
  const sendText = useCallback((text: string) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN && text.trim()) {
      ws.send(JSON.stringify({ type: 'user-text', text }));
    }
  }, []);

  // Smooth the level for the ring, once a frame
  useEffect(() => {
    const buf = new Float32Array(1024);
    let frame = 0;
    const tick = () => {
      let playback = 0;
      const analyser = analyserRef.current;
      if (analyser && sourcesRef.current.size > 0) {
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        playback = Math.sqrt(sum / buf.length);
      }
      const target = Math.min(1, Math.max(playback, micLevelRef.current) * 4);
      levelRef.current += (target - levelRef.current) * 0.3;
      micLevelRef.current *= 0.92;
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, []);

  return {
    ...state,
    view,
    levelRef,
    connect,
    disconnect,
    toggleMute,
    sendText,
  };
}
