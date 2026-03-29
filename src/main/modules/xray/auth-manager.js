const fetch = require('node-fetch');

const DEFAULT_API_BASE = 'https://api.dentcloud.app';

class AuthManager {
  constructor(logger, configStore) {
    this.logger = logger;
    this.configStore = configStore;
    this.apiKey = null;
    this.deviceInfo = null;
    this.clinicInfo = null;
    this.branchInfo = null;
  }

  _getApiBase() {
    const config = this.configStore.getConfig('xray');
    return config.apiBaseUrl || DEFAULT_API_BASE;
  }

  _getHeaders() {
    return {
      'x-device-api-key': this.apiKey,
      'Content-Type': 'application/json',
    };
  }

  async connect(apiKey) {
    try {
      this.apiKey = apiKey;
      const url = `${this._getApiBase()}/api/device/validate`;
      const response = await fetch(url, {
        headers: { 'x-device-api-key': apiKey },
      });

      if (!response.ok) {
        this.apiKey = null;
        const err = await response.json().catch(() => ({}));
        const errMsg = err.errorMessage || err.message;
        throw new Error(typeof errMsg === 'string' ? errMsg : `Validation failed: ${response.status}`);
      }

      const result = await response.json();
      this.deviceInfo = {
        id: result.deviceId,
        name: result.deviceName,
        scopes: result.scopes,
      };
      this.clinicInfo = { id: result.clinicId, code: result.clinicCode };
      this.branchInfo = { id: result.branchId, name: result.branchName, code: result.branchCode };

      // Store API key and clinicBranchURL securely
      if (this.configStore.saveCredential) {
        this.configStore.saveCredential('xray-api-key', apiKey);
      }
      // Save clinicBranchURL for patient search and upload API paths
      const xrayConfig = this.configStore.getConfig('xray');
      this.configStore.setConfig('xray', {
        ...xrayConfig,
        clinicBranchURL: `${result.clinicCode}/${result.branchCode}`,
      });

      this.logger.info('Device connected', {
        deviceId: this.deviceInfo.id,
        deviceName: this.deviceInfo.name,
        branchName: this.branchInfo.name,
      });

      return { success: true, device: this.deviceInfo, branch: this.branchInfo };
    } catch (error) {
      this.logger.error('Device connection failed', { error: error.message });
      this.apiKey = null;
      return { success: false, error: error.message };
    }
  }

  async searchPatientByDN(patientDN, crossBranch = false) {
    if (!this.apiKey || !this.clinicInfo || !this.branchInfo) {
      return { success: false, error: 'Not configured' };
    }
    try {
      // Use device's branch for the URL path, but clinicInfo for context
      const config = this.configStore.getConfig('xray');
      const clinicBranch = config.clinicBranchURL;
      if (!clinicBranch) return { success: false, error: 'No clinic/branch configured' };

      const [clinicCode, branchCode] = clinicBranch.split('/');
      let url = `${this._getApiBase()}/api/patient/${clinicCode}/${branchCode}?dn=${encodeURIComponent(patientDN)}`;
      if (crossBranch) url += '&crossBranch=true';

      const response = await fetch(url, {
        headers: { 'x-device-api-key': this.apiKey },
      });

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

  async getPresignedUploadURL(patientId, fileMetadata, dicomMetadata, targetBranch) {
    try {
      const config = this.configStore.getConfig('xray');
      const clinicBranch = config.clinicBranchURL;
      if (!clinicBranch) throw new Error('No clinic/branch configured');

      const [clinicCode, branchCode] = clinicBranch.split('/');
      // Upload to patient's branch if specified, otherwise device's branch
      const uploadBranchCode = targetBranch || branchCode;

      const url = `${this._getApiBase()}/api/mediaFile/getPresigned/${clinicCode}/${uploadBranchCode}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: this._getHeaders(),
        body: JSON.stringify({
          category: 'XRay',
          patientId: patientId.toString(),
          filesMetadata: [fileMetadata],
        }),
      });

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        const detail = errBody.errorMessage || errBody.message || response.status;
        throw new Error(`Presigned URL failed: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
      }

      const result = await response.json();
      let uploadUrl = null;
      if (Array.isArray(result) && result.length > 0) uploadUrl = result[0].url || result[0].uploadUrl;
      else uploadUrl = result.uploadUrl || result.url;

      return { success: true, uploadUrl };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  getUploadContext() {
    return {
      deviceId: this.deviceInfo?.id,
      deviceName: this.deviceInfo?.name,
      branchName: this.branchInfo?.name,
    };
  }

  isAuthenticated() { return !!this.apiKey && !!this.deviceInfo; }

  disconnect() {
    this.apiKey = null;
    this.deviceInfo = null;
    this.clinicInfo = null;
    this.branchInfo = null;
  }
}

module.exports = AuthManager;
