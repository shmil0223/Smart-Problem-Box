
import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

// KaTeX 配置：允许 Unicode/中文字符
const katexOptions = { strict: false };
import 'katex/dist/katex.min.css';
import { useStore } from '../../context/StoreContext';
import { Problem } from '../../types';
import { Bookmark, Sparkles, Send, MoreVertical, Trash2, Zap } from 'lucide-react';
import { apiAnalyzeQuestionText, apiChat, apiFetchChatHistory } from '../../api';
import type { AnalysisResult } from '../../types/analysis';
import { AIFullScreenLoader } from '../ui/AiLoaders';
import { preprocessLaTeX } from '../../utils/latex';

interface StudyViewProps {
  problem: Problem;
}

const StudyView: React.FC<StudyViewProps> = ({ problem }) => {
  const { state, toggleFavorite, deleteProblem, setViewMode } = useStore();
  const isFavorite = state.favorites.includes(problem.id);
  const analysisCacheKey = 'spb_analysis_cache_v1';
  const createdAtText = (() => {
    if (!problem.createdAt) return '';
    const date = new Date(problem.createdAt);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString();
  })();

  // AI Chat State
  const initialChatMessage = { role: 'ai' as const, content: '你好！我是你的 AI 助教。关于这道题目，你有什么想深入了解的吗？' };
  const [chatMessages, setChatMessages] = useState<Array<{role: 'user' | 'ai', content: string}>>([
    initialChatMessage
  ]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [chatModel, setChatModel] = useState('openai/gpt-4o-mini');
  const [analysisModel, setAnalysisModel] = useState('google/gemini-3-flash-preview');
  const chatModelOptions = [
    { value: 'openai/gpt-4o-mini', label: 'GPT-4o mini（OpenRouter）' },
    { value: 'google/gemini-2.0-flash-001', label: 'Gemini 2.0 Flash（OpenRouter）' },
    { value: 'deepseek-ai/DeepSeek-V3', label: 'DeepSeek-V3（SiliconFlow）' },
    { value: 'openai/gpt-5-mini', label: 'GPT-5 mini（OpenRouter）' },
    { value: 'Qwen/Qwen2.5-72B-Instruct-128K', label: 'Qwen2.5-72B（SiliconFlow）' }
  ];
  const analysisModelOptions = [
    { value: 'openai/gpt-5-mini', label: 'GPT-5 mini（OpenRouter）' },
    { value: 'google/gemini-3-flash-preview', label: 'Gemini 3 Flash Preview（OpenRouter）' },
    { value: 'openai/gpt-4o', label: 'GPT-4o（OpenRouter）' },
    { value: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash（OpenRouter）' }
  ];
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [questionText, setQuestionText] = useState(problem.description || '');
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const analysisCacheRef = useRef<Record<string, AnalysisResult>>({});
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState('');
  const renderCardClass =
    'rounded-2xl border border-zinc-200/60 dark:border-zinc-800 bg-[#f8fafc] dark:bg-[#1c1c21] text-zinc-900 dark:text-zinc-100 shadow-[0_8px_24px_rgba(15,23,42,0.06)]';
  const renderContentClass =
    'rounded-2xl px-6 py-5 bg-[#f9fafb] dark:bg-[#111114] border border-zinc-200/60 dark:border-zinc-800 shadow-[0_8px_24px_rgba(15,23,42,0.05)]';
  const questionContentClass =
    'relative overflow-hidden rounded-2xl px-8 py-7 bg-[#f9fafb] dark:bg-[#0f0f12] border border-zinc-200/70 dark:border-zinc-800 text-zinc-900 dark:text-slate-100 shadow-[0_18px_36px_rgba(15,23,42,0.08)]';
  const formatQuestionForDisplay = (value: string) => {
    if (!value) return '';
    let text = value.replace(/\r\n/g, '\n').trim();
    text = text.replace(/[ \t]+/g, ' ');
    text = text.replace(/\n{3,}/g, '\n\n');
    text = text.replace(/(\n)?\s*\(([A-D])\)\s*/g, '\n- ($2) ');
    text = text.replace(/(\n)?\s*([A-D])[\.\、]\s*/g, '\n- $2. ');
    text = text.replace(/\\begin\{[^}]+\}[\s\S]*?\\end\{[^}]+\}/g, (match) => `\n\n$$${match}$$\n\n`);
    text = text.replace(/\\left[\s\S]*?\\right[\)\}\]]/g, (match) => `$${match}$`);
    text = text.replace(/\\(int|sum|lim)[\s\S]*?(?=$|[。；;\n,，])/g, (match) => `$${match.trim()}$`);
    text = text.replace(/\{([A-Za-z]\w*(?:_\{[^}]+\}|_\w+|\^\{[^}]+\}|\^\w+)+)\}/g, (_m, inner) => `$${inner}$`);
    text = text.replace(/\b([A-Za-z]\w*(?:_\{[^}]+\}|_\w+|\^\{[^}]+\}|\^\w+)+)\b/g, (m) => `$${m}$`);

    const wrapInlineMath = (segment: string) => {
      let next = segment;
      const commandPattern =
        /\\[a-zA-Z]+(?:\*?)?(?:\s*\{[^}]*\}|\s*\[[^\]]*\]|\s*[_^]\{[^}]*\}|\s*[_^][a-zA-Z0-9]+|\s*[0-9a-zA-Z+\-*/=()|.,<>]+)*/g;
      next = next.replace(commandPattern, (match) => {
        const trimmed = match.trim();
        if (!trimmed) return match;
        return `$${trimmed}$`;
      });
      next = next.replace(
        /\b[A-Za-z]\w*(?:\^\{[^}]+\}|\^\d+|_\{[^}]+\}|_\d+)+/g,
        (m) => `$${m}$`
      );
      next = next.replace(
        /(\|[A-Za-z]\w*\|\s*=\s*[\d\.]+|\b[A-Za-z]\w*\s*=\s*[A-Za-z0-9\.\+\-\*/]+)\b/g,
        (m) => `$${m}$`
      );
      return next;
    };

    const parts = text.split(/(\$\$[\s\S]*?\$\$|\$[^$]+\$)/g);
    text = parts
      .map((segment) => {
        if (segment.startsWith('$$') || segment.startsWith('$')) return segment;
        return wrapInlineMath(segment);
      })
      .join('');

    text = text
      .replace(/(^|\n)设/g, '$1**设**')
      .replace(/(^|\n)则/g, '$1**则**');
    return text.replace(/\n{3,}/g, '\n\n');
  };
  const normalizeMarkdown = (value: string) => {
    if (!value) return '';
    const withDelimiters = value
      .replace(/\\\[/g, '$$')
      .replace(/\\\]/g, '$$')
      .replace(/\\\(/g, '$')
      .replace(/\\\)/g, '$')
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n');

    const normalizeBlockMath = (input: string) =>
      input.replace(/\$\$([\s\S]*?)\$\$/g, (_match, content) => {
        const trimmed = String(content || '').trim();
        if (!trimmed) return '$$ $$';
        const needsBlock =
          /\\begin\{(aligned|align|cases|matrix|pmatrix|bmatrix|vmatrix|Vmatrix)\}/.test(trimmed) ||
          /\\\\/.test(trimmed) ||
          /&/.test(trimmed);
        if (!needsBlock) return `$$${trimmed}$$`;
        return `\n\n$$\n${trimmed}\n$$\n\n`;
      });

    return normalizeBlockMath(withDelimiters)
      .replace(/\n{3,}/g, '\n\n')
      .replace(/([^\n])\n(?!\n)/g, '$1  \n');
  };

  const getPlainText = (children: React.ReactNode) => {
    if (typeof children === 'string') return children;
    if (Array.isArray(children)) return children.map(getPlainText).join('');
    if (React.isValidElement(children)) return getPlainText(children.props.children);
    return '';
  };

  const renderMarkdown = (content: string) => (
    <ReactMarkdown
      remarkPlugins={[remarkMath]}
      rehypePlugins={[[rehypeKatex, katexOptions]]}
      components={{
        h3: ({ children }) => (
          <h3 className="flex items-center gap-2 text-lg font-semibold text-zinc-900 dark:bg-gradient-to-r dark:from-white dark:to-gray-400 dark:bg-clip-text dark:text-transparent">
            <Sparkles size={14} className="text-cyan-400" />
            {children}
          </h3>
        ),
        p: ({ children }) => {
          const text = getPlainText(children).trim();
          const stepMatch = text.match(/^(第[一二三四五六七八九十]+步|Step\s*\d+)[：:、]?\s*(.*)$/i);
          if (stepMatch) {
            return (
              <p className="flex flex-wrap items-start gap-2 text-zinc-900 dark:text-slate-200">
                <span className="text-xs font-mono py-0.5 px-2 rounded-full border border-cyan-500/30 bg-cyan-500/10 text-zinc-900 dark:text-slate-100">
                  {stepMatch[1]}
                </span>
                <span>{stepMatch[2]}</span>
              </p>
            );
          }
          if (/最终(结果|答案)/.test(text)) {
            return (
              <div className="rounded-xl border border-green-500/20 bg-green-500/10 p-4 shadow-[0_0_20px_rgba(0,255,0,0.1)]">
                <p className="text-base font-semibold text-zinc-900 dark:text-slate-100">{children}</p>
              </div>
            );
          }
          return <p className="text-zinc-900 dark:text-slate-200">{children}</p>;
        },
        strong: ({ children }) => (
          <strong className="text-zinc-900 dark:text-white font-semibold">{children}</strong>
        )
      }}
    >
      {normalizeMarkdown(content)}
    </ReactMarkdown>
  );

  useEffect(() => {
    try {
      const cached = localStorage.getItem(analysisCacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && typeof parsed === 'object') {
          analysisCacheRef.current = parsed;
        }
      }
    } catch {
      analysisCacheRef.current = {};
    }
  }, []);

  useEffect(() => {
    setQuestionText(problem.description || '');
    if (problem.analysisResult) {
      analysisCacheRef.current[problem.id] = problem.analysisResult;
    }
    setAnalysisResult(problem.analysisResult || analysisCacheRef.current[problem.id] || null);
    setAnalysisError('');
  }, [problem.id, problem.description, problem.analysisResult]);

  // Auto-scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, isChatLoading]);

  useEffect(() => {
    let isMounted = true;
    const loadHistory = async () => {
      try {
        const { messages } = await apiFetchChatHistory({ problemId: problem.id });
        if (!isMounted) return;
        if (messages && messages.length > 0) {
          setChatMessages(messages.map((m) => ({ role: m.role, content: m.content })));
        } else {
          setChatMessages([initialChatMessage]);
        }
      } catch {
        if (isMounted) setChatMessages([initialChatMessage]);
      }
    };
    loadHistory();
    return () => {
      isMounted = false;
    };
  }, [problem.id]);

  const handleSendMessage = async () => {
    if (!chatInput.trim()) return;
    
    const userMsg = chatInput;
    const nextMessages = [...chatMessages, { role: 'user', content: userMsg }];
    setChatMessages(nextMessages);
    setChatInput('');
    setIsChatLoading(true);

    try {
      const history = nextMessages
        .filter((msg, idx) => !(idx === 0 && msg.role === 'ai'))
        .slice(-8);
      const { reply } = await apiChat({
        message: userMsg,
        model: chatModel,
        context: problem.description || problem.title,
        history,
        problemId: problem.id
      });
      setChatMessages(prev => [...prev, { role: 'ai', content: reply.content }]);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'AI 回复失败，请稍后再试';
      setChatMessages(prev => [...prev, { role: 'ai', content: `出错了：${message}` }]);
    } finally {
      setIsChatLoading(false);
    }
  };

  const handleAnalyze = async () => {
    if (!questionText.trim()) {
      setAnalysisError('题目文本不能为空');
      return;
    }
    setIsAnalyzing(true);
    setAnalysisError('');
    try {
      const { result } = await apiAnalyzeQuestionText({
        questionText: questionText.trim(),
        subject: problem.subject,
        problemId: problem.id,
        model: analysisModel
      });
      const typedResult = result as AnalysisResult;
      analysisCacheRef.current[problem.id] = typedResult;
      try {
        localStorage.setItem(analysisCacheKey, JSON.stringify(analysisCacheRef.current));
      } catch {
        // ignore write errors (e.g., storage quota)
      }
      setAnalysisResult(typedResult);
    } catch (error) {
      const message = error instanceof Error ? error.message : '分析失败，请稍后再试';
      setAnalysisError(message);
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <>
        <div className="max-w-4xl mx-auto px-8 py-10 flex flex-col gap-8 pb-32 animate-fade-in">
        {/* Title Header */}
        <div>
            <div className="flex items-start justify-between gap-4 mb-2">
            <h1 className="text-2xl md:text-3xl font-bold text-zinc-900 dark:text-white tracking-tight leading-tight">
                {problem.title}
            </h1>
            <div className="flex items-center gap-2">
                <button 
                    onClick={() => toggleFavorite(problem.id)}
                    className={`flex-none p-2 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors ${isFavorite ? 'text-primary bg-primary/10' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500'}`}
                >
                    <Bookmark size={20} className={isFavorite ? "fill-current" : ""} />
                </button>
                <div className="relative">
                    <button
                        onClick={() => setIsMenuOpen((prev) => !prev)}
                        className="flex-none p-2 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
                        title="更多"
                    >
                        <MoreVertical size={18} />
                    </button>
                    {isMenuOpen && (
                        <div className="absolute right-0 mt-2 w-32 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xl z-20 overflow-hidden animate-fade-in">
                            <button
                                onClick={() => {
                                    deleteProblem(problem.id);
                                    setIsMenuOpen(false);
                                    setViewMode('study');
                                }}
                                className="w-full flex items-center gap-2 px-4 py-2 text-xs text-red-600 dark:text-red-400 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                            >
                                <Trash2 size={14} />
                                删除题目
                            </button>
                        </div>
                    )}
                </div>
            </div>
            </div>
            <p className="text-zinc-500 text-sm">
              来源：{createdAtText || problem.timeAgo || '刚刚'}
            </p>
        </div>

        {/* Original Question */}
        <div className="flex flex-col gap-3 p-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#1c1c21]">
            <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-zinc-900 dark:text-white">题目原文</h3>
            </div>
            <div className={questionContentClass}>
                <div className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-zinc-900/5 dark:ring-white/5" />
                <div className="flux-math prose prose-lg dark:prose-invert max-w-none leading-relaxed prose-p:leading-8 prose-p:my-4 prose-li:my-2 prose-strong:text-zinc-900 dark:prose-strong:text-white prose-em:text-zinc-700 dark:prose-em:text-zinc-300 prose-blockquote:border-l-primary prose-blockquote:text-zinc-600 dark:prose-blockquote:text-zinc-300">
                    <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[[rehypeKatex, katexOptions]]}>
                        {preprocessLaTeX(questionText)}
                    </ReactMarkdown>
                </div>
            </div>
            <div className="flex items-center justify-end gap-3">
                {analysisError && <div className="text-xs text-red-600 mr-auto">{analysisError}</div>}
                    <select
                    value={analysisModel}
                    onChange={(e) => setAnalysisModel(e.target.value)}
                        className="text-[11px] px-2 py-1 rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-white focus:outline-none focus:ring-1 focus:ring-primary"
                >
                    {analysisModelOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                            {option.label}
                        </option>
                    ))}
                </select>
                <button
                    onClick={handleAnalyze}
                    disabled={isAnalyzing}
                    className="px-4 py-2 rounded-lg text-sm font-medium bg-primary hover:bg-primary/90 text-white shadow-lg shadow-primary/20 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                    {isAnalyzing ? '分析中...' : '开始分析'}
                </button>
            </div>
        </div>

        {analysisResult && (
            <div className="flex flex-col gap-5">
                <div className="flex items-center justify-between">
                    <h3 className="text-base font-semibold text-zinc-900 dark:text-white">AI 题目深度分析</h3>
                    <span className="text-xs text-zinc-500 dark:text-white/80">已生成</span>
                </div>
                <div className={`p-6 ${renderCardClass}`}>
                    <div className="flex items-center gap-2 mb-4">
                        <Zap size={14} className="text-cyan-400" />
                        <h4 className="text-lg font-semibold text-zinc-900 dark:bg-gradient-to-r dark:from-white dark:to-gray-400 dark:bg-clip-text dark:text-transparent">
                          关键概念扫盲
                        </h4>
                    </div>
                    <div className={renderContentClass}>
                        <div className="solution-display space-y-6">
                            {renderMarkdown(analysisResult.analysis.concept_explanation)}
                        </div>
                    </div>
                </div>
                <div className={`p-6 ${renderCardClass}`}>
                    <div className="flex items-center gap-2 mb-4">
                        <Zap size={14} className="text-cyan-400" />
                        <h4 className="text-lg font-semibold text-zinc-900 dark:bg-gradient-to-r dark:from-white dark:to-gray-400 dark:bg-clip-text dark:text-transparent">
                          逻辑战略地图
                        </h4>
                    </div>
                    <div className={renderContentClass}>
                        <div className="solution-display space-y-6">
                            {renderMarkdown(analysisResult.analysis.logic_strategy)}
                        </div>
                    </div>
                </div>
                <div className="border-t border-white/10" />
                <div className={`p-6 ${renderCardClass}`}>
                    <div className="flex items-center gap-2 mb-4">
                        <Zap size={14} className="text-cyan-400" />
                        <h4 className="text-lg font-semibold text-zinc-900 dark:bg-gradient-to-r dark:from-white dark:to-gray-400 dark:bg-clip-text dark:text-transparent">
                          核心步骤详解
                        </h4>
                    </div>
                    <div className={renderContentClass}>
                        <div className="solution-display space-y-6">
                            {renderMarkdown(analysisResult.analysis.full_solution)}
                        </div>
                    </div>
                </div>
            </div>
        )}

        {/* AI Chat Interface */}
        <div className="flex flex-col border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden bg-white dark:bg-[#1c1c21] shadow-sm">
            {/* Chat Header */}
            <div className="px-5 py-3 border-b border-zinc-100 dark:border-zinc-800 bg-gradient-to-r from-blue-50/50 to-transparent dark:from-blue-900/10 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <Sparkles className="text-primary" size={18} />
                    <h3 className="font-semibold text-zinc-900 dark:text-white text-sm">AI 助教追问</h3>
                </div>
                <div className="flex items-center gap-2">
                    <select
                        value={chatModel}
                        onChange={(e) => setChatModel(e.target.value)}
                        className="text-[11px] px-2 py-1 rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-white focus:outline-none focus:ring-1 focus:ring-primary"
                    >
                        {chatModelOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                                {option.label}
                            </option>
                        ))}
                    </select>
                    <span className="text-[10px] text-zinc-500 dark:text-white/80 bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded-full border border-zinc-200 dark:border-zinc-700">Beta</span>
                </div>
            </div>
            
            {/* Messages Area */}
            <div className="p-5 flex flex-col gap-4 max-h-[640px] min-h-[440px] overflow-y-auto bg-zinc-50/30 dark:bg-black/20 scrollbar-thin">
                {chatMessages.map((msg, idx) => (
                    <div key={idx} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                        {/* Avatar */}
                        <div className={`flex-none w-8 h-8 rounded-full flex items-center justify-center shadow-sm ${msg.role === 'ai' ? 'bg-indigo-100 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400' : 'bg-primary text-white'}`}>
                            {msg.role === 'ai' ? (
                                <Sparkles size={14} />
                            ) : state.user.avatar ? (
                                <img
                                    src={state.user.avatar}
                                    alt={state.user.name || 'Me'}
                                    className="w-full h-full rounded-full object-cover"
                                />
                            ) : (
                                <div className="text-[10px] font-bold">ME</div>
                            )}
                        </div>
                        {/* Bubble */}
                        <div className={`rounded-2xl px-4 py-2.5 max-w-[85%] text-sm leading-relaxed shadow-sm ${
                            msg.role === 'user' 
                            ? 'bg-primary text-white rounded-tr-sm' 
                            : 'bg-white dark:bg-[#111114] text-zinc-800 dark:text-zinc-100 border border-zinc-200/60 dark:border-zinc-800 rounded-tl-sm'
                        }`}>
                            {msg.role === 'ai' ? (
                                <div className="prose prose-sm dark:prose-invert max-w-none leading-relaxed prose-p:leading-7 prose-p:my-2 prose-li:my-1">
                                    <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[[rehypeKatex, katexOptions]]}>
                                        {normalizeMarkdown(msg.content)}
                                    </ReactMarkdown>
                                </div>
                            ) : (
                                msg.content
                            )}
                        </div>
                    </div>
                ))}
                
                {/* Loading Indicator */}
                {isChatLoading && (
                    <div className="flex gap-3 animate-fade-in">
                        <div className="flex-none w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400 flex items-center justify-center">
                            <Sparkles size={14} />
                        </div>
                        <div className="bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 px-4 py-3 rounded-2xl rounded-tl-sm flex items-center gap-1.5 shadow-sm">
                            <div className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce" style={{animationDelay: '0ms'}}></div>
                            <div className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce" style={{animationDelay: '150ms'}}></div>
                            <div className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce" style={{animationDelay: '300ms'}}></div>
                        </div>
                    </div>
                )}
                <div ref={chatEndRef} />
            </div>

            {/* Input Area */}
            <div className="p-3 bg-white dark:bg-[#1c1c21] border-t border-zinc-200 dark:border-zinc-800">
                <div className="relative flex items-center gap-2">
                    <input 
                        type="text" 
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                        placeholder="请输入你的问题"
                        className="flex-1 bg-zinc-100 dark:bg-zinc-900 border-none rounded-lg py-2.5 pl-4 pr-12 text-sm text-zinc-900 dark:text-white placeholder:text-zinc-500 dark:placeholder:text-white/60 focus:ring-1 focus:ring-primary focus:bg-white dark:focus:bg-black transition-all"
                    />
                    <button 
                        onClick={handleSendMessage}
                        disabled={!chatInput.trim() || isChatLoading}
                        className="absolute right-1.5 p-1.5 bg-white dark:bg-zinc-800 text-primary rounded-md shadow-sm border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                    >
                        <Send size={16} />
                    </button>
                </div>
            </div>
        </div>

        </div>

        {isAnalyzing && <AIFullScreenLoader />}
    </>
  );
};

export default StudyView;
