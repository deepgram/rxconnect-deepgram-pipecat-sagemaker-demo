/**
 * =============================================================================
 * Main Application Component
 * =============================================================================
 * 
 * Voice agent demo UI with:
 * - Connect/disconnect controls
 * - Mute toggle
 * - Conversation display
 */

'use client';

import { ConversationPanel } from './ConversationPanel';
import { useVoiceConnection } from './useVoiceConnection';

export const App = () => {
  const {
    isConnected,
    isListening,
    isMuted,
    status,
    messages,
    error,
    connect,
    disconnect,
    toggleMute,
    resetConversation,
  } = useVoiceConnection('ws://localhost:8000/ws/voice');

  return (
    <div className="flex flex-col w-full h-dvh bg-gradient-to-br from-zinc-950 to-zinc-900">
      {/* Header */}
      <header className="flex items-center justify-between px-8 py-5 border-b border-zinc-800">
        <div className="flex items-center gap-4">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" 
                  d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" 
                />
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">Voice Agent Demo</h1>
              <p className="text-xs text-zinc-500">Deepgram + Pipecat + SageMaker</p>
            </div>
          </div>
        </div>
        
        {/* Controls */}
        <div className="flex items-center gap-3">
          {/* Mute Button */}
          {isConnected && (
            <button
              onClick={toggleMute}
              className={`w-12 h-12 rounded-full flex items-center justify-center transition-all duration-200 ${
                isMuted 
                  ? 'bg-red-500/20 border-2 border-red-500/50' 
                  : 'bg-blue-500/15 border-2 border-blue-500/40'
              } ${isListening && !isMuted ? 'shadow-lg shadow-blue-500/20' : ''}`}
              title={isMuted ? 'Unmute microphone' : 'Mute microphone'}
            >
              {isMuted ? (
                <svg className="w-5 h-5 text-red-500" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z"/>
                </svg>
              ) : (
                <svg className="w-5 h-5 text-blue-400" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1 1.93c-3.94-.49-7-3.85-7-7.93h2c0 3.31 2.69 6 6 6s6-2.69 6-6h2c0 4.08-3.06 7.44-7 7.93V19h4v2H8v-2h4v-3.07z"/>
                </svg>
              )}
            </button>
          )}

          {/* Connect/Disconnect Button */}
          <button
            onClick={isConnected ? disconnect : connect}
            className={`px-5 py-2.5 rounded-lg font-medium text-sm transition-all duration-200 ${
              isConnected 
                ? 'bg-purple-500/15 border border-purple-500/40 text-purple-400 hover:bg-purple-500/25' 
                : 'bg-zinc-800 border border-zinc-700 text-white hover:bg-zinc-700'
            }`}
          >
            {isConnected ? 'Disconnect' : 'Connect'}
          </button>

          {/* Reset Button */}
          {isConnected && messages.length > 0 && (
            <button
              onClick={resetConversation}
              className="p-2.5 rounded-lg bg-zinc-800 border border-zinc-700 hover:bg-zinc-700 transition-colors"
              title="Reset conversation"
            >
              <svg className="w-4 h-4 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" 
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
            </button>
          )}
        </div>
      </header>

      {/* Error Banner */}
      {error && (
        <div className="px-8 py-3 bg-red-500/10 border-b border-red-500/20">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 overflow-hidden p-6">
        <div className="h-full max-w-4xl mx-auto">
          <div className="h-full rounded-xl bg-zinc-900 border border-zinc-800 overflow-hidden">
            <ConversationPanel 
              messages={messages} 
              status={status}
              isListening={isListening}
              isMuted={isMuted}
            />
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="px-8 py-4 border-t border-zinc-800">
        <div className="flex items-center justify-center gap-4 text-sm text-zinc-500">
          <span>Built with</span>
          <a 
            href="https://deepgram.com" 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-purple-400 hover:text-purple-300 transition-colors"
          >
            Deepgram
          </a>
          <span>+</span>
          <a 
            href="https://github.com/pipecat-ai/pipecat" 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-purple-400 hover:text-purple-300 transition-colors"
          >
            Pipecat
          </a>
          <span>+</span>
          <a 
            href="https://aws.amazon.com/sagemaker/" 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-purple-400 hover:text-purple-300 transition-colors"
          >
            AWS SageMaker
          </a>
        </div>
      </footer>
    </div>
  );
};

