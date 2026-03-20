const fetch = require('node-fetch');

const DEFAULT_API_BASE = 'https://api.dentcloud.app';

class AuthManager {
  constructor(logger, configStore) {
    this.logger = logger;
    this.configStore = configStore;
    this.accessToken = null;
    this.refreshTokenCookie = null;
    this.userInfo = null;
    this.clinicInfo = null;
    this.branchInfo = null;
  }

  _getApiBase() {
    const config = this.configStore.getConfig('xray');
    return config.apiBaseUrl || DEFAULT_API_BASE;
  }

  async login(credentials) {
    try {
      const url = `${this._getApiBase()}/api/login`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: credentials.email, password: credentials.password, rememberMe: true }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.errorMessage?.validationResult?.[0]?.message || err.errorMessage || `Login failed: ${response.status}`);
      }

      const result = await response.json();
      if (result.status === 'OK' && result.data) {
        this.accessToken = result.data.accessToken;
        this.userInfo = result.data.user;
        const cookie = response.headers.get('set-cookie');
        if (cookie) this.refreshTokenCookie = cookie;

        // Store credentials securely
        if (this.configStore.saveCredential) {
          this.configStore.saveCredential('xray-password', credentials.password);
        }

        this.logger.info('Login successful', { userId: this.userInfo?.uid });
        return { success: true, user: this.userInfo };
      }
      throw new Error('Authentication failed');
    } catch (error) {
      this.logger.error('Login failed', { error: error.message });
      return { success: false, error: error.message };
    }
  }

  async getClinicList(retry = true) {
    if (!this.accessToken) return { success: false, error: 'Not authenticated' };
    try {
      const url = `${this._getApiBase()}/api/user/clinic`;
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${this.accessToken}` },
      });
      if (response.status === 401 && retry && this.refreshTokenCookie) {
        if (await this._refreshToken()) return this.getClinicList(false);
      }
      if (!response.ok) throw new Error(`Failed to fetch clinics: ${response.status}`);
      const result = await response.json();
      return { success: true, clinics: result.data || result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async validateConfiguration(clinicBranchURL, retry = true) {
    if (!this.accessToken) throw new Error('Not authenticated');
    const parts = clinicBranchURL.split('/');
    if (parts.length !== 2) throw new Error('Invalid format. Expected: clinicName/branchName');
    const clinicCode = parts[0].trim();
    const branchCode = parts[1].trim();

    try {
      const url = `${this._getApiBase()}/api/branch/${clinicCode}/${branchCode}`;
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${this.accessToken}` },
      });
      if (response.status === 401 && retry && this.refreshTokenCookie) {
        if (await this._refreshToken()) return this.validateConfiguration(clinicBranchURL, false);
      }
      if (!response.ok) throw new Error(`Branch validation failed: ${response.status}`);
      const result = await response.json();
      const branchData = result.data || result;

      this.clinicInfo = { url: clinicCode, name: branchData.clinic?.name || clinicCode };
      this.branchInfo = { url: branchCode, name: branchData.name || branchCode, id: branchData.id };

      this.logger.info('Branch selected', { clinic: clinicCode, branch: branchCode });
      return { success: true, clinic: this.clinicInfo, branch: this.branchInfo };
    } catch (error) {
      // Fallback: still store the codes so basic functionality works
      this.clinicInfo = { url: clinicCode };
      this.branchInfo = { url: branchCode };
      this.logger.warn('Branch API call failed, using config values', { error: error.message });
      return { success: true, clinic: this.clinicInfo, branch: this.branchInfo, warning: error.message };
    }
  }

  async searchPatientByDN(patientDN, retry = true) {
    if (!this.accessToken || !this.clinicInfo || !this.branchInfo) {
      return { success: false, error: 'Not configured' };
    }
    try {
      const url = `${this._getApiBase()}/api/patient/${this.clinicInfo.url}/${this.branchInfo.url}?dn=${encodeURIComponent(patientDN)}`;
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${this.accessToken}` },
      });

      if (response.status === 401 && retry && this.refreshTokenCookie) {
        if (await this._refreshToken()) return this.searchPatientByDN(patientDN, false);
      }
      if (response.status === 404) return { success: true, patients: [] };
      if (!response.ok) throw new Error(`Search failed: ${response.status}`);

      const result = await response.json();
      const patients = result.data || result.patients || result || [];
      return { success: true, patients };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  shouldUpload(dicomData, searchResults) {
    if (!searchResults.patients || searchResults.patients.length !== 1) {
      return { upload: false, reason: 'NO_SINGLE_MATCH' };
    }
    const patient = searchResults.patients[0];
    if (dicomData.patientId === patient.dn) {
      return { upload: true, patientId: patient.id.toString(), patient };
    }
    return { upload: false, reason: 'NO_DN_MATCH' };
  }

  async getPresignedUploadURL(patientId, fileMetadata, dicomMetadata, retry = true) {
    try {
      const url = `${this._getApiBase()}/api/mediaFile/getPresigned/${this.clinicInfo.url}/${this.branchInfo.url}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          category: 'XRay',
          patientId: patientId.toString(),
          filesMetadata: [fileMetadata],
        }),
      });

      if (response.status === 401 && retry && this.refreshTokenCookie) {
        if (await this._refreshToken()) return this.getPresignedUploadURL(patientId, fileMetadata, dicomMetadata, false);
      }
      if (!response.ok) throw new Error(`Presigned URL failed: ${response.status}`);

      const result = await response.json();
      let uploadUrl = null;
      if (Array.isArray(result) && result.length > 0) uploadUrl = result[0].url || result[0].uploadUrl;
      else uploadUrl = result.uploadUrl || result.url;

      return { success: true, uploadUrl };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async _refreshToken() {
    try {
      const response = await fetch(`${this._getApiBase()}/api/token`, {
        method: 'POST',
        headers: { 'Cookie': this.refreshTokenCookie, 'Content-Type': 'application/json' },
      });
      if (!response.ok) return false;
      const result = await response.json();
      if (result.status === 'OK' && result.data) {
        this.accessToken = result.data.accessToken;
        const cookie = response.headers.get('set-cookie');
        if (cookie) this.refreshTokenCookie = cookie;
        return true;
      }
      return false;
    } catch { return false; }
  }

  getUploadContext() {
    return {
      clinicURL: this.clinicInfo?.url,
      branchURL: this.branchInfo?.url,
      userId: this.userInfo?.uid,
    };
  }

  isAuthenticated() { return !!this.accessToken; }

  logout() {
    this.accessToken = null;
    this.refreshTokenCookie = null;
    this.userInfo = null;
    this.clinicInfo = null;
    this.branchInfo = null;
  }
}

module.exports = AuthManager;
