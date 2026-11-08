import crypto from 'node:crypto';

export interface ChatworkUser {
  account_id: number;
  role: 'admin' | 'member' | 'readonly';
  name: string;
  chatwork_id: string;
  organization_id?: number;
  organization_name?: string;
  department?: string;
  avatar_image_url?: string;
}

export interface ChatworkRoom {
  room_id: number;
  name: string;
  type: string;
  role: string;
  sticky: boolean;
  unread_num: number;
  mention_num: number;
  mytask_num: number;
  message_num: number;
  file_num: number;
  task_num: number;
  icon_path: string;
  last_update_time: number;
}

export interface ChatworkWebhookPayload {
  webhook_setting_id?: string;
  webhook_event_type: 'message_created' | 'message_updated' | 'mention_to_me';
  webhook_event_time?: number;
  webhook_event: {
    message_id: string;
    room_id: number;
    account_id: number;
    body: string;
    send_time: number;
    update_time: number;
  };
}

// In-memory simulation store for demonstration when no token is present
let mockRooms: ChatworkRoom[] = [
  {
    room_id: 10001,
    name: 'プロジェクト開発・公開ラウンジ (メイン監視)',
    type: 'group',
    role: 'admin',
    sticky: true,
    unread_num: 0,
    mention_num: 0,
    mytask_num: 0,
    message_num: 420,
    file_num: 15,
    task_num: 2,
    icon_path: 'https://appdata.chatwork.com/icon/ico_group.png',
    last_update_time: Math.floor(Date.now() / 1000),
  },
  {
    room_id: 10002,
    name: '一般サポート・質問受付ルーム',
    type: 'group',
    role: 'admin',
    sticky: false,
    unread_num: 2,
    mention_num: 0,
    mytask_num: 0,
    message_num: 150,
    file_num: 4,
    task_num: 0,
    icon_path: 'https://appdata.chatwork.com/icon/ico_group.png',
    last_update_time: Math.floor(Date.now() / 1000) - 3600,
  },
];

let mockMembers: Record<number, ChatworkUser[]> = {
  10001: [
    {
      account_id: 111111,
      role: 'admin',
      name: 'システム管理者 (Bot実行者)',
      chatwork_id: 'sysadmin',
      avatar_image_url: 'https://avatar.vercel.sh/sysadmin.svg?text=SA',
    },
    {
      account_id: 222222,
      role: 'member',
      name: '一般参加メンバー A',
      chatwork_id: 'member_a',
      avatar_image_url: 'https://avatar.vercel.sh/member_a.svg?text=MA',
    },
    {
      account_id: 333333,
      role: 'member',
      name: '一般参加メンバー B',
      chatwork_id: 'member_b',
      avatar_image_url: 'https://avatar.vercel.sh/member_b.svg?text=MB',
    },
  ],
  10002: [
    {
      account_id: 111111,
      role: 'admin',
      name: 'システム管理者 (Bot実行者)',
      chatwork_id: 'sysadmin',
      avatar_image_url: 'https://avatar.vercel.sh/sysadmin.svg?text=SA',
    },
    {
      account_id: 444444,
      role: 'member',
      name: 'サポート利用者 C',
      chatwork_id: 'user_c',
      avatar_image_url: 'https://avatar.vercel.sh/user_c.svg?text=UC',
    },
  ],
};

export class ChatworkClient {
  private apiToken: string;

  constructor(apiToken?: string) {
    this.apiToken = (apiToken || process.env.CHATWORK_API_TOKEN || '').trim();
  }

  isConfigured(): boolean {
    return Boolean(this.apiToken && this.apiToken.length > 5);
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `https://api.chatwork.com/v2${endpoint}`;
    const headers: Record<string, string> = {
      'X-ChatWorkToken': this.apiToken,
      ...(options.headers as Record<string, string> || {}),
    };

    const res = await fetch(url, {
      ...options,
      headers,
    });

    if (!res.ok) {
      const errText = await res.text();
      let parsedErr: any = errText;
      try {
        parsedErr = JSON.parse(errText);
      } catch {
        // no-op
      }
      const message = parsedErr?.errors?.[0] || parsedErr?.message || errText || `Chatwork API Error: ${res.status}`;
      throw new Error(message);
    }

    return res.json() as Promise<T>;
  }

