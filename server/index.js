const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const { z } = require('zod');

dotenv.config();

// 带超时的 fetch 封装（默认 60 秒）
const fetchWithTimeout = async (url, options = {}, timeout = 60000) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    return response;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`请求超时 (${timeout / 1000}s)`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
};

const {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY,
  OPENAI_API_KEY,
  OPENROUTER_API_KEY,
  OPENAI_BASE_URL = 'https://openrouter.ai/api/v1',
  OPENAI_MODEL = 'openai/gpt-4o',
  OPENROUTER_REFERER,
  OPENROUTER_TITLE,
  SILICONFLOW_API_KEY,
  SILICONFLOW_BASE_URL = 'https://api.siliconflow.cn/v1',
  DASHSCOPE_API_KEY,
  OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small'
} = process.env;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn('缺少 Supabase 环境变量，请检查 backend/.env');
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));

const supabase = createClient(SUPABASE_URL || '', SUPABASE_ANON_KEY || '', {
  auth: { persistSession: false }
});
const supabaseAdmin = createClient(SUPABASE_URL || '', SUPABASE_SERVICE_ROLE_KEY || '', {
  auth: { persistSession: false }
});

const ANALYSIS_SYSTEM_PROMPT = `
# Role

你是一位世界级的理工科金牌讲师，专门擅长辅导高中基础的学生攻克大学难度的题目。
你的核心能力是“降维打击”：将晦涩的大学知识点（如微积分、线性代数、物理等），通过通俗易懂的语言和高中知识进行类比，讲透其本质，同时在解题过程中保持数学推导的绝对严谨。

# User Input

前一步处理完的一段理工科题目的文本。

# Core Workflow

你必须严格按照以下三个阶段进行思维处理和输出：

## Phase 1: 深度拆解 (Deep Analysis) - 教学模式

1. **关键概念扫盲 (Concept Explanation)**:
    - 提取题目核心术语（如“特征值”、“全微分”）。
    - **降维讲解**：不要堆砌定义。必须使用“高中知识类比”或“直觉解释”来说明它是什么、有什么用。
2. **逻辑战略地图 (Logic Strategy)**:
    - **动笔前的思考**：像教人走迷宫一样，先画出路线图。
    - 解释思路：第一步做什么，第二步做什么，为什么要选这条路（而不是别的路）。
3. **核心步骤详解 (Step-by-Step Solution)**:
    - **保姆级推导**：步骤必须严谨、连贯。
    - 严禁跳步：假设用户看不懂省略的中间运算，把每一个变形的理由都写清楚。

## Phase 2: 格式化输出 (Formatting)

1. **LaTeX 强制规则**:
    - 所有数学符号、变量、公式必须使用 LaTeX。
    - 行内公式：使用 \`$ ... $\` 包裹（如 $f(x) = x^2$）。
    - 独立公式：使用 \`$$...$$\` 包裹。
    - 禁止出现纯文本数学符号（如 x^2, a/b）。
2. **JSON 输出规则**:
    - 结果必须且只能是一个合法的 JSON 对象。
    - 不要使用 Markdown 的代码块标记（即不要输出 \`json 或\` ）。
    - 确保 JSON 格式能够被程序直接解析。

# Output JSON Structure

请严格填充以下 JSON 模板返回结果：

{
"title_essence": "利用[方法]解决[问题]",
"tags": {
"subject": "学科",
"category": "章节/大范畴",
"concept": "具体考点"
},
"analysis": {
"concept_explanation": "Markdown 文本。解释核心概念，使用高中类比，公式用 $...$ 包裹。",
"logic_strategy": "Markdown 文本。解题前的思路规划，公式用 $...$ 包裹。",
"full_solution": "Markdown 文本。完整的保姆级推导过程，独立公式用 $$...$$ 包裹，行内公式用 $...$ 包裹。"
}
}
`;

const AnalysisResultSchema = z.object({
  title_essence: z.string(),
  tags: z.object({
    subject: z.string(),
    category: z.string(),
    concept: z.string()
  }),
  analysis: z.object({
    concept_explanation: z.string(),
    logic_strategy: z.string(),
    full_solution: z.string()
  })
});

const PracticeFeedbackSchema = z.object({
  verdict: z.enum(['correct', 'partial', 'incorrect']),
  score: z.number().min(0).max(100),
  summary: z.string(),
  strengths: z.array(z.string()),
  improvements: z.array(z.string()),
  next_steps: z.array(z.string()),
  correct_answer: z.string(),
  solution_steps: z.string()
});

const PracticeGenerateSchema = z.object({
  new_question_text: z.string(),
  question_type: z.string(),
  options: z.array(z.string()).optional(),
  thinking_process: z.string(),
  correct_answer: z.string(),
  explanation: z.string()
});

const PracticeGradeSchema = z.object({
  internal_calculation_check: z.string(),
  is_correct: z.boolean(),
  feedback: z.string(),
  standard_solution: z.object({
    steps: z.array(z.object({
      seq: z.number(),
      content: z.string()
    })),
    final_answer_latex: z.string()
  })
});

const getProviderConfig = (model) => {
  const normalized = model || OPENAI_MODEL;
  if (normalized.startsWith('deepseek-ai/') || normalized.startsWith('Qwen/')) {
    return {
      baseUrl: SILICONFLOW_BASE_URL,
      apiKey: SILICONFLOW_API_KEY,
      headers: { 'Content-Type': 'application/json' }
    };
  }
  return {
    baseUrl: OPENAI_BASE_URL,
    apiKey: OPENROUTER_API_KEY || OPENAI_API_KEY,
    headers: {
      'Content-Type': 'application/json',
      ...(OPENROUTER_REFERER ? { 'HTTP-Referer': OPENROUTER_REFERER } : {}),
      ...(OPENROUTER_TITLE ? { 'X-Title': OPENROUTER_TITLE } : {})
    }
  };
};

const callChatCompletions = async ({ model, messages, response_format, temperature, timeout = 90000 }) => {
  const provider = getProviderConfig(model);
  if (!provider.apiKey) {
    return { ok: false, error: '缺少模型平台的 API Key' };
  }

  try {
    const aiResponse = await fetchWithTimeout(
      `${provider.baseUrl}/chat/completions`,
      {
        method: 'POST',
        headers: {
          ...provider.headers,
          Authorization: `Bearer ${provider.apiKey}`
        },
        body: JSON.stringify({
          model,
          messages,
          ...(response_format ? { response_format } : {}),
          ...(typeof temperature === 'number' ? { temperature } : {})
        })
      },
      timeout // 默认 90 秒超时
    );

    const aiJson = await aiResponse.json();
    if (!aiResponse.ok) {
      return { ok: false, error: aiJson?.error?.message || '模型请求失败' };
    }
    return { ok: true, data: aiJson };
  } catch (error) {
    return { ok: false, error: error.message || '模型请求失败' };
  }
};

