/* ==========================================================================
   3MTT POS APP - LOCAL SESSION STORE
   Remembers which real (Supabase-backed) agent is currently signed in on
   this device, and whether they administer an organization. All actual
   sales/expense data lives in Supabase — this file only caches identity so
   the UI has something to render immediately.
   ========================================================================== */

const STORAGE_KEYS = {
  AGENT_BUSINESS: '3mtt_pos_agent_business_v4',
  AGENT_NAME: '3mtt_pos_agent_name_v4',
  AGENT_EMAIL: '3mtt_pos_agent_email_v4',
  AGENT_PHONE: '3mtt_pos_agent_phone_v4',
  CURRENT_USER_ID: '3mtt_pos_current_user_id_v4',
  ADMIN_ORG_ID: '3mtt_pos_admin_org_id_v1',
  ADMIN_ORG_NAME: '3mtt_pos_admin_org_name_v1'
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
    this.persist();
  }

  signOut() {
    this.agentBusiness = '';
    this.agentName = '';
    this.agentEmail = '';
    this.agentPhone = '';
    this.currentUserId = null;
    this.adminOrgId = null;
    this.adminOrgName = null;
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
  }
}

export const store = new SessionStore();
