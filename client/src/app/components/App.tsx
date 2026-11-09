'use client';

import Image from 'next/image';
import { DatabasePanel } from './DatabasePanel';
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
  } = useVoiceConnection();

  return (
    <div className="flex flex-col w-full h-dvh" style={{ 
      background: 'var(--surface-canvas)'
    }}>
      {/* Header */}
      <div className="flex items-center justify-between gap-6 px-10 py-5" style={{ 
        background: 'var(--surface-default)',
        borderBottom: '1px solid var(--border-default)',
        boxShadow: 'none'
      }}>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <h1 className="text-[28px] leading-none font-semibold text-[color:var(--text-primary)]">
              RxConnect
            </h1>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Real-time voice assistant for prescription management
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          {isConnected && (
            <button
              onClick={toggleMute}
              className="w-12 h-12 rounded-full flex items-center justify-center transition-all duration-200"
              style={{
                background: isMuted 
                  ? 'color-mix(in srgb, var(--status-error) 15%, transparent)' 
                  : 'var(--surface-glass)',
                border: 'none',
                boxShadow: isMuted
                  ? 'inset 0 0 0 1px var(--text-error)'
                  : isListening
                    ? 'inset 0 0 0 1px var(--accent)'
                    : 'inset 0 0 0 1px var(--border-default)',
              }}
              title={isMuted ? 'Unmute microphone' : 'Mute microphone'}
            >
              {isMuted ? (
                <svg 
                  className="w-5 h-5" 
                  style={{ color: 'var(--text-error)' }} 
                  fill="currentColor" 
                  viewBox="0 0 24 24"
                >
                  <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z"/>
                </svg>
              ) : (
                <svg 
                  className="w-5 h-5" 
                  style={{ color: 'var(--accent-text)' }} 
                  fill="currentColor" 
                  viewBox="0 0 24 24"
                >
                  <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1 1.93c-3.94-.49-7-3.85-7-7.93h2c0 3.31 2.69 6 6 6s6-2.69 6-6h2c0 4.08-3.06 7.44-7 7.93V19h4v2H8v-2h4v-3.07z"/>
                </svg>
              )}
            </button>
          )}

          <button
            onClick={isConnected ? disconnect : connect}
            className="min-h-[40px] px-5 rounded-full font-mono font-medium text-sm transition-all duration-200"
            style={{
              background: isConnected ? 'var(--surface-glass)' : 'var(--accent)',
              border: 'none',
              boxShadow: isConnected ? 'inset 0 0 0 1px var(--border-default)' : 'none',
              color: isConnected ? 'var(--text-primary)' : 'var(--text-on-accent)',
            }}
          >
            {isConnected ? 'Disconnect' : 'Connect'}
          </button>

          {isConnected && messages.length > 0 && (
            <button
              onClick={resetConversation}
              className="w-10 h-10 rounded-full flex items-center justify-center transition-all duration-200"
              style={{
                background: 'var(--surface-glass)',
                border: 'none',
                boxShadow: 'inset 0 0 0 1px var(--border-default)',
              }}
              title="Reset conversation"
            >
              <svg className="w-4 h-4" style={{ color: 'var(--text-tertiary)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
              </svg>
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="px-10 py-3" style={{ background: 'color-mix(in srgb, var(--status-error) 10%, transparent)', borderBottom: '1px solid color-mix(in srgb, var(--status-error) 20%, transparent)' }}>
          <p className="text-sm text-[color:var(--text-error)]">{error}</p>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden gap-4 p-4">
        <div className="h-full overflow-hidden rounded-lg" style={{ 
          width: '50%',
          minWidth: '780px',
          border: '1px solid var(--border-default)',
          background: 'var(--surface-default)'
        }}>
          <DatabasePanel />
        </div>

        <div className="flex-1 flex flex-col overflow-hidden gap-4">
          <div className="flex-1 overflow-hidden rounded-lg" style={{
            background: 'var(--surface-card)',
            border: '1px solid var(--border-default)'
          }}>
            <ConversationPanel 
              messages={messages} 
              status={status}
              isListening={isListening}
              isMuted={isMuted}
            />
          </div>

          <div className="px-6 py-4 rounded-lg" style={{
            background: 'var(--surface-card)',
            border: '1px solid var(--border-default)',
            boxShadow: 'none'
          }}>
            <div className="flex items-center gap-4">
              <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center" style={{
                background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
                border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)'
              }}>
                <span className="text-lg">💡</span>
              </div>
              <div className="flex-1">
                <p className="text-xs font-mono font-medium uppercase tracking-wider mb-1" style={{ color: 'var(--accent-text)' }}>
                  Quick Tip
                </p>
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  Click &quot;Connect&quot; to start talking with the assistant. Use the database panel to find Member IDs and Order IDs for testing.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="px-8 py-10" style={{ 
        background: 'var(--surface-canvas)',
        borderTop: '1px solid var(--border-default)'
      }}>
        <div className="flex items-center justify-center gap-8" style={{ minHeight: '40px' }}>
          <a 
            href="https://deepgram.com" 
            target="_blank" 
            rel="noopener noreferrer"
            className="transition-all hover:scale-105 flex items-center"
          >
            <Image 
              src="/deepgram-2026.svg" 
              alt="Deepgram" 
              width={126}
              height={24}
              className="object-contain"
              style={{ height: '24px', width: 'auto', display: 'block' }}
              priority
            />
          </a>
          <span className="text-2xl font-light flex items-center" style={{ color: 'var(--text-tertiary)' }}>×</span>
          <a 
            href="https://pipecat.ai" 
            target="_blank" 
            rel="noopener noreferrer"
            className="transition-all hover:scale-105 flex items-center"
          >
            <Image 
              src="/pipecat-logo.png" 
              alt="Pipecat" 
              width={140}
              height={32}
              className="object-contain"
              style={{ height: '32px', display: 'block', mixBlendMode: 'lighten' }}
              priority
            />
          </a>
          <span className="text-2xl font-light flex items-center" style={{ color: 'var(--text-tertiary)' }}>×</span>
          <a 
            href="https://aws.amazon.com/sagemaker/" 
            target="_blank" 
            rel="noopener noreferrer"
            className="transition-all hover:scale-105 flex items-center"
          >
            <Image 
              src="/aws-2.png" 
              alt="AWS SageMaker" 
              width={60}
              height={26}
              className="object-contain"
              style={{ height: '26px', display: 'block' }}
              priority
            />
          </a>
        </div>
      </div>
    </div>
  );
};