const callEmbeddings = async ({ input, model }) => {
  const apiKey = OPENROUTER_API_KEY || OPENAI_API_KEY;
  if (!apiKey) {
    return { ok: false, error: '缺少 OpenRouter/OpenAI API Key' };
  }

  const aiResponse = await fetch(`${OPENAI_BASE_URL}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      ...(OPENROUTER_REFERER ? { 'HTTP-Referer': OPENROUTER_REFERER } : {}),
      ...(OPENROUTER_TITLE ? { 'X-Title': OPENROUTER_TITLE } : {})
    },
    body: JSON.stringify({
      model: model || OPENAI_EMBEDDING_MODEL,
      input
    })
  });

  const aiJson = await aiResponse.json();
  if (!aiResponse.ok) {
    return { ok: false, error: aiJson?.error?.message || 'Embedding 请求失败' };
  }
  return { ok: true, data: aiJson };
};

const parseJsonFromContent = (content) => {
  if (!content || typeof content !== 'string') return null;
  try {
    return JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
};

const normalizeTagWithAI = async ({ subject, aiProposedTag }) => {
  if (!aiProposedTag || !subject) return aiProposedTag || '';

  const embedResult = await callEmbeddings({ input: aiProposedTag });
  if (!embedResult.ok) return aiProposedTag;
  const embedding = embedResult.data?.data?.[0]?.embedding;
  if (!Array.isArray(embedding)) return aiProposedTag;

  const { data: matches, error } = await supabaseAdmin.rpc('match_tag', {
    query_embedding: embedding,
    match_threshold: 0.8,
    filter_subject: subject
  });

  if (!error && Array.isArray(matches) && matches.length > 0) {
    const best = matches[0];
    if (best?.name) return best.name;
  }

  await supabaseAdmin
    .from('standard_tags')
    .upsert({ subject, name: aiProposedTag, embedding }, { onConflict: 'subject,name' });

  return aiProposedTag;
};

const decodeDataUrl = (dataUrl) => {
  const match = /^data:(.+);base64,(.*)$/.exec(dataUrl || '');
  if (!match) return null;
  return { mime: match[1], buffer: Buffer.from(match[2], 'base64') };
};

const getUserFromRequest = async (req) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) return null;
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
};

const ensureTrashFolder = async (userId) => {
  const { data, error } = await supabaseAdmin
    .from('tree_nodes')
    .select('*')
    .eq('user_id', userId)
    .eq('type', 'folder')
    .eq('title', '回收站')
    .is('parent_id', null)
    .maybeSingle();

  if (!error && data) return data;

  const { data: created, error: createError } = await supabaseAdmin
    .from('tree_nodes')
    .insert({ user_id: userId, title: '回收站', type: 'folder', parent_id: null })
    .select('*')
    .single();

  if (createError) throw createError;
  return created;
};

const buildTree = (nodes) => {
  const nodeMap = new Map();
  const roots = [];

  nodes.forEach((node) => {
    nodeMap.set(node.id, {
      id: node.id,
      title: node.title,
      type: node.type,
      problemId: node.problem_id,
      children: []
    });
  });

  nodes.forEach((node) => {
    const mapped = nodeMap.get(node.id);
    if (node.parent_id && nodeMap.has(node.parent_id)) {
      nodeMap.get(node.parent_id).children.push(mapped);
    } else {
      roots.push(mapped);
    }
  });

  return roots;
};

const getOrCreateFolder = async ({ userId, title, parentId, cache }) => {
  const cleanName = (title || '').trim();
  if (!cleanName) throw new Error('文件夹名称不能为空');
  const cacheKey = `${parentId || 'root'}::${cleanName}`;
  if (cache && cache.has(cacheKey)) return cache.get(cacheKey);

  const baseQuery = supabaseAdmin
    .from('tree_nodes')
    .select('*')
    .eq('user_id', userId)
    .eq('type', 'folder')
    .eq('title', cleanName);

  const { data: existing, error } = parentId
    ? await baseQuery.eq('parent_id', parentId).maybeSingle()
    : await baseQuery.is('parent_id', null).maybeSingle();

  if (!error && existing) {
    if (cache) cache.set(cacheKey, existing);
    return existing;
  }

  const { data: created, error: createError } = await supabaseAdmin
    .from('tree_nodes')
    .insert({
      user_id: userId,
      title: cleanName,
      type: 'folder',
      parent_id: parentId || null,
      sort_order: Date.now()
    })
    .select('*')
    .single();

  if (!createError && created) {
    if (cache) cache.set(cacheKey, created);
    return created;
  }

  const { data: retry } = parentId
    ? await baseQuery.eq('parent_id', parentId).maybeSingle()
    : await baseQuery.is('parent_id', null).maybeSingle();

  if (retry) {
    if (cache) cache.set(cacheKey, retry);
    return retry;
  }

  throw createError || new Error('创建文件夹失败');
};

const classifyQuestions = async ({ items, subject, existingCategories, model }) => {
  const usedModel = model || OPENAI_MODEL;

  const prompt = [
    '你是题库分类助手。请按要求返回 JSON。',
    '对每道题生成：',
    '1) 一句话总结 summary（<=25字，自由描述，避免固定句式，尽量自然简洁）',
    '2) mid（中类）',
    '3) small（细化知识点）',
    '4) difficulty（难度，只能是 easy / medium / hard）',
    'mid 与 small 必须使用中文，不要英文/拼音。',
    `big 固定为 "${subject}"。`,
    existingCategories.length
      ? `已有中类列表：${existingCategories.join(', ')}。请优先选用；没有合适再新建。`
      : '暂无已有中类，可自行给出合理中类。',
    '严格输出 JSON：{"items":[{"summary":"...","mid":"...","small":"...","difficulty":"easy|medium|hard"}]}。',
    '以下是题目列表：'
  ].join('\n');

  const questionList = items.map((item, index) => `${index + 1}. ${item.content || ''}`).join('\n');

  const aiResult = await callChatCompletions({
    model: usedModel,
    messages: [
      { role: 'system', content: '你只输出 JSON。' },
      { role: 'user', content: `${prompt}\n${questionList}` }
    ],
    response_format: { type: 'json_object' },
    temperature: 0.2
  });

  if (!aiResult.ok) {
    throw new Error(aiResult.error || '分类模型请求失败');
  }

  const content = aiResult.data?.choices?.[0]?.message?.content || '';
  const parsedJson = parseJsonFromContent(content);
  if (!parsedJson) {
    throw new Error(`分类模型返回格式不符合预期（${usedModel}）`);
  }
  const parsed = parsedJson;
  const results = Array.isArray(parsed?.items) ? parsed.items : [];
  return results.map((item) => {
    const diff = String(item?.difficulty || '').toLowerCase();
    const normalizedDifficulty = diff === 'easy' || diff === 'hard' ? diff : 'medium';
    return {
      summary: item?.summary || '',
      mid: item?.mid || '',
      small: item?.small || '',
      difficulty: normalizedDifficulty
    };
  });
};

const mapProblem = (row) => ({
  id: row.id,
  title: row.title,
  subject: row.subject,
  difficulty: row.difficulty,
  timeAgo: row.time_ago || '',
  createdAt: row.created_at || '',
  analysisResult: row.analysis_result || null,
  tags: Array.isArray(row.tags) ? row.tags : [],
  description: row.description || ''
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ message: '缺少邮箱或密码' });
  }
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    return res.status(401).json({ message: error?.message || '登录失败' });
  }
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', data.user.id)
    .single();

  res.json({ token: data.session.access_token, profile });
});

app.post('/api/auth/register', async (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) {
    return res.status(400).json({ message: '缺少注册信息' });
  }

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { name }
    }
  });

  if (error) {
    return res.status(400).json({ message: error.message });
  }

  const userId = data.user?.id;
  if (userId) {
    await supabaseAdmin
      .from('profiles')
      .upsert({ id: userId, name, email })
      .select();
  }

  let token = data.session?.access_token || '';
  if (!token) {
    const login = await supabase.auth.signInWithPassword({ email, password });
    token = login.data.session?.access_token || '';
  }

  const { data: profile } = userId
    ? await supabaseAdmin.from('profiles').select('*').eq('id', userId).single()
    : { data: null };

  res.json({ token, profile });
});

app.post('/api/auth/change-password', async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ message: '未登录' });

  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ message: '缺少当前密码或新密码' });
  }

  const email = user.email;
  if (!email) return res.status(400).json({ message: '用户邮箱缺失' });

  const { error: verifyError } = await supabase.auth.signInWithPassword({
    email,
    password: currentPassword
  });

  if (verifyError) {
    return res.status(401).json({ message: '当前密码不正确' });
  }

  const { error: updateError } = await supabaseAdmin.auth.updateUserById(user.id, {
    password: newPassword
  });

  if (updateError) {
    return res.status(400).json({ message: updateError.message });
  }

  res.json({ ok: true });
});

app.get('/api/bootstrap', async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ message: '未登录' });

  try {
    await ensureTrashFolder(user.id);
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    const { data: problems } = await supabaseAdmin
      .from('problems')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    const { data: treeNodes } = await supabaseAdmin
      .from('tree_nodes')
      .select('*')
      .eq('user_id', user.id)
      .order('sort_order', { ascending: true });

    const { data: favorites } = await supabaseAdmin
      .from('favorites')
      .select('problem_id')
      .eq('user_id', user.id);

    res.json({
      profile,
      problems: (problems || []).map(mapProblem),
      tree: buildTree(treeNodes || []),
      favorites: (favorites || []).map((fav) => fav.problem_id)
    });
  } catch (error) {
    res.status(500).json({ message: '加载失败' });
  }
});

app.post('/api/profile', async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ message: '未登录' });

  const update = req.body || {};
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .update(update)
    .eq('id', user.id)
    .select('*')
    .single();

  if (error) {
    return res.status(400).json({ message: error.message });
  }
  res.json({ profile: data });
});

app.post('/api/favorites/toggle', async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ message: '未登录' });

  const { problemId } = req.body || {};
  if (!problemId) return res.status(400).json({ message: '缺少题目 ID' });

  const { data: existing } = await supabaseAdmin
    .from('favorites')
    .select('*')
    .eq('user_id', user.id)
    .eq('problem_id', problemId)
    .maybeSingle();

  if (existing) {
    await supabaseAdmin
      .from('favorites')
      .delete()
      .eq('user_id', user.id)
      .eq('problem_id', problemId);
  } else {
    await supabaseAdmin
      .from('favorites')
      .insert({ user_id: user.id, problem_id: problemId });
  }

  const { data: favorites } = await supabaseAdmin
    .from('favorites')
    .select('problem_id')
    .eq('user_id', user.id);

  res.json({ favorites: (favorites || []).map((fav) => fav.problem_id) });
});

app.post('/api/folders', async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ message: '未登录' });

  const { title, parentId } = req.body || {};
  if (!title) return res.status(400).json({ message: '缺少文件夹名称' });

  const { data, error } = await supabaseAdmin
    .from('tree_nodes')
    .insert({ user_id: user.id, title, type: 'folder', parent_id: parentId || null })
    .select('*')
    .single();

  if (error) return res.status(400).json({ message: error.message });
  res.json({ node: {
    id: data.id,
    title: data.title,
    type: data.type,
    children: []
  }});
});

app.delete('/api/nodes/:id', async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ message: '未登录' });

  const trash = await ensureTrashFolder(user.id);
  const nodeId = req.params.id;
  
  // 先查询节点
  const { data: existingNode } = await supabaseAdmin
    .from('tree_nodes')
    .select('*')
    .eq('id', nodeId)
    .eq('user_id', user.id)
    .maybeSingle();
  
  if (!existingNode) {
    return res.status(400).json({ message: '节点不存在' });
  }
  
  // 为避免唯一约束冲突，给节点名称添加时间戳后缀
  const timestamp = Date.now();
  const newTitle = `${existingNode.title}_deleted_${timestamp}`;
  
  const { error } = await supabaseAdmin
    .from('tree_nodes')
    .update({ 
      parent_id: trash.id,
      title: newTitle
    })
    .eq('id', nodeId)
    .eq('user_id', user.id);

  if (error) return res.status(400).json({ message: error.message });
  res.json({ ok: true });
});

app.post('/api/nodes/batch-delete', async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ message: '未登录' });

  const { nodeIds } = req.body || {};
  if (!Array.isArray(nodeIds) || nodeIds.length === 0) {
    return res.status(400).json({ message: '缺少节点' });
  }
  
  const trash = await ensureTrashFolder(user.id);
  const timestamp = Date.now();
  let successCount = 0;
  let errorMessages = [];
  
  for (let i = 0; i < nodeIds.length; i++) {
    const nodeId = nodeIds[i];
    
    const { data: existingNode } = await supabaseAdmin
      .from('tree_nodes')
      .select('*')
      .eq('id', nodeId)
      .eq('user_id', user.id)
      .maybeSingle();
    
    if (!existingNode) continue;
    
    // 重命名以避免唯一约束冲突
    const newTitle = `${existingNode.title}_deleted_${timestamp}_${i}`;
    
    const { error } = await supabaseAdmin
      .from('tree_nodes')
      .update({ 
        parent_id: trash.id,
        title: newTitle
      })
      .eq('id', nodeId)
      .eq('user_id', user.id);
    
    if (error) {
      errorMessages.push(error.message);
    } else {
      successCount++;
    }
  }
  
  if (errorMessages.length > 0 && successCount === 0) {
    return res.status(400).json({ message: errorMessages[0] });
  }
  
  res.json({ ok: true });
});

app.post('/api/nodes/restore', async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ message: '未登录' });

  const { nodeId } = req.body || {};
  if (!nodeId) return res.status(400).json({ message: '缺少节点' });

  // 查询节点当前信息
  const { data: existingNode } = await supabaseAdmin
    .from('tree_nodes')
    .select('*')
    .eq('id', nodeId)
    .eq('user_id', user.id)
    .maybeSingle();
  
  if (!existingNode) {
    return res.status(400).json({ message: '节点不存在' });
  }
  
  // 尝试恢复原名（去掉 _deleted_xxx 后缀）
  let restoredTitle = existingNode.title;
  const deletedSuffixMatch = restoredTitle.match(/^(.+)_deleted_\d+(_\d+)?$/);
  if (deletedSuffixMatch) {
    restoredTitle = deletedSuffixMatch[1];
  }
  
  // 检查根目录是否已有同名节点
  const { data: conflictNode } = await supabaseAdmin
    .from('tree_nodes')
    .select('id')
    .eq('user_id', user.id)
    .eq('title', restoredTitle)
    .is('parent_id', null)
    .neq('id', nodeId)
    .maybeSingle();
  
  // 如果有冲突，添加时间戳后缀
  if (conflictNode) {
    restoredTitle = `${restoredTitle}_restored_${Date.now()}`;
  }
  
  const { error } = await supabaseAdmin
    .from('tree_nodes')
    .update({ 
      parent_id: null,
      title: restoredTitle
    })
    .eq('id', nodeId)
    .eq('user_id', user.id);

  if (error) return res.status(400).json({ message: error.message });
  res.json({ ok: true });
});

app.post('/api/nodes/hard-delete', async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ message: '未登录' });

  const { nodeId } = req.body || {};
  if (!nodeId) return res.status(400).json({ message: '缺少节点' });

  const { data: node } = await supabaseAdmin
    .from('tree_nodes')
    .select('type, problem_id')
    .eq('id', nodeId)
    .eq('user_id', user.id)
    .maybeSingle();

  await supabaseAdmin
    .from('tree_nodes')
    .delete()
    .eq('id', nodeId)
    .eq('user_id', user.id);

  if (node?.problem_id) {
    await supabaseAdmin
      .from('favorites')
      .delete()
      .eq('user_id', user.id)
      .eq('problem_id', node.problem_id);
  }
  if (node?.type === 'file' && node?.problem_id) {
    await supabaseAdmin
      .from('problems')
      .delete()
      .eq('user_id', user.id)
      .eq('id', node.problem_id);
  }

  res.json({ ok: true });
});

app.post('/api/nodes/move-problem', async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ message: '未登录' });

  const { problemId, targetFolderId } = req.body || {};
  if (!problemId) return res.status(400).json({ message: '缺少题目 ID' });

  if (targetFolderId) {
    const { data: folder } = await supabaseAdmin
      .from('tree_nodes')
      .select('id')
      .eq('id', targetFolderId)
      .eq('user_id', user.id)
      .eq('type', 'folder')
      .maybeSingle();
    if (!folder) return res.status(400).json({ message: '目标文件夹不存在' });
  }

  const { error } = await supabaseAdmin
    .from('tree_nodes')
    .update({ parent_id: targetFolderId || null })
    .eq('user_id', user.id)
    .eq('problem_id', problemId);

  if (error) return res.status(400).json({ message: error.message });
  res.json({ ok: true });
});

app.post('/api/nodes/move-node', async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ message: '未登录' });

  const { nodeId, targetFolderId } = req.body || {};
  if (!nodeId) return res.status(400).json({ message: '缺少节点 ID' });
  if (targetFolderId && targetFolderId === nodeId) {
    return res.status(400).json({ message: '不能移动到自身' });
  }

  if (targetFolderId) {
    const { data: folder } = await supabaseAdmin
      .from('tree_nodes')
      .select('id')
      .eq('id', targetFolderId)
      .eq('user_id', user.id)
      .eq('type', 'folder')
      .maybeSingle();
    if (!folder) return res.status(400).json({ message: '目标文件夹不存在' });
  }

  const { error } = await supabaseAdmin
    .from('tree_nodes')
    .update({ parent_id: targetFolderId || null })
    .eq('user_id', user.id)
    .eq('id', nodeId);

  if (error) return res.status(400).json({ message: error.message });
  res.json({ ok: true });
});

app.post('/api/nodes/reorder', async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ message: '未登录' });

  const { orderedIds } = req.body || {};
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
    return res.status(400).json({ message: '缺少排序列表' });
  }

  const { data: nodes } = await supabaseAdmin
    .from('tree_nodes')
    .select('id')
    .eq('user_id', user.id)
    .in('id', orderedIds);

  if (!nodes || nodes.length !== orderedIds.length) {
    return res.status(400).json({ message: '包含无效节点' });
  }

  const base = Date.now();
  const updates = orderedIds.map((id, idx) => (
    supabaseAdmin
      .from('tree_nodes')
      .update({ sort_order: base + idx })
      .eq('user_id', user.id)
      .eq('id', id)
  ));

  const results = await Promise.all(updates);
  const failed = results.find((r) => r.error);
  if (failed?.error) return res.status(400).json({ message: failed.error.message });

  res.json({ ok: true });
});

app.delete('/api/problems/:id', async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ message: '未登录' });

  await supabaseAdmin
    .from('tree_nodes')
    .delete()
    .eq('user_id', user.id)
    .eq('problem_id', req.params.id);

  await supabaseAdmin
    .from('favorites')
    .delete()
    .eq('user_id', user.id)
    .eq('problem_id', req.params.id);

  await supabaseAdmin
    .from('problems')
    .delete()
    .eq('id', req.params.id)
    .eq('user_id', user.id);

  res.json({ ok: true });
});

app.post('/api/problems/batch-delete', async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ message: '未登录' });

  const { problemIds } = req.body || {};
  if (!Array.isArray(problemIds) || problemIds.length === 0) {
    return res.status(400).json({ message: '缺少题目' });
  }

  await supabaseAdmin
    .from('favorites')
    .delete()
    .in('problem_id', problemIds)
    .eq('user_id', user.id);

  await supabaseAdmin
    .from('tree_nodes')
    .delete()
    .in('problem_id', problemIds)
    .eq('user_id', user.id);

  await supabaseAdmin
    .from('problems')
    .delete()
    .in('id', problemIds)
    .eq('user_id', user.id);

  res.json({ ok: true });
});

app.get('/api/questions', async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ message: '未登录' });

  const { data, error } = await supabaseAdmin
    .from('questions')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error && error.code === '42P01') {
    return res.json({ questions: [] });
  }
  if (error) return res.status(400).json({ message: error.message });
  res.json({ questions: data || [] });
});

app.post('/api/questions/batch', async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ message: '未登录' });

  const { imageUrl, items, parentFolderId, subject, tags, forceParentOnly, classifyModel } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: '题目不能为空' });
  }

  const subjectText = subject || '未分类';
  const normalizedTags = Array.isArray(tags)
    ? tags
    : tags && typeof tags === 'object'
      ? [tags.big, tags.mid, tags.small].filter(Boolean)
      : [];

  const { data: problemsForTags } = await supabaseAdmin
    .from('problems')
    .select('tags')
    .eq('user_id', user.id)
    .eq('subject', subjectText);

  const existingCategories = Array.from(new Set((problemsForTags || [])
    .map((row) => {
      if (Array.isArray(row.tags)) return row.tags[1];
      if (row.tags && typeof row.tags === 'object') return row.tags.mid;
      return null;
    })
    .filter(Boolean)));

  let aiResults = [];
  if (!forceParentOnly) {
    try {
      aiResults = await classifyQuestions({ items, subject: subjectText, existingCategories, model: classifyModel });
    } catch (error) {
      aiResults = [];
    }
  }

  const sanitizeTitle = (value) => {
    const trimmed = String(value || '').trim();
    return trimmed.replace(/[。．.!！?？、]+$/g, '').trim();
  };
  const sanitizeFolderTag = (value) => {
    const trimmed = String(value || '').trim();
    if (!trimmed) return '';
    const withoutEnglish = trimmed.replace(/[A-Za-z]/g, '');
    return withoutEnglish.replace(/\s+/g, ' ').trim();
  };

  const normalizedAiResults = await Promise.all(
    (aiResults || []).map(async (item) => {
      const mid = sanitizeFolderTag(
        await normalizeTagWithAI({ subject: subjectText, aiProposedTag: item?.mid || '' })
      );
      const small = sanitizeFolderTag(
        await normalizeTagWithAI({ subject: subjectText, aiProposedTag: item?.small || '' })
      );
      return { ...item, mid, small };
    })
  );

  const problemRows = items.map((item, idx) => ({
    user_id: user.id,
    title: sanitizeTitle(
      item.title
        || normalizedAiResults[idx]?.summary?.trim()
        || (item.content || '').slice(0, 25)
        || '新导入题目'
    ),
    subject: subjectText,
    difficulty: item.difficulty || normalizedAiResults[idx]?.difficulty || 'medium',
    time_ago: '刚刚',
    tags: item.tags
      ? item.tags
      : normalizedTags.length
        ? normalizedTags
        : forceParentOnly
          ? [subjectText].filter(Boolean)
          : [
              subjectText,
              sanitizeFolderTag(normalizedAiResults[idx]?.mid),
              sanitizeFolderTag(normalizedAiResults[idx]?.small)
            ].filter(Boolean),
    description: item.content || ''
  }));

  const { data: inserted, error } = await supabaseAdmin
    .from('problems')
    .insert(problemRows)
    .select('*');

  if (error) return res.status(400).json({ message: error.message });

  const folderCache = new Map();
  const fileNodes = [];
  for (let idx = 0; idx < (inserted || []).length; idx += 1) {
    const row = inserted[idx];
    const rowTags = Array.isArray(row.tags) ? row.tags : [];
    const mid = rowTags[1];
    const small = rowTags[2];

    let targetParentId = parentFolderId || null;
    if (!forceParentOnly) {
      if (mid) {
        const midFolder = await getOrCreateFolder({
          userId: user.id,
          title: mid,
          parentId: targetParentId,
          cache: folderCache
        });
        targetParentId = midFolder.id;
      }
      if (small) {
        const smallFolder = await getOrCreateFolder({
          userId: user.id,
          title: small,
          parentId: targetParentId,
          cache: folderCache
        });
        targetParentId = smallFolder.id;
      }
    }

    fileNodes.push({
      user_id: user.id,
      title: row.title,
      type: 'file',
      parent_id: targetParentId,
      problem_id: row.id,
      sort_order: Date.now() + idx
    });
  }

  await supabaseAdmin.from('tree_nodes').insert(fileNodes);

  res.json({ ok: true, problems: (inserted || []).map(mapProblem) });
});

app.post('/api/import/analyze', async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ message: '未登录' });

  const { dataUrl } = req.body || {};
  const decoded = decodeDataUrl(dataUrl);
  if (!decoded) return res.status(400).json({ message: '图片解析失败' });

  const extension = decoded.mime.split('/')[1] || 'png';
  const objectPath = `${user.id}/${Date.now()}.${extension}`;

  const upload = await supabaseAdmin
    .storage
    .from('question_images')
    .upload(objectPath, decoded.buffer, { contentType: decoded.mime });

  if (upload.error) {
    return res.status(400).json({ message: upload.error.message });
  }

  const { data: publicUrlData } = supabaseAdmin
    .storage
    .from('question_images')
    .getPublicUrl(objectPath);

  const imageUrl = publicUrlData.publicUrl;

  if (!DASHSCOPE_API_KEY) {
    return res.status(400).json({ message: '缺少 DASHSCOPE_API_KEY' });
  }

  const prompt = [
    '你是高精度数学OCR与重述引擎。',
    '任务：理解图像中的题目，先识别原始文本，再将每道题“完整复述”为可直接渲染的规范文本。',
    '必须返回严格 JSON，格式如下：',
    '{"items":[{"raw_text":"原始题干文本","latex_text":"可渲染文本","options":["A...","B..."]}],"handwritten":false,"reason":""}',
    '规则：',
    '1) raw_text 保持识别到的原始文本，不做格式修饰。',
    '2) latex_text 是“复述后”的题目文本，要求语义一致但表达更清晰、可渲染：行内 $...$，块级 $$...$$。',
    '3) 任何 \\begin{...}...\\end{...} 必须整体包在 $$...$$ 中。',
    '4) 若题目是选择题，options 必须给出；同时 latex_text 中要包含所有选项（每行一个）。',
    '5) 禁止多余的 $，不得输出 $$$ 或 $$ $ 之类错误组合。',
    '6) 只输出 JSON，不要添加解释、不要代码块。',
    'items 数组中每个元素对应一道题，禁止合并成一条。',
    '输出必须以 { 开头，以 } 结束；不得包含多余字符。'
  ].join('\n');

  let aiResponse;
  try {
    aiResponse = await fetchWithTimeout(
      'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${DASHSCOPE_API_KEY}`
        },
        body: JSON.stringify({
          model: 'qwen-vl-max',
          input: {
            messages: [
              { role: 'system', content: [{ text: '你只输出 JSON。' }] },
              { role: 'user', content: [{ image: imageUrl }, { text: prompt }] }
            ]
          },
          parameters: {
            temperature: 0.0
          }
        })
      },
      90000 // 90 秒超时（OCR 可能较慢）
    );
  } catch (error) {
    return res.status(400).json({ message: error.message || 'OCR 识别超时，请稍后重试' });
  }

  const aiJson = await aiResponse.json();
  if (!aiResponse.ok) {
    const message = aiJson?.message || aiJson?.error?.message || '识别失败，请稍后再试';
    return res.status(400).json({ message });
  }
  const dashContent = aiJson?.output?.choices?.[0]?.message?.content;
  const content = Array.isArray(dashContent)
    ? dashContent.map((part) => part.text || '').join('')
    : (typeof dashContent === 'string' ? dashContent : '');
  if (!content) {
    return res.status(400).json({
      message: '识别结果为空，可能是图片不清晰或模型不支持该图片格式'
    });
  }
  let candidates = [];
  let parsedJson = null;
  try {
    parsedJson = parseJsonFromContent(content);
    let rawCandidates = [];
    if (!parsedJson) {
      rawCandidates = [{ content }];
    } else {
      const parsed = parsedJson;
      if (Array.isArray(parsed)) {
        rawCandidates = parsed;
      } else if (parsed && typeof parsed === 'object') {
        // 已移除手写检测拦截，允许包含手写内容的图片继续识别
        // if (parsed.handwritten === true) {
        //   return res.status(400).json({ message: parsed.reason || '检测到手写题目，已跳过识别' });
        // }
        if (Array.isArray(parsed.items)) rawCandidates = parsed.items;
        else if (Array.isArray(parsed.questions)) rawCandidates = parsed.questions;
        else if (Array.isArray(parsed.data)) rawCandidates = parsed.data;
        else if (typeof parsed.content === 'string') rawCandidates = [{ content: parsed.content }];
        else if (typeof parsed.text === 'string') rawCandidates = [{ content: parsed.text }];
      } else if (typeof parsed === 'string') {
        rawCandidates = [{ content: parsed }];
      }
    }

    candidates = rawCandidates
      .map((item) => {
        if (typeof item === 'string') return { content: item };
        if (item && typeof item === 'object') {
          const baseContent = item.latex_text || item.content || item.question || item.raw_text || item.text || item.value || item.title || '';
          const optionList = Array.isArray(item.options)
            ? item.options
            : Array.isArray(item.choices)
              ? item.choices
              : [];
          const optionsText = optionList
            .map((opt, index) => {
              if (typeof opt === 'string') return opt;
              if (opt && typeof opt === 'object') {
                return opt.text || opt.content || opt.label || opt.value || `选项${index + 1}`;
              }
              return '';
            })
            .filter((opt) => opt && String(opt).trim());
          const mergedContent = optionsText.length
            ? [baseContent, ...optionsText].filter(Boolean).join('\n')
            : baseContent;
          return { content: mergedContent };
        }
        return { content: '' };
      })
      .filter((item) => item.content && item.content.trim());

    if (candidates.length === 1) {
      const text = candidates[0].content;
      const parts = text
        .split(/\n(?=(?:\d+[\.\、\)]|（\d+）|[一二三四五六七八九十]+[、\)]))/)
        .map((part) => part.trim())
        .filter(Boolean);
      if (parts.length > 1) {
        candidates = parts.map((content) => ({ content }));
      }
    }
  } catch (error) {
    candidates = [{ content }];
  }

  if (!parsedJson) {
    const strictPrompt = [
      '只允许输出严格 JSON，不要任何解释，不要代码块。',
      '必须输出：{"items":[{"raw_text":"...","latex_text":"...","options":["A...","B..."]}]}。',
      '如果检测到手写题目，请输出：{"items":[],"handwritten":true,"reason":"手写题目暂不支持"}。',
      '输出必须以 { 开头，以 } 结束。',
      '如果无法识别选项，options 返回空数组。',
    ].join('\n');
    let retry;
    try {
      retry = await fetchWithTimeout(
        'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${DASHSCOPE_API_KEY}`
          },
          body: JSON.stringify({
            model: 'qwen-vl-max',
            input: {
              messages: [
                { role: 'system', content: [{ text: '你只输出 JSON。' }] },
                { role: 'user', content: [{ image: imageUrl }, { text: strictPrompt }] }
              ]
            },
            parameters: { temperature: 0.0 }
          })
        },
        90000 // 90 秒超时
      );
    } catch {
      // 重试超时，使用已有的 candidates
      retry = null;
    }
    const retryJson = retry ? await retry.json() : {};
    const retryContent = Array.isArray(retryJson?.output?.choices?.[0]?.message?.content)
      ? retryJson.output.choices[0].message.content.map((part) => part.text || '').join('')
      : (typeof retryJson?.output?.choices?.[0]?.message?.content === 'string'
        ? retryJson.output.choices[0].message.content
        : '');
    const retryParsed = parseJsonFromContent(retryContent || '');
    if (retryParsed && !Array.isArray(retryParsed)) {
      // 已移除手写检测拦截，允许包含手写内容的图片继续识别
      // if (retryParsed.handwritten === true) {
      //   return res.status(400).json({ message: retryParsed.reason || '检测到手写题目，已跳过识别' });
      // }
      const items = Array.isArray(retryParsed.items) ? retryParsed.items : [];
      if (items.length > 0) {
        candidates = items.map((item) => {
          const baseContent = item.latex_text || item.raw_text || item.content || '';
          const optionList = Array.isArray(item.options) ? item.options : [];
          const merged = optionList.length ? [baseContent, ...optionList].filter(Boolean).join('\n') : baseContent;
          return { content: merged };
        }).filter((item) => item.content && item.content.trim());
      }
    }
  }

  const sanitizeMathDelimiters = (value) => {
    let next = value || '';
    next = next.replace(/\${3,}/g, '$$');
    next = next.replace(/\$\s*\$/g, '$$');
    next = next.replace(/\$\s*\$\$/g, '$$');
    next = next.replace(/\$\$\s*\$/g, '$$');
    return next;
  };

  const normalizeOcrText = async (text) => {
    const trimmed = (text || '').trim();
    if (!trimmed) return '';
    const needsNormalization = /\\|$$|\$|\\begin\{|\\left|\\right/.test(trimmed);
    if (!needsNormalization) return trimmed;
    const prompt = [
      '你是“数学OCR清洗器”，必须输出与原题完全一致的可渲染纯文本。',
      '只允许输出清洗后的题干文本；不得包含任何解释或代码块。',
      '硬性规则：',
      '1) 所有数学表达必须有明确定界符：行内用 $...$，块级用 $$...$$。',
      '2) \\begin{...}...\\end{...} 必须整体包在 $$...$$ 中。',
      '3) 禁止出现多余的 $（例如 $$$ 或 $$ $），必须纠正为合法的 $ 或 $$。',
      '4) \\left ... \\right 必须包在同一个 $...$ 中。',
      '5) 中文与公式之间必须加空格。',
      '6) 保留题干与选项，保持原意，不补充不删改。',
      '7) 输出必须是一段纯文本。',
      '输入：',
      trimmed
    ].join('\n');
    const aiResult = await callChatCompletions({
      model: 'openai/gpt-4o-mini',
      messages: [
        { role: 'system', content: '你只输出清洗后的纯文本。' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.0
    });
    if (!aiResult.ok) return trimmed;
    const cleaned = String(aiResult.data?.choices?.[0]?.message?.content || '').trim();
    if (!cleaned || cleaned.length < 3) return trimmed;
    if (cleaned.startsWith('{') || cleaned.startsWith('[') || cleaned.includes('```')) {
      return trimmed;
    }
    const normalized = sanitizeMathDelimiters(cleaned);
    return normalized || trimmed;
  };

  try {
    candidates = await Promise.all(
      candidates.map(async (item) => ({
        ...item,
        content: await normalizeOcrText(item.content)
      }))
    );
  } catch {
    // fallback to original candidates
  }

  if (candidates.length === 0) {
    return res.status(400).json({
      message: '识别完成但未解析出题目，可能是图片模糊/遮挡/非题目区域'
    });
  }

  res.json({ imageUrl, candidates });
});

app.post('/api/analysis', async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ message: '未登录' });

  const { questionText, problemId, model } = req.body || {};
  if (!questionText) {
    return res.status(400).json({ message: '题目文本不能为空' });
  }

  const systemPrompt = ANALYSIS_SYSTEM_PROMPT;
  const usedModel = model || OPENAI_MODEL;
  const aiResult = await callChatCompletions({
    model: usedModel,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: questionText }
    ],
    response_format: { type: 'json_object' },
    temperature: 0.2
  });

  if (!aiResult.ok) {
    return res.status(400).json({ message: aiResult.error });
  }

  const content = aiResult.data?.choices?.[0]?.message?.content || '';

  const parseAnalysisResult = (rawContent) => {
    const parsedJson = parseJsonFromContent(rawContent || '');
    if (!parsedJson) return null;
    try {
      return AnalysisResultSchema.parse(parsedJson);
    } catch {
      return null;
    }
  };

  let parsed = parseAnalysisResult(content);

  if (!parsed) {
    const retryPrompt = [
      ANALYSIS_SYSTEM_PROMPT,
      '',
      '补充要求：',
      '1) 只输出 JSON，不要代码块，不要解释文字。',
      '2) 字段必须完整且与模板一致。',
      '3) 所有字段必须是字符串，不能为空。',
      '4) 如果无法完成，也必须返回完整 JSON，用简短中文填充。'
    ].join('\n');

    const retryResult = await callChatCompletions({
      model: usedModel,
      messages: [
        { role: 'system', content: retryPrompt },
        { role: 'user', content: questionText }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.0
    });

    if (retryResult.ok) {
      const retryContent = retryResult.data?.choices?.[0]?.message?.content || '';
      parsed = parseAnalysisResult(retryContent);
    }
  }

  if (!parsed) {
    return res.status(400).json({ message: `模型返回格式不符合预期（${usedModel}）` });
  }

  if (problemId) {
    const { error: updateError } = await supabaseAdmin
      .from('problems')
      .update({ analysis_result: parsed })
      .eq('id', problemId)
      .eq('user_id', user.id);
    if (updateError) {
      return res.status(400).json({ message: updateError.message });
    }
  }

  res.json({ result: parsed });
});

