import React, { useEffect, useMemo, useState } from 'react';
import { useStore } from '../../context/StoreContext';
import { Problem } from '../../types';
import { Check, RotateCcw, ArrowRight, ArrowLeft, XCircle, ChevronRight } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

// KaTeX 配置：允许 Unicode/中文字符
const katexOptions = { strict: false };
import 'katex/dist/katex.min.css';
import { apiFetchPracticeFeedback, apiFetchPracticeList, apiSaveQuestions } from '../../api';

interface FeedbackViewProps {
  problem: Problem;
}

const FeedbackView: React.FC<FeedbackViewProps> = ({ problem }) => {
  const { setViewMode, treeData, setCurrentProblem, refreshData } = useStore();
  const [feedbackPayload, setFeedbackPayload] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [isSavingToLibrary, setIsSavingToLibrary] = useState(false);
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

  const handleSaveToLibrary = async () => {
    if (!feedbackPayload?.question) return;
    setIsSavingToLibrary(true);
    try {
      const { items } = await apiFetchPracticeList({ problemId: problem.id });
      const seq = Math.max(1, (items || []).length);
      const title = `${problem.title}-同类题${seq}`;
      const parentFolderId = findParentFolderId(treeData || [], problem.id, null);
      const { problems } = await apiSaveQuestions({
        imageUrl: '',
        items: [{ content: feedbackPayload.question, title }],
        subject: problem.subject,
        parentFolderId,
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
      alert(message);
    } finally {
      setIsSavingToLibrary(false);
    }
  };
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
  useEffect(() => {
    let isMounted = true;
    const loadFeedback = async () => {
      setIsLoading(true);
      setLoadError('');
      try {
        const activeId = localStorage.getItem(`spb_practice_active_${problem.id}`) || '';
        const { item } = await apiFetchPracticeFeedback(activeId ? { practiceId: activeId } : { problemId: problem.id });
        if (!isMounted) return;
        setFeedbackPayload(item || null);
      } catch (error) {
        if (!isMounted) return;
        const message = error instanceof Error ? error.message : '加载失败';
        setLoadError(message);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };
    loadFeedback();
    return () => {
      isMounted = false;
    };
  }, [problem.id]);

  const feedback = feedbackPayload?.feedback;
  const isCorrect = typeof feedback?.is_correct === 'boolean' ? feedback.is_correct : null;
  const verdict = isCorrect === true ? 'correct' : isCorrect === false ? 'incorrect' : 'partial';
  const verdictLabel = verdict === 'correct' ? '解答正确' : verdict === 'incorrect' ? '解答有误' : '部分正确';
  const verdictTone =
    verdict === 'correct'
      ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20 text-emerald-900 dark:text-emerald-400'
      : verdict === 'incorrect'
        ? 'bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/20 text-red-900 dark:text-red-400'
        : 'bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20 text-amber-900 dark:text-amber-400';

  return (
    <div className="max-w-3xl mx-auto px-8 py-8 flex flex-col gap-6 pb-20 animate-fade-in">
        {/* Result Header */}
        <div className={`rounded-xl p-4 flex items-start gap-3 shadow-sm border ${verdictTone}`}>
            <div className={`mt-0.5 h-5 w-5 rounded-full flex items-center justify-center flex-none text-white ${
                verdict === 'correct' ? 'bg-emerald-500' : verdict === 'incorrect' ? 'bg-red-500' : 'bg-amber-500'
            }`}>
                {verdict === 'incorrect' ? <XCircle size={14} strokeWidth={2} /> : <Check size={14} strokeWidth={3} />}
            </div>
            <div>
                <h3 className="text-sm font-bold">{verdictLabel}</h3>
                <p className="text-sm mt-1 leading-relaxed">
                    {isLoading ? '加载中...' : loadError ? loadError : (feedback?.summary || '已完成批改。')}
                </p>
                {verdict === 'correct' && (
                    <p className="text-xs mt-2 text-emerald-700 dark:text-emerald-500">做得很好，保持这个节奏！</p>
                )}
            </div>
        </div>

        {/* Problem Recap */}
        <section>
            <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-3 pl-1">题目内容</h4>
            <div className="bg-white dark:bg-[#1c1c21] border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 shadow-sm">
                <div className="prose prose-sm dark:prose-invert max-w-none leading-relaxed">
                    <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[[rehypeKatex, katexOptions]]}>
                        {normalizeMarkdown(feedbackPayload?.question || '')}
                    </ReactMarkdown>
                </div>
            </div>
        </section>

        {/* User Logic Trace */}
        <section>
            <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-3 pl-1">你的解题思路</h4>
            <div className="bg-white dark:bg-[#1c1c21] border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 shadow-sm relative overflow-hidden group">
                <div className="prose prose-sm dark:prose-invert max-w-none leading-relaxed">
                    <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[[rehypeKatex, katexOptions]]}>
                        {normalizeMarkdown(feedbackPayload?.user_answer || '')}
                    </ReactMarkdown>
                </div>
            </div>
        </section>

        {feedback?.standard_solution?.final_answer_latex && (
            <section>
                <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-3 pl-1">正确解答</h4>
                <div className="bg-white dark:bg-[#1c1c21] border border-primary/30 dark:border-primary/40 rounded-xl p-6 shadow-sm">
                    <div className="flex items-center gap-2 mb-3">
                        <span className="text-[10px] font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded-full border border-primary/20">标准答案</span>
                    </div>
                    <div className="prose prose-sm dark:prose-invert max-w-none leading-relaxed">
                        <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[[rehypeKatex, katexOptions]]}>
                            {normalizeMarkdown(feedback.standard_solution.final_answer_latex)}
                        </ReactMarkdown>
                    </div>
                </div>
            </section>
        )}

        {Array.isArray(feedback?.standard_solution?.steps) && feedback.standard_solution.steps.length > 0 && (
            <section>
                <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-3 pl-1">解题思路</h4>
                <div className="bg-white dark:bg-[#1c1c21] border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 shadow-sm">
                    <div className="space-y-3">
                        {feedback.standard_solution.steps.map((step: any) => (
                            <details key={step.seq} className="group rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 open:bg-zinc-50/60 dark:open:bg-zinc-800/40">
                                <summary className="flex items-center justify-between cursor-pointer text-sm font-semibold text-zinc-900 dark:text-white">
                                    <div className="flex items-center gap-3">
                                        <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-primary/10 text-primary text-xs font-bold">
                                            {step.seq}
                                        </span>
                                        <span>步骤 {step.seq}</span>
                                    </div>
                                    <ChevronRight className="text-zinc-400 group-open:rotate-90 transition-transform" size={16} />
                                </summary>
                                <div className="mt-3 prose prose-sm dark:prose-invert max-w-none leading-relaxed">
                                    <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[[rehypeKatex, katexOptions]]}>
                                        {normalizeMarkdown(step.content)}
                                    </ReactMarkdown>
                                </div>
                            </details>
                        ))}
                    </div>
                </div>
            </section>
        )}

        {/* Footer Actions */}
        <div className="mt-4 pt-4 border-t border-zinc-100 dark:border-zinc-800/50 flex flex-col sm:flex-row items-center gap-4">
             <button 
                onClick={() => {
                    localStorage.setItem(`spb_practice_retry_${problem.id}`, '1');
                    setViewMode('practice');
                }}
                className="w-full sm:flex-1 h-10 border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300 rounded-lg font-medium text-sm transition-colors flex items-center justify-center gap-2"
             >
                <RotateCcw size={18} />
                再试一次
            </button>
            <button
                onClick={handleSaveToLibrary}
                disabled={isSavingToLibrary}
                className="w-full sm:flex-1 h-10 border border-primary/40 hover:bg-primary/10 text-primary rounded-lg font-medium text-sm transition-colors flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
            >
                {isSavingToLibrary ? '保存中...' : '增添到题库'}
            </button>
            <button
                onClick={() => {
                    localStorage.setItem(`spb_practice_regenerate_${problem.id}`, '1');
                    setViewMode('practice');
                }}
                className="w-full sm:flex-1 h-10 bg-primary hover:bg-primary/90 text-white rounded-lg font-medium text-sm transition-all shadow-lg shadow-primary/20 flex items-center justify-center gap-2"
            >
                <span>下一道同类题</span>
                <ArrowRight size={18} />
            </button>
        </div>
        <div className="flex items-center justify-center">
            <button
                onClick={() => setViewMode('study')}
                className="text-xs text-zinc-500 hover:text-primary transition-colors flex items-center gap-1.5"
            >
                <ArrowLeft size={14} />
                返回原题
            </button>
        </div>
    </div>
  );
};

export default FeedbackView;