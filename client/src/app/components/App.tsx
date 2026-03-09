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
      background: 'linear-gradient(135deg, #0a0a0a 0%, #18181b 100%)'
    }}>
      {/* Header */}
      <div className="flex items-center justify-between gap-6 px-10 py-5" style={{ 
        background: 'linear-gradient(180deg, #000000 0%, #0a0a0a 100%)',
        borderBottom: '1px solid rgba(113, 113, 122, 0.2)',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)'
      }}>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <h1 className="text-xl font-bold text-white tracking-tight">
              RxConnect
            </h1>
            <p className="text-xs" style={{ color: '#71717a' }}>
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
                  ? 'rgba(239, 68, 68, 0.2)' 
                  : 'rgba(59, 130, 246, 0.15)',
                border: isMuted 
                  ? '2px solid rgba(239, 68, 68, 0.5)' 
                  : '2px solid rgba(59, 130, 246, 0.4)',
                boxShadow: isListening && !isMuted
                  ? '0 0 20px rgba(59, 130, 246, 0.3)' 
                  : 'none',
              }}
              title={isMuted ? 'Unmute microphone' : 'Mute microphone'}
            >
              {isMuted ? (
                <svg 
                  className="w-5 h-5" 
                  style={{ color: '#ef4444' }} 
                  fill="currentColor" 
                  viewBox="0 0 24 24"
                >
                  <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z"/>
                </svg>
              ) : (
                <svg 
                  className="w-5 h-5" 
                  style={{ color: '#3b82f6' }} 
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
            className="px-5 py-2.5 rounded-lg font-medium text-sm transition-all duration-200"
            style={{
              background: isConnected 
                ? 'rgba(168, 146, 255, 0.15)' 
                : 'rgba(39, 39, 42, 0.5)',
              border: isConnected 
                ? '1px solid rgba(168, 146, 255, 0.4)' 
                : '1px solid rgba(113, 113, 122, 0.2)',
              color: isConnected ? '#A892FF' : '#ffffff',
            }}
          >
            {isConnected ? 'Disconnect' : 'Connect'}
          </button>

          {isConnected && messages.length > 0 && (
            <button
              onClick={resetConversation}
              className="p-2.5 rounded-lg transition-all duration-200"
              style={{
                background: 'rgba(39, 39, 42, 0.5)',
                border: '1px solid rgba(113, 113, 122, 0.2)',
              }}
              title="Reset conversation"
            >
              <svg className="w-4 h-4" style={{ color: '#71717a' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
              </svg>
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="px-10 py-3" style={{ background: 'rgba(239, 68, 68, 0.1)', borderBottom: '1px solid rgba(239, 68, 68, 0.2)' }}>
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden gap-4 p-4">
        <div className="h-full overflow-hidden rounded-lg" style={{ 
          width: '50%',
          minWidth: '780px',
          border: '1px solid rgba(113, 113, 122, 0.2)',
          background: '#000000'
        }}>
          <DatabasePanel />
        </div>

        <div className="flex-1 flex flex-col overflow-hidden gap-4">
          <div className="flex-1 overflow-hidden rounded-lg" style={{
            background: '#18181b',
            border: '1px solid rgba(113, 113, 122, 0.2)'
          }}>
            <ConversationPanel 
              messages={messages} 
              status={status}
              isListening={isListening}
              isMuted={isMuted}
            />
          </div>

          <div className="px-6 py-4 rounded-lg" style={{
            background: 'linear-gradient(135deg, #18181b 0%, #27272a 100%)',
            border: '1px solid rgba(217, 70, 239, 0.2)',
            boxShadow: '0 0 20px rgba(217, 70, 239, 0.1)'
          }}>
            <div className="flex items-center gap-4">
              <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center" style={{
                background: 'rgba(217, 70, 239, 0.1)',
                border: '1px solid rgba(217, 70, 239, 0.3)'
              }}>
                <span className="text-lg">💡</span>
              </div>
              <div className="flex-1">
                <p className="text-xs font-medium mb-1" style={{ color: '#d946ef' }}>
                  Quick Tip
                </p>
                <p className="text-sm" style={{ color: '#e4e4e7' }}>
                  Click &quot;Connect&quot; to start talking with the assistant. Use the database panel to find Member IDs and Order IDs for testing.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="px-8 py-10" style={{ 
        background: '#000000',
        borderTop: '1px solid rgba(113, 113, 122, 0.1)'
      }}>
        <div className="flex items-center justify-center gap-8" style={{ minHeight: '40px' }}>
          <a 
            href="https://deepgram.com" 
            target="_blank" 
            rel="noopener noreferrer"
            className="transition-all hover:scale-105 flex items-center"
          >
            <Image 
              src="/deepgram.svg" 
              alt="Deepgram" 
              width={125}
              height={32}
              className="object-contain"
              style={{ height: '32px', display: 'block' }}
              priority
            />
          </a>
          <span className="text-2xl font-light flex items-center" style={{ color: '#71717a' }}>×</span>
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
              style={{ height: '32px', display: 'block' }}
              priority
            />
          </a>
          <span className="text-2xl font-light flex items-center" style={{ color: '#71717a' }}>×</span>
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
