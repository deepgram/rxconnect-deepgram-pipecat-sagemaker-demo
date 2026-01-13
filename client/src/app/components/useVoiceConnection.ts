/**
 * =============================================================================
 * useVoiceConnection Hook
 * =============================================================================
 * 
 * This hook manages the WebSocket connection to the voice agent backend.
 * It handles:
 * - Microphone capture and audio streaming
 * - WebSocket communication
 * - Audio playback of TTS responses
 * 
 * Audio Format: 16-bit PCM, 16kHz, mono
 */

'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

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

// -----------------------------------------------------------------------------
// Hook Implementation
// -----------------------------------------------------------------------------

export function useVoiceConnection(wsUrl: string = 'ws://localhost:8000/ws/voice') {
  // State
  const [state, setState] = useState<VoiceConnectionState>({
    isConnected: false,
    isListening: false,
    isMuted: false,
    status: 'Disconnected',
    messages: [],
    error: null,
  });

  // Refs for mutable values that shouldn't trigger re-renders
  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const isMutedRef = useRef<boolean>(false);

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------
  
  const cleanup = useCallback(() => {
    // Disconnect audio processing
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    
    // Stop microphone
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    
    // Close audio context
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Audio Playback
  // ---------------------------------------------------------------------------
  
  /**
   * Play audio from base64-encoded PCM data.
   * Converts 16-bit PCM to Float32 for Web Audio API.
   */
  const playAudio = useCallback(async (base64Audio: string, sampleRate: number) => {
    try {
      // Create audio context for playback
      const audioContext = new AudioContext({ sampleRate });
      
      // Decode base64 to binary
      const binaryString = atob(base64Audio);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      
      // Convert 16-bit PCM to Float32 (Web Audio format)
      const int16Array = new Int16Array(bytes.buffer);
      const float32Array = new Float32Array(int16Array.length);
      for (let i = 0; i < int16Array.length; i++) {
        // Normalize to -1.0 to 1.0 range
        float32Array[i] = int16Array[i] / 32768.0;
      }
      
      // Create audio buffer and play
      const audioBuffer = audioContext.createBuffer(1, float32Array.length, sampleRate);
      audioBuffer.copyToChannel(float32Array, 0);
      
      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContext.destination);
      source.start();
      
      // Clean up when done
      source.onended = () => audioContext.close();
      
    } catch (e) {
      console.error('Audio playback error:', e);
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Microphone Capture
  // ---------------------------------------------------------------------------
  
  /**
   * Start capturing audio from microphone and streaming to server.
   */
  const startListening = useCallback(() => {
    if (!wsRef.current || !mediaStreamRef.current) return;

    try {
      // Create audio context at 16kHz (Deepgram's preferred sample rate)
      audioContextRef.current = new AudioContext({ sampleRate: 16000 });
      sourceRef.current = audioContextRef.current.createMediaStreamSource(mediaStreamRef.current);
      
      // Create processor to access raw audio samples
      // Note: ScriptProcessorNode is deprecated but still widely supported
      // For production, consider using AudioWorklet
      processorRef.current = audioContextRef.current.createScriptProcessor(4096, 1, 1);
      
      processorRef.current.onaudioprocess = (e) => {
        // Don't send audio if muted
        if (isMutedRef.current) return;
        
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          // Get audio samples
          const inputData = e.inputBuffer.getChannelData(0);
          
          // Convert Float32 to Int16 (16-bit PCM)
          const int16Array = new Int16Array(inputData.length);
          for (let i = 0; i < inputData.length; i++) {
            const s = Math.max(-1, Math.min(1, inputData[i]));
            int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
          }
          
          // Send binary audio data to server
          wsRef.current.send(int16Array.buffer);
        }
      };

      // Connect audio pipeline
      sourceRef.current.connect(processorRef.current);
      processorRef.current.connect(audioContextRef.current.destination);

      setState(prev => ({
        ...prev,
        isListening: true,
        status: 'Listening',
      }));
      
    } catch (e) {
      console.error('Listening error:', e);
    }
  }, []);

  // ---------------------------------------------------------------------------
  // WebSocket Connection
  // ---------------------------------------------------------------------------
  
  /**
   * Connect to voice agent backend.
   */
  const connect = useCallback(async () => {
    try {
      setState(prev => ({ ...prev, status: 'Connecting...', error: null }));

      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        }
      });
      mediaStreamRef.current = stream;

      // Create WebSocket connection
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setState(prev => ({
          ...prev,
          isConnected: true,
          status: 'Connected',
        }));
        
        // Auto-start listening after connection
        setTimeout(() => startListening(), 500);
      };

      ws.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data);
          
          switch (data.type) {
            case 'transcript':
              // New message from user or assistant
              const newMessage: Message = {
                id: Date.now().toString(),
                text: data.text,
                speaker: data.speaker,
                timestamp: new Date(),
              };
              setState(prev => ({
                ...prev,
                messages: [...prev.messages, newMessage],
              }));
              break;
              
            case 'status':
              // Status update
              setState(prev => ({
                ...prev,
                status: data.message || data.status,
              }));
              break;
              
            case 'audio':
              // TTS audio to play
              await playAudio(data.data, data.sampleRate || 16000);
              break;
              
            case 'error':
              // Error message
              setState(prev => ({
                ...prev,
                error: data.message,
              }));
              break;
              
            case 'disconnect':
              // Server-initiated disconnect (e.g., after goodbye)
              console.log('Server requested disconnect:', data.reason);
              setState(prev => ({
                ...prev,
                status: 'Call ended',
              }));
              break;
          }
        } catch (e) {
          console.error('Message parse error:', e);
        }
      };

      ws.onerror = () => {
        setState(prev => ({
          ...prev,
          error: 'WebSocket connection error',
          status: 'Error',
        }));
      };

      ws.onclose = () => {
        setState(prev => ({
          ...prev,
          isConnected: false,
          isListening: false,
          status: 'Disconnected',
        }));
        cleanup();
      };

    } catch (e) {
      setState(prev => ({
        ...prev,
        error: `Connection failed: ${e}`,
        status: 'Error',
      }));
    }
  }, [wsUrl, cleanup, playAudio, startListening]);

  /**
   * Disconnect from voice agent.
   */
  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    cleanup();
    setState(prev => ({
      ...prev,
      isConnected: false,
      isListening: false,
      status: 'Disconnected',
    }));
  }, [cleanup]);

  /**
   * Toggle microphone mute.
   */
  const toggleMute = useCallback(() => {
    isMutedRef.current = !isMutedRef.current;
    setState(prev => ({
      ...prev,
      isMuted: isMutedRef.current,
      status: isMutedRef.current ? 'Muted' : 'Listening',
    }));
  }, []);

  /**
   * Reset conversation history.
   */
  const resetConversation = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'reset' }));
    }
    setState(prev => ({
      ...prev,
      messages: [],
    }));
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => disconnect();
  }, [disconnect]);

  return {
    ...state,
    connect,
    disconnect,
    toggleMute,
    resetConversation,
  };
}

