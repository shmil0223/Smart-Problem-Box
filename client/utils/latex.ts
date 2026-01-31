const isCjkChar = (char: string) => /[\u4e00-\u9fff]/.test(char);

const normalizeEscapes = (text: string) => {
  let next = text
    .replaceAll('\\\\[', '\\[')
    .replaceAll('\\\\]', '\\]')
    .replaceAll('\\\\(', '\\(')
    .replaceAll('\\\\)', '\\)');

  while (next.includes('\\\\')) {
    next = next.replaceAll('\\\\', '\\');
  }

  return next;
};

const isBoundaryChar = (char: string) =>
  char === '\n' ||
  char === '。' ||
  char === '；' ||
  char === '，' ||
  char === '、' ||
  char === '.' ||
  char === '?' ||
  char === '!' ||
  char === '；' ||
  char === '：';

const wrapMathRuns = (text: string) => {
  let result = '';
  let i = 0;

  const consumeMath = (start: number) => {
    let end = start;
    while (end < text.length && !isBoundaryChar(text[end])) {
      end += 1;
    }
    const segment = text.slice(start, end).trim();
    return { segment, end };
  };

  while (i < text.length) {
    const current = text[i];

    if (current === '$') {
      const isBlock = text[i + 1] === '$';
      const closeToken = isBlock ? '$$' : '$';
      const start = i;
      i += isBlock ? 2 : 1;
      while (i < text.length) {
        if (text[i] === '$' && (!isBlock || text[i + 1] === '$')) {
          i += isBlock ? 2 : 1;
          break;
        }
        i += 1;
      }
      result += text.slice(start, i);
      continue;
    }

    if (current === '\\' || current === '^' || current === '_') {
      const { segment, end } = consumeMath(i);
      result += `$${segment}$`;
      i = end;
      continue;
    }

    if (
      /[A-Za-z0-9]/.test(current) &&
      (text[i + 1] === '_' || text[i + 1] === '^')
    ) {
      const { segment, end } = consumeMath(i);
      result += `$${segment}$`;
      i = end;
      continue;
    }

    result += current;
    i += 1;
  }

  return result;
};

const normalizeMathDelimiters = (text: string) => {
  let out = '';
  let i = 0;
  let inInline = false;
  let inBlock = false;

  while (i < text.length) {
    const isBlockToken = text[i] === '$' && text[i + 1] === '$';
    if (isBlockToken) {
      if (inInline) {
        // avoid $$ inside inline math
        out += '$';
        i += 2;
        continue;
      }
      inBlock = !inBlock;
      out += '$$';
      i += 2;
      continue;
    }

    if (text[i] === '$') {
      if (inBlock) {
        // ignore single $ inside block math
        i += 1;
        continue;
      }
      inInline = !inInline;
      out += '$';
      i += 1;
      continue;
    }

    out += text[i];
    i += 1;
  }

  return out;
};

const normalizeMathPairs = (text: string) => {
  const blockCount = (text.match(/\$\$/g) || []).length;
  const inlineCount = (text.replace(/\$\$/g, '').match(/\$/g) || []).length;
  let next = text;
  if (blockCount % 2 === 1) {
    next = next.replace(/\$\$(?![\s\S]*\$\$)/, '');
  }
  if (inlineCount % 2 === 1) {
    next = next.replace(/\$(?![\s\S]*\$)/, '');
  }
  return next;
};

// 将 \text{中文} 移到数学块外面，避免 KaTeX 渲染错误
const moveChineseTextOutOfMath = (text: string): string => {
  // 处理 $...\text{中文}...$ 格式
  // 策略：把包含中文的 \text{} 分割出来
  
  return text.replace(/\$([^$]+)\$/g, (match, inner) => {
    // 检查是否包含带中文的 \text{}
    const textWithChinesePattern = /\\text\s*\{([^}]*[\u4e00-\u9fff][^}]*)\}/g;
    
    if (!textWithChinesePattern.test(inner)) {
      return match; // 没有中文，原样返回
    }
    
    // 重置正则
    textWithChinesePattern.lastIndex = 0;
    
    // 分割：把 \text{中文} 提取出来作为普通文本
    let result = '';
    let lastIndex = 0;
    let m;
    
    while ((m = textWithChinesePattern.exec(inner)) !== null) {
      // 添加 \text{} 之前的数学内容
      const beforeText = inner.slice(lastIndex, m.index).trim();
      if (beforeText) {
        result += `$${beforeText}$ `;
      }
      
      // 添加中文文本（不用 $ 包裹）
      const chineseText = m[1].trim();
      result += chineseText + ' ';
      
      lastIndex = m.index + m[0].length;
    }
    
    // 添加剩余的数学内容
    const remaining = inner.slice(lastIndex).trim();
    if (remaining) {
      result += `$${remaining}$`;
    }
    
    return result.trim();
  });
};

export const preprocessLaTeX = (value: string) => {
  if (!value) return '';

  let text = normalizeEscapes(value.replace(/\r\n/g, '\n').trim());

  text = text
    .replace(/(\n)?\s*\(([A-D])\)\s*/g, '\n- ($2) ')
    .replace(/(\n)?\s*([A-D])[\.\、]\s*/g, '\n- $2. ');

  text = text.replace(/\${3,}/g, '$$');
  text = text.replace(/\$\s*\$/g, '$$');

  text = text
    .replaceAll('\\[', '$$')
    .replaceAll('\\]', '$$')
    .replaceAll('\\(', '$')
    .replaceAll('\\)', '$');

  text = text.replace(/\$(\s*\\begin\{[^}]+\}[\s\S]*?\\end\{[^}]+\}\s*)\$/g, (_m, inner) => `$$${inner}$$`);
  text = text.replace(/\\begin\{[^}]+\}[\s\S]*?\\end\{[^}]+\}/g, (match) => `$$${match}$$`);
  text = text.replace(/\\left[\s\S]*?\\right[\)\}\]]/g, (match) => `$${match}$`);

  // 处理 \text{中文} - 移到数学块外面
  text = moveChineseTextOutOfMath(text);

  const mathChunks = text.split(/(\$\$[\s\S]*?\$\$|\$[^$]*\$)/g);
  text = mathChunks
    .map((chunk) => {
      if (chunk.startsWith('$$') || chunk.startsWith('$')) return chunk;
      const withTextWrapped = chunk.replace(/\\text\s*\{[^}]*\}/g, (match) => `$${match}$`);
      return wrapMathRuns(withTextWrapped);
    })
    .join('');

  text = text.replace(/([^\n])\n(?!\n)/g, '$1  \n');

  let spaced = '';
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const prev = text[i - 1];
    const next = text[i + 1];
    if (char === '$') {
      if (prev && isCjkChar(prev)) spaced += ' ';
      spaced += char;
      if (next && isCjkChar(next)) spaced += ' ';
      continue;
    }
    spaced += char;
  }

  return normalizeMathPairs(normalizeMathDelimiters(spaced));
};