app.get('/api/chat/history', async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ message: '未登录' });

  const { problemId } = req.query || {};
  if (!problemId) return res.status(400).json({ message: '缺少题目 ID' });

  const { data, error } = await supabaseAdmin
    .from('chat_messages')
    .select('role, content, model, created_at')
    .eq('user_id', user.id)
    .eq('problem_id', problemId)
    .order('created_at', { ascending: true });

  if (error) return res.status(400).json({ message: error.message });
  const messages = (data || []).map((row) => ({
    role: row.role,
    content: row.content,
    model: row.model,
    createdAt: row.created_at
  }));
  res.json({ messages });
});

app.post('/api/chat', async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ message: '未登录' });

  const { message, model, context, history, problemId } = req.body || {};
  if (!message) return res.status(400).json({ message: '消息不能为空' });
  const usedModel = model || 'openai/gpt-4o-mini';
  const safeHistory = Array.isArray(history)
    ? history
        .filter((item) => item && typeof item.content === 'string')
        .map((item) => ({
          role: item.role === 'ai' ? 'assistant' : 'user',
          content: item.content
        }))
        .slice(-8)
    : [];
  const aiResult = await callChatCompletions({
    model: usedModel,
    messages: [
      { role: 'system', content: '你是Flux Matrix的AI助教。Flux Matrix 是一个高端 AI 数学/全科题库与学习系统，主打“知识流动(Flux)”与“矩阵化组织(Matrix)”。当用户询问“Flux Matrix 是什么”或品牌相关问题时，直接用产品口吻简洁说明其定位、核心能力与使用价值，不要否认或回避。请优先回答用户的具体问题，不要默认完整解题；只有用户明确要求时再给出完整解法。必要时引用题干作为上下文。回答要简洁清晰。数学表达请使用 LaTeX，并用 $...$ 或 $$...$$ 包裹。若问题不清晰，请先追问。' },
      ...(context ? [{ role: 'system', content: `题目背景（仅供参考，不要重复完整题干）：${context}` }] : []),
      ...safeHistory,
      { role: 'user', content: message }
    ],
    temperature: 0.7
  });

  if (!aiResult.ok) {
    return res.status(400).json({ message: aiResult.error });
  }
  const reply = aiResult.data?.choices?.[0]?.message || { role: 'assistant', content: '' };

  if (problemId) {
    await supabaseAdmin
      .from('chat_messages')
      .insert([
        {
          user_id: user.id,
          problem_id: problemId,
          role: 'user',
          content: message
        },
        {
          user_id: user.id,
          problem_id: problemId,
          role: 'ai',
          content: reply.content || '',
          model: usedModel
        }
      ]);
  }

  res.json({ reply });
});

