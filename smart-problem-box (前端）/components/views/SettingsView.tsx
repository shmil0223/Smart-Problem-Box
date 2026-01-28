
import React, { useState, useRef } from 'react';
import { useStore } from '../../context/StoreContext';
import { User, Mail, Lock, Moon, Sun, Monitor, Save, PanelLeft, Camera, Check, X } from 'lucide-react';
import { apiChangePassword } from '../../api';

const SettingsView: React.FC = () => {
    const { state, toggleDarkMode, updateUserProfile, toggleSidebar, setViewMode } = useStore();
    const [name, setName] = useState(state.user.name);
    const [email, setEmail] = useState(state.user.email);
    const [avatar, setAvatar] = useState<string | undefined>(state.user.avatar);
    const [isSaved, setIsSaved] = useState(false);
    
    // Change Password State
    const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [passwordError, setPasswordError] = useState('');
    const [passwordSuccess, setPasswordSuccess] = useState('');

    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleSave = () => {
        updateUserProfile({ name, avatar });
        setIsSaved(true);
        setTimeout(() => setIsSaved(false), 2000);
    };

    const handleAvatarClick = () => {
        fileInputRef.current?.click();
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => {
                setAvatar(reader.result as string);
            };
            reader.readAsDataURL(file);
        }
    };

    const handleChangePassword = async (e: React.FormEvent) => {
        e.preventDefault();
        setPasswordError('');
        setPasswordSuccess('');

        if (newPassword !== confirmPassword) {
            setPasswordError('新密码与确认密码不一致');
            return;
        }

        if (newPassword.length < 6) {
            setPasswordError('新密码长度不能少于6位');
            return;
        }
        try {
            await apiChangePassword({ currentPassword, newPassword });
            setPasswordSuccess('密码修改成功！');
            setCurrentPassword('');
            setNewPassword('');
            setConfirmPassword('');
            setTimeout(() => {
                setIsChangePasswordOpen(false);
                setPasswordSuccess('');
            }, 1500);
        } catch (error) {
            const message = error instanceof Error ? error.message : '修改密码失败';
            setPasswordError(message);
        }
    };

    return (
        <div className="flex-1 flex flex-col bg-zinc-50 dark:bg-black min-w-0 h-full animate-fade-in overflow-y-auto">
             <header className="h-16 flex-none flex items-center px-6 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 sticky top-0 z-10 gap-4">
                 <button 
                    onClick={toggleSidebar}
                    className="p-2 -ml-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 rounded-lg transition-colors"
                >
                    <PanelLeft size={20} />
                </button>
                <h1 className="text-lg font-bold text-zinc-900 dark:text-white">账号设置</h1>
            </header>

            <div className="max-w-3xl w-full mx-auto p-8 space-y-8 pb-20">
                {/* Profile Section */}
                <section className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-6 shadow-sm">
                    <h2 className="text-base font-semibold text-zinc-900 dark:text-white mb-6 flex items-center gap-2">
                        <User size={18} className="text-primary" />
                        个人资料
                    </h2>
                    
                    <div className="flex items-start gap-6">
                        <div className="flex-none flex flex-col items-center">
                            <div className="relative group cursor-pointer" onClick={handleAvatarClick}>
                                {avatar ? (
                                    <img src={avatar} alt="Avatar" className="w-20 h-20 rounded-full object-cover shadow-lg border-2 border-white dark:border-zinc-800" />
                                ) : (
                                    <div className="w-20 h-20 rounded-full bg-gradient-to-tr from-primary to-purple-500 flex items-center justify-center text-white text-2xl font-bold shadow-lg border-2 border-white dark:border-zinc-800">
                                        {name.charAt(0)}
                                    </div>
                                )}
                                <div className="absolute inset-0 bg-black/40 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                    <Camera size={24} className="text-white" />
                                </div>
                            </div>
                            <button onClick={handleAvatarClick} className="mt-2 text-xs text-primary hover:underline w-full text-center">更换头像</button>
                            <input 
                                type="file" 
                                ref={fileInputRef} 
                                className="hidden" 
                                accept="image/*"
                                onChange={handleFileChange}
                            />
                        </div>
                        
                        <div className="flex-1 space-y-4 pt-1">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-1.5">
                                    <label className="text-xs font-medium text-zinc-500">昵称</label>
                                    <input 
                                        type="text" 
                                        value={name}
                                        onChange={(e) => setName(e.target.value)}
                                        className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-900 dark:text-white focus:ring-1 focus:ring-primary outline-none"
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-xs font-medium text-zinc-500">邮箱</label>
                                    <div className="relative">
                                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={14} />
                                    <input 
                                        type="email" 
                                        value={email}
                                        readOnly
                                        className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg pl-9 pr-3 py-2 text-sm text-zinc-900 dark:text-white focus:ring-1 focus:ring-primary outline-none cursor-not-allowed"
                                    />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                {/* Theme Section */}
                <section className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-6 shadow-sm">
                     <h2 className="text-base font-semibold text-zinc-900 dark:text-white mb-6 flex items-center gap-2">
                        <Monitor size={18} className="text-primary" />
                        偏好设置
                    </h2>
                    
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-zinc-900 dark:text-white">外观模式</p>
                            <p className="text-xs text-zinc-500 mt-1">切换明亮或暗黑主题</p>
                        </div>
                        <div className="flex bg-zinc-100 dark:bg-zinc-800 p-1 rounded-lg">
                            <button 
                                onClick={() => !state.darkMode && toggleDarkMode()}
                                className={`p-2 rounded-md transition-all ${!state.darkMode ? 'bg-white shadow text-zinc-900' : 'text-zinc-500 hover:text-zinc-300'}`}
                            >
                                <Sun size={18} />
                            </button>
                            <button 
                                onClick={() => state.darkMode && toggleDarkMode()}
                                className={`p-2 rounded-md transition-all ${state.darkMode ? 'bg-zinc-700 shadow text-white' : 'text-zinc-500 hover:text-zinc-700'}`}
                            >
                                <Moon size={18} />
                            </button>
                        </div>
                    </div>
                </section>

                {/* Security Section */}
                <section className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-6 shadow-sm">
                     <h2 className="text-base font-semibold text-zinc-900 dark:text-white mb-6 flex items-center gap-2">
                        <Lock size={18} className="text-primary" />
                        安全
                    </h2>
                    
                    {!isChangePasswordOpen ? (
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm font-medium text-zinc-900 dark:text-white">密码</p>
                                <p className="text-xs text-zinc-500 mt-1">上次修改于 30 天前</p>
                            </div>
                            <button 
                                onClick={() => setIsChangePasswordOpen(true)}
                                className="px-4 py-2 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                            >
                                修改密码
                            </button>
                        </div>
                    ) : (
                        <div className="animate-fade-in bg-zinc-50 dark:bg-zinc-800/50 rounded-lg p-6 border border-zinc-100 dark:border-zinc-800">
                             <h3 className="text-sm font-semibold text-zinc-900 dark:text-white mb-4">修改密码</h3>
                             <form onSubmit={handleChangePassword} className="space-y-4 max-w-md">
                                <div className="space-y-1">
                                    <label className="text-xs font-medium text-zinc-500">当前密码</label>
                                    <input 
                                        type="password" 
                                        required
                                        value={currentPassword}
                                        onChange={e => setCurrentPassword(e.target.value)}
                                        className="w-full bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-900 dark:text-white focus:ring-1 focus:ring-primary outline-none"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs font-medium text-zinc-500">新密码</label>
                                    <input 
                                        type="password" 
                                        required
                                        value={newPassword}
                                        onChange={e => setNewPassword(e.target.value)}
                                        className="w-full bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-900 dark:text-white focus:ring-1 focus:ring-primary outline-none"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs font-medium text-zinc-500">确认新密码</label>
                                    <input 
                                        type="password" 
                                        required
                                        value={confirmPassword}
                                        onChange={e => setConfirmPassword(e.target.value)}
                                        className="w-full bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-900 dark:text-white focus:ring-1 focus:ring-primary outline-none"
                                    />
                                </div>

                                {passwordError && (
                                    <div className="flex items-center gap-2 text-red-600 text-xs mt-2">
                                        <X size={12} />
                                        {passwordError}
                                    </div>
                                )}
                                {passwordSuccess && (
                                    <div className="flex items-center gap-2 text-emerald-600 text-xs mt-2">
                                        <Check size={12} />
                                        {passwordSuccess}
                                    </div>
                                )}

                                <div className="flex items-center gap-3 pt-2">
                                    <button 
                                        type="submit"
                                        className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-blue-600 transition-colors"
                                    >
                                        确认修改
                                    </button>
                                    <button 
                                        type="button"
                                        onClick={() => setIsChangePasswordOpen(false)}
                                        className="px-4 py-2 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 text-sm font-medium rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors"
                                    >
                                        取消
                                    </button>
                                </div>
                             </form>
                        </div>
                    )}
                </section>

                <div className="flex justify-end gap-4">
                    <button 
                        onClick={() => setViewMode('study')}
                        className="px-6 py-2 rounded-lg text-sm font-medium text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                    >
                        返回
                    </button>
                    <button 
                        onClick={handleSave}
                        className={`px-6 py-2 rounded-lg text-sm font-medium text-white transition-all flex items-center gap-2 ${isSaved ? 'bg-emerald-500' : 'bg-primary hover:bg-blue-600'}`}
                    >
                        {isSaved ? <span className="flex items-center gap-1">已保存</span> : <span className="flex items-center gap-1"><Save size={16}/> 保存更改</span>}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default SettingsView;
