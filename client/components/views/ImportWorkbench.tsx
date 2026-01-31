
import React, { useState, useEffect, useCallback, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

// KaTeX 配置：允许 Unicode/中文字符
const katexOptions = { strict: false };
import 'katex/dist/katex.min.css';
import { preprocessLaTeX } from '../../utils/latex';
import { useStore } from '../../context/StoreContext';
import { TreeNode } from '../../types';
import { apiAnalyzeImport, apiSaveQuestions } from '../../api';
import { AIFullScreenLoader, AIInlineLoader } from '../ui/AiLoaders';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf';
import pdfWorker from 'pdfjs-dist/legacy/build/pdf.worker?url';
import { 
    CloudUpload, 
    ChevronDown, 
    Sparkles, 
    Image as ImageIcon, 
    X, 
    Check,
    PanelLeft,
    Folder,
    FolderPlus,
    ChevronRight,
    Search,
    Upload,
    ListChecks
} from 'lucide-react';

const ImportWorkbench: React.FC = () => {
    const { treeData, setViewMode, toggleSidebar, state, setColumnWidth, addNewFolder, refreshData } = useStore();
    const [isResizing, setIsResizing] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadError, setUploadError] = useState('');
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [candidates, setCandidates] = useState<Array<{ content: string }>>([]);
    const [analysisImageUrl, setAnalysisImageUrl] = useState<string>('');
    const [isSaving, setIsSaving] = useState(false);
    const [hasClickedImport, setHasClickedImport] = useState(false);
    const [selectedCandidateIndexes, setSelectedCandidateIndexes] = useState<number[]>([]);
    const [isCandidateSelectMode, setIsCandidateSelectMode] = useState(false);
    const [classifyModel, setClassifyModel] = useState('openai/gpt-4o');
    const [hasSelectedFolder, setHasSelectedFolder] = useState(false);
    const [pdfProgressText, setPdfProgressText] = useState('');
    
    // Custom Dropdown State
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const [targetFolder, setTargetFolder] = useState<{id: string, title: string} | null>(null);
    const [expandedFolderIds, setExpandedFolderIds] = useState<string[]>([]);
    const [isCreatingFolder, setIsCreatingFolder] = useState(false);
    const [newFolderTitle, setNewFolderTitle] = useState('');
    const dropdownRef = useRef<HTMLDivElement>(null);
    const uploadInputRef = useRef<HTMLInputElement>(null);

    GlobalWorkerOptions.workerSrc = pdfWorker;
    const hasUnsavedCandidates = candidates.length > 0;


    const pdfToDataUrls = async (file: File) => {
        const buffer = await file.arrayBuffer();
        const pdf = await getDocument({ data: buffer }).promise;
        const urls: string[] = [];
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
            setPdfProgressText(`第 ${pageNumber} 页识别中...`);
            const page = await pdf.getPage(pageNumber);
            const viewport = page.getViewport({ scale: 2 });
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            if (!context) throw new Error('PDF 渲染失败');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            await page.render({ canvasContext: context, viewport }).promise;
            urls.push(canvas.toDataURL('image/png'));
        }
        return urls;
    };

    // Close dropdown on outside click
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsDropdownOpen(false);
                setIsCreatingFolder(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    useEffect(() => {
        if (!hasUnsavedCandidates) return;
        const handleBeforeUnload = (event: BeforeUnloadEvent) => {
            event.preventDefault();
            event.returnValue = '';
        };
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [hasUnsavedCandidates]);

    const startResizing = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        setIsResizing(true);
    }, []);

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isResizing) return;
            const sidebarOffset = state.isSidebarOpen ? state.sidebarWidth : 0;
            const newWidth = e.clientX - sidebarOffset;
            if (newWidth > 200 && newWidth < 800) {
                setColumnWidth('middle', newWidth);
            }
        };

        const handleMouseUp = () => {
            setIsResizing(false);
        };

        if (isResizing) {
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
        } else {
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        }

        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };
    }, [isResizing, state.isSidebarOpen, state.sidebarWidth, setColumnWidth]);

    const findNodePath = (nodes: TreeNode[], targetId: string, path: TreeNode[] = []): TreeNode[] | null => {
        for (const node of nodes) {
            const nextPath = [...path, node];
            if (node.id === targetId) return nextPath;
            if (node.children) {
                const found = findNodePath(node.children, targetId, nextPath);
                if (found) return found;
            }
        }
        return null;
    };

    const getSubjectTitle = (folderId?: string | null) => {
        if (!folderId) return '未分类';
        const path = findNodePath(treeData, folderId);
        if (!path || path.length === 0) return '未分类';
        return path[0].title || '未分类';
    };

    const handleCreateFolder = (e: React.FormEvent) => {
        e.preventDefault();
        if (newFolderTitle.trim()) {
            addNewFolder(newFolderTitle.trim());
            setNewFolderTitle('');
            setIsCreatingFolder(false);
        }
    };

    const handleUploadSingle = async (file: File) => {
        const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
        if (isPdf) {
            const dataUrls = await pdfToDataUrls(file);
            const results = await Promise.all(
                dataUrls.map((dataUrl, idx) => (
                    apiAnalyzeImport({ dataUrl }).then((res) => ({ idx, res }))
                ))
            );
            results
                .sort((a, b) => a.idx - b.idx)
                .forEach(({ res }) => {
                    setAnalysisImageUrl(prev => prev || res.imageUrl);
                    setCandidates(prev => [...prev, ...res.candidates]);
                });
            setSelectedCandidateIndexes([]);
            setPdfProgressText('');
            return;
        }

        const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = () => reject(new Error('读取图片失败'));
            reader.readAsDataURL(file);
        });

        const { imageUrl, candidates: nextCandidates } = await apiAnalyzeImport({ dataUrl });
        setAnalysisImageUrl(prev => prev || imageUrl);
        setCandidates(prev => [...prev, ...nextCandidates]);
        setSelectedCandidateIndexes([]);
    };

    const handleSaveAll = async () => {
        if (!analysisImageUrl || candidates.length === 0) {
            alert('没有可保存的题目');
            return;
        }
        if (isSaving) return;
        try {
            setIsSaving(true);
            const cleaned = candidates.map(item => ({ content: item.content.trim() })).filter(item => item.content);
            if (cleaned.length === 0) {
                alert('题目内容不能为空');
                return;
            }
            const folderId = targetFolder?.id || state.selectedFolderId;
            if (!hasSelectedFolder) {
                alert('请先选择保存目录');
                return;
            }
            const subjectTitle = getSubjectTitle(folderId);
            await apiSaveQuestions({
                imageUrl: analysisImageUrl,
                items: cleaned,
                parentFolderId: folderId,
                subject: subjectTitle,
                classifyModel
            });
            await refreshData();
            setCandidates([]);
            setAnalysisImageUrl('');
            setSelectedCandidateIndexes([]);
            setIsCandidateSelectMode(false);
        } catch (error) {
            const message = error instanceof Error ? error.message : '保存失败，请稍后再试';
            alert(message);
        } finally {
            setIsSaving(false);
        }
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;
        setHasClickedImport(true);
        const fileList = Array.from(files);
        setIsUploading(true);
        setUploadError('');
        setIsAnalyzing(true);
        setPdfProgressText('');
        try {
            for (const file of fileList) {
                try {
                    await handleUploadSingle(file);
                } catch (error) {
                    const message = error instanceof Error ? error.message : '上传失败，请稍后再试';
                    setUploadError(message);
                    alert(message);
                }
            }
        } finally {
            setIsUploading(false);
            setIsAnalyzing(false);
            setPdfProgressText('');
            if (uploadInputRef.current) {
                uploadInputRef.current.value = '';
            }
        }
    };

    const toggleCandidateSelect = (index: number) => {
        setSelectedCandidateIndexes(prev => (
            prev.includes(index) ? prev.filter(i => i !== index) : [...prev, index]
        ));
    };

    const toggleSelectAllCandidates = () => {
        if (selectedCandidateIndexes.length === candidates.length) {
            setSelectedCandidateIndexes([]);
        } else {
            setSelectedCandidateIndexes(candidates.map((_, idx) => idx));
        }
    };

    const handleBatchDeleteCandidates = () => {
        if (selectedCandidateIndexes.length === 0) return;
        setCandidates(prev => prev.filter((_, idx) => !selectedCandidateIndexes.includes(idx)));
        setSelectedCandidateIndexes([]);
    };

    const toggleCandidateSelectMode = () => {
        setIsCandidateSelectMode(prev => {
            const next = !prev;
            if (!next) {
                setSelectedCandidateIndexes([]);
            }
            return next;
        });
    };

    // Recursive rendering for custom dropdown
    const renderFolderOption = (node: TreeNode, level: number = 0) => {
        // Only render folders
        if (node.type !== 'folder' || node.title === '回收站') return null;
        
        const isExpanded = expandedFolderIds.includes(node.id);
        const hasChildren = node.children && node.children.some(c => c.type === 'folder');
        
        return (
            <div key={node.id}>
                 <div 
                    className={`flex items-center px-3 py-2 cursor-pointer transition-colors ${targetFolder?.id === node.id ? 'bg-primary/5 text-primary font-medium' : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800'}`}
                    style={{ paddingLeft: `${level * 12 + 12}px` }}
                    onClick={(e) => {
                        e.stopPropagation();
                        setTargetFolder({ id: node.id, title: node.title });
                        setIsDropdownOpen(false);
                        setHasSelectedFolder(true);
                    }}
                 >
                    {/* Toggle Button */}
                    <div 
                        className={`p-0.5 mr-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-400 transition-colors ${hasChildren ? 'visible' : 'invisible'}`}
                        onClick={(e) => {
                            e.stopPropagation();
                            if (isExpanded) {
                                setExpandedFolderIds(prev => prev.filter(id => id !== node.id));
                            } else {
                                setExpandedFolderIds(prev => [...prev, node.id]);
                            }
                        }}
                    >
                        <ChevronRight size={14} className={`transform transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} />
                    </div>
                    
                    <Folder size={16} className={`mr-2 flex-none ${targetFolder?.id === node.id ? 'text-primary' : 'text-zinc-400'}`} />
                    <span className="truncate text-sm">{node.title}</span>
                 </div>
                 
                 {isExpanded && hasChildren && (
                     <div>
                        {node.children!.map(child => renderFolderOption(child, level + 1))}
                     </div>
                 )}
            </div>
        );
    };

    return (
        <>
            {/* Middle Column: Upload Workbench */}
            <div 
                className="flex-none bg-white dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-800 flex flex-col relative z-10 animate-fade-in"
                style={{ width: state.middleColumnWidth }}
            >
                <div className="h-16 flex items-center px-4 border-b border-zinc-200 dark:border-zinc-800">
                    <button 
                        onClick={toggleSidebar}
                        className="p-2 mr-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 rounded-lg transition-colors"
                        title={state.isSidebarOpen ? "收起侧边栏" : "展开侧边栏"}
                    >
                        <PanelLeft size={20} />
                    </button>
                    <h2 className="text-base font-semibold text-zinc-900 dark:text-white truncate">上传文件</h2>
                </div>
                
                <div className="p-6 flex flex-col gap-8 flex-1 overflow-y-auto">
                    {/* Upload Action */}
                    <button
                        type="button"
                        onClick={() => {
                            setHasClickedImport(true);
                            uploadInputRef.current?.click();
                        }}
                        disabled={isUploading}
                        className={`w-full bg-primary hover:bg-primary/90 text-white font-medium py-2.5 rounded-lg transition-all flex items-center justify-center gap-2 shadow-lg shadow-primary/20 disabled:opacity-70 disabled:cursor-wait ${
                            !hasClickedImport ? 'ring-2 ring-primary/50 ring-offset-2 ring-offset-white dark:ring-offset-zinc-900 animate-pulse' : ''
                        }`}
                    >
                        {isUploading ? (
                            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                        ) : (
                            <>
                                <Upload size={16} />
                                导入题目
                            </>
                        )}
                    </button>

                    {/* Upload Area */}
                    <div className="flex flex-col gap-3">
                        <div className="group relative w-full h-64 border-2 border-dashed border-zinc-300 dark:border-zinc-700 rounded-xl bg-zinc-50 dark:bg-zinc-800/30 hover:bg-zinc-100 dark:hover:bg-zinc-800/50 hover:border-primary/50 transition-all cursor-pointer flex flex-col items-center justify-center gap-4 text-center">
                            <div className="h-12 w-12 rounded-full bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                                <CloudUpload className="text-primary" size={24} />
                            </div>
                            <div>
                                <p className="text-sm font-medium text-zinc-900 dark:text-white group-hover:text-primary transition-colors">点击或拖拽文件到此处</p>
                                <p className="text-xs text-zinc-500 mt-1">支持 PDF 全页识别、PNG、JPG（最大 20MB）</p>
                            </div>
                            <input
                                ref={uploadInputRef}
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                type="file"
                                accept="image/*,application/pdf"
                                onChange={handleFileChange}
                                disabled={isUploading}
                                multiple
                            />
                        </div>
                        {uploadError && (
                            <div className="text-xs text-red-600">{uploadError}</div>
                        )}
                    </div>

                    {/* Options */}
                    <div className="flex flex-col gap-3 relative z-20">
                        <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">分类模型</label>
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={() => setClassifyModel('openai/gpt-4o')}
                                className={`px-3 py-2 rounded-lg text-xs font-semibold border transition-colors ${
                                    classifyModel === 'openai/gpt-4o'
                                        ? 'bg-primary/10 text-primary border-primary/30'
                                        : 'bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700 hover:border-primary/40'
                                }`}
                            >
                                GPT-4o（OpenRouter）
                            </button>
                            <button
                                type="button"
                                onClick={() => setClassifyModel('google/gemini-2.5-flash')}
                                className={`px-3 py-2 rounded-lg text-xs font-semibold border transition-colors ${
                                    classifyModel === 'google/gemini-2.5-flash'
                                        ? 'bg-primary/10 text-primary border-primary/30'
                                        : 'bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700 hover:border-primary/40'
                                }`}
                            >
                                Gemini 2.5 Flash（OpenRouter）
                            </button>
                        </div>
                        <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">保存至文件夹</label>
                        
                        <div className="relative" ref={dropdownRef}>
                            {/* Dropdown Trigger */}
                            <div 
                                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                                className={`w-full bg-white dark:bg-zinc-800 border ${isDropdownOpen ? 'border-primary ring-1 ring-primary/20' : 'border-zinc-300 dark:border-zinc-700 hover:border-zinc-400'} rounded-lg py-2.5 pl-3 pr-10 text-sm flex items-center cursor-pointer transition-all`}
                            >
                                <Folder size={16} className={`mr-2 flex-none ${targetFolder ? 'text-primary' : 'text-zinc-400'}`} />
                                <span className={`truncate ${targetFolder ? 'text-zinc-900 dark:text-white' : 'text-zinc-500'}`}>
                                    {targetFolder ? targetFolder.title : "收件箱 (未分类)"}
                                </span>
                                <ChevronDown className={`absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} size={18} />
                            </div>

                            {/* Dropdown Content */}
                            {isDropdownOpen && (
                                <div className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg shadow-xl overflow-hidden animate-fade-in flex flex-col max-h-80">
                                    {/* Create New Action */}
                                    <div className="p-2 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-black/20">
                                        {isCreatingFolder ? (
                                            <form onSubmit={handleCreateFolder} className="flex items-center gap-2 px-2">
                                                <input 
                                                    autoFocus
                                                    type="text" 
                                                    placeholder="输入文件夹名称..." 
                                                    className="flex-1 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded px-2 py-1 text-xs focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                                                    value={newFolderTitle}
                                                    onChange={e => setNewFolderTitle(e.target.value)}
                                                />
                                                <button type="submit" className="p-1 bg-primary text-white rounded hover:bg-primary/90">
                                                    <Check size={14} />
                                                </button>
                                                <button type="button" onClick={() => setIsCreatingFolder(false)} className="p-1 text-zinc-400 hover:text-zinc-600">
                                                    <X size={14} />
                                                </button>
                                            </form>
                                        ) : (
                                            <button 
                                                onClick={() => setIsCreatingFolder(true)}
                                                className="flex items-center gap-2 w-full px-2 py-1.5 text-xs font-medium text-primary hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors"
                                            >
                                                <FolderPlus size={14} />
                                                新建一级文件夹
                                            </button>
                                        )}
                                    </div>

                                    {/* Tree List */}
                                    <div className="overflow-y-auto flex-1 py-1">
                                        <div 
                                            className={`flex items-center px-3 py-2 cursor-pointer ${!targetFolder ? 'bg-zinc-50 dark:bg-zinc-800/50 text-zinc-900 dark:text-white' : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800'}`}
                                            onClick={() => {
                                                setTargetFolder(null);
                                                setIsDropdownOpen(false);
                                                setHasSelectedFolder(true);
                                            }}
                                        >
                                            <span className="w-5 mr-1"></span>
                                            <Folder size={16} className="mr-2 text-zinc-400" />
                                            <span className="text-sm">收件箱 (未分类)</span>
                                        </div>
                                        {treeData
                                            .filter(node => node.title !== '回收站')
                                            .map(node => renderFolderOption(node))}
                                    </div>
                                </div>
                            )}
                        </div>
                        
                        <p className="text-xs text-zinc-500">
                            文件处理完成后将自动保存到选定位置。
                        </p>
                    </div>

                    {/* Status Info */}
                    <div className="mt-auto">
                        <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-500/20">
                            <div className="flex items-start gap-3">
                                <Sparkles className="text-primary mt-0.5" size={20} />
                                <div>
                                    <h4 className="text-xs font-bold text-primary mb-0.5">智能识别</h4>
                                    <p className="text-xs text-zinc-600 dark:text-zinc-400">系统将自动识别题目边界并进行拆分预览。</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Resize Handle */}
            <div 
                onMouseDown={startResizing}
                className="w-1 cursor-col-resize hover:bg-primary/50 transition-colors relative z-20 group flex items-center justify-center flex-none -ml-0.5"
            >
                <div className={`w-0.5 h-8 rounded-full bg-zinc-300 dark:bg-zinc-700 group-hover:bg-primary transition-colors ${isResizing ? 'bg-primary' : ''}`}></div>
            </div>

            {/* Right Column: Preview Area */}
            <main className="flex-1 flex flex-col bg-zinc-100 dark:bg-black min-w-0 animate-fade-in delay-75">
                {/* Preview Header */}
                <header className="h-16 flex items-center justify-between px-6 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 sticky top-0 z-10">
                    <div className="flex items-center gap-4">
                        <h2 className="text-base font-semibold text-zinc-900 dark:text-white">识别结果确认</h2>
                    </div>
                    <div className="flex items-center gap-4">
                        <button
                            className="text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors"
                            onClick={() => {
                                if (hasUnsavedCandidates) {
                                    const shouldLeave = window.confirm('当前识别结果尚未保存，确定要退出吗？');
                                    if (!shouldLeave) return;
                                }
                                setViewMode('study');
                            }}
                            title="收起导入"
                        >
                            <ChevronDown size={24} />
                        </button>
                    </div>
                </header>

                {/* Confirm Panel */}
                <div className="flex-1 px-6 py-4 bg-white dark:bg-zinc-900 overflow-y-auto flex flex-col">
                    <div className="flex items-center justify-end mb-3">
                        <div className="flex items-center gap-2">
                            {isAnalyzing && (
                                <span className="text-xs text-primary">
                                    {pdfProgressText || '分析中...'}
                                </span>
                            )}
                            {isCandidateSelectMode && (
                              <>
                                <button
                                    type="button"
                                    onClick={toggleSelectAllCandidates}
                                    className="text-[10px] text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-200 border border-zinc-200 dark:border-zinc-700 px-2 py-0.5 rounded"
                                >
                                    {selectedCandidateIndexes.length === candidates.length && candidates.length > 0 ? '取消全选' : '全选'}
                                </button>
                                <button
                                    type="button"
                                    onClick={handleBatchDeleteCandidates}
                                    className={`text-[10px] px-2 py-0.5 rounded border ${
                                      selectedCandidateIndexes.length === 0
                                        ? 'text-zinc-400 border-zinc-200 dark:border-zinc-700 cursor-not-allowed'
                                        : 'text-red-600 border-red-200 hover:bg-red-50 dark:hover:bg-red-900/10'
                                    }`}
                                >
                                    批量删除
                                </button>
                              </>
                            )}
                            <button
                                type="button"
                                onClick={toggleCandidateSelectMode}
                                className="p-1 rounded border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-200"
                                title={isCandidateSelectMode ? '退出多选' : '多选'}
                            >
                                {isCandidateSelectMode ? <X size={14} /> : <ListChecks size={14} />}
                            </button>
                        </div>
                    </div>
                    {candidates.length === 0 ? (
                        <div className="text-base font-semibold text-zinc-600 dark:text-zinc-300 text-center py-6">
                            {isAnalyzing
                                ? '分析中，请稍候...'
                                : analysisImageUrl
                                    ? '识别完成，但未解析出题目，请检查图片清晰度或重试'
                                    : '上传图片后将在这里显示待确认题目'}
                        </div>
                    ) : (
                        <div className="space-y-3 pr-1">
                            {candidates.map((item, index) => (
                                <div key={index} className="bg-zinc-50/80 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-800 rounded-lg p-3 space-y-2">
                                    {isCandidateSelectMode && (
                                      <div className="flex items-center gap-2">
                                          <input
                                              type="checkbox"
                                              checked={selectedCandidateIndexes.includes(index)}
                                              onChange={() => toggleCandidateSelect(index)}
                                              className="h-3 w-3 accent-primary"
                                          />
                                          <span className="text-xs text-zinc-500">题目 {index + 1}</span>
                                      </div>
                                    )}
                                    <div className="rounded-md border border-zinc-200/80 dark:border-zinc-700 bg-white/80 dark:bg-zinc-900/80 p-3">
                                        <div className="text-[11px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400 mb-2">
                                            预览
                                        </div>
                                        <div className="flux-math prose prose-sm dark:prose-invert max-w-none leading-relaxed prose-p:leading-6 prose-p:my-2 text-zinc-700 dark:text-white/90 prose-p:text-zinc-700 dark:prose-p:text-white prose-li:text-zinc-700 dark:prose-li:text-white">
                                            <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[[rehypeKatex, katexOptions]]}>
                                                {preprocessLaTeX(item.content)}
                                            </ReactMarkdown>
                                        </div>
                                    </div>
                                    <textarea
                                        value={item.content}
                                        onChange={(e) => {
                                            const value = e.target.value;
                                            setCandidates(prev => prev.map((c, i) => i === index ? { ...c, content: value } : c));
                                        }}
                                        className="w-full min-h-[80px] bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-md p-2 text-xs text-zinc-800 dark:text-zinc-200 focus:ring-1 focus:ring-primary outline-none"
                                    />
                                    <div className="flex justify-end text-[10px] text-zinc-500">
                                        <button
                                            type="button"
                                            onClick={() => setCandidates(prev => prev.filter((_, i) => i !== index))}
                                            className="text-red-500 hover:text-red-600"
                                        >
                                            删除此题
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                    <div className="mt-auto pt-6 flex items-center justify-end gap-3">
                        {isSaving && <AIInlineLoader />}
                        <button
                            type="button"
                            onClick={handleSaveAll}
                            className={`px-5 py-2.5 rounded-lg text-sm font-medium bg-primary hover:bg-primary/90 text-white shadow-lg shadow-primary/20 flex items-center gap-2 ${candidates.length === 0 || isSaving ? 'opacity-60 cursor-not-allowed' : ''}`}
                        >
                            {isSaving && (
                                <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin"></span>
                            )}
                            {isSaving ? '保存中...' : '确认保存'}
                        </button>
                    </div>
                </div>

            </main>
            {isAnalyzing && <AIFullScreenLoader backgroundImageUrl={analysisImageUrl} />}
        </>
    );
};

export default ImportWorkbench;