app.post('/api/practice/generate', async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ message: '未登录' });

  const { problemText, subject, model, problemId } = req.body || {};
  if (!problemText) return res.status(400).json({ message: '题目文本不能为空' });
  if (!problemId) return res.status(400).json({ message: '缺少题目 ID' });

  if (!OPENAI_API_KEY) {
    return res.status(400).json({ message: '缺少 OPENAI_API_KEY' });
  }

  const prompt = [
    '请基于给定题目生成一道同类型、同难度的练习题。',
    subject ? `学科为：${subject}。` : '学科未知，请合理判断。',
    '保持题型结构一致，但数值或条件不同。',
    '只返回题目本身，不要给答案或解析。',
    '数学表达必须使用 LaTeX，行内用 $...$，独立公式用 $$...$$。',
    '严格输出 JSON：{"question":"..."}。'
  ].join('\n');

  const aiResponse = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      ...(OPENROUTER_REFERER ? { 'HTTP-Referer': OPENROUTER_REFERER } : {}),
      ...(OPENROUTER_TITLE ? { 'X-Title': OPENROUTER_TITLE } : {})
    },
    body: JSON.stringify({
      model: model || OPENAI_MODEL,
      messages: [
        { role: 'system', content: '你只输出 JSON。' },
        { role: 'user', content: `${prompt}\n\n原题：\n${problemText}` }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.7
    })
  });

  const aiJson = await aiResponse.json();
  const content = aiJson?.choices?.[0]?.message?.content || '';
  try {
    const parsedJson = parseJsonFromContent(content);
    if (!parsedJson) throw new Error('invalid_json');
    const parsed = parsedJson;
    const question = parsed?.question || '';
    if (!question) return res.status(400).json({ message: '生成题目为空' });

    const { data: saved, error: saveError } = await supabaseAdmin
      .from('practice_items')
      .insert({
        user_id: user.id,
        problem_id: problemId,
        model: model || OPENAI_MODEL,
        question
      })
      .select('id, question, model, created_at')
      .single();

    if (saveError) return res.status(400).json({ message: saveError.message });
    return res.json({ question: saved.question, id: saved.id, model: saved.model, createdAt: saved.created_at });
  } catch (error) {
    return res.status(400).json({ message: '模型返回格式不符合预期（practice/generate）' });
  }
});

