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
      // Checking availability initializes Chromium's key storage. Read its
      // selected backend afterwards, not a stale pre-initialization value.
      available = this.safe.isEncryptionAvailable();
      if (this.safe.getSelectedStorageBackend) backend = this.safe.getSelectedStorageBackend();
      available = available && backend !== 'basic_text';
      // Linux must positively identify a real keyring. Unknown/uninitialized
      // backends are not permission to persist an app password.
      if (this.platform === 'linux') available = available && ['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'].includes(backend);
    } catch { available = false; }
    return { available: !!available, backend, platform: this.platform, message: available ? '' : this.platform === 'linux'
      ? backend === 'basic_text' || backend === 'unknown' || !backend
        ? t('Secure password storage is unavailable: NeoSync could not select a keyring. It may already be unlocked. Make sure GNOME Keyring or KDE Wallet is running in your desktop session, then fully close and reopen NeoSync. Remove any --password-store=basic launch option. No app password has been saved without protection.')
        : t('Secure password storage is unavailable: NeoSync cannot access the selected keyring. Open GNOME Keyring or KDE Wallet and allow access if asked. If it is already unlocked, fully close and reopen NeoSync so it can reconnect. No app password has been saved without protection.')
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
