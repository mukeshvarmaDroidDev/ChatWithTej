import React, { useState, useEffect, useRef } from 'react';
import { 
  MessageSquare, 
  Plus, 
  Trash2, 
  Edit2, 
  X, 
  Settings, 
  Send, 
  Globe, 
  Bot, 
  User, 
  Sparkles,
  RefreshCw
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './App.css';

const API_BASE = '';

interface Session {
  session_id: string;
  session_name: string;
  created_at: number;
  updated_at: number;
  model: string;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  created_at?: number;
  toolsUsed?: string[];
  isError?: boolean;
}

export default function App() {
  // Session list states
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>('');
  
  // Active chat state
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState<string>('');
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [activeTools, setActiveTools] = useState<string[]>([]);
  
  // Editing session name states
  const [editingSessionId, setEditingSessionId] = useState<string>('');
  const [editingSessionName, setEditingSessionName] = useState<string>('');

  // Settings states (persisted in localStorage)
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [modelId, setModelId] = useState<string>(() => 
    localStorage.getItem('gemini_model_id') || 'gemini-2.5-flash'
  );
  const [enableSearch, setEnableSearch] = useState<boolean>(() => 
    localStorage.getItem('gemini_enable_search') === 'true'
  );
  const [systemInstruction, setSystemInstruction] = useState<string>(() => 
    localStorage.getItem('gemini_system_instruction') || 
    'You are Tej, a highly knowledgeable and friendly AI assistant. Help the user with coding, reasoning, and answering questions clearly.'
  );
  const [userApiKey, setUserApiKey] = useState<string>(() => 
    localStorage.getItem('gemini_api_key') || ''
  );

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load sessions list on startup
  useEffect(() => {
    fetchSessions();
  }, []);

  // Fetch session history when active session changes
  useEffect(() => {
    if (activeSessionId) {
      fetchSessionHistory(activeSessionId);
    } else {
      setMessages([]);
    }
  }, [activeSessionId]);

  // Auto scroll to bottom of chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, activeTools]);

  // Save settings changes to localStorage
  useEffect(() => {
    localStorage.setItem('gemini_model_id', modelId);
  }, [modelId]);

  useEffect(() => {
    localStorage.setItem('gemini_enable_search', String(enableSearch));
  }, [enableSearch]);

  useEffect(() => {
    localStorage.setItem('gemini_system_instruction', systemInstruction);
  }, [systemInstruction]);

  useEffect(() => {
    localStorage.setItem('gemini_api_key', userApiKey);
  }, [userApiKey]);

  // Auto-resize the input textarea based on content
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value);
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 200)}px`;
    }
  };

  const fetchSessions = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/sessions`);
      if (res.ok) {
        const data: Session[] = await res.json();
        setSessions(data);
        // Automatically select the first session if none selected
        if (data.length > 0 && !activeSessionId) {
          setActiveSessionId(data[0].session_id);
        }
      }
    } catch (err) {
      console.error('Error fetching sessions:', err);
    }
  };

  const fetchSessionHistory = async (sessionId: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/sessions/${sessionId}/history`);
      if (res.ok) {
        const data = await res.json();
        setMessages(data.map((m: any) => ({
          role: m.role,
          content: m.content,
          isError: m.status === 'ERROR'
        })));
      }
    } catch (err) {
      console.error('Error fetching history:', err);
    }
  };

  const handleCreateSession = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Chat' })
      });
      if (res.ok) {
        const newSession = await res.json();
        setSessions(prev => [newSession, ...prev]);
        setActiveSessionId(newSession.session_id);
        // Focus the chat input
        setTimeout(() => inputRef.current?.focus(), 100);
      }
    } catch (err) {
      console.error('Error creating session:', err);
    }
  };

  const handleDeleteSession = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this chat session?')) return;

    try {
      const res = await fetch(`${API_BASE}/api/sessions/${sessionId}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        setSessions(prev => prev.filter(s => s.session_id !== sessionId));
        if (activeSessionId === sessionId) {
          const remaining = sessions.filter(s => s.session_id !== sessionId);
          if (remaining.length > 0) {
            setActiveSessionId(remaining[0].session_id);
          } else {
            setActiveSessionId('');
          }
        }
      }
    } catch (err) {
      console.error('Error deleting session:', err);
    }
  };

  const handleStartRename = (e: React.MouseEvent, s: Session) => {
    e.stopPropagation();
    setEditingSessionId(s.session_id);
    setEditingSessionName(s.session_name);
  };

  const handleSaveRename = async (sessionId: string) => {
    if (!editingSessionName.trim()) return;

    try {
      const res = await fetch(`${API_BASE}/api/sessions/${sessionId}/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editingSessionName })
      });
      if (res.ok) {
        setSessions(prev => prev.map(s => 
          s.session_id === sessionId ? { ...s, session_name: editingSessionName } : s
        ));
        setEditingSessionId('');
      }
    } catch (err) {
      console.error('Error renaming session:', err);
    }
  };

  const handleSendMessage = async () => {
    if (!inputValue.trim() || isStreaming) return;

    let targetSessionId = activeSessionId;
    
    // Create session automatically if none exists
    if (!targetSessionId) {
      try {
        const res = await fetch(`${API_BASE}/api/sessions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: inputValue.trim().slice(0, 30) || 'New Chat' })
        });
        if (res.ok) {
          const newSession = await res.json();
          setSessions(prev => [newSession, ...prev]);
          targetSessionId = newSession.session_id;
          setActiveSessionId(newSession.session_id);
        } else {
          return;
        }
      } catch (err) {
        console.error('Failed to auto-create session:', err);
        return;
      }
    }

    const userMessageText = inputValue.trim();
    setInputValue('');
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
    }

    // Append user message in UI
    setMessages(prev => [...prev, { role: 'user', content: userMessageText }]);
    setIsStreaming(true);
    setActiveTools([]);

    // Insert dummy assistant response which we will update during streaming
    setMessages(prev => [...prev, { role: 'assistant', content: '', toolsUsed: [] }]);

    try {
      const response = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessageText,
          session_id: targetSessionId,
          model_id: modelId,
          enable_search: enableSearch,
          system_instruction: systemInstruction,
          user_api_key: userApiKey || null
        })
      });

      if (!response.body) {
        throw new Error('ReadableStream not supported by response');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let assistantContent = '';
      let toolsTrack: string[] = [];

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const chunkText = decoder.decode(value, { stream: true });
        
        // Parse Server-Sent Events format "data: {...}"
        const lines = chunkText.split('\n\n');
        for (const line of lines) {
          if (line.trim().startsWith('data: ')) {
            try {
              const jsonStr = line.slice(6).trim();
              const event = JSON.parse(jsonStr);

              if (event.type === 'content') {
                assistantContent += event.content;
                setMessages(prev => {
                  const updated = [...prev];
                  const lastIdx = updated.length - 1;
                  if (lastIdx >= 0) {
                    updated[lastIdx] = {
                      ...updated[lastIdx],
                      content: assistantContent
                    };
                  }
                  return updated;
                });
              } else if (event.type === 'tool_start') {
                setActiveTools(prev => [...prev, event.content]);
                if (!toolsTrack.includes(event.content)) {
                  toolsTrack.push(event.content);
                  setMessages(prev => {
                    const updated = [...prev];
                    const lastIdx = updated.length - 1;
                    if (lastIdx >= 0) {
                      updated[lastIdx] = {
                        ...updated[lastIdx],
                        toolsUsed: [...(updated[lastIdx].toolsUsed || []), event.content]
                      };
                    }
                    return updated;
                  });
                }
              } else if (event.type === 'tool_end') {
                setActiveTools(prev => prev.filter(t => t !== event.content));
              } else if (event.type === 'error') {
                assistantContent += `\n\n**Error:** ${event.content}`;
                setMessages(prev => {
                  const updated = [...prev];
                  const lastIdx = updated.length - 1;
                  if (lastIdx >= 0) {
                    updated[lastIdx] = {
                      ...updated[lastIdx],
                      content: assistantContent,
                      isError: true
                    };
                  }
                  return updated;
                });
              }
            } catch (jsonErr) {
              // Ignore line split issues or partial chunks
            }
          }
        }
      }
    } catch (error: any) {
      console.error('Streaming error:', error);
      setMessages(prev => {
        const updated = [...prev];
        const lastIdx = updated.length - 1;
        if (lastIdx >= 0) {
          updated[lastIdx] = {
            ...updated[lastIdx],
            content: updated[lastIdx].content + `\n\n**Connection Error:** Failed to read response stream.`,
            isError: true
          };
        }
        return updated;
      });
    } finally {
      setIsStreaming(false);
      setActiveTools([]);
      // Refresh session list so that names/dates update correctly in sidebar
      fetchSessions();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <div className="app-container">
      {/* Sidebar Section */}
      <div className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-title">
            <Bot size={22} className="text-primary" />
            <span>Tej Agent Studio</span>
          </div>
          <Sparkles size={16} className="text-secondary" style={{ opacity: 0.8 }} />
        </div>

        <button className="btn-new-chat" onClick={handleCreateSession}>
          <Plus size={18} />
          <span>New Chat</span>
        </button>

        {/* Sessions list */}
        <div className="session-list">
          {sessions.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem 1rem', color: 'var(--text-disabled)', fontSize: '0.85rem' }}>
              No chats yet. Click New Chat to start.
            </div>
          ) : (
            sessions.map(s => {
              const isActive = s.session_id === activeSessionId;
              const isEditing = s.session_id === editingSessionId;

              return (
                <div 
                  key={s.session_id} 
                  className={`session-item ${isActive ? 'active' : ''}`}
                  onClick={() => !isEditing && setActiveSessionId(s.session_id)}
                >
                  <div className="session-item-content">
                    <MessageSquare size={16} style={{ flexShrink: 0 }} />
                    {isEditing ? (
                      <input 
                        className="session-name-input"
                        value={editingSessionName}
                        onChange={(e) => setEditingSessionName(e.target.value)}
                        onBlur={() => handleSaveRename(s.session_id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveRename(s.session_id);
                          if (e.key === 'Escape') setEditingSessionId('');
                        }}
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <span className="session-name">{s.session_name}</span>
                    )}
                  </div>
                  
                  {!isEditing && (
                    <div className="session-actions">
                      <button 
                        className="action-btn" 
                        onClick={(e) => handleStartRename(e, s)}
                        title="Rename Chat"
                      >
                        <Edit2 size={13} />
                      </button>
                      <button 
                        className="action-btn delete-btn" 
                        onClick={(e) => handleDeleteSession(e, s.session_id)}
                        title="Delete Chat"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer actions */}
        <div className="sidebar-footer">
          <button className="settings-trigger" onClick={() => setShowSettings(true)}>
            <Settings size={16} />
            <span>Settings</span>
          </button>
          
          <button className="action-btn" onClick={fetchSessions} title="Refresh chats">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="chat-main">
        {/* Chat Header */}
        {activeSessionId && (
          <div className="chat-header">
            <div className="chat-header-info">
              <div className="chat-header-title">
                {sessions.find(s => s.session_id === activeSessionId)?.session_name || 'Active Session'}
              </div>
              <div className="chat-header-meta">
                <span className="status-badge">
                  <span className="status-indicator"></span>
                  Connected
                </span>
                <span>•</span>
                <span style={{ fontFamily: 'monospace' }}>{modelId}</span>
                {enableSearch && (
                  <>
                    <span>•</span>
                    <Globe size={11} className="text-secondary" />
                    <span>Search Enabled</span>
                  </>
                )}
              </div>
            </div>
            
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button 
                className="action-btn" 
                onClick={() => setShowSettings(true)}
                title="Settings"
                style={{ border: '1px solid var(--border-glass)', padding: '0.4rem', borderRadius: '8px' }}
              >
                <Settings size={16} />
              </button>
            </div>
          </div>
        )}

        {/* Messages */}
        {activeSessionId ? (
          <div className="messages-container">
            {messages.length === 0 ? (
              <div className="empty-state animate-fade-in" style={{ flex: 1 }}>
                <div className="empty-icon">
                  <Bot size={36} />
                </div>
                <h2 className="empty-title">Meet Tej, Your Gemini Agent</h2>
                <p className="empty-subtitle">
                  Ask me anything! I am equipped with the Gemini LLM and can perform live web searches when you enable Search in settings.
                </p>
                <div className="suggested-prompts">
                  <div 
                    className="suggested-prompt-card"
                    onClick={() => {
                      setInputValue('Explain quantum computing in simple terms.');
                      setTimeout(() => inputRef.current?.focus(), 100);
                    }}
                  >
                    <div className="suggested-prompt-title">EXPLAIN CONCEPT</div>
                    <div className="suggested-prompt-text">Quantum computing in simple terms</div>
                  </div>
                  <div 
                    className="suggested-prompt-card"
                    onClick={() => {
                      setInputValue('Write a Python function to check if a number is prime, with docstrings.');
                      setTimeout(() => inputRef.current?.focus(), 100);
                    }}
                  >
                    <div className="suggested-prompt-title">CODING TASK</div>
                    <div className="suggested-prompt-text">Python prime number check function</div>
                  </div>
                </div>
              </div>
            ) : (
              <>
                {messages.map((msg, idx) => (
                  <div key={idx} className={`message-wrapper ${msg.role}`}>
                    <div className="avatar">
                      {msg.role === 'user' ? <User size={16} /> : <Bot size={16} />}
                    </div>
                    <div className="message-bubble">
                      {/* Show tool calls badges if any */}
                      {msg.role === 'assistant' && msg.toolsUsed && msg.toolsUsed.length > 0 && (
                        <div className="tool-call-container">
                          {msg.toolsUsed.map((tool, tIdx) => (
                            <div key={tIdx} className="tool-badge">
                              <Globe size={12} />
                              <span>Used Tool: {tool}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Message Content */}
                      <div className="markdown-content">
                        {msg.content ? (
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {msg.content}
                          </ReactMarkdown>
                        ) : (
                          <span style={{ opacity: 0.5 }}>Thinking...</span>
                        )}
                        {isStreaming && idx === messages.length - 1 && (
                          <span className="cursor-blink" style={{ color: 'var(--color-secondary)', fontWeight: 'bold' }}>|</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                
                {/* Active tools overlay inside chat when generating */}
                {activeTools.length > 0 && (
                  <div className="message-wrapper assistant">
                    <div className="avatar">
                      <Bot size={16} />
                    </div>
                    <div className="message-bubble" style={{ backgroundColor: 'rgba(245, 158, 11, 0.03)' }}>
                      <div className="tool-call-container">
                        {activeTools.map((tool, tIdx) => (
                          <div key={tIdx} className="tool-badge">
                            <div className="tool-badge-spinner"></div>
                            <span>Executing {tool}...</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </>
            )}
          </div>
        ) : (
          <div className="empty-state" style={{ flex: 1 }}>
            <div className="empty-icon">
              <Sparkles size={36} />
            </div>
            <h2 className="empty-title">Welcome to Tej Agent Studio</h2>
            <p className="empty-subtitle">
              To get started, select an existing conversation from the sidebar or click "New Chat" to begin a new thread.
            </p>
            <button className="btn-primary" onClick={handleCreateSession} style={{ padding: '0.75rem 1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Plus size={18} />
              <span>Create First Conversation</span>
            </button>
          </div>
        )}

        {/* Input Bar */}
        {activeSessionId && (
          <div className="input-container">
            <div className="input-box-wrapper">
              <textarea
                ref={inputRef}
                className="chat-input"
                placeholder={isStreaming ? "Tej is thinking..." : "Ask Tej anything... (Press Enter to send, Shift+Enter for new line)"}
                value={inputValue}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                disabled={isStreaming}
              />
              <button 
                className="btn-send"
                onClick={handleSendMessage}
                disabled={!inputValue.trim() || isStreaming}
              >
                <Send size={16} />
              </button>
            </div>
            <div className="input-footer-info">
              Powered by Google Gemini and Agno Agent Framework. Sessions are persisted in SQLite.
            </div>
          </div>
        )}
      </div>

      {/* Settings Modal */}
      {showSettings && (
        <div className="modal-overlay" onClick={() => setShowSettings(false)}>
          <div className="modal-content glass-panel" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Settings size={18} />
                <span>Agent & Model Settings</span>
              </div>
              <button className="modal-close" onClick={() => setShowSettings(false)}>
                <X size={18} />
              </button>
            </div>

            <div className="modal-body">
              {/* API Key */}
              <div className="form-group">
                <label className="form-label">
                  Gemini API Key
                  <span className="form-label-desc" style={{ display: 'block', marginTop: '0.1rem' }}>
                    Optional. Overrides the backend's `.env` configuration. Saved locally on your device.
                  </span>
                </label>
                <input 
                  type="password" 
                  className="form-input" 
                  placeholder="AIzaSy..." 
                  value={userApiKey}
                  onChange={(e) => setUserApiKey(e.target.value)}
                />
              </div>

              {/* Model Select */}
              <div className="form-group">
                <label className="form-label">Google Gemini Model</label>
                <select 
                  className="form-select" 
                  value={modelId}
                  onChange={(e) => setModelId(e.target.value)}
                >
                  <option value="gemini-2.5-flash">Gemini 2.5 Flash (Recommended - Fastest & Multi-modal)</option>
                  <option value="gemini-2.5-pro">Gemini 2.5 Pro (Best for complex coding/reasoning)</option>
                  <option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
                  <option value="gemini-1.5-flash">Gemini 1.5 Flash (Legacy)</option>
                </select>
              </div>

              {/* System Instruction */}
              <div className="form-group">
                <label className="form-label">System Instructions / Agent Prompt</label>
                <textarea 
                  className="form-input" 
                  style={{ minHeight: '80px', resize: 'vertical' }}
                  value={systemInstruction}
                  onChange={(e) => setSystemInstruction(e.target.value)}
                  placeholder="Enter system prompt instructions for the agent..."
                />
              </div>

              {/* Web Search Tool Toggle */}
              <div className="form-switch">
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <Globe size={14} className="text-secondary" />
                    Web Search Tool
                  </span>
                  <span className="form-label-desc">Allow agent to search the web via DuckDuckGo for live facts.</span>
                </div>
                <label className="switch-container">
                  <input 
                    type="checkbox" 
                    className="switch-input"
                    checked={enableSearch}
                    onChange={(e) => setEnableSearch(e.target.checked)}
                  />
                  <span className="switch-slider"></span>
                </label>
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn-primary" onClick={() => setShowSettings(false)}>
                Save & Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