  async getMe(): Promise<{ account_id: number; name: string; chatwork_id: string } | null> {
    if (!this.isConfigured()) {
      return {
        account_id: 111111,
        name: 'Chatwork Guardian Bot (Simulated)',
        chatwork_id: 'guardian_bot',
      };
    }
    return this.request('/me');
  }

  async getRooms(): Promise<ChatworkRoom[]> {
    if (!this.isConfigured()) {
      return mockRooms;
    }
    return this.request<ChatworkRoom[]>('/rooms');
  }

  async getRoomMembers(roomId: number | string): Promise<ChatworkUser[]> {
    const rid = Number(roomId);
    if (!this.isConfigured()) {
      return mockMembers[rid] || [];
    }
    return this.request<ChatworkUser[]>(`/rooms/${rid}/members`);
  }

  /**
   * Kicks a user from the specified Chatwork room.
   * Chatwork API v2 kicking mechanism:
   * To remove a user, call PUT /v2/rooms/{room_id}/members omitting their account_id
   * from admin_ids, member_ids, and readonly_ids.
   */
  async kickMember(
    roomId: number | string,
    targetAccountId: number | string
  ): Promise<{ wasPresent: boolean; success: boolean; user?: ChatworkUser; message: string }> {
    const rid = Number(roomId);
    const tid = Number(targetAccountId);

    if (!this.isConfigured()) {
      const currentList = mockMembers[rid] || [];
      const foundIdx = currentList.findIndex((m) => m.account_id === tid);
      if (foundIdx === -1) {
        return {
          wasPresent: false,
          success: true,
          message: `ユーザー ID ${tid} はルーム #${rid} に在室していません。`,
        };
      }
      const removedUser = currentList[foundIdx];
      // Cannot kick sole admin
      const admins = currentList.filter((m) => m.role === 'admin' && m.account_id !== tid);
      if (removedUser.role === 'admin' && admins.length === 0) {
        return {
          wasPresent: true,
          success: false,
          user: removedUser,
          message: '唯一の管理者ユーザーは退室させることができません。',
        };
      }
      mockMembers[rid] = currentList.filter((m) => m.account_id !== tid);
      return {
        wasPresent: true,
        success: true,
        user: removedUser,
        message: `ユーザー「${removedUser.name}」(ID: ${tid}) をルームから強制退室させました。`,
      };
    }

    // Live API Execution
    const members = await this.getRoomMembers(rid);
    const targetMember = members.find((m) => m.account_id === tid);

    if (!targetMember) {
      return {
        wasPresent: false,
        success: true,
        message: `ユーザー ID ${tid} はルーム #${rid} に在室していません。`,
      };
    }

    // Reconstruct lists excluding target
    const adminIds = members.filter((m) => m.role === 'admin' && m.account_id !== tid).map((m) => m.account_id);
    const memberIds = members.filter((m) => m.role === 'member' && m.account_id !== tid).map((m) => m.account_id);
    const readonlyIds = members.filter((m) => m.role === 'readonly' && m.account_id !== tid).map((m) => m.account_id);

    if (adminIds.length === 0) {
      throw new Error('管理者権限を持つユーザーが0人になるため退室できません。最低1人の管理者を残す必要があります。');
    }

    const params = new URLSearchParams();
    params.set('admin_ids', adminIds.join(','));
    if (memberIds.length > 0) {
      params.set('member_ids', memberIds.join(','));
    }
    if (readonlyIds.length > 0) {
      params.set('readonly_ids', readonlyIds.join(','));
    }

    await this.request(`/rooms/${rid}/members`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    return {
      wasPresent: true,
      success: true,
      user: targetMember,
      message: `ユーザー「${targetMember.name}」(ID: ${tid}) をルームから強制退室させました。`,
    };
  }

  async sendMessage(roomId: number | string, messageText: string): Promise<{ message_id: string }> {
    const rid = Number(roomId);
    if (!this.isConfigured()) {
      console.log(`[SIMULATED CHATWORK MESSAGE to Room #${rid}]:\n${messageText}`);
      return { message_id: `msg_mock_${Date.now()}` };
    }

    const params = new URLSearchParams();
    params.set('body', messageText);

    return this.request<{ message_id: string }>(`/rooms/${rid}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
  }

  /**
   * Updates a member's role (e.g. downgrades to 'readonly' when spamming emojis).
   */
  async changeMemberRole(
    roomId: number | string,
    targetAccountId: number | string,
    newRole: 'admin' | 'member' | 'readonly'
  ): Promise<{ success: boolean; user?: ChatworkUser; message: string }> {
    const rid = Number(roomId);
    const tid = Number(targetAccountId);

    if (!this.isConfigured()) {
      const currentList = mockMembers[rid] || [];
      const foundIdx = currentList.findIndex((m) => m.account_id === tid);
      if (foundIdx === -1) {
        return {
          success: false,
          message: `ユーザー ID ${tid} はルーム #${rid} に在室していません。`,
        };
      }
      const targetUser = currentList[foundIdx];
      // Cannot downgrade sole admin
      if (targetUser.role === 'admin' && newRole !== 'admin') {
        const otherAdmins = currentList.filter((m) => m.role === 'admin' && m.account_id !== tid);
        if (otherAdmins.length === 0) {
          return {
            success: false,
            user: targetUser,
            message: '唯一の管理者ユーザーの権限は変更できません。',
          };
        }
      }
      targetUser.role = newRole;
      return {
        success: true,
        user: targetUser,
        message: `ユーザー「${targetUser.name}」(ID: ${tid}) の権限を「${newRole}」に変更しました。`,
      };
    }

