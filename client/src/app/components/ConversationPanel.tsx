/**
 * =============================================================================
 * ConversationPanel Component
 * =============================================================================
 * 
 * Displays the conversation between user and voice assistant.
 * Messages auto-scroll as new ones arrive.
 */

'use client';

import { useEffect, useRef } from 'react';
import { Message } from './useVoiceConnection';

interface ConversationPanelProps {
  messages: Message[];
  status: string;
  isListening: boolean;
  isMuted: boolean;
}

export function ConversationPanel({ 
  messages, 
  status, 
  isListening, 
  isMuted 
}: ConversationPanelProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-5 py-4 border-b border-zinc-800">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">Conversation</h2>
          <div className="flex items-center gap-2">
            {/* Listening indicator */}
            {isListening && !isMuted && (
              <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/15">
                <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                <span className="text-xs text-blue-400">Listening</span>
              </div>
            )}
            
            {/* Muted indicator */}
            {isMuted && (
              <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-red-500/15">
                <div className="w-2 h-2 rounded-full bg-red-500" />
                <span className="text-xs text-red-400">Muted</span>
              </div>
            )}
            
            {/* Status badge */}
            <span className={`text-xs px-3 py-1 rounded-full ${
              status === 'Disconnected' 
                ? 'bg-zinc-800 text-zinc-400' 
                : 'bg-purple-500/10 text-purple-400'
            }`}>
              {status}
            </span>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 ? (
          // Empty state
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4 bg-purple-500/10 border border-purple-500/20">
              <svg 
                className="w-8 h-8 text-purple-400" 
                fill="none" 
                stroke="currentColor" 
                viewBox="0 0 24 24"
              >
                <path 
                  strokeLinecap="round" 
                  strokeLinejoin="round" 
                  strokeWidth="1.5" 
                  d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" 
                />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-white mb-2">Ready to assist</h3>
            <p className="text-sm text-zinc-500 max-w-xs">
              Click "Connect" to start a conversation with the pharmacy assistant.
            </p>
          </div>
        ) : (
          // Message list
          messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${message.speaker === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] px-4 py-3 rounded-2xl ${
                  message.speaker === 'user' 
                    ? 'rounded-br-md bg-purple-500/15 border border-purple-500/25' 
                    : 'rounded-bl-md bg-zinc-800 border border-zinc-700'
                }`}
              >
                <p className="text-sm leading-relaxed text-zinc-200">
                  {message.text}
                </p>
                <p className="text-[10px] mt-1.5 text-zinc-500">
                  {message.timestamp.toLocaleTimeString([], { 
                    hour: '2-digit', 
                    minute: '2-digit' 
                  })}
                </p>
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}

