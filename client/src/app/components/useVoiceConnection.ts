'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

export interface Message {
  id: string;
  text: string;
  speaker: 'user' | 'assistant';
  timestamp: Date;
}

export interface VoiceConnectionState {
  isConnected: boolean;
  isListening: boolean;
  isMuted: boolean;
  status: string;
  messages: Message[];
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
    messages: [],
    error: null,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const addMessage = useCallback((text: string, speaker: 'user' | 'assistant') => {
    if (!text.trim()) return;
    const msg: Message = {
      id: Date.now().toString() + Math.random(),
      text,
      speaker,
      timestamp: new Date(),
    };
    setState(prev => ({ ...prev, messages: [...prev.messages, msg] }));
  }, []);

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
      source.connect(playbackCtx.destination);
      source.start();
      source.onended = () => playbackCtx.close();
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
          for (let i = 0; i < inputData.length; i++) {
            const s = Math.max(-1, Math.min(1, inputData[i]));
            int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
          }
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

          switch (data.type) {
            case 'transcript':
              addMessage(data.text, data.speaker);
              break;
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
  }, [wsBase, httpBase, addMessage, playAudio, startMicrophone, stopMicrophone]);

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

  const resetConversation = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'reset' }));
    }
    setState(prev => ({ ...prev, messages: [] }));
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

  return {
    ...state,
    connect,
    disconnect,
    toggleMute,
    resetConversation,
  };
}
