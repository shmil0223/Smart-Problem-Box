import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';

export const thinkingSteps = [
  "Flux-Matrix正在深度思考…",
  "Flux-Matrix正在发挥创造力…",
  "正在唤醒深度推理核心...",
  "提取关键语义信息...",
  "遍历全网亿级知识图谱...",
  "构建逻辑推理思维链...",
  "交叉验证搜索结果...",
  "组织语言逻辑结构...",
  "优化最终输出表达...",
  "Flux-Matrix已经顿悟！",
  "Flux-Matrix思考出来了问题的解法！",
];

const useTypewriter = (steps: string[], typeSpeed = 45, pauseMs = 1400) => {
  const stableSteps = useMemo(() => steps.filter(Boolean), [steps]);
  const [stepIndex, setStepIndex] = useState(0);
  const [text, setText] = useState('');

  useEffect(() => {
    if (stableSteps.length === 0) return;
    const current = stableSteps[stepIndex % stableSteps.length];
    let timer: number | undefined;

    if (text.length < current.length) {
      timer = window.setTimeout(() => {
        setText(current.slice(0, text.length + 1));
      }, typeSpeed);
    } else {
      timer = window.setTimeout(() => {
        setText('');
        setStepIndex((prev) => (prev + 1) % stableSteps.length);
      }, pauseMs);
    }

    return () => {
      if (timer) window.clearTimeout(timer);
    };
  }, [stableSteps, stepIndex, text, typeSpeed, pauseMs]);

  return text;
};

interface AIFullScreenLoaderProps {
  backgroundImageUrl?: string;
  steps?: string[];
}

export const AIFullScreenLoader: React.FC<AIFullScreenLoaderProps> = ({
  backgroundImageUrl,
  steps = thinkingSteps
}) => {
  const typingText = useTypewriter(steps);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center text-[#E0E0E0]">
      <div
        className="absolute inset-0 bg-center bg-cover"
        style={backgroundImageUrl ? { backgroundImage: `url(${backgroundImageUrl})` } : undefined}
      />
      <div className="absolute inset-0 bg-black/60 backdrop-blur-xl" />

      <div className="relative z-10 flex flex-col items-center gap-6 px-6">
        <motion.div
          className="h-28 w-28 rounded-full border-[0.5px] border-cyan-400/60 shadow-[0_0_24px_rgba(34,211,238,0.25)]"
          animate={{ scale: [0.9, 1.1, 0.9], opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
        />

        <div className="text-center font-mono text-sm tracking-wide text-[#E0E0E0]/90">
          {typingText || '\u00A0'}
        </div>
      </div>
    </div>
  );
};

interface AIInlineLoaderProps {
  steps?: string[];
  className?: string;
}

export const AIInlineLoader: React.FC<AIInlineLoaderProps> = ({
  steps = thinkingSteps,
  className
}) => {
  const typingText = useTypewriter(steps, 40, 1200);

  return (
    <div className={`flex items-center space-x-3 font-mono ${className || ''}`}>
      <motion.span
        className="h-1.5 w-1.5 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.35)]"
        animate={{ opacity: [0.2, 1, 0.2] }}
        transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
      />
      <span className="text-xs text-gray-400 tracking-wide">
        {typingText || '\u00A0'}
      </span>
    </div>
  );
};
