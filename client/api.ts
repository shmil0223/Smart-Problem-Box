const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';

const ACCESS_TOKEN_KEY = 'spb_access_token';

export const setAccessToken = (token: string) => {
  localStorage.setItem(ACCESS_TOKEN_KEY, token);
};

export const getAccessToken = () => {
  return localStorage.getItem(ACCESS_TOKEN_KEY) || '';
};

export const clearAccessToken = () => {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
};

// 带超时的 fetch 封装
const fetchWithTimeout = async (
  url: string,
  options: RequestInit & { timeout?: number } = {}
): Promise<Response> => {
  const { timeout = 30000, ...fetchOptions } = options;
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal
    });
    return response;
  } catch (error: any) {
    if (error.name === 'AbortError') {
      throw new Error('请求超时，请稍后重试');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
};

const request = async <T>(
  path: string,
  options: RequestInit & { timeout?: number } = {}
) => {
  const token = getAccessToken();
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const { timeout, ...restOptions } = options;
  
  const response = await fetchWithTimeout(`${API_BASE_URL}${path}`, {
    ...restOptions,
    headers,
    timeout: timeout || 30000 // 默认 30 秒
  });

  const text = await response.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    const message = data?.message || '请求失败';
    throw new Error(message);
  }

  return data as T;
};

export const apiLogin = (payload: { email: string; password: string }) => {
  return request<{ token: string; profile: any }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
};

export const apiRegister = (payload: { name: string; email: string; password: string }) => {
  return request<{ token: string; profile: any }>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
};

export const apiChangePassword = (payload: { currentPassword: string; newPassword: string }) => {
  return request<{ ok: boolean }>('/api/auth/change-password', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
};

export const apiBootstrap = () => {
  return request<{ profile: any; problems: any[]; tree: any[]; favorites: string[] }>('/api/bootstrap');
};

export const apiUpdateProfile = (payload: any) => {
  return request<{ profile: any }>('/api/profile', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
};

export const apiToggleFavorite = (problemId: string) => {
  return request<{ favorites: string[] }>('/api/favorites/toggle', {
    method: 'POST',
    body: JSON.stringify({ problemId })
  });
};

export const apiAddFolder = (payload: { title: string; parentId?: string | null }) => {
  return request<{ node: any }>('/api/folders', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
};

export const apiDeleteNode = (nodeId: string) => {
  return request<{ ok: boolean }>(`/api/nodes/${nodeId}`, { method: 'DELETE' });
};

export const apiDeleteNodesBatch = (nodeIds: string[]) => {
  return request<{ ok: boolean }>('/api/nodes/batch-delete', {
    method: 'POST',
    body: JSON.stringify({ nodeIds })
  });
};

export const apiRestoreNode = (payload: { nodeId: string }) => {
  return request<{ ok: boolean }>('/api/nodes/restore', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
};

export const apiHardDeleteNode = (payload: { nodeId: string }) => {
  return request<{ ok: boolean }>('/api/nodes/hard-delete', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
};

export const apiMoveProblemToFolder = (payload: { problemId: string; targetFolderId?: string | null }) => {
  return request<{ ok: boolean }>('/api/nodes/move-problem', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
};

export const apiMoveNodeToFolder = (payload: { nodeId: string; targetFolderId?: string | null }) => {
  return request<{ ok: boolean }>('/api/nodes/move-node', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
};

export const apiReorderNodes = (payload: { orderedIds: string[] }) => {
  return request<{ ok: boolean }>('/api/nodes/reorder', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
};

export const apiDeleteProblem = (problemId: string) => {
  return request<{ ok: boolean }>(`/api/problems/${problemId}`, { method: 'DELETE' });
};

export const apiDeleteProblemsBatch = (problemIds: string[]) => {
  return request<{ ok: boolean }>('/api/problems/batch-delete', {
    method: 'POST',
    body: JSON.stringify({ problemIds })
  });
};

export const apiAnalyzeImport = (payload: { dataUrl: string }) => {
  return request<{ imageUrl: string; candidates: Array<{ content: string }> }>('/api/import/analyze', {
    method: 'POST',
    body: JSON.stringify(payload),
    timeout: 180000 // 3 分钟超时（OCR + 清洗可能需要较长时间）
  });
};

export const apiFetchQuestions = () => {
  return request<{ questions: any[] }>('/api/questions');
};

export const apiSaveQuestions = (payload: {
  imageUrl: string;
  items: Array<{ content: string; title?: string; tags?: string[]; difficulty?: string }>;
  parentFolderId?: string | null;
  subject?: string;
  tags?: { big: string; mid: string; small: string } | string[];
  forceParentOnly?: boolean;
  classifyModel?: string;
}) => {
  return request<{ ok: boolean; problems?: any[] }>(
    '/api/questions/batch',
    {
      method: 'POST',
      body: JSON.stringify(payload)
    }
  );
};

export const apiAnalyzeQuestionText = (payload: { questionText: string; subject?: string; problemId?: string; model?: string }) => {
  return request<{ result: any }>('/api/analysis', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
};

export const apiChat = (payload: { message: string; model?: string; context?: string; history?: Array<{ role: 'user' | 'ai'; content: string }>; problemId?: string }) => {
  return request<{ reply: { role: string; content: string } }>('/api/chat', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
};

export const apiFetchChatHistory = (payload: { problemId: string }) => {
  const params = new URLSearchParams(payload);
  return request<{ messages: Array<{ role: 'user' | 'ai'; content: string; model?: string; createdAt?: string }> }>(
    `/api/chat/history?${params.toString()}`
  );
};

export const apiGenerateSimilarProblem = (payload: { originalText: string; analysisContext?: any; model?: string; problemId: string }) => {
  return request<{ question: string; id: string; model: string; createdAt: string; payload: any }>('/api/practice/generate-v2', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
};

export const apiFetchLatestPractice = (payload: { problemId: string }) => {
  const params = new URLSearchParams(payload);
  return request<{ item: { id: string; question: string; model?: string; createdAt: string } | null }>(`/api/practice/latest?${params.toString()}`);
};

export const apiFetchPracticeList = (payload: { problemId: string }) => {
  const params = new URLSearchParams(payload);
  return request<{ items: Array<{ id: string; question: string; model?: string; createdAt: string }> }>(`/api/practice/list?${params.toString()}`);
};

export const apiCheckPractice = (payload: { questionText: string; userAnswer: string; model?: string; practiceId: string }) => {
  return request<{ feedback: { verdict: 'correct' | 'partial' | 'incorrect'; score: number; summary: string; strengths: string[]; improvements: string[]; next_steps: string[]; correct_answer: string; solution_steps: string } }>(
    '/api/practice/check',
    {
      method: 'POST',
      body: JSON.stringify(payload)
    }
  );
};

export const apiFetchPracticeFeedback = (payload: { problemId?: string; practiceId?: string }) => {
  const params = new URLSearchParams();
  if (payload.problemId) params.set('problemId', payload.problemId);
  if (payload.practiceId) params.set('practiceId', payload.practiceId);
  return request<{ item: { id: string; question: string; user_answer: string; feedback: any; model?: string; created_at: string; checked_at?: string } | null }>(
    `/api/practice/feedback?${params.toString()}`
  );
};

export const apiSubmitAndGradeAnswer = (payload: { userAnswer: string; correctAnswerContext?: string | null; practiceId: string; model?: string }) => {
  return request<{ result: any }>('/api/practice/grade-v2', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
};
