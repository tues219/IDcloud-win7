const EventEmitter = require('events');

class UploadQueue extends EventEmitter {
  constructor(logger) {
    super();
    this.logger = logger;
    this.queue = [];
    this.processing = false;
    this.authManager = null;
  }

  setAuthManager(authManager) {
    this.authManager = authManager;
  }

  addToQueue(fileInfo, metadata) {
    const item = {
      id: Date.now() + Math.random(),
      fileInfo,
      metadata,
      status: metadata.requiresAssignment ? 'awaiting-assignment' : 'pending',
      progress: 0,
      addedAt: new Date().toISOString(),
      attempts: 0,
      error: null,
    };
    this.queue.push(item);
    this.logger.info('Added to queue', { id: item.id, file: fileInfo.name, status: item.status });
    this.emit('queue-updated', this.getQueueStatus());
    if (!this.processing && item.status === 'pending') this.processQueue();
    return item;
  }

  async processQueue() {
    if (this.processing) return;
    this.processing = true;

    while (true) {
      const item = this.queue.find(i => i.status === 'pending');
      if (!item) break;
      try {
        await this._processItem(item);
      } catch (err) {
        this.logger.error('Queue item failed', { id: item.id, error: err.message });
      }
      await new Promise(r => setTimeout(r, 1000));
    }
    this.processing = false;
  }

  async _processItem(item) {
    try {
      // Items awaiting assignment should not be processed — wait for user action
      if (item.status === 'awaiting-assignment') return;

      item.status = 'processing';
      item.attempts++;
      this.emit('queue-updated', this.getQueueStatus());

      if (!this.authManager || !this.authManager.isAuthenticated()) {
        throw new Error('Not authenticated');
      }

      // Search patient
      item.progress = 10;
      const searchResults = await this.authManager.searchPatientByDN(item.metadata.patientId);
      if (!searchResults.success) throw new Error(`Patient search failed: ${searchResults.error}`);

      // Upload decision
      item.progress = 20;
      const decision = this.authManager.shouldUpload(item.metadata, searchResults);
      if (!decision.upload) {
        item.status = 'awaiting-assignment';
        item.matchInfo = {
          reason: decision.reason,
          dicomPatientId: item.metadata.patientId,
          dicomPatientName: item.metadata.patientNameFormatted,
          searchResults: searchResults.patients || [],
        };
        this.emit('queue-updated', this.getQueueStatus());
        return;
      }

      // Get presigned URL
      item.progress = 30;
      const presigned = await this.authManager.getPresignedUploadURL(
        decision.patientId,
        { contentType: 'application/dicom', filename: item.fileInfo.name },
        item.metadata
      );
      if (!presigned.success) throw new Error(`Presigned URL failed: ${presigned.error}`);

      // Upload
      item.progress = 50;
      const fs = require('fs').promises;
      const fetch = require('node-fetch');
      const fileBuffer = await fs.readFile(item.fileInfo.path);
      const response = await fetch(presigned.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/dicom' },
        body: fileBuffer,
      });
      if (!response.ok) throw new Error(`S3 upload failed: ${response.status}`);

      item.status = 'completed';
      item.progress = 100;
      this.logger.info('Upload complete', { id: item.id });
      this.emit('queue-updated', this.getQueueStatus());
    } catch (err) {
      item.status = 'failed';
      item.error = err.message;
      this.emit('queue-updated', this.getQueueStatus());
      if (item.attempts < 3) {
        setTimeout(() => {
          item.status = 'pending';
          item.error = null;
          this.emit('queue-updated', this.getQueueStatus());
          if (!this.processing) this.processQueue();
        }, 5000);
      }
    }
  }

  assignPatientDN(queueItemId, patientInfo) {
    const item = this.queue.find(i => i.id === queueItemId);
    if (!item) return { success: false, error: 'Item not found' };

    item.metadata.patientId = patientInfo.dn;
    item.assignedPatient = patientInfo;
    item.status = 'pending';
    item.error = null;
    item.attempts = 0;
    this.emit('queue-updated', this.getQueueStatus());
    if (!this.processing) this.processQueue();
    return { success: true };
  }

  getQueueStatus() {
    return {
      total: this.queue.length,
      pending: this.queue.filter(i => i.status === 'pending').length,
      processing: this.queue.filter(i => i.status === 'processing').length,
      completed: this.queue.filter(i => i.status === 'completed').length,
      failed: this.queue.filter(i => i.status === 'failed').length,
      awaitingAssignment: this.queue.filter(i => i.status === 'awaiting-assignment').length,
      items: this.queue.slice(-20),
    };
  }

  clearCompleted() {
    this.queue = this.queue.filter(i => i.status !== 'completed');
    this.emit('queue-updated', this.getQueueStatus());
  }

  retryFailed() {
    this.queue.forEach(item => {
      if (item.status === 'failed') {
        item.status = 'pending';
        item.error = null;
        item.attempts = 0;
      }
    });
    this.emit('queue-updated', this.getQueueStatus());
    if (!this.processing) this.processQueue();
  }
}

module.exports = UploadQueue;