    // Live API Execution
    const members = await this.getRoomMembers(rid);
    const targetMember = members.find((m) => m.account_id === tid);
    if (!targetMember) {
      return {
        success: false,
        message: `ユーザー ID ${tid} はルーム #${rid} に在室していません。`,
      };
    }

    const adminIds = members.filter((m) => m.role === 'admin' && m.account_id !== tid).map((m) => m.account_id);
    const memberIds = members.filter((m) => m.role === 'member' && m.account_id !== tid).map((m) => m.account_id);
    const readonlyIds = members.filter((m) => m.role === 'readonly' && m.account_id !== tid).map((m) => m.account_id);

    if (newRole === 'admin') {
      adminIds.push(tid);
    } else if (newRole === 'member') {
      memberIds.push(tid);
    } else if (newRole === 'readonly') {
      readonlyIds.push(tid);
    }

    if (adminIds.length === 0) {
      throw new Error('管理者権限を持つユーザーが0人になるため権限変更できません。最低1人の管理者を残す必要があります。');
    }

    const params = new URLSearchParams();
    params.set('admin_ids', adminIds.join(','));
    if (memberIds.length > 0) {
      params.set('member_ids', memberIds.join(','));
    }
    if (readonlyIds.length > 0) {
      params.set('readonly_ids', readonlyIds.join(','));
    }

    await this.request(`/rooms/${rid}/members`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    return {
      success: true,
      user: targetMember,
      message: `ユーザー「${targetMember.name}」(ID: ${tid}) の権限を「${newRole}」に変更しました。`,
    };
  }

  // Helper for simulation to inject or join member
  simulateMemberJoin(roomId: number, user: ChatworkUser): void {
    if (!mockMembers[roomId]) mockMembers[roomId] = [];
    if (!mockMembers[roomId].some((m) => m.account_id === user.account_id)) {
      mockMembers[roomId].push(user);
    }
  }

