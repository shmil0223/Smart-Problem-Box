
import React, { createContext, useContext, useState, ReactNode, useEffect, useMemo } from 'react';
import { AppState, Problem, TreeNode, ViewMode, UserProfile } from '../types';
import {
  apiAddFolder,
  apiBootstrap,
  apiDeleteNode,
  apiDeleteProblem,
  apiLogin,
  apiRegister,
  apiToggleFavorite,
  apiUpdateProfile,
  clearAccessToken,
  getAccessToken,
  setAccessToken
} from '../api';

interface StoreContextType {
  state: AppState;
  problems: Record<string, Problem>;
  treeData: TreeNode[];
  filteredProblems: Problem[]; // Exposed filtered list
  toggleFavorite: (problemId: string) => void;
  setCurrentProblem: (problemId: string) => void;
  setSelectedFolder: (folderId: string | null) => void;
  setViewMode: (mode: ViewMode) => void;
  toggleNodeExpansion: (nodeId: string) => void;
  toggleDarkMode: () => void;
  toggleFullscreen: () => void;
  toggleSidebar: () => void;
  setColumnWidth: (column: 'sidebar' | 'middle', width: number) => void;
  setDifficultyFilter: (difficulty: 'all' | 'easy' | 'medium' | 'hard') => void;
  addNewFolder: (title: string) => void;
  deleteNode: (nodeId: string) => void;
  deleteProblem: (problemId: string) => void;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => void;
  updateUserProfile: (profile: Partial<UserProfile>) => void;
}

const StoreContext = createContext<StoreContextType | undefined>(undefined);

// Helper to find a node by ID in the tree
const findNode = (nodes: TreeNode[], id: string): TreeNode | null => {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.children) {
      const found = findNode(node.children, id);
      if (found) return found;
    }
  }
  return null;
};

// Helper to recursively collect all problem IDs under a node
const collectProblemIds = (node: TreeNode): string[] => {
  let ids: string[] = [];
  if (node.type === 'file' && node.problemId) {
    ids.push(node.problemId);
  }
  if (node.children) {
    node.children.forEach(child => {
      ids = ids.concat(collectProblemIds(child));
    });
  }
  return ids;
};