app.post('/api/practice/generate-v2', async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ message: '未登录' });

  const { originalText, analysisContext, model, problemId } = req.body || {};
  if (!originalText) return res.status(400).json({ message: '缺少原题文本' });
  if (!problemId) return res.status(400).json({ message: '缺少题目 ID' });
  const usedModel = model || 'openai/gpt-4o';

  const normalizedContext = {
    essence_one_sentence: analysisContext?.essence_one_sentence
      || analysisContext?.title_essence
      || '',
    key_concepts: analysisContext?.learning_mode?.key_concepts
      || analysisContext?.key_concepts
      || [],
    tags: analysisContext?.tags || {}
  };

  const systemPrompt = [
    '你是一位资深的命题专家。',
    '你的任务是基于一道“原题”及其“深度分析”，创作一道新的练习题。',
    '',
    '核心目标：生成一道同构题 (Isomorphic Problem)。',
    '1. 灵魂不变：新题必须考察与原题完全相同的核心知识点（参考 input.analysisContext.essence_one_sentence）。',
    '2. 肉体重塑：不要只替换数字，尽量结构变种；难度保持或略微提升（不超过 10%）。',
    '3. 数值友好：计算结果要干净（整数/简单分数/常见无理数）。',
    '',
    '输出要求 (JSON)：',
    '{',
    '"new_question_text": "新题目的 LaTeX 文本",',
    '"question_type": "选择/填空/解答",',
    '"options": ["A...", "B...", "C...", "D..."] (如果是选择题),',
    '"thinking_process": "详细的解题推导过程（AI自检用，确保答案正确）",',
    '"correct_answer": "最终答案 (LaTeX)",',
    '"explanation": "给用户的解析，重点讲解这道新题是如何运用原题知识点的"',
    '}'
  ].join('\n');

  const aiResult = await callChatCompletions({
    model: usedModel,
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: JSON.stringify({
          originalText,
          analysisContext: normalizedContext
        })
      }
    ],
    response_format: { type: 'json_object' },
    temperature: 0.7
  });

  if (!aiResult.ok) {
    return res.status(400).json({ message: aiResult.error });
  }

  const content = aiResult.data?.choices?.[0]?.message?.content || '';
  try {
    const parsedJson = parseJsonFromContent(content);
    if (!parsedJson) throw new Error('invalid_json');
    const parsed = PracticeGenerateSchema.parse(parsedJson);
    const options = Array.isArray(parsed.options) ? parsed.options : [];
    const optionsText = options.length
      ? options.map((opt, idx) => `${String.fromCharCode(65 + idx)}. ${opt}`).join('\n')
      : '';
    const questionText = optionsText
      ? `${parsed.new_question_text}\n\n${optionsText}`
      : parsed.new_question_text;

    const { data: saved, error: saveError } = await supabaseAdmin
      .from('practice_items')
      .insert({
        user_id: user.id,
        problem_id: problemId,
        model: usedModel,
        question: questionText
      })
      .select('id, question, model, created_at')
      .single();

    if (saveError) return res.status(400).json({ message: saveError.message });
    return res.json({
      question: saved.question,
      id: saved.id,
      model: saved.model,
      createdAt: saved.created_at,
      payload: parsed
    });
  } catch (error) {
    return res.status(400).json({ message: `模型返回格式不符合预期（${usedModel}）` });
  }
});

