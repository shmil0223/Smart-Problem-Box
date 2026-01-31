
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../../context/StoreContext';
import { Problem } from '../../types';
import { Sparkles, CheckCircle, RefreshCcw, ArrowLeft, ChevronDown, Folder } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

// KaTeX 配置：允许 Unicode/中文字符
const katexOptions = { strict: false };
import 'katex/dist/katex.min.css';
import { apiGenerateSimilarProblem, apiFetchLatestPractice, apiFetchPracticeList, apiSaveQuestions, apiSubmitAndGradeAnswer } from '../../api';
import { AIInlineLoader } from '../ui/AiLoaders';

interface PracticeViewProps {
  problem: Problem;
}

const PracticeView: React.FC<PracticeViewProps> = ({ problem }) => {
    const { setViewMode, refreshData, treeData, setCurrentProblem } = useStore();
    const [model, setModel] = useState('google/gemini-3-flash-preview');
    const [generatedQuestion, setGeneratedQuestion] = useState('');
    const [practiceId, setPracticeId] = useState<string | null>(null);
    const [isGenerating, setIsGenerating] = useState(false);
    const [generateError, setGenerateError] = useState('');
    const [isLoadingLatest, setIsLoadingLatest] = useState(false);
    const [practiceList, setPracticeList] = useState<Array<{ id: string; question: string; model?: string; createdAt: string }>>([]);
    const [saveFolderId, setSaveFolderId] = useState<string | null>(null);
    const [answerText, setAnswerText] = useState('');
    const [isChecking, setIsChecking] = useState(false);
    const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(new Set());
    const suppressNextGenerateRef = useRef(false);
    const recycleNode = useMemo(() => (treeData || []).find((node) => node.title === '回收站'), [treeData]);

    const normalizeMarkdown = (value: string) => {
        if (!value) return '';
        return value
            .replace(/\\\[/g, '$$')
            .replace(/\\\]/g, '$$')
            .replace(/\\\(/g, '$')
            .replace(/\\\)/g, '$')
            .replace(/\r\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .replace(/([^\n])\n(?!\n)/g, '$1  \n');
    };

    const modelOptions = [
        { value: 'openai/gpt-5-mini', label: 'GPT-5 mini（OpenRouter）' },
        { value: 'google/gemini-3-flash-preview', label: 'Gemini 3 Flash Preview（OpenRouter）' },
        { value: 'openai/gpt-4o', label: 'GPT-4o（OpenRouter）' },
        { value: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash（OpenRouter）' }
    ];

    const handleGenerate = async () => {
        setIsGenerating(true);
        setGenerateError('');
        try {
            const baseText = problem.description || problem.title;
            const { question, id, model: usedModel, createdAt } = await apiGenerateSimilarProblem({
                originalText: baseText,
                analysisContext: problem.analysisResult || null,
                model,
                problemId: problem.id
            });
            setGeneratedQuestion(question || '');
            setPracticeId(id || null);
            if (usedModel) setModel(usedModel);
            if (id) {
                setPracticeList((prev) => [
                    { id, question: question || '', model: usedModel, createdAt },
                    ...prev.filter((item) => item.id !== id)
                ]);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : '生成失败，请稍后再试';
            setGenerateError(message);
        } finally {
            setIsGenerating(false);
        }
    };

    useEffect(() => {
        let isMounted = true;
        const loadLatest = async () => {
            setIsLoadingLatest(true);
            try {
                const [latestRes, listRes] = await Promise.all([
                    apiFetchLatestPractice({ problemId: problem.id }),
                    apiFetchPracticeList({ problemId: problem.id })
                ]);
                const item = latestRes.item;
                const listItems = listRes.items || [];
                if (!isMounted) return;
                if (item?.question) {
                    setGeneratedQuestion(item.question);
                    setPracticeId(item.id);
                    setAnswerText('');
                    if (item.model) {
                        suppressNextGenerateRef.current = true;
                        setModel(item.model);
                    }
                } else {
                    setGeneratedQuestion('');
                    setPracticeId(null);
                }
                setPracticeList(listItems);
            } catch {
                if (isMounted) {
                    setGeneratedQuestion('');
                    setPracticeId(null);
                }
            } finally {
                if (isMounted) setIsLoadingLatest(false);
            }
        };
        loadLatest();
        return () => {
            isMounted = false;
        };
    }, [problem.id]);

    useEffect(() => {
        if (suppressNextGenerateRef.current) {
            suppressNextGenerateRef.current = false;
        }
    }, [model]);

    useEffect(() => {
        const retryKey = `spb_practice_retry_${problem.id}`;
        const regenerateKey = `spb_practice_regenerate_${problem.id}`;
        const shouldRetry = localStorage.getItem(retryKey);
        const shouldRegenerate = localStorage.getItem(regenerateKey);
        if (shouldRetry) {
            setAnswerText('');
            localStorage.removeItem(retryKey);
        }
        if (shouldRegenerate) {
            handleGenerate();
            localStorage.removeItem(regenerateKey);
        }
    }, [problem.id]);

    const findParentFolderId = (nodes: any[], problemId: string, parentId: string | null = null): string | null => {
        for (const node of nodes) {
            if (node.type === 'file' && node.problemId === problemId) {
                return parentId;
            }
            if (node.children) {
                const found = findParentFolderId(node.children, problemId, node.type === 'folder' ? node.id : parentId);
                if (found) return found;
            }
        }
        return null;
    };

    const findFolderPath = (nodes: any[], targetId: string | null, path: string[] = []): string[] => {
        if (!targetId) return [];
        for (const node of nodes) {
            if (node.type === 'folder') {
                const nextPath = [...path, node.id];
                if (node.id === targetId) return nextPath;
                if (node.children?.length) {
                    const found = findFolderPath(node.children, targetId, nextPath);
                    if (found.length) return found;
                }
            }
        }
        return [];
    };

    const findFolderLabel = (nodes: any[], targetId: string | null, path: string[] = []): string => {
        if (!targetId) return '根目录';
        for (const node of nodes) {
            if (node.type === 'folder') {
                const nextPath = [...path, node.title];
                if (node.id === targetId) return nextPath.join(' / ');
                if (node.children?.length) {
                    const found = findFolderLabel(node.children, targetId, nextPath);
                    if (found !== '根目录') return found;
                }
            }
        }
        return '根目录';
    };

    const renderFolderTree = (nodes: any[], depth = 0) => {
        return nodes
            .filter((node) => node.type === 'folder' && node.title !== '回收站')
            .map((node) => (
                <div key={node.id}>
                    <div
                        className={`flex items-center gap-2 px-3 py-2 rounded-md text-xs transition-colors ${
                          saveFolderId === node.id
                            ? 'bg-sky-50 text-sky-700 font-semibold border border-sky-200 dark:bg-primary/10 dark:text-primary dark:border-primary/30'
                            : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                        }`}
                        style={{ paddingLeft: `${10 + depth * 14}px` }}
                    >
                        {node.children?.length ? (
                            <button
                                type="button"
                                onClick={() => {
                                    const next = new Set(expandedFolderIds);
                                    if (next.has(node.id)) next.delete(node.id);
                                    else next.add(node.id);
                                    setExpandedFolderIds(next);
                                }}
                                className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                            >
                                <ChevronDown
                                    size={14}
                                    className={`transition-transform ${expandedFolderIds.has(node.id) ? 'rotate-0' : '-rotate-90'}`}
                                />
                            </button>
                        ) : (
                            <span className="w-[14px]" />
                        )}
                        <Folder size={14} className="text-zinc-400" />
                        <button
                            type="button"
                            onClick={() => {
                                setSaveFolderId(node.id);
                                setIsFolderMenuOpen(false);
                            }}
                            className="flex-1 text-left"
                        >
                            {node.title}
                        </button>
                    </div>
                    {node.children?.length && expandedFolderIds.has(node.id)
                        ? renderFolderTree(node.children, depth + 1)
                        : null}
                </div>
            ));
    };

    useEffect(() => {
        const defaultFolderId = findParentFolderId(treeData || [], problem.id, null);
        const normalized = recycleNode?.id && defaultFolderId === recycleNode.id ? null : defaultFolderId;
        setSaveFolderId(normalized || null);
    }, [problem.id, treeData, recycleNode?.id]);

    useEffect(() => {
        const expandedPath = findFolderPath(treeData || [], saveFolderId, []);
        setExpandedFolderIds(new Set(expandedPath));
    }, [treeData, saveFolderId]);


    const handleSaveToLibrary = async () => {
        if (!generatedQuestion.trim()) {
            setGenerateError('题目内容为空，无法保存');
            return;
        }
        if (recycleNode?.id && saveFolderId === recycleNode.id) {
            setGenerateError('不能保存到回收站，请选择其他目录');
            return;
        }
        try {
            const seq = Math.max(1, practiceList.length);
            const title = `${problem.title}-同类题${seq}`;
            const { problems } = await apiSaveQuestions({
                imageUrl: '',
                items: [{ content: generatedQuestion, title }],
                subject: problem.subject,
                parentFolderId: saveFolderId,
                forceParentOnly: true
            });
            await refreshData();
            const newProblemId = problems && problems[0]?.id;
            if (newProblemId) {
                setCurrentProblem(newProblemId);
                setViewMode('study');
            }
            alert('已保存到题库');
        } catch (error) {
            const message = error instanceof Error ? error.message : '保存失败，请稍后再试';
            setGenerateError(message);
        }
    };

    const handleSubmitCheck = async () => {
        if (!generatedQuestion.trim()) {
            setGenerateError('题目内容为空，无法检查');
            return;
        }
        if (!answerText.trim()) {
            setGenerateError('请先填写你的解题思路或答案');
            return;
        }
        if (!practiceId) {
            setGenerateError('请先生成题目');
            return;
        }
        setIsChecking(true);
        setGenerateError('');
        try {
            const { result } = await apiSubmitAndGradeAnswer({
                userAnswer: answerText,
                correctAnswerContext: null,
                practiceId,
                model
            });
            localStorage.setItem(`spb_practice_active_${problem.id}`, practiceId);
            setViewMode('feedback');
        } catch (error) {
            const message = error instanceof Error ? error.message : '检查失败，请稍后再试';
            setGenerateError(message);
        } finally {
            setIsChecking(false);
        }
    };

  return (
    <div className="max-w-3xl mx-auto px-8 py-10 flex flex-col h-full animate-fade-in">
        <div className="text-center mb-10">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 text-xs font-semibold mb-4 border border-blue-100 dark:border-blue-500/20">
                <Sparkles size={14} />
                AI 智能生成
            </div>
            <h1 className="text-2xl md:text-3xl font-bold text-zinc-900 dark:text-white tracking-tight leading-tight mb-3">同类题训练</h1>
            <p className="text-zinc-500 text-sm">基于当前题目，由 AI 生成相似题型</p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <div className="rounded-2xl border border-zinc-200/80 dark:border-zinc-700/80 bg-white/90 dark:bg-[#1c1c21] px-5 py-4 shadow-[0_14px_30px_rgba(0,0,0,0.08)] flex flex-col min-h-[220px]">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">选择模型</span>
                        <span className="text-[10px] text-sky-700 bg-sky-50 px-2 py-0.5 rounded-full border border-sky-200 dark:text-primary dark:bg-primary/10 dark:border-primary/20">Beta</span>
                    </div>
                    <div className="flex-1 flex flex-col gap-2 overflow-y-auto pr-1 scrollbar-thin">
                        {modelOptions.map((option) => (
                            <button
                                key={option.value}
                                type="button"
                                onClick={() => setModel(option.value)}
                                className={`w-full rounded-full px-3 py-1.5 text-xs font-semibold transition-colors border ${
                                    model === option.value
                                        ? 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-primary/10 dark:text-primary dark:border-primary/30'
                                        : 'bg-white/70 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300 border-zinc-200/70 dark:border-zinc-700 hover:border-primary/40'
                                }`}
                            >
                                {option.label}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="rounded-2xl border border-zinc-200/80 dark:border-zinc-700/80 bg-white/90 dark:bg-[#1c1c21] px-5 py-4 shadow-[0_14px_30px_rgba(0,0,0,0.08)]">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">保存目录</span>
                    </div>
                    <div className="max-h-64 overflow-y-auto rounded-xl border border-zinc-200/80 dark:border-zinc-700 bg-zinc-50/60 dark:bg-[#15151a] p-2">
                        <button
                            type="button"
                            onClick={() => setSaveFolderId(null)}
                            className={`w-full text-left px-3 py-2 rounded-md text-xs transition-colors ${
                              !saveFolderId
                                ? 'bg-sky-50 text-sky-700 font-semibold border border-sky-200 dark:bg-primary/10 dark:text-primary dark:border-primary/30'
                                : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                            }`}
                        >
                            根目录
                        </button>
                        {renderFolderTree(treeData || [])}
                    </div>
                </div>
            </div>
        </div>

        {/* Generated Problem Card */}
        <div className="bg-white dark:bg-[#1c1c21] border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 shadow-sm mb-6">
            <div className="flex justify-between items-start">
                <div className="flex gap-3">
                    <span className="flex-none h-6 w-6 rounded-full bg-sky-50 text-sky-700 flex items-center justify-center text-xs font-bold border border-sky-200 dark:bg-primary/10 dark:text-primary dark:border-primary/30">1</span>
                    <div className="text-zinc-900 dark:text-white font-medium text-base leading-relaxed w-full">
                        {isGenerating && <span className="text-zinc-400">生成中...</span>}
                        {!isGenerating && !generatedQuestion && !generateError && (
                            <span className="text-zinc-400">点击下方按钮开始生成同类题</span>
                        )}
                        {generateError && <span className="text-red-500">{generateError}</span>}
                        {!!generatedQuestion && (
                            <div className="prose prose-sm dark:prose-invert max-w-none leading-relaxed">
                                <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[[rehypeKatex, katexOptions]]}>
                                    {normalizeMarkdown(generatedQuestion)}
                                </ReactMarkdown>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>

        {practiceList.length > 0 && (
            <div className="mb-8">
                <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-3">生成题列表</h3>
                <div className="flex flex-col gap-2">
                    {practiceList.map((item, index) => (
                        <button
                            key={item.id}
                            onClick={() => {
                                setGeneratedQuestion(item.question);
                                setPracticeId(item.id);
                                if (item.model) setModel(item.model);
                            }}
                            className={`text-left p-4 rounded-lg border ${
                                item.id === practiceId
                                    ? 'border-primary/50 bg-primary/5'
                                    : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#1c1c21]'
                            } hover:border-primary/50 transition-colors`}
                        >
                            <div className="text-xs text-zinc-500 mb-1">
                                {index + 1}. {item.model || '模型未知'} · {new Date(item.createdAt).toLocaleString()}
                            </div>
                            <div className="text-sm text-zinc-800 dark:text-zinc-200 line-clamp-2">
                                {item.question}
                            </div>
                        </button>
                    ))}
                </div>
            </div>
        )}

        {/* Input Area */}
        <div className="mb-8">
            <label htmlFor="answer" className="sr-only">Your Answer</label>
            <textarea 
                id="answer"
                value={answerText}
                onChange={(e) => setAnswerText(e.target.value)}
                className="w-full h-40 bg-white dark:bg-[#1c1c21] border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 text-base font-medium text-zinc-900 dark:text-white focus:ring-2 focus:ring-primary focus:border-transparent resize-none placeholder:text-zinc-400 dark:placeholder:text-zinc-500 transition-all shadow-sm outline-none"
                placeholder="请输入你的答案"
            ></textarea>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col items-center gap-6 pb-20">
            {isChecking && (
                <div className="w-full flex justify-center">
                    <AIInlineLoader />
                </div>
            )}
            <div className="flex items-center gap-4 w-full sm:w-auto">
                <button 
                    onClick={handleSubmitCheck}
                    disabled={isChecking}
                    className="flex-1 sm:flex-none w-full sm:w-48 h-11 bg-primary hover:bg-primary/90 text-white rounded-lg font-medium text-sm transition-all shadow-lg shadow-primary/20 flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                    <CheckCircle size={18} />
                    {isChecking ? '检查中...' : '提交并检查'}
                </button>
                <button
                    onClick={handleSaveToLibrary}
                    className="flex-1 sm:flex-none w-full sm:w-48 h-11 border border-sky-200 hover:bg-sky-50 text-sky-700 dark:border-primary/40 dark:hover:bg-primary/10 dark:text-primary rounded-lg font-medium text-sm transition-colors flex items-center justify-center gap-2"
                >
                    保存到题库
                </button>
                <button
                    onClick={handleGenerate}
                    disabled={isGenerating}
                    className={`flex-1 sm:flex-none w-full sm:w-48 h-11 rounded-lg font-medium text-sm transition-colors flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed ${
                        generatedQuestion
                            ? 'border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300'
                            : 'bg-primary hover:bg-primary/90 text-white shadow-lg shadow-primary/20'
                    }`}
                >
                    <RefreshCcw size={18} />
                    {generatedQuestion ? '换一道同类题' : '开始生成'}
                </button>
            </div>
            <div className="flex items-center gap-8 text-xs font-medium text-zinc-500">
                <button 
                    onClick={() => setViewMode('study')}
                    className="hover:text-primary transition-colors flex items-center gap-1.5 group"
                >
                    <ArrowLeft size={16} className="text-zinc-400 group-hover:text-primary" />
                    返回原题
                </button>
            </div>
        </div>
    </div>
  );
};

export default PracticeView;
