'use client';

import { useEffect, useRef } from 'react';
import { Message } from './useVoiceConnection';

interface ConversationPanelProps {
  messages: Message[];
  status: string;
  isListening: boolean;
  isMuted: boolean;
}

export function ConversationPanel({ messages, status, isListening, isMuted }: ConversationPanelProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="flex flex-col h-full">
      <div className="px-5 py-4 border-b" style={{ borderColor: 'rgba(113, 113, 122, 0.2)' }}>
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">Conversation</h2>
          <div className="flex items-center gap-2">
            {isListening && !isMuted && (
              <div className="flex items-center gap-2 px-3 py-1 rounded-full" style={{ background: 'rgba(59, 130, 246, 0.15)' }}>
                <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                <span className="text-xs text-blue-400">Listening</span>
              </div>
            )}
            {isMuted && (
              <div className="flex items-center gap-2 px-3 py-1 rounded-full" style={{ background: 'rgba(239, 68, 68, 0.15)' }}>
                <div className="w-2 h-2 rounded-full bg-red-500" />
                <span className="text-xs text-red-400">Muted</span>
              </div>
            )}
            <span className="text-xs px-3 py-1 rounded-full" style={{ 
              background: status === 'Disconnected' 
                ? 'rgba(113, 113, 122, 0.1)' 
                : 'rgba(168, 146, 255, 0.1)',
              color: status === 'Disconnected' ? '#71717a' : '#A892FF'
            }}>
              {status}
            </span>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{
              background: 'rgba(168, 146, 255, 0.1)',
              border: '1px solid rgba(168, 146, 255, 0.2)'
            }}>
              <svg className="w-8 h-8" style={{ color: '#A892FF' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-white mb-2">Ready to assist</h3>
            <p className="text-sm max-w-xs" style={{ color: '#71717a' }}>
              Click &quot;Connect&quot; to start a conversation with the pharmacy assistant.
            </p>
          </div>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${message.speaker === 'user' ? 'justify-end' : 'justify-start'}`}
              style={{ animation: 'fadeSlideIn 0.3s ease-out' }}
            >
              <div
                className={`max-w-[80%] px-4 py-3 rounded-2xl ${
                  message.speaker === 'user' ? 'rounded-br-md' : 'rounded-bl-md'
                }`}
                style={{
                  background: message.speaker === 'user' 
                    ? 'rgba(168, 146, 255, 0.15)' 
                    : 'rgba(113, 113, 122, 0.12)',
                  border: message.speaker === 'user'
                    ? '1px solid rgba(168, 146, 255, 0.25)'
                    : '1px solid rgba(113, 113, 122, 0.2)',
                }}
              >
                <p className="text-sm leading-relaxed" style={{ color: '#e4e4e7' }}>
                  {message.text}
                </p>
                <p className="text-[10px] mt-1.5" style={{ color: '#71717a' }}>
                  {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
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