app.post('/api/practice/grade-v2', async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ message: '未登录' });

  const { userAnswer, correctAnswerContext, practiceId, model } = req.body || {};
  if (!userAnswer) {
    return res.status(400).json({ message: '缺少答案' });
  }
  if (!practiceId) {
    return res.status(400).json({ message: '缺少练习题 ID' });
  }
  const usedModel = model || 'google/gemini-3-flash-preview';

  const { data: practiceItem, error: practiceError } = await supabaseAdmin
    .from('practice_items')
    .select('question')
    .eq('id', practiceId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (practiceError) return res.status(400).json({ message: practiceError.message });
  if (!practiceItem?.question) return res.status(404).json({ message: '练习题不存在' });

  const systemPrompt = [
    '你是一位严谨的数学阅卷专家。',
    '你的任务是：',
    '',
    '1. 独立重做 (Re-solve)：不要盲目信任任何提供的参考答案。请先在内存中一步步推导这道题，确保每一步计算都绝对正确。',
    '2. 语义比对 (Compare)：将你的计算结果与用户的 userAnswer 进行数学含义上的比对。',
    '3. 生成报告 (Report)：输出判定结果和标准解析。',
    '',
    '判题规则：',
    '- 数学等价性：忽略格式差异，只要数学本质相同即判定为正确。',
    '- 思路认可：若过程关键步骤正确，即使最后一步算错也可部分肯定，但 is_correct 仍为 false。',
    '',
    '一致性要求：',
    '- 先给出 final_answer_latex，再根据它判断 is_correct。',
    '- 若 userAnswer 与 final_answer_latex 不等价，is_correct 必须为 false。',
    '',
    '输出要求 (JSON Only)：',
    '{',
    '"internal_calculation_check": "在此处写下你的草稿演算过程，强制你自己检查计算是否出错（此字段不展示给用户，仅用于保证精度）",',
    '"is_correct": boolean,',
    '"feedback": "给用户的简短点评。如果错了，指出具体错在哪一步，语气要鼓励。",',
    '"standard_solution": {',
    '  "steps": [',
    '    { "seq": 1, "content": "第一步的详细推导（Markdown + LaTeX）" }',
    '  ],',
    '  "final_answer_latex": "最终的正确答案（LaTeX格式）"',
    '}',
    '}'
  ].join('\n');

  const aiResult = await callChatCompletions({
    model: usedModel,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: JSON.stringify({ questionText: practiceItem.question, userAnswer, correctAnswerContext }) }
    ],
    response_format: { type: 'json_object' },
    temperature: 0.1
  });

  if (!aiResult.ok) {
    return res.status(400).json({ message: aiResult.error });
  }

  const content = aiResult.data?.choices?.[0]?.message?.content || '';
  try {
    const parsedJson = parseJsonFromContent(content);
    if (!parsedJson) throw new Error('invalid_json');
    const parsed = PracticeGradeSchema.parse(parsedJson);
    const { error: updateError } = await supabaseAdmin
      .from('practice_items')
      .update({
        user_answer: userAnswer,
        feedback: parsed,
        checked_at: new Date().toISOString()
      })
      .eq('id', practiceId)
      .eq('user_id', user.id);
    if (updateError) return res.status(400).json({ message: updateError.message });
    return res.json({ result: parsed });
  } catch (error) {
    return res.status(400).json({ message: `模型返回格式不符合预期（${usedModel}）` });
  }
});

