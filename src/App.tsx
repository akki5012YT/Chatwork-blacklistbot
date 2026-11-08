/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  UserX,
  UserCheck,
  Users,
  Terminal,
  Cloud,
  Play,
  RefreshCw,
  Search,
  Plus,
  Trash2,
  Settings,
  AlertCircle,
  CheckCircle2,
  Copy,
  ExternalLink,
  Lock,
  Database,
  ArrowRight,
  Eye,
  Check,
  Radio,
  Sliders,
} from 'lucide-react';

interface BlacklistEntry {
  id: string;
  account_id: string;
  chatwork_id?: string;
  name?: string;
  reason: string;
  room_id: string;
  added_by: string;
  status: 'active' | 'revoked';
  auto_reject_count: number;
  created_at: string;
  updated_at: string;
  last_attempt_at?: string;
}

interface BanLog {
  id: string;
  account_id: string;
  room_id: string;
  user_name?: string;
  action: 'COMMAND_BAN' | 'AUTO_KICK_JOIN' | 'AUTO_REJECT_REENTRY' | 'MANUAL_BAN' | 'MANUAL_UNBAN' | 'CHECK';
  details: string;
  timestamp: string;
}

interface RoomMember {
  account_id: number;
  role: 'admin' | 'member' | 'readonly';
  name: string;
  chatwork_id: string;
  avatar_image_url?: string;
  isBlacklisted?: boolean;
}

interface ChatworkRoom {
  room_id: number;
  name: string;
  type: string;
  role: string;
  message_num: number;
}

interface BotStatus {
  status: string;
  timestamp: string;
  database: {
    type: 'postgres' | 'local_file';
    status: string;
  };
  bot: {
    isConfigured: boolean;
    account: { account_id: number; name: string; chatwork_id: string } | null;
    autoKickEnabled: boolean;
    autoRejectEnabled: boolean;
    monitoredRoomsCount: number;
    activeBanCount: number;
    totalRejectionsCount: number;
    pollingIntervalSeconds: number;
  };
}

