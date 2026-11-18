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
  const playersRef = useRef(new Set<AnalyserNode>());
  const playingRef = useRef(0);

  const playAudio = useCallback((base64Data: string, sampleRate: number) => {
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

      const playbackCtx = new AudioContext({ sampleRate });
      const buffer = playbackCtx.createBuffer(1, float32.length, sampleRate);
      buffer.getChannelData(0).set(float32);

      const source = playbackCtx.createBufferSource();
      source.buffer = buffer;
      const analyser = playbackCtx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      analyser.connect(playbackCtx.destination);
      source.start();
      playersRef.current.add(analyser);
      if (playingRef.current++ === 0) dispatch({ type: 'PlaybackStarted' });
      source.onended = () => {
        playersRef.current.delete(analyser);
        playbackCtx.close();
        if (--playingRef.current === 0) dispatch({ type: 'PlaybackEnded' });
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
  }, [wsBase, httpBase, playAudio, startMicrophone, stopMicrophone]);

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    stopMicrophone();
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
  }, [stopMicrophone]);

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
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
      }
    };
  }, [stopMicrophone]);

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
      for (const analyser of playersRef.current) {
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        playback = Math.max(playback, Math.sqrt(sum / buf.length));
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