export const StoreProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [state, setState] = useState<AppState>({
    isLoggedIn: false, // Default to false to show Login Screen
    user: {
        name: '李明',
        email: 'liming@example.com',
        plan: 'free'
    },
    currentView: 'study',
    currentProblemId: null,
    selectedFolderId: null, // Default to null (show all or root)
    favorites: [],
    expandedNodes: ['root-1', 'ch-1-1'],
    darkMode: true,
    isFullscreen: false,
    isSidebarOpen: true,
    sidebarWidth: 256, // 16rem default
    middleColumnWidth: 384, // 24rem default
    difficultyFilter: 'all',
  });

  const [problems, setProblems] = useState<Record<string, Problem>>({});
  const [treeData, setTreeData] = useState<TreeNode[]>([]);

  const loadRemoteData = async () => {
    const data = await apiBootstrap();
    const problemsMap = data.problems.reduce<Record<string, Problem>>((acc, problem) => {
      acc[problem.id] = problem;
      return acc;
    }, {});

    setProblems(problemsMap);
    setTreeData(data.tree || []);
    setState(prev => ({
      ...prev,
      isLoggedIn: true,
      user: data.profile,
      favorites: data.favorites || [],
      currentProblemId: data.problems[0]?.id ?? null
    }));
  };

  // Sync dark mode with HTML class
  useEffect(() => {
    if (state.darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [state.darkMode]);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) return;
    loadRemoteData().catch(() => {
      clearAccessToken();
      setState(prev => ({ ...prev, isLoggedIn: false }));
    });
  }, []);

  // Compute filtered problems based on selectedFolderId and difficultyFilter
  const filteredProblems = useMemo(() => {
    let result: Problem[] = [];

    // 1. Filter by Folder
    if (!state.selectedFolderId) {
      // If no folder selected, show all problems
      result = Object.values(problems);
    } else {
      const selectedNode = findNode(treeData, state.selectedFolderId);
      if (!selectedNode) {
          result = [];
      } else {
          const ids = collectProblemIds(selectedNode);
          result = ids.map(id => problems[id]).filter(Boolean);
      }
    }

    // 2. Filter by Difficulty
    if (state.difficultyFilter !== 'all') {
        result = result.filter(p => p.difficulty === state.difficultyFilter);
    }

    return result;
  }, [state.selectedFolderId, state.difficultyFilter, problems, treeData]);

  const toggleFavorite = (problemId: string) => {
    apiToggleFavorite(problemId)
      .then(({ favorites }) => {
        setState(prev => ({ ...prev, favorites }));
      })
      .catch((error) => {
        console.error('切换收藏失败：', error);
      });
  };

  const setCurrentProblem = (problemId: string) => {
    setState((prev) => ({ ...prev, currentProblemId: problemId }));
  };

  const setSelectedFolder = (folderId: string | null) => {
    setState((prev) => ({ ...prev, selectedFolderId: folderId }));
  };

  const setViewMode = (mode: ViewMode) => {
    setState((prev) => ({ ...prev, currentView: mode }));
  };

  const toggleNodeExpansion = (nodeId: string) => {
    setState((prev) => {
      const isExpanded = prev.expandedNodes.includes(nodeId);
      return {
        ...prev,
        expandedNodes: isExpanded
          ? prev.expandedNodes.filter((id) => id !== nodeId)
          : [...prev.expandedNodes, nodeId],
      };
    });
  };

  const toggleDarkMode = () => {
    setState(prev => ({ ...prev, darkMode: !prev.darkMode }));
  };

  const toggleFullscreen = () => {
    setState(prev => ({ ...prev, isFullscreen: !prev.isFullscreen }));
  }

  const toggleSidebar = () => {
    setState(prev => ({ ...prev, isSidebarOpen: !prev.isSidebarOpen }));
  };

  const setColumnWidth = (column: 'sidebar' | 'middle', width: number) => {
    setState(prev => ({
        ...prev,
        [column === 'sidebar' ? 'sidebarWidth' : 'middleColumnWidth']: width
    }));
  };

  const setDifficultyFilter = (difficulty: 'all' | 'easy' | 'medium' | 'hard') => {
      setState(prev => ({ ...prev, difficultyFilter: difficulty }));
  };

  const addNewFolder = (title: string) => {
    apiAddFolder({ title })
      .then(({ node }) => {
        setTreeData(prev => [...prev, node]);
      })
      .catch((error) => {
        console.error('新建文件夹失败：', error);
      });
  };

  const deleteNode = (nodeId: string) => {
    apiDeleteNode(nodeId)
      .then(({ deletedIds }) => {
        const recursiveDelete = (nodes: TreeNode[]): TreeNode[] => {
          return nodes
            .filter(node => !deletedIds.includes(node.id))
            .map(node => ({
              ...node,
              children: node.children ? recursiveDelete(node.children) : undefined
            }));
        };
        setTreeData(prev => recursiveDelete(prev));
      })
      .catch((error) => {
        console.error('删除节点失败：', error);
      });
  };

  const deleteProblem = (problemId: string) => {
    apiDeleteProblem(problemId)
      .then(() => {
        const recursiveDelete = (nodes: TreeNode[]): TreeNode[] => {
          return nodes
            .filter(node => node.problemId !== problemId)
            .map(node => ({
              ...node,
              children: node.children ? recursiveDelete(node.children) : undefined
            }));
        };
        setTreeData(prev => recursiveDelete(prev));

        setProblems(prev => {
          const next = { ...prev };
          delete next[problemId];
          return next;
        });

        setState(prev => ({
          ...prev,
          favorites: prev.favorites.filter(id => id !== problemId),
          currentProblemId: prev.currentProblemId === problemId ? null : prev.currentProblemId
        }));
      })
      .catch((error) => {
        console.error('删除题目失败：', error);
      });
  };

  // Auth Methods
  const login = async (email: string, password: string) => {
    const { token, profile } = await apiLogin({ email, password });
    setAccessToken(token);
    setState(prev => ({ ...prev, isLoggedIn: true, user: profile }));
    await loadRemoteData();
  };

  const register = async (name: string, email: string, password: string) => {
    const { token, profile } = await apiRegister({ name, email, password });
    setAccessToken(token);
    setState(prev => ({ ...prev, isLoggedIn: true, user: profile }));
    await loadRemoteData();
  };

  const logout = () => {
    clearAccessToken();
    setProblems({});
    setTreeData([]);
    setState(prev => ({
      ...prev,
      isLoggedIn: false,
      favorites: [],
      currentProblemId: null,
      currentView: 'study'
    }));
  };

  const updateUserProfile = (profile: Partial<UserProfile>) => {
    setState(prev => ({
      ...prev,
      user: { ...prev.user, ...profile }
    }));
    apiUpdateProfile(profile)
      .then(({ profile: nextProfile }) => {
        setState(prev => ({
          ...prev,
          user: { ...prev.user, ...nextProfile }
        }));
      })
      .catch((error) => {
        console.error('更新用户信息失败：', error);
      });
  };

  return (
    <StoreContext.Provider
      value={{
        state,
        problems,
        treeData,
        filteredProblems,
        toggleFavorite,
        setCurrentProblem,
        setSelectedFolder,
        setViewMode,
        toggleNodeExpansion,
        toggleDarkMode,
        toggleFullscreen,
        toggleSidebar,
        setColumnWidth,
        setDifficultyFilter,
        addNewFolder,
        deleteNode,
        deleteProblem,
        login,
        register,
        logout,
        updateUserProfile
      }}
    >
      {children}
    </StoreContext.Provider>
  );
};

export const useStore = () => {
  const context = useContext(StoreContext);
  if (!context) {
    throw new Error('useStore must be used within a StoreProvider');
  }
  return context;
};