  getSimulatedMembers(roomId: number): ChatworkUser[] {
    return mockMembers[roomId] || [];
  }
}

/**
 * Detects whether a message contains 5 or more consecutive Chatwork/Unicode emojis.
 * Matches official Chatwork emoji codes like (bow)(clap)(smile) or Unicode pictographic emojis.
 */
export function detectConsecutiveEmojis(text: string): {
  hasSpam: boolean;
  count: number;
  matchedSequence: string;
} {
  if (!text) return { hasSpam: false, count: 0, matchedSequence: '' };

  let maxCount = 0;
  let maxSeq = '';
  let currentCount = 0;
  let currentSeq = '';

  let i = 0;
  while (i < text.length) {
    const sub = text.slice(i);
    // Chatwork shortcode emoji pattern: (bow), (clap), (flex), (:)), (roger), etc.
    const cwMatch = sub.match(/^(\([a-zA-Z0-9_:;\-+=><!?#*~@$%^&/]{1,25}\))/);
    // Unicode emoji pattern
    const uniMatch = sub.match(/^(\p{Extended_Pictographic})/u);

    if (cwMatch) {
      currentCount++;
      currentSeq += cwMatch[1];
      i += cwMatch[1].length;
      if (currentCount > maxCount) {
        maxCount = currentCount;
        maxSeq = currentSeq;
      }
      // Allow optional single space or whitespace between consecutive emojis
      if (text[i] === ' ' || text[i] === '　') {
        currentSeq += text[i];
        i++;
      }
    } else if (uniMatch) {
      currentCount++;
      currentSeq += uniMatch[1];
      i += uniMatch[1].length;
      if (currentCount > maxCount) {
        maxCount = currentCount;
        maxSeq = currentSeq;
      }
      if (text[i] === ' ' || text[i] === '　') {
        currentSeq += text[i];
        i++;
      }
    } else {
      currentCount = 0;
      currentSeq = '';
      i++;
    }
  }

  return {
    hasSpam: maxCount >= 5,
    count: maxCount,
    matchedSequence: maxSeq.trim(),
  };
}

/**
 * Validates the Chatwork Webhook HMAC-SHA256 signature.
 * Chatwork signs the raw payload using HMAC-SHA256 with the Base64-decoded webhook token.
 */
export function verifyWebhookSignature(
  rawBody: Buffer | string,
  signatureHeader: string | undefined,
  secretToken: string
): boolean {
  if (!signatureHeader || !secretToken) {
    return false;
  }

  try {
    const rawBuffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf-8');
    
    // Secret token in Chatwork Webhook is typically Base64 encoded, but we support raw string fallback
    let keyBuffer: Buffer;
    try {
      const b64Decoded = Buffer.from(secretToken, 'base64');
      // If base64 decoded string re-encoded matches or has valid length
      if (b64Decoded.length > 0 && b64Decoded.toString('base64') === secretToken) {
        keyBuffer = b64Decoded;
      } else {
        keyBuffer = Buffer.from(secretToken, 'utf-8');
      }
    } catch {
      keyBuffer = Buffer.from(secretToken, 'utf-8');
    }

    const computed = crypto.createHmac('sha256', keyBuffer).update(rawBuffer).digest('base64');
    
    // Constant-time comparison
    const sigBuff = Buffer.from(signatureHeader.trim());
    const compBuff = Buffer.from(computed);

    if (sigBuff.length !== compBuff.length) {
      // Also try raw UTF-8 key if base64 failed
      const altComputed = crypto.createHmac('sha256', Buffer.from(secretToken, 'utf-8')).update(rawBuffer).digest('base64');
      const altBuff = Buffer.from(altComputed);
      if (sigBuff.length === altBuff.length && crypto.timingSafeEqual(sigBuff, altBuff)) {
        return true;
      }
      return false;
    }

    return crypto.timingSafeEqual(sigBuff, compBuff);
  } catch (err) {
    console.error('Error verifying webhook signature:', err);
    return false;
  }
}