interface BotConfig {
  api_token: string;
  webhook_token: string;
  monitored_rooms: string[];
  auto_kick_enabled: boolean;
  auto_reject_enabled: boolean;
  notify_in_chat: boolean;
  polling_interval_seconds: number;
  admin_account_ids: string[];
  hasApiToken: boolean;
  hasWebhookToken: boolean;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'blacklist' | 'rooms' | 'logs' | 'simulator' | 'render'>('blacklist');
  const [status, setStatus] = useState<BotStatus | null>(null);
  const [config, setConfig] = useState<BotConfig | null>(null);
  const [blacklist, setBlacklist] = useState<BlacklistEntry[]>([]);
  const [logs, setLogs] = useState<BanLog[]>([]);
  const [rooms, setRooms] = useState<ChatworkRoom[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<number | null>(null);
  const [members, setMembers] = useState<RoomMember[]>([]);

  const [isLoading, setIsLoading] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'revoked'>('active');

  // Modals & Forms
  const [showAddModal, setShowAddModal] = useState(false);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [copiedText, setCopiedText] = useState<string | null>(null);

  // New Ban Form State
  const [newBanAccountId, setNewBanAccountId] = useState('');
  const [newBanName, setNewBanName] = useState('');
  const [newBanReason, setNewBanReason] = useState('荒らし・不適切行為のため');
  const [newBanRoomId, setNewBanRoomId] = useState('GLOBAL');
  const [newBanKickNow, setNewBanKickNow] = useState(true);
  const [banFormError, setBanFormError] = useState('');
  const [banFormSuccess, setBanFormSuccess] = useState('');

  // Simulator State
  const [simCommand, setSimCommand] = useState('/blacklist 9988123 スパムURL投稿');
  const [simRoomId, setSimRoomId] = useState('10001');
  const [simSenderId, setSimSenderId] = useState('111111'); // 111111 = Admin, 222222 = Member
  const [simTargetId, setSimTargetId] = useState('8899001');
  const [simTargetName, setSimTargetName] = useState('迷惑宣伝アカウント');
  const [simResponse, setSimResponse] = useState<any>(null);
  const [simLoading, setSimLoading] = useState(false);

  // Settings Edit Form
  const [editApiToken, setEditApiToken] = useState('');
  const [editWebhookToken, setEditWebhookToken] = useState('');
  const [editAutoKick, setEditAutoKick] = useState(true);
  const [editAutoReject, setEditAutoReject] = useState(true);
  const [editNotifyInChat, setEditNotifyInChat] = useState(true);
  const [editInterval, setEditInterval] = useState(20);
  const [configSaveSuccess, setConfigSaveSuccess] = useState(false);

  // Fetch initial data
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/status');
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
      }
    } catch (err) {
      console.error('Failed to fetch status:', err);
    }
  }, []);

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/config');
      if (res.ok) {
        const data: BotConfig = await res.json();
        setConfig(data);
        setEditAutoKick(data.auto_kick_enabled);
        setEditAutoReject(data.auto_reject_enabled);
        setEditNotifyInChat(data.notify_in_chat);
        setEditInterval(data.polling_interval_seconds);
      }
    } catch (err) {
      console.error('Failed to fetch config:', err);
    }
  }, []);

  const fetchBlacklist = useCallback(async () => {
    try {
      const res = await fetch('/api/blacklist');
      if (res.ok) {
        const data = await res.json();
        setBlacklist(data);
      }
    } catch (err) {
      console.error('Failed to fetch blacklist:', err);
    }
  }, []);

  const fetchLogs = useCallback(async () => {
    try {
      const res = await fetch('/api/logs?limit=50');
      if (res.ok) {
        const data = await res.json();
        setLogs(data);
      }
    } catch (err) {
      console.error('Failed to fetch logs:', err);
    }
  }, []);

  const fetchRooms = useCallback(async () => {
    try {
      const res = await fetch('/api/rooms');
      if (res.ok) {
        const data: ChatworkRoom[] = await res.json();
        setRooms(data);
        if (data.length > 0 && selectedRoomId === null) {
          setSelectedRoomId(data[0].room_id);
        }
      }
    } catch (err) {
      console.error('Failed to fetch rooms:', err);
    }
  }, [selectedRoomId]);

  const fetchMembers = useCallback(async (roomId: number) => {
    try {
      setIsLoading(true);
      const res = await fetch(`/api/rooms/${roomId}/members`);
      if (res.ok) {
        const data = await res.json();
        setMembers(data);
      }
    } catch (err) {
      console.error('Failed to fetch members:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    fetchConfig();
    fetchBlacklist();
    fetchLogs();
    fetchRooms();
  }, [fetchStatus, fetchConfig, fetchBlacklist, fetchLogs, fetchRooms]);

  useEffect(() => {
    if (selectedRoomId) {
      fetchMembers(selectedRoomId);
    }
  }, [selectedRoomId, fetchMembers]);

  // Periodic polling for status and logs
  useEffect(() => {
    const timer = setInterval(() => {
      fetchStatus();
      fetchLogs();
      fetchBlacklist();
    }, 15000);
    return () => clearInterval(timer);
  }, [fetchStatus, fetchLogs, fetchBlacklist]);

  // Copy helper
  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(id);
    setTimeout(() => setCopiedText(null), 2000);
  };

  // Immediate scan execution
  const handleTriggerScan = async () => {
    try {
      setIsScanning(true);
      const res = await fetch('/api/scan-now', { method: 'POST' });
      if (res.ok) {
        await fetchStatus();
        await fetchBlacklist();
        await fetchLogs();
        if (selectedRoomId) {
          await fetchMembers(selectedRoomId);
        }
      }
    } catch (err) {
      console.error('Scan failed:', err);
    } finally {
      setIsScanning(false);
    }
  };

  // Create manual BAN
  const handleCreateBan = async (e: React.FormEvent) => {
    e.preventDefault();
    setBanFormError('');
    setBanFormSuccess('');

    if (!newBanAccountId.trim()) {
      setBanFormError('Chatwork ユーザーIDを入力してください。');
      return;
    }

    try {
      setIsLoading(true);
      const res = await fetch('/api/blacklist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_id: newBanAccountId.trim(),
          name: newBanName.trim() || undefined,
          reason: newBanReason.trim(),
          room_id: newBanRoomId,
          kick_now: newBanKickNow,
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || '登録に失敗しました');
      }

      const result = await res.json();
      setBanFormSuccess(
        `ユーザー ID: ${newBanAccountId} をブラックリストに登録しました。${result.kickResult?.wasPresent ? '対象ルームから即座に強制退室させました。' : '今後入室時は自動で拒否されます。'}`
      );
      setNewBanAccountId('');
      setNewBanName('');
      await fetchBlacklist();
      await fetchLogs();
      await fetchStatus();
      if (selectedRoomId) {
        await fetchMembers(selectedRoomId);
      }
      setTimeout(() => {
        setShowAddModal(false);
        setBanFormSuccess('');
      }, 1500);
    } catch (err: any) {
      setBanFormError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  // Unban user
  const handleRevokeBan = async (accountId: string) => {
    if (!confirm(`ユーザー ID: ${accountId} のブラックリストを解除しますか？`)) {
      return;
    }
    try {
      const res = await fetch(`/api/blacklist/${accountId}`, { method: 'DELETE' });
      if (res.ok) {
        await fetchBlacklist();
        await fetchLogs();
        await fetchStatus();
      }
    } catch (err) {
      console.error('Failed to revoke ban:', err);
    }
  };

  // Direct kick from member list
  const handleKickMember = async (accountId: number, name: string) => {
    if (!selectedRoomId) return;
    const reason = prompt(`ユーザー「${name}」(ID: ${accountId}) を退室させ、ブラックリストに追加しますか？\n理由を入力してください:`, '迷惑行為のためBAN');
    if (reason === null) return;

    try {
      // 1. Add to blacklist
      await fetch('/api/blacklist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_id: String(accountId),
          name,
          reason,
          room_id: String(selectedRoomId),
          kick_now: true,
        }),
      });

      // 2. Direct kick
      await fetch(`/api/rooms/${selectedRoomId}/kick/${accountId}`, { method: 'POST' });

      await fetchBlacklist();
      await fetchLogs();
      await fetchStatus();
      await fetchMembers(selectedRoomId);
    } catch (err) {
      console.error('Failed to kick member:', err);
    }
  };

  // Save Settings
  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload: any = {
        auto_kick_enabled: editAutoKick,
        auto_reject_enabled: editAutoReject,
        notify_in_chat: editNotifyInChat,
        polling_interval_seconds: Number(editInterval) || 20,
      };
      if (editApiToken.trim()) {
        payload.api_token = editApiToken.trim();
      }
      if (editWebhookToken.trim()) {
        payload.webhook_token = editWebhookToken.trim();
      }

      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        setConfigSaveSuccess(true);
        setEditApiToken('');
        setEditWebhookToken('');
        await fetchConfig();
        await fetchStatus();
        setTimeout(() => {
          setConfigSaveSuccess(false);
          setShowConfigModal(false);
        }, 1200);
      }
    } catch (err) {
      console.error('Failed to save config:', err);
    }
  };

  // Run Simulator
  const handleRunSimulator = async (type: 'command' | 'reentry' | 'emoji_spam') => {
    try {
      setSimLoading(true);
      setSimResponse(null);

      let payload: any;
      if (type === 'command') {
        payload = {
          type: 'command',
          roomId: simRoomId,
          senderId: simSenderId,
          text: simCommand,
        };
      } else if (type === 'reentry') {
        payload = {
          type: 'reentry',
          roomId: simRoomId,
          accountId: simTargetId,
          name: simTargetName,
        };
      } else {
        payload = {
          type: 'emoji_spam',
          roomId: simRoomId,
          accountId: simTargetId,
          name: simTargetName,
          text: '(bow)(bow)(bow)(bow)(bow) 絵文字5連続テスト',
        };
      }

      const res = await fetch('/api/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      setSimResponse(data);
      await fetchBlacklist();
      await fetchLogs();
      await fetchStatus();
      if (selectedRoomId) {
        await fetchMembers(selectedRoomId);
      }
    } catch (err: any) {
      setSimResponse({ error: err.message });
    } finally {
      setSimLoading(false);
    }
  };

  // Filtered blacklist
  const filteredBlacklist = useMemo(() => {
    return blacklist.filter((item) => {
      const matchesStatus =
        statusFilter === 'all' ? true : statusFilter === 'active' ? item.status === 'active' : item.status === 'revoked';
      const q = searchQuery.toLowerCase().trim();
      const matchesQuery =
        !q ||
        item.account_id.toLowerCase().includes(q) ||
        (item.name && item.name.toLowerCase().includes(q)) ||
        (item.reason && item.reason.toLowerCase().includes(q));
      return matchesStatus && matchesQuery;
    });
  }, [blacklist, statusFilter, searchQuery]);

  const appUrl = window.location.origin;
  const webhookUrl = `${appUrl}/api/chatwork/webhook`;

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col selection:bg-rose-500 selection:text-white">
      {/* ------------------------------------------------------------- */}
      {/* Top Bar Contract (3 Zones, gap-8)                            */}
      {/* ------------------------------------------------------------- */}
      <header className="flex items-center justify-between gap-8 px-6 py-3.5 border-b border-slate-800 bg-slate-950/80 backdrop-blur sticky top-0 z-30">
        {/* Zone 1: Single Brand wordmark element */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="w-8 h-8 rounded-lg bg-rose-600/20 border border-rose-500/30 flex items-center justify-center text-rose-400">
            <ShieldAlert className="w-4 h-4" />
          </div>
          <a href="/" className="text-base font-bold tracking-tight text-white whitespace-nowrap">
            Chatwork Guardian
          </a>
          <span className="text-xs text-slate-400 hidden sm:inline">·</span>
          <span className="text-xs text-slate-400 hidden sm:inline">ブラックリスト & 自動退室Bot</span>
        </div>

        {/* Zone 2: Navigation Links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-400">
          <button
            onClick={() => setActiveTab('blacklist')}
            className={`transition-colors whitespace-nowrap shrink-0 hover:text-white ${activeTab === 'blacklist' ? 'text-rose-400 font-semibold' : ''}`}
          >
            ブラックリスト
          </button>
          <button
            onClick={() => setActiveTab('rooms')}
            className={`transition-colors whitespace-nowrap shrink-0 hover:text-white ${activeTab === 'rooms' ? 'text-rose-400 font-semibold' : ''}`}
          >
            ルーム監視 & メンバー
          </button>
          <button
            onClick={() => setActiveTab('logs')}
            className={`transition-colors whitespace-nowrap shrink-0 hover:text-white ${activeTab === 'logs' ? 'text-rose-400 font-semibold' : ''}`}
          >
            監査ログ
          </button>
          <button
            onClick={() => setActiveTab('simulator')}
            className={`transition-colors whitespace-nowrap shrink-0 hover:text-white ${activeTab === 'simulator' ? 'text-rose-400 font-semibold' : ''}`}
          >
            テスト実行
          </button>
          <button
            onClick={() => setActiveTab('render')}
            className={`transition-colors whitespace-nowrap shrink-0 hover:text-white ${activeTab === 'render' ? 'text-rose-400 font-semibold' : ''}`}
          >
            Renderデプロイ
          </button>
        </nav>

        {/* Zone 3: Primary Action & Quick Tools */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={handleTriggerScan}
            disabled={isScanning}
            title="全監視ルームのブラックリスト在室スキャンを即時実行します"
            className="hidden sm:inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin text-rose-400' : ''}`} />
            <span>{isScanning ? 'スキャン中...' : '即時スキャン'}</span>
          </button>

          <button
            onClick={() => setShowAddModal(true)}
            className="inline-flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium text-white bg-rose-600 hover:bg-rose-500 rounded-lg shadow-sm transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>新規BAN登録</span>
          </button>

          <button
            onClick={() => setShowConfigModal(true)}
            title="Bot・API設定"
            className="p-1.5 text-slate-400 hover:text-white bg-slate-800/80 hover:bg-slate-800 border border-slate-700 rounded-lg transition-colors shrink-0"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* ------------------------------------------------------------- */}
      {/* Mobile Navigation Bar                                        */}
      {/* ------------------------------------------------------------- */}
      <div className="md:hidden flex items-center justify-around border-b border-slate-800 bg-slate-950 px-2 py-2 text-xs">
        <button
          onClick={() => setActiveTab('blacklist')}
          className={`py-1 px-2 whitespace-nowrap ${activeTab === 'blacklist' ? 'text-rose-400 font-semibold border-b-2 border-rose-500' : 'text-slate-400'}`}
        >
          ブラックリスト
        </button>
        <button
          onClick={() => setActiveTab('rooms')}
          className={`py-1 px-2 whitespace-nowrap ${activeTab === 'rooms' ? 'text-rose-400 font-semibold border-b-2 border-rose-500' : 'text-slate-400'}`}
        >
          メンバー
        </button>
        <button
          onClick={() => setActiveTab('logs')}
          className={`py-1 px-2 whitespace-nowrap ${activeTab === 'logs' ? 'text-rose-400 font-semibold border-b-2 border-rose-500' : 'text-slate-400'}`}
        >
          ログ
        </button>
        <button
          onClick={() => setActiveTab('simulator')}
          className={`py-1 px-2 whitespace-nowrap ${activeTab === 'simulator' ? 'text-rose-400 font-semibold border-b-2 border-rose-500' : 'text-slate-400'}`}
        >
          テスト
        </button>
        <button
          onClick={() => setActiveTab('render')}
          className={`py-1 px-2 whitespace-nowrap ${activeTab === 'render' ? 'text-rose-400 font-semibold border-b-2 border-rose-500' : 'text-slate-400'}`}
        >
          Render
        </button>
      </div>

      {/* ------------------------------------------------------------- */}
      {/* Main Content Viewport                                         */}
      {/* ------------------------------------------------------------- */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* KPI / Security Status Banner */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>アクティブBAN登録数</span>
              <UserX className="w-4 h-4 text-rose-400" />
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-2xl sm:text-3xl font-bold font-mono tabular-nums text-white">
                {status?.bot.activeBanCount ?? blacklist.filter((b) => b.status === 'active').length}
              </span>
              <span className="text-xs text-slate-400">アカウント</span>
            </div>
            <div className="mt-2 text-xs text-slate-400 flex items-center gap-1.5">
              <span>コマンド</span>
              <span aria-hidden="true">·</span>
              <span>/blacklist で即時追加</span>
            </div>
          </div>

          <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>再参加・入室自動拒否数</span>
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-2xl sm:text-3xl font-bold font-mono tabular-nums text-emerald-400">
                {status?.bot.totalRejectionsCount ??
                  blacklist.reduce((acc, cur) => acc + (cur.auto_reject_count || 0), 0)}
              </span>
              <span className="text-xs text-slate-400">回ブロック</span>
            </div>
            <div className="mt-2 text-xs text-slate-400 flex items-center gap-1.5">
              <span>自動退室</span>
              <span aria-hidden="true">·</span>
              <span>{config?.auto_reject_enabled ? '自動拒否ガード稼働中' : '無効'}</span>
            </div>
          </div>

          <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>データベース永続化</span>
              <Database className="w-4 h-4 text-indigo-400" />
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-xl sm:text-2xl font-bold text-white capitalize">
                {status?.database.type === 'postgres' ? 'PostgreSQL' : 'Persistent File'}
              </span>
            </div>
            <div className="mt-2 text-xs text-slate-400 flex items-center gap-1.5 truncate">
              <span>{status?.database.type === 'postgres' ? 'Render PG 接続済' : 'data/blacklist_db.json'}</span>
              <span aria-hidden="true">·</span>
              <span className="text-emerald-400 font-mono">READY</span>
            </div>
          </div>

          <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Chatwork連携ステータス</span>
              <div className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                <span className="text-xs text-emerald-400">
                  {status?.bot.isConfigured ? 'Live API' : 'Sandbox (検証用)'}
                </span>
              </div>
            </div>
            <div className="mt-3">
              <div className="text-sm font-semibold text-white truncate">
                {status?.bot.account?.name || 'Chatwork Guardian Bot'}
              </div>
              <div className="text-xs text-slate-400 font-mono truncate">
                ID: {status?.bot.account?.account_id || 111111}
              </div>
            </div>
            <div className="mt-2 text-xs text-slate-400 flex items-center gap-1.5">
              <span>監視間隔</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">{config?.polling_interval_seconds || 20}秒</span>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------- */}
        {/* TAB 1: ブラックリスト管理 (Blacklist Manager)                  */}
        {/* ------------------------------------------------------------- */}
        {activeTab === 'blacklist' && (
          <div className="space-y-4">
            {/* Filter and Search Bar */}
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
              <div className="flex items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded-lg">
                <button
                  onClick={() => setStatusFilter('active')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${statusFilter === 'active' ? 'bg-rose-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'}`}
                >
                  BAN中のみ ({blacklist.filter((b) => b.status === 'active').length})
                </button>
                <button
                  onClick={() => setStatusFilter('all')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${statusFilter === 'all' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-400 hover:text-white'}`}
                >
                  全件 ({blacklist.length})
                </button>
                <button
                  onClick={() => setStatusFilter('revoked')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${statusFilter === 'revoked' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-400 hover:text-white'}`}
                >
                  解除済 ({blacklist.filter((b) => b.status === 'revoked').length})
                </button>
              </div>

              <div className="relative flex-1 sm:max-w-xs">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="ユーザーID・名前・理由で検索..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-9 pr-4 py-1.5 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-rose-500 transition-colors"
                />
              </div>
            </div>

            {/* Blacklist Table */}
            <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-900/50 text-slate-400 font-medium">
                      <th className="py-3 px-4">対象ユーザー (Account ID)</th>
                      <th className="py-3 px-4">BAN理由</th>
                      <th className="py-3 px-4">適用範囲</th>
                      <th className="py-3 px-4 text-right">再参加拒否回数</th>
                      <th className="py-3 px-4">登録日時 / 実行元</th>
                      <th className="py-3 px-4 text-center">ステータス</th>
                      <th className="py-3 px-4 text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-sans">
                    {filteredBlacklist.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-12 text-center text-slate-400">
                          <UserX className="w-8 h-8 mx-auto mb-2 text-slate-400" />
                          <p>該当するブラックリストユーザーは見つかりませんでした。</p>
                          <button
                            onClick={() => setShowAddModal(true)}
                            className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>新しいユーザーを登録する</span>
                          </button>
                        </td>
                      </tr>
                    ) : (
                      filteredBlacklist.map((item) => (
                        <tr key={item.id} className="hover:bg-slate-900/40 transition-colors">
                          <td className="py-3 px-4">
                            <div className="font-semibold text-white flex items-center gap-2">
                              <span>{item.name || `User #${item.account_id}`}</span>
                              {item.chatwork_id && (
                                <span className="text-slate-400 font-mono text-[11px]">@{item.chatwork_id}</span>
                              )}
                            </div>
                            <div className="text-slate-400 font-mono text-[11px] tabular-nums flex items-center gap-1 mt-0.5">
                              <span>ID: {item.account_id}</span>
                              <button
                                onClick={() => handleCopy(item.account_id, item.id)}
                                title="IDをコピー"
                                className="hover:text-slate-200"
                              >
                                {copiedText === item.id ? (
                                  <Check className="w-3 h-3 text-emerald-400" />
                                ) : (
                                  <Copy className="w-3 h-3 text-slate-400" />
                                )}
                              </button>
                            </div>
                          </td>
                          <td className="py-3 px-4 max-w-xs text-slate-300">
                            <p className="truncate" title={item.reason}>
                              {item.reason}
                            </p>
                          </td>
                          <td className="py-3 px-4 text-slate-400 font-mono">
                            {item.room_id === 'GLOBAL' ? '全ルーム (GLOBAL)' : `Room #${item.room_id}`}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <span
                              className={`font-mono font-semibold tabular-nums ${item.auto_reject_count > 0 ? 'text-rose-400' : 'text-slate-400'}`}
                            >
                              {item.auto_reject_count} 回
                            </span>
                            {item.last_attempt_at && (
                              <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                                最終: {new Date(item.last_attempt_at).toLocaleDateString('ja-JP')}
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-4 text-slate-400">
                            <div className="font-mono text-[11px] text-slate-300">
                              {new Date(item.created_at).toLocaleString('ja-JP', {
                                month: '2-digit',
                                day: '2-digit',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </div>
                            <div className="text-[10px] text-slate-400">by {item.added_by}</div>
                          </td>
                          <td className="py-3 px-4 text-center">
                            {item.status === 'active' ? (
                              <span className="inline-flex items-center gap-1 text-rose-400 text-xs font-semibold">
                                <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                                BAN適用中
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-slate-400 text-xs">
                                <span className="w-1.5 h-1.5 rounded-full bg-slate-500"></span>
                                解除済
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right">
                            {item.status === 'active' ? (
                              <button
                                onClick={() => handleRevokeBan(item.account_id)}
                                className="px-2.5 py-1 text-xs text-slate-300 hover:text-white bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded transition-colors whitespace-nowrap shrink-0"
                              >
                                解除
                              </button>
                            ) : (
                              <button
                                onClick={() => {
                                  setNewBanAccountId(item.account_id);
                                  setNewBanName(item.name || '');
                                  setShowAddModal(true);
                                }}
                                className="px-2.5 py-1 text-xs text-rose-400 hover:text-rose-300 bg-rose-950/40 hover:bg-rose-900/50 border border-rose-800/50 rounded transition-colors whitespace-nowrap shrink-0"
                              >
                                再登録
                              </button>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Quick Command Guide Banner */}
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 text-xs text-slate-400 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <Terminal className="w-4 h-4 text-rose-400 shrink-0" />
                <span className="text-slate-300 font-medium">管理者専用コマンド:</span>
                <code className="text-white bg-slate-900 px-2 py-0.5 rounded font-mono border border-slate-800">
                  /blacklist &lt;ID&gt; [理由]
                </code>
                <span className="text-slate-400">で登録 ·</span>
                <code className="text-emerald-300 bg-slate-900 px-2 py-0.5 rounded font-mono border border-slate-800">
                  /del-blacklist &lt;ID&gt;
                </code>
                <span className="text-slate-400">で解除 ·</span>
                <code className="text-purple-300 bg-slate-900 px-2 py-0.5 rounded font-mono border border-slate-800">
                  /flush
                </code>
                <span className="text-slate-400">で「a」50件流し</span>
              </div>
              <div className="text-slate-400 flex flex-wrap items-center gap-2">
                <span className="text-indigo-400 font-medium">全ルーム連動:</span>
                <span>Bot参加の全グループで自動BAN・絵文字ガードが作動</span>
              </div>
            </div>
          </div>
        )}

        {/* ------------------------------------------------------------- */}
        {/* TAB 2: ルーム監視 & メンバー (Room Scanner & Members)          */}
        {/* ------------------------------------------------------------- */}
        {activeTab === 'rooms' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Rooms List */}
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  <Users className="w-4 h-4 text-rose-400" />
                  <span>監視ルーム一覧</span>
                </h3>
                <span className="text-xs text-slate-400 font-mono tabular-nums">{rooms.length} ルーム</span>
              </div>

              <div className="space-y-2">
                {rooms.map((room) => {
                  const isSelected = selectedRoomId === room.room_id;
                  return (
                    <button
                      key={room.room_id}
                      onClick={() => setSelectedRoomId(room.room_id)}
                      className={`w-full text-left p-3 rounded-lg border transition-all ${
                        isSelected
                          ? 'bg-rose-950/30 border-rose-500/50 text-white'
                          : 'bg-slate-900/50 border-slate-800/80 hover:bg-slate-900 text-slate-300'
                      }`}
                    >
                      <div className="font-semibold text-xs truncate">{room.name}</div>
                      <div className="mt-1 flex items-center justify-between text-[11px] text-slate-400 font-mono">
                        <span>Room ID: {room.room_id}</span>
                        <span>{room.role === 'admin' ? '管理者権限' : 'メンバー'}</span>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="pt-2 border-t border-slate-800 text-xs text-slate-400 space-y-2">
                <p>
                  ※
                  Chatwork側でBotが管理者(Admin)として招待されているグループチャットにおいて、退室APIを実行できます。
                </p>
              </div>
            </div>

            {/* Room Members Table */}
            <div className="lg:col-span-2 bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-white">
                    在室メンバー ({members.length} 名)
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    選択中のルーム: #{selectedRoomId}
                  </p>
                </div>
                <button
                  onClick={() => selectedRoomId && fetchMembers(selectedRoomId)}
                  disabled={isLoading}
                  className="px-2.5 py-1 text-xs text-slate-300 hover:text-white bg-slate-900 border border-slate-700 rounded-lg flex items-center gap-1.5"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                  <span>更新</span>
                </button>
              </div>

              <div className="border border-slate-800 rounded-lg overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-900/50 text-slate-400">
                      <th className="py-2.5 px-3">メンバー</th>
                      <th className="py-2.5 px-3">権限</th>
                      <th className="py-2.5 px-3">ブラックリスト状態</th>
                      <th className="py-2.5 px-3 text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-sans">
                    {members.map((member) => (
                      <tr key={member.account_id} className="hover:bg-slate-900/40">
                        <td className="py-2.5 px-3">
                          <div className="flex items-center gap-2">
                            {member.avatar_image_url ? (
                              <img
                                src={member.avatar_image_url}
                                alt={member.name}
                                className="w-6 h-6 rounded-full bg-slate-800"
                              />
                            ) : (
                              <div className="w-6 h-6 rounded-full bg-slate-800 text-slate-400 flex items-center justify-center font-mono text-[10px]">
                                {member.name.charAt(0)}
                              </div>
                            )}
                            <div>
                              <div className="font-semibold text-white">{member.name}</div>
                              <div className="text-[10px] text-slate-400 font-mono">
                                ID: {member.account_id}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-slate-400 font-mono">
                          {member.role === 'admin' ? (
                            <span className="text-amber-400 font-semibold">管理者</span>
                          ) : member.role === 'readonly' ? (
                            <span>閲覧のみ</span>
                          ) : (
                            <span>メンバー</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3">
                          {member.isBlacklisted ? (
                            <span className="inline-flex items-center gap-1 text-rose-400 font-semibold">
                              <ShieldAlert className="w-3.5 h-3.5" />
                              <span>該当（即時BAN対象）</span>
                            </span>
                          ) : (
                            <span className="text-slate-400">未登録</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <button
                            onClick={() => handleKickMember(member.account_id, member.name)}
                            disabled={member.role === 'admin' && members.filter((m) => m.role === 'admin').length <= 1}
                            className="px-2.5 py-1 text-xs text-rose-400 hover:text-white hover:bg-rose-600 bg-rose-950/30 border border-rose-800/60 rounded transition-colors disabled:opacity-30 whitespace-nowrap"
                          >
                            BAN & 強制退室
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ------------------------------------------------------------- */}
        {/* TAB 3: 監査ログ (Audit Log)                                   */}
        {/* ------------------------------------------------------------- */}
        {activeTab === 'logs' && (
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-white">BAN執行 & 拒否監査ログ</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  すべての /blacklist コマンド実行、自動退室、再参加ブロックの記録
                </p>
              </div>
              <button
                onClick={fetchLogs}
                className="px-2.5 py-1 text-xs text-slate-300 hover:text-white bg-slate-900 border border-slate-700 rounded-lg flex items-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>最新ログ取得</span>
              </button>
            </div>

            <div className="space-y-2">
              {logs.length === 0 ? (
                <div className="text-center py-8 text-xs text-slate-400">まだログはありません。</div>
              ) : (
                logs.map((log) => {
                  const isReject = log.action === 'AUTO_REJECT_REENTRY' || log.action === 'AUTO_KICK_JOIN';
                  return (
                    <div
                      key={log.id}
                      className="p-3 bg-slate-900/60 border border-slate-800/80 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold ${
                              isReject
                                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                            }`}
                          >
                            {log.action}
                          </span>
                          <span className="font-semibold text-white">
                            対象: {log.user_name || `ID #${log.account_id}`}
                          </span>
                          <span className="text-slate-400 font-mono">
                            {log.room_id === 'GLOBAL' ? 'GLOBAL' : `Room #${log.room_id}`}
                          </span>
                        </div>
                        <p className="text-slate-300">{log.details}</p>
                      </div>

                      <div className="text-right text-[11px] font-mono text-slate-400 whitespace-nowrap shrink-0">
                        {new Date(log.timestamp).toLocaleString('ja-JP')}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* ------------------------------------------------------------- */}
        {/* TAB 4: 動作シミュレーター (Interactive Test Workbench)          */}
        {/* ------------------------------------------------------------- */}
        {activeTab === 'simulator' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Command Simulation Box */}
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-5 space-y-4">
              <div className="flex items-center gap-2 text-white font-semibold text-sm">
                <Terminal className="w-4 h-4 text-rose-400" />
                <span>1. /blacklist コマンド送信シミュレーション</span>
              </div>
              <p className="text-xs text-slate-400">
                ChatworkチャットからBot宛にコマンドが送られた場合の挙動（Webhook受信 → 解析 → BAN登録 → 退室API実行 → 返信投稿）をシミュレートします。
              </p>

              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      送信者の権限 (管理者検証用)
                    </label>
                    <select
                      value={simSenderId}
                      onChange={(e) => setSimSenderId(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-white"
                    >
                      <option value="111111">👑 管理者 (Admin / ID: 111111)</option>
                      <option value="222222">👤 一般メンバー (Member / ID: 222222) - 拒否テスト</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      送信先ルーム
                    </label>
                    <select
                      value={simRoomId}
                      onChange={(e) => setSimRoomId(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-white"
                    >
                      {rooms.map((r) => (
                        <option key={r.room_id} value={r.room_id}>
                          {r.name} (#{r.room_id})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    チャットメッセージ本文 (コマンド)
                  </label>
                  <input
                    type="text"
                    value={simCommand}
                    onChange={(e) => setSimCommand(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-white font-mono"
                    placeholder="/blacklist 1234567 理由"
                  />
                  <div className="flex flex-wrap items-center gap-2 mt-1.5 text-[11px] text-slate-400">
                    <span>クイック入力:</span>
                    <button
                      onClick={() => setSimCommand('/blacklist 7788990 宣伝スパム行為')}
                      className="text-rose-400 hover:underline"
                    >
                      /blacklist 7788990
                    </button>
                    <span>·</span>
                    <button
                      onClick={() => setSimCommand('/del-blacklist 9988123')}
                      className="text-emerald-400 hover:underline font-semibold"
                    >
                      /del-blacklist 9988123
                    </button>
                    <span>·</span>
                    <button
                      onClick={() => setSimCommand('/blacklist list')}
                      className="text-slate-300 hover:underline"
                    >
                      /blacklist list
                    </button>
                    <span>·</span>
                    <button
                      onClick={() => setSimCommand('/status')}
                      className="text-slate-300 hover:underline"
                    >
                      /status
                    </button>
                  </div>
                </div>

                <button
                  onClick={() => handleRunSimulator('command')}
                  disabled={simLoading}
                  className="w-full py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>コマンドを実行・シミュレート</span>
                </button>
              </div>
            </div>

            {/* Re-entry Simulation Box */}
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-5 space-y-4">
              <div className="flex items-center gap-2 text-white font-semibold text-sm">
                <ShieldAlert className="w-4 h-4 text-amber-400" />
                <span>2. ブラックリストユーザーの再入室・自動BANシミュレーション</span>
              </div>
              <p className="text-xs text-slate-400">
                一度退室させたユーザーが再度ルームに参加を試みたケースをシミュレートします。Botが即時検知し、自動で強制退室させ再参加を拒否するフローを検証できます。
              </p>

              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      試行ユーザーID
                    </label>
                    <input
                      type="text"
                      value={simTargetId}
                      onChange={(e) => setSimTargetId(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      表示名
                    </label>
                    <input
                      type="text"
                      value={simTargetName}
                      onChange={(e) => setSimTargetName(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-white"
                    />
                  </div>
                </div>

                <div className="p-3 bg-slate-900/80 border border-slate-800 rounded-lg text-xs space-y-1.5">
                  <div className="text-slate-300 font-semibold">自動検知ガードの動作プロセス:</div>
                  <ol className="list-decimal list-inside text-slate-400 space-y-0.5 text-[11px]">
                    <li>ユーザーがルームに参加（リンク参加 or 招待）</li>
                    <li>Botがメンバー一覧を照合し、ブラックリスト該当を瞬時に特定</li>
                    <li>PUT /rooms/{'{id}'}/members により即時強制退室(BAN)</li>
                    <li>再参加拒否回数をインクリメントし、監査ログを記録</li>
                  </ol>
                </div>

                <button
                  onClick={() => handleRunSimulator('reentry')}
                  disabled={simLoading}
                  className="w-full py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <ShieldAlert className="w-3.5 h-3.5" />
                  <span>再入室を試行させて自動BANを発動</span>
                </button>
              </div>
            </div>

            {/* Emoji Spam Simulation Box */}
            <div className="lg:col-span-2 bg-slate-950 border border-slate-800 rounded-xl p-5 space-y-4">
              <div className="flex items-center gap-2 text-white font-semibold text-sm">
                <AlertCircle className="w-4 h-4 text-purple-400" />
                <span>3. 絵文字5連投検知 → 閲覧のみ(readonly)制限 & メッセージ「a」50件流し (自動停止)</span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Chatwork絵文字 <code>(bow)(bow)(bow)(bow)(bow)</code> やUnicode絵文字が5個以上連続で投稿された際、画面が重延・硬直するのを防ぐため、Botが権限を【閲覧のみ (Read Only)】に変更した上で、<strong>メッセージ「a」だけを50件打って重延絵文字を画面外へ押し流し、50件で自動停止</strong>します。
              </p>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 p-3 bg-slate-900/60 border border-slate-800 rounded-lg">
                <div className="text-xs space-y-1">
                  <div className="text-slate-300 font-mono flex items-center gap-2">
                    <span className="text-slate-400">送信サンプル:</span>
                    <span className="text-purple-300 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                      (bow)(bow)(bow)(bow)(bow) 絵文字5連続テスト
                    </span>
                  </div>
                  <div className="text-slate-400 text-[11px]">
                    対象: 参加メンバー (ID: {simTargetId}) / ルーム: #{simRoomId} (権限降格後、メッセージ「a」×50件送信 → 停止)
                  </div>
                </div>

                <button
                  onClick={() => handleRunSimulator('emoji_spam')}
                  disabled={simLoading}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-2 shrink-0 disabled:opacity-50"
                >
                  <AlertCircle className="w-3.5 h-3.5" />
                  <span>絵文字5連投送信 → 閲覧のみ降格 & 「a」50件流しを実行</span>
                </button>
              </div>
            </div>

            {/* Simulation Results Display */}
            {simResponse && (
              <div className="lg:col-span-2 bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-emerald-400 flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4" />
                    シミュレーション実行完了レスポンス
                  </span>
                  <span className="text-slate-400 font-mono">Status: 200 OK</span>
                </div>
                <pre className="p-3 bg-slate-900 rounded-lg text-slate-300 font-mono text-xs overflow-x-auto whitespace-pre-wrap">
                  {JSON.stringify(simResponse, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}

        {/* ------------------------------------------------------------- */}
        {/* TAB 5: Render デプロイガイド (Render Setup & Blueprint)         */}
        {/* ------------------------------------------------------------- */}
        {activeTab === 'render' && (
          <div className="space-y-6">
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                    <Cloud className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white">
                      Render へのデプロイ手順 & 設定ガイド
                    </h3>
                    <p className="text-xs text-slate-400">
                      Chatwork Guardian Bot を Render に無料/本番配備する完全ステップ
                    </p>
                  </div>
                </div>
                <a
                  href="https://dashboard.render.com"
                  target="_blank"
                  rel="noreferrer"
                  className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-medium"
                >
                  <span>Render ダッシュボードを開く</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>

              {/* Step 1 to 4 Accordion/Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                <div className="p-4 bg-slate-900/60 border border-slate-800 rounded-lg space-y-2">
                  <div className="text-xs font-semibold text-indigo-400">STEP 1</div>
                  <h4 className="text-sm font-bold text-white">GitHub リポジトリの準備</h4>
                  <p className="text-xs text-slate-300">
                    プロジェクトファイル一式（<code>render.yaml</code>, <code>server.ts</code>, <code>package.json</code> など）をご自身の GitHub リポジトリにプッシュします。
                  </p>
                </div>

                <div className="p-4 bg-slate-900/60 border border-slate-800 rounded-lg space-y-2">
                  <div className="text-xs font-semibold text-indigo-400">STEP 2</div>
                  <h4 className="text-sm font-bold text-white">Render Blueprint による作成</h4>
                  <p className="text-xs text-slate-300">
                    Render ダッシュボードで <strong>New +</strong> → <strong>Blueprint</strong> を選択し、リポジトリを指定すると <code>render.yaml</code> を読み込んで Web Service と PostgreSQL が自動構築されます。
                  </p>
                </div>

                <div className="p-4 bg-slate-900/60 border border-slate-800 rounded-lg space-y-2">
                  <div className="text-xs font-semibold text-indigo-400">STEP 3</div>
                  <h4 className="text-sm font-bold text-white">環境変数 (Environment) の設定</h4>
                  <p className="text-xs text-slate-300">
                    Render の <strong>Environment</strong> タブで以下の秘密鍵を登録します:
                  </p>
                  <ul className="text-xs text-slate-400 space-y-1 font-mono">
                    <li>• CHATWORK_API_TOKEN : APIトークン</li>
                    <li>• CHATWORK_WEBHOOK_TOKEN : Webhook署名鍵</li>
                    <li>• DATABASE_URL : Render PGなら自動注入</li>
                  </ul>
                </div>

                <div className="p-4 bg-slate-900/60 border border-slate-800 rounded-lg space-y-2">
                  <div className="text-xs font-semibold text-indigo-400">STEP 4</div>
                  <h4 className="text-sm font-bold text-white">Chatwork Webhook の登録</h4>
                  <p className="text-xs text-slate-300">
                    Chatwork 管理画面の「サービス連携」→「Webhook」にて、Render から付与されたURLを登録します。
                  </p>
                </div>
              </div>
            </div>

            {/* Copyable Webhook URL and Blueprint */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Webhook Endpoint Box */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3">
                <h4 className="text-xs font-semibold text-white flex items-center justify-between">
                  <span>Chatwork Webhook 登録用 URL</span>
                  <span className="text-slate-400 font-mono">POST</span>
                </h4>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={webhookUrl}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-slate-300 select-all"
                  />
                  <button
                    onClick={() => handleCopy(webhookUrl, 'webhook-url')}
                    className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-medium shrink-0 flex items-center gap-1.5"
                  >
                    {copiedText === 'webhook-url' ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    <span>コピー</span>
                  </button>
                </div>
                <div className="text-[11px] text-slate-400 space-y-1">
                  <p>※ Render にデプロイした後は、上記ドメイン部を <code>https://&lt;your-app&gt;.onrender.com/api/chatwork/webhook</code> に置き換えてください。</p>
                  <p>※ Webhook イベントは「<strong>メッセージ作成</strong> (message_created)」にチェックを入れてください。</p>
                </div>
              </div>

              {/* Database Persistence Box */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3">
                <h4 className="text-xs font-semibold text-white flex items-center justify-between">
                  <span>データベース永続化の仕組み</span>
                  <Database className="w-4 h-4 text-emerald-400" />
                </h4>
                <div className="text-xs text-slate-300 space-y-2">
                  <p>
                    Render の環境変数 <code>DATABASE_URL</code> が検出されると、自動的に PostgreSQL モードへ切り替わります（テーブル作成・インデックス・接続プールが自動実行されます）。
                  </p>
                  <p className="text-slate-400 text-[11px]">
                    Render PostgreSQL の無料枠や Render Persistent Disk、あるいはローカル実行環境（<code>data/blacklist_db.json</code>）のいずれでも透過的にデータが永続化されます。
                  </p>
                </div>
              </div>
            </div>

            {/* render.yaml preview */}
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold text-white flex items-center gap-2">
                  <span>render.yaml (Render Blueprint 構成ファイル)</span>
                </h4>
                <button
                  onClick={() =>
                    handleCopy(
                      `services:
  - type: web
    name: chatwork-guardian-bot
    env: node
    plan: free
    region: singapore
    buildCommand: npm install && npm run build
    startCommand: npm run start
    healthCheckPath: /api/status
    envVars:
      - key: NODE_ENV
        value: production
      - key: PORT
        value: 10000
      - key: CHATWORK_API_TOKEN
        sync: false
      - key: CHATWORK_WEBHOOK_TOKEN
        sync: false
      - key: AUTO_KICK_ENABLED
        value: "true"
      - key: AUTO_REJECT_ENABLED
        value: "true"
      - key: DATABASE_URL
        fromDatabase:
          name: chatwork-guardian-db
          property: connectionString

databases:
  - name: chatwork-guardian-db
    plan: free
    region: singapore
    databaseName: chatwork_bot
    user: bot_user`,
                      'yaml-copy'
                    )
                  }
                  className="px-2.5 py-1 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded flex items-center gap-1.5"
                >
                  {copiedText === 'yaml-copy' ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  <span>設定内容をコピー</span>
                </button>
              </div>

              <pre className="p-3 bg-slate-900 border border-slate-800 rounded-lg text-xs font-mono text-slate-300 overflow-x-auto">
{`services:
  - type: web
    name: chatwork-guardian-bot
    env: node
    plan: free
    region: singapore
    buildCommand: npm install && npm run build
    startCommand: npm run start
    healthCheckPath: /api/status
    envVars:
      - key: NODE_ENV
        value: production
      - key: PORT
        value: 10000
      - key: CHATWORK_API_TOKEN
        sync: false # Renderダッシュボードで設定
      - key: CHATWORK_WEBHOOK_TOKEN
        sync: false # Renderダッシュボードで設定
      - key: AUTO_KICK_ENABLED
        value: "true"
      - key: AUTO_REJECT_ENABLED
        value: "true"
      - key: DATABASE_URL
        fromDatabase:
          name: chatwork-guardian-db
          property: connectionString

databases:
  - name: chatwork-guardian-db
    plan: free
    region: singapore
    databaseName: chatwork_bot
    user: bot_user`}
              </pre>
            </div>

            {/* Manual Web Service Setup & Free Tier Sleep Prevention */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Manual Web Service Guide */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-5 space-y-3">
                <h4 className="text-xs font-semibold text-white flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-indigo-400" />
                  <span>手動で Web Service を作成する場合の設定値</span>
                </h4>
                <div className="text-xs text-slate-300 space-y-2">
                  <p>Blueprintを使わず、手動でRenderの <strong>New +</strong> → <strong>Web Service</strong> から作成する場合は、以下の値を入力します：</p>
                  <table className="w-full text-left font-mono text-[11px] border border-slate-800 rounded overflow-hidden">
                    <tbody className="divide-y divide-slate-800">
                      <tr className="bg-slate-900/40">
                        <td className="py-1.5 px-2 text-slate-400">Runtime</td>
                        <td className="py-1.5 px-2 text-white font-semibold">Docker (推奨) または Node</td>
                      </tr>
                      <tr>
                        <td className="py-1.5 px-2 text-slate-400">Region</td>
                        <td className="py-1.5 px-2 text-white">Singapore (おすすめ)</td>
                      </tr>
                      <tr className="bg-slate-900/40">
                        <td className="py-1.5 px-2 text-slate-400">Dockerfile Path</td>
                        <td className="py-1.5 px-2 text-emerald-300">./Dockerfile (自動検出)</td>
                      </tr>
                      <tr>
                        <td className="py-1.5 px-2 text-slate-400">Health Check Path</td>
                        <td className="py-1.5 px-2 text-white">/api/status</td>
                      </tr>
                      <tr className="bg-slate-900/40">
                        <td className="py-1.5 px-2 text-slate-400">Plan</td>
                        <td className="py-1.5 px-2 text-white">Free</td>
                      </tr>
                    </tbody>
                  </table>
                  <div className="pt-2 text-[11px] text-slate-400 space-y-1">
                    <p className="font-semibold text-slate-300">🐳 ローカルでの Docker 実行コマンド:</p>
                    <pre className="p-2 bg-slate-900 rounded font-mono text-[10px] text-emerald-300 overflow-x-auto">
{`# 1. 単体コンテナで起動
docker build -t chatwork-guardian-bot .
docker run -d -p 3000:3000 -v $(pwd)/data:/app/data --env-file .env chatwork-guardian-bot

# 2. docker-compose (PostgreSQL同梱) で起動
docker compose up -d`}
                    </pre>
                  </div>
                </div>
              </div>

              {/* Free Tier Sleep Prevention */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-5 space-y-3">
                <h4 className="text-xs font-semibold text-white flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  <span>Render 無料プランのスリープ防止対策（常時稼働）</span>
                </h4>
                <div className="text-xs text-slate-300 space-y-2 leading-relaxed">
                  <p>
                    Renderの無料枠（Free Web Service）は、15分間外部からのリクエストがないとインスタンスが<strong>自動スリープ（一時停止）</strong>し、次のリクエスト復帰に約50秒の待機時間が発生します。
                  </p>
                  <div className="p-3 bg-slate-900/80 border border-slate-800 rounded-lg space-y-1.5 text-[11px]">
                    <span className="font-semibold text-emerald-400">💡 24時間常時稼働させる無料テクニック:</span>
                    <ol className="list-decimal list-inside text-slate-300 space-y-1">
                      <li>無料の外部監視サービス（<strong>UptimeRobot</strong> または <strong>cron-job.org</strong>）に無料登録</li>
                      <li>URLに <code className="text-emerald-300">https://&lt;サービス名&gt;.onrender.com/api/status</code> を指定</li>
                      <li>監視間隔を「<strong>5分おき</strong>」に設定してHTTP GETリクエストを定期送信</li>
                    </ol>
                    <p className="text-slate-400 text-[10px] pt-1">
                      これによりRenderがスリープせず、Chatworkで荒らしや絵文字連投が発生した際に即時自動BAN・退室処理が実行されます。
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* ------------------------------------------------------------- */}
      {/* Modal: 新規BAN登録 (Add Ban Modal)                            */}
      {/* ------------------------------------------------------------- */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-slate-950 border border-slate-800 rounded-xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <UserX className="w-5 h-5 text-rose-500" />
                <span>ブラックリスト新規登録 & 強制退室</span>
              </h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            {banFormError && (
              <div className="p-2.5 bg-rose-950/40 border border-rose-800/60 rounded text-xs text-rose-300">
                {banFormError}
              </div>
            )}

            {banFormSuccess && (
              <div className="p-2.5 bg-emerald-950/40 border border-emerald-800/60 rounded text-xs text-emerald-300">
                {banFormSuccess}
              </div>
            )}

            <form onSubmit={handleCreateBan} className="space-y-4 text-xs">
              <div>
                <label className="block font-medium text-slate-300 mb-1">
                  Chatwork ユーザーID (必須・数字)
                </label>
                <input
                  type="text"
                  required
                  placeholder="例: 1234567"
                  value={newBanAccountId}
                  onChange={(e) => setNewBanAccountId(e.target.value.replace(/[^0-9]/g, ''))}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-white font-mono focus:border-rose-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-300 mb-1">
                  対象者のお名前 (任意)
                </label>
                <input
                  type="text"
                  placeholder="例: 迷惑アカウント山田"
                  value={newBanName}
                  onChange={(e) => setNewBanName(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-white focus:border-rose-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-300 mb-1">
                  登録・BAN理由
                </label>
                <input
                  type="text"
                  value={newBanReason}
                  onChange={(e) => setNewBanReason(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-white focus:border-rose-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-300 mb-1">
                  対象ルーム
                </label>
                <select
                  value={newBanRoomId}
                  onChange={(e) => setNewBanRoomId(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-white"
                >
                  <option value="GLOBAL">全ルーム共通 (GLOBAL)</option>
                  {rooms.map((r) => (
                    <option key={r.room_id} value={r.room_id}>
                      {r.name} (#{r.room_id})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="kickNowCheckbox"
                  checked={newBanKickNow}
                  onChange={(e) => setNewBanKickNow(e.target.checked)}
                  className="rounded border-slate-800 text-rose-600 focus:ring-0"
                />
                <label htmlFor="kickNowCheckbox" className="text-slate-300 cursor-pointer">
                  対象者が現在ルームに在室中の場合は即座に強制退室させる
                </label>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-slate-300 rounded-lg"
                >
                  キャンセル
                </button>
                <button
                  type="submit"
                  disabled={isLoading}
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-lg font-semibold"
                >
                  {isLoading ? '処理中...' : 'ブラックリスト登録 & 実行'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* Modal: 設定 (Settings Modal)                                  */}
      {/* ------------------------------------------------------------- */}
      {showConfigModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-slate-950 border border-slate-800 rounded-xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Settings className="w-5 h-5 text-slate-400" />
                <span>Bot & セキュリティ設定</span>
              </h3>
              <button
                onClick={() => setShowConfigModal(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            {configSaveSuccess && (
              <div className="p-2.5 bg-emerald-950/40 border border-emerald-800/60 rounded text-xs text-emerald-300">
                設定を保存しました。
              </div>
            )}

            <form onSubmit={handleSaveConfig} className="space-y-4 text-xs">
              <div>
                <label className="block font-medium text-slate-300 mb-1">
                  Chatwork APIトークン
                </label>
                <input
                  type="password"
                  placeholder={config?.hasApiToken ? '設定済 (変更する場合のみ入力)' : 'Chatwork APIトークンを入力'}
                  value={editApiToken}
                  onChange={(e) => setEditApiToken(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-white font-mono focus:border-rose-500 focus:outline-none"
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  Chatwork 個人設定 → API設定 から発行できる API Token です。
                </p>
              </div>

              <div>
                <label className="block font-medium text-slate-300 mb-1">
                  Webhook署名トークン (Signature Secret)
                </label>
                <input
                  type="password"
                  placeholder={config?.hasWebhookToken ? '設定済 (変更する場合のみ入力)' : 'Chatwork Webhook発行トークン'}
                  value={editWebhookToken}
                  onChange={(e) => setEditWebhookToken(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-white font-mono focus:border-rose-500 focus:outline-none"
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  Chatwork Webhook設定時に発行されるHMAC検証キーです。空欄の場合は署名検証をスキップします。
                </p>
              </div>

              <div className="p-3 bg-slate-900/60 border border-slate-800 rounded-lg space-y-3">
                <div className="font-semibold text-slate-200">セキュリティ自動ガード設定</div>

                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-slate-300">自動強制退室 (Auto-Kick)</div>
                    <div className="text-[11px] text-slate-400">
                      /blacklist コマンド時やブラックリスト該当者を検知した瞬間に退室させます
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={editAutoKick}
                    onChange={(e) => setEditAutoKick(e.target.checked)}
                    className="rounded border-slate-800 text-rose-600 focus:ring-0"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-slate-300">再参加自動拒否 (Auto-Reject)</div>
                    <div className="text-[11px] text-slate-400">
                      退室後ユーザーが再度入室を試みた際、自動で検知して即座に強制退室させます
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={editAutoReject}
                    onChange={(e) => setEditAutoReject(e.target.checked)}
                    className="rounded border-slate-800 text-rose-600 focus:ring-0"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-slate-300">チャットルームへ通知投稿</div>
                    <div className="text-[11px] text-slate-400">
                      BANや再参加拒否が執行された際、ルームへ [info] 通知を投稿します
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={editNotifyInChat}
                    onChange={(e) => setEditNotifyInChat(e.target.checked)}
                    className="rounded border-slate-800 text-rose-600 focus:ring-0"
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-300 mb-1">
                  定期監視スキャン間隔 (秒)
                </label>
                <input
                  type="number"
                  min="10"
                  max="300"
                  value={editInterval}
                  onChange={(e) => setEditInterval(Number(e.target.value))}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-white font-mono"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowConfigModal(false)}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-slate-300 rounded-lg"
                >
                  キャンセル
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-lg font-semibold"
                >
                  設定を保存
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* Quiet Footer                                                  */}
      {/* ------------------------------------------------------------- */}
      <footer className="border-t border-slate-800/80 bg-slate-950 py-4 px-6 text-xs text-slate-400 flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span>Chatwork Guardian Bot</span>
          <span aria-hidden="true">·</span>
          <span>Render & PostgreSQL Ready</span>
        </div>
        <div className="flex items-center gap-4 text-slate-400">
          <span>API: /api/chatwork/webhook</span>
          <span aria-hidden="true">·</span>
          <span>Port 3000</span>
        </div>
      </footer>
    </div>
  );
}
