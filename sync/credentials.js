'use strict';
const { t } = require('../i18n');
const fs = require('node:fs');
const { durable } = require('./storage');
class Credentials {
  constructor(file, safeStorage, platform = process.platform) { this.file = file; this.safe = safeStorage; this.platform = platform; }
  protection() {
    let backend = this.platform === 'linux' ? 'unknown' : 'system';
    let available = false;
    try {
      if (this.safe.getSelectedStorageBackend) backend = this.safe.getSelectedStorageBackend();
      available = this.safe.isEncryptionAvailable() && backend !== 'basic_text';
      // Linux must positively identify a real keyring. Unknown/uninitialized
      // backends are not permission to persist an app password.
      if (this.platform === 'linux') available = available && ['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'].includes(backend);
    } catch { /* a locked/unavailable provider is not a save failure */ }
    return { available: !!available, backend, platform: this.platform, message: available ? '' : this.platform === 'linux'
      ? t('Credential protection is unavailable. Unlock GNOME Keyring or KDE Wallet, then choose Sync now to retry a saved connection. If no keyring is running, start one and restart NeoSync. No app password will be stored without protection.')
      : t('OS credential protection is unavailable. Enable your system keyring and try again.') };
  }
  available() { return this.protection().available; }
  save(value) {
    const protection = this.protection();
    if (!protection.available) throw new Error(protection.message);
    durable(this.file, this.safe.encryptString(JSON.stringify(value)));
  }
  read() {
    if (!fs.existsSync(this.file)) return null;
    const protection = this.protection();
    if (!protection.available) throw new Error(protection.message);
    try { return JSON.parse(this.safe.decryptString(fs.readFileSync(this.file))); }
    catch { throw new Error(t('Could not unlock Nextcloud credentials. Reconnect in settings.')); }
  }
  remove() { if (fs.existsSync(this.file)) fs.unlinkSync(this.file); }
}
module.exports = { Credentials };
