/* ==========================================================================
   BIZLEDGER - LOCAL SESSION STORE
   Remembers which real (Supabase-backed) identity is currently signed in on
   this device — either a personal/admin `users` account, OR an org member
   account (a separate, username+password system). All actual sales/expense
   data lives in Supabase — this file only caches identity so the UI has
   something to render immediately.
   ========================================================================== */

const STORAGE_KEYS = {
  AGENT_BUSINESS: '3mtt_pos_agent_business_v4',
  AGENT_NAME: '3mtt_pos_agent_name_v4',
  AGENT_EMAIL: '3mtt_pos_agent_email_v4',
  AGENT_PHONE: '3mtt_pos_agent_phone_v4',
  CURRENT_USER_ID: '3mtt_pos_current_user_id_v4',
  ADMIN_ORG_ID: '3mtt_pos_admin_org_id_v1',
  ADMIN_ORG_NAME: '3mtt_pos_admin_org_name_v1',
  MEMBER_ID: '3mtt_pos_member_id_v1',
  MEMBER_USERNAME: '3mtt_pos_member_username_v1',
  MEMBER_ORG_ID: '3mtt_pos_member_org_id_v1',
  MEMBER_ORG_NAME: '3mtt_pos_member_org_name_v1'
};

export class SessionStore {
  constructor() {
    this.agentBusiness = this.load(STORAGE_KEYS.AGENT_BUSINESS, '');
    this.agentName = this.load(STORAGE_KEYS.AGENT_NAME, '');
    this.agentEmail = this.load(STORAGE_KEYS.AGENT_EMAIL, '');
    this.agentPhone = this.load(STORAGE_KEYS.AGENT_PHONE, '');
    this.currentUserId = this.load(STORAGE_KEYS.CURRENT_USER_ID, null);
    // If this signed-in agent administers an organization, its id/name —
    // once set, this user's own sales/expenses are recorded into and read
    // from the org's shared ledger instead of a personal one.
    this.adminOrgId = this.load(STORAGE_KEYS.ADMIN_ORG_ID, null);
    this.adminOrgName = this.load(STORAGE_KEYS.ADMIN_ORG_NAME, null);

    // Org MEMBER session — a completely separate identity from the above.
    // Only one of (currentUserId) or (memberId) is ever meaningfully "active"
    // at a time; app.js decides which based on which is set.
    this.memberId = this.load(STORAGE_KEYS.MEMBER_ID, null);
    this.memberUsername = this.load(STORAGE_KEYS.MEMBER_USERNAME, null);
    this.memberOrgId = this.load(STORAGE_KEYS.MEMBER_ORG_ID, null);
    this.memberOrgName = this.load(STORAGE_KEYS.MEMBER_ORG_NAME, null);
  }

  load(key, fallback) {
    try {
      const data = localStorage.getItem(key);
      return data ? JSON.parse(data) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  save(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch (e) { }
  }

  // Called right after a real login or registration succeeds on the backend.
  setSignedInUser(user) {
    this.agentBusiness = user.business_name || user.name || '';
    this.agentName = user.name || '';
    this.agentEmail = user.email || '';
    this.agentPhone = user.phone || '';
    this.currentUserId = user.id;
    this.clearMemberSession();
    this.persist();
  }

  // Called right after a member login or invite-acceptance succeeds.
  setSignedInMember(member) {
    this.memberId = member.id;
    this.memberUsername = member.username;
    this.memberOrgId = member.org_id;
    this.memberOrgName = member.orgName || 'Organization';
    this.clearPersonalSession();
    this.persist();
  }

  clearPersonalSession() {
    this.agentBusiness = '';
    this.agentName = '';
    this.agentEmail = '';
    this.agentPhone = '';
    this.currentUserId = null;
    this.adminOrgId = null;
    this.adminOrgName = null;
  }

  clearMemberSession() {
    this.memberId = null;
    this.memberUsername = null;
    this.memberOrgId = null;
    this.memberOrgName = null;
  }

  signOut() {
    this.clearPersonalSession();
    this.clearMemberSession();
    this.persist();
  }

  persist() {
    this.save(STORAGE_KEYS.AGENT_BUSINESS, this.agentBusiness);
    this.save(STORAGE_KEYS.AGENT_NAME, this.agentName);
    this.save(STORAGE_KEYS.AGENT_EMAIL, this.agentEmail);
    this.save(STORAGE_KEYS.AGENT_PHONE, this.agentPhone);
    this.save(STORAGE_KEYS.CURRENT_USER_ID, this.currentUserId);
    this.save(STORAGE_KEYS.ADMIN_ORG_ID, this.adminOrgId);
    this.save(STORAGE_KEYS.ADMIN_ORG_NAME, this.adminOrgName);
    this.save(STORAGE_KEYS.MEMBER_ID, this.memberId);
    this.save(STORAGE_KEYS.MEMBER_USERNAME, this.memberUsername);
    this.save(STORAGE_KEYS.MEMBER_ORG_ID, this.memberOrgId);
    this.save(STORAGE_KEYS.MEMBER_ORG_NAME, this.memberOrgName);
  }
}

export const store = new SessionStore();