app.get('/api/practice/latest', async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ message: '未登录' });

  const { problemId } = req.query || {};
  if (!problemId) return res.status(400).json({ message: '缺少题目 ID' });

  const { data, error } = await supabaseAdmin
    .from('practice_items')
    .select('id, question, model, created_at')
    .eq('user_id', user.id)
    .eq('problem_id', problemId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return res.status(400).json({ message: error.message });
  return res.json({ item: data || null });
});

app.get('/api/practice/list', async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ message: '未登录' });

  const { problemId } = req.query || {};
  if (!problemId) return res.status(400).json({ message: '缺少题目 ID' });

  const { data, error } = await supabaseAdmin
    .from('practice_items')
    .select('id, question, model, created_at')
    .eq('user_id', user.id)
    .eq('problem_id', problemId)
    .order('created_at', { ascending: false });

  if (error) return res.status(400).json({ message: error.message });
  return res.json({ items: data || [] });
});

app.post('/api/practice/check', async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ message: '未登录' });

  const { userAnswer, model, practiceId } = req.body || {};
  if (!userAnswer) {
    return res.status(400).json({ message: '缺少答案' });
  }
  if (!practiceId) {
    return res.status(400).json({ message: '缺少练习题 ID' });
  }

  if (!OPENAI_API_KEY) {
    return res.status(400).json({ message: '缺少 OPENAI_API_KEY' });
  }

  const { data: practiceItem, error: practiceError } = await supabaseAdmin
    .from('practice_items')
    .select('question')
    .eq('id', practiceId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (practiceError) return res.status(400).json({ message: practiceError.message });
  if (!practiceItem?.question) return res.status(404).json({ message: '练习题不存在' });

  const prompt = [
    '你是严格的题目批改老师，请根据题目与学生答案给出客观反馈。',
    '必须判断答案是否正确，不能随意判对。',
    '如果答案不完整、与题目无关或明显错误，判定 incorrect。',
    '只输出 JSON，格式如下：',
    '{"verdict":"correct|partial|incorrect","score":0-100,"summary":"...","strengths":["..."],"improvements":["..."],"next_steps":["..."],"correct_answer":"...","solution_steps":"..."}',
    'summary 用简洁中文说明整体情况。',
    'strengths/improvements/next_steps 每项尽量具体。',
    '若判定 incorrect，必须给出正确答案或标准解法摘要。',
    'solution_steps 给出题目解题思路或关键步骤（Markdown）。',
    '数学表达使用 LaTeX，行内 $...$，独立 $$...$$。'
  ].join('\n');

  const aiResponse = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      ...(OPENROUTER_REFERER ? { 'HTTP-Referer': OPENROUTER_REFERER } : {}),
      ...(OPENROUTER_TITLE ? { 'X-Title': OPENROUTER_TITLE } : {})
    },
    body: JSON.stringify({
      model: model || OPENAI_MODEL,
      messages: [
        { role: 'system', content: '你只输出 JSON。' },
        { role: 'user', content: `${prompt}\n\n题目：\n${practiceItem.question}\n\n学生答案：\n${userAnswer}` }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2
    })
  });

  const aiJson = await aiResponse.json();
  const content = aiJson?.choices?.[0]?.message?.content || '';
  try {
    const parsedJson = parseJsonFromContent(content);
    if (!parsedJson) throw new Error('invalid_json');
    const parsed = PracticeFeedbackSchema.parse(parsedJson);

    const { error: updateError } = await supabaseAdmin
      .from('practice_items')
      .update({
        user_answer: userAnswer,
        feedback: parsed,
        checked_at: new Date().toISOString()
      })
      .eq('id', practiceId)
      .eq('user_id', user.id);

    if (updateError) return res.status(400).json({ message: updateError.message });
    return res.json({ feedback: parsed });
  } catch (error) {
    return res.status(400).json({ message: '模型返回格式不符合预期（practice/check）' });
  }
});

app.get('/api/practice/feedback', async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ message: '未登录' });

  const { practiceId, problemId } = req.query || {};
  if (!practiceId && !problemId) {
    return res.status(400).json({ message: '缺少题目 ID 或练习题 ID' });
  }

  let query = supabaseAdmin
    .from('practice_items')
    .select('id, question, user_answer, feedback, model, created_at, checked_at')
    .eq('user_id', user.id);

  if (practiceId) {
    query = query.eq('id', practiceId).maybeSingle();
    const { data, error } = await query;
    if (error) return res.status(400).json({ message: error.message });
    return res.json({ item: data || null });
  }

  const { data, error } = await query
    .eq('problem_id', problemId)
    .not('feedback', 'is', null)
    .order('checked_at', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return res.status(400).json({ message: error.message });
  return res.json({ item: data || null });
});

module.exports = app;
