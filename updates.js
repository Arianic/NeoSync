'use strict';
const semver = require('semver');
const REPOSITORY = 'https://github.com/Arianic/NeoSync';
const RELEASES_API = 'https://api.github.com/repos/Arianic/NeoSync/releases?per_page=100';
const FEED = require('./update-feed.json');

function updateTarget({ packaged, platform, arch, env, installed }) {
  if (!packaged || arch !== 'x64') return null;
  if (platform === 'win32' && installed && !env.PORTABLE_EXECUTABLE_FILE && !env.PORTABLE_EXECUTABLE_DIR) return 'windows';
  if (platform === 'linux' && env.APPIMAGE && !env.APPIMAGE_EXTRACT_AND_RUN) return 'linux';
  return null;
}
function assetNames(version, target) {
  return target === 'windows'
    ? { manifest: 'latest.yml', binary: `NeoSync-Setup-${version}.exe` }
    : { manifest: 'latest-linux.yml', binary: `NeoSync-${version}-x86_64.AppImage` };
}
function selectRelease(releases, currentVersion) {
  const current = semver.parse(currentVersion);
  if (!current || !Array.isArray(releases)) throw new Error('Invalid release information');
  const channel = current.prerelease[0];
  return releases.flatMap(release => {
    if (release.draft || !release.published_at || typeof release.tag_name !== 'string') return [];
    const version = release.tag_name.startsWith('neosync-v') ? release.tag_name.slice(9) : '';
    if (!semver.valid(version) || !semver.gt(version, current)) return [];
    const prerelease = semver.prerelease(version);
    if ((release.prerelease || prerelease) && (!channel || !prerelease || prerelease[0] !== channel)) return [];
    const url = REPOSITORY + '/releases/tag/' + release.tag_name;
    if (release.html_url !== url) return [];
    return [{ version, url, tag: release.tag_name, assets: release.assets || [] }];
  }).sort((a, b) => semver.rcompare(a.version, b.version))[0] || null;
}
function hasAsset(release, name) {
  return release.assets.some(a => a.name === name && a.state === 'uploaded' && a.size > 0 &&
    a.browser_download_url === `${REPOSITORY}/releases/download/${release.tag}/${name}`);
}
function validateUpdate(info, release, target) {
  const names = assetNames(release.version, target);
  if (info.version !== release.version || !Array.isArray(info.files) || !info.files.length) throw new Error('Update version does not match its release');
  const allowed = new Set([names.binary]);
  // Linux metadata can also describe the Debian installer; AppImageUpdater selects AppImage.
  if (target === 'linux') allowed.add(`NeoSync-${release.version}-amd64.deb`);
  for (const file of info.files) {
    if (!allowed.has(file.url) || !hasAsset(release, file.url) || !/^[A-Za-z0-9+/]{86}==$/.test(file.sha512 || '') || !Number.isSafeInteger(file.size) || file.size <= 0) {
      throw new Error('Update files do not match the NeoSync release');
    }
  }
  if (!info.files.some(f => f.url === names.binary) || (info.path && !allowed.has(info.path)) || info.packages) throw new Error('Unexpected update package');
}

class Updates {
  constructor({ version, packaged, target, fetch, createUpdater, send = () => {}, log = () => {} }) {
    Object.assign(this, { version, packaged, target, fetch, createUpdater, send, log });
    this.state = { state: 'idle', currentVersion: version, hasUpdate: false, canInstall: false, ready: false };
  }
  info() { return { ...this.state, disabled: !this.packaged }; }
  change(value) { Object.assign(this.state, value); this.send({ type: 'update', ...this.info() }); }
  fail(error) {
    this.resume?.(); this.resume = null; this.installing = false;
    this.log(error);
    this.change({ state: 'error', error: !this.state.hasUpdate, ready: false, message: error.message || String(error) });
  }
  async check() {
    if (!this.packaged || this.state.ready || this.downloading) return this.info();
    if (!this.checking) this.checking = this.lookup().catch(e => this.fail(e)).finally(() => { this.checking = null; });
    await this.checking;
    return this.info();
  }
  async lookup() {
    this.change({ state: 'checking', error: false, message: '' });
    const response = await this.fetch(RELEASES_API, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'NeoSync' }, signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error('GitHub update check failed: ' + response.status);
    const release = selectRelease(await response.json(), this.version);
    this.release = release;
    if (!release) { this.change({ state: 'idle', hasUpdate: false, canInstall: false, latestVersion: '' }); return; }
    this.change({ state: 'release', hasUpdate: true, latestVersion: release.version, canInstall: false });
    if (!this.target) return;
    const names = assetNames(release.version, this.target);
    if (!hasAsset(release, names.manifest) || !hasAsset(release, names.binary)) return;
    if (!this.updater) {
      this.updater = this.createUpdater(this.target);
      Object.assign(this.updater, { autoDownload: false, autoInstallOnAppQuit: false, allowDowngrade: false, allowPrerelease: !!semver.prerelease(this.version), disableDifferentialDownload: true });
      this.updater.on('download-progress', p => this.change({ state: 'downloading', percent: p.percent, transferred: p.transferred, total: p.total }));
      this.updater.on('error', e => this.fail(e));
    }
    // The stock GitHub provider cannot parse our neosync-v* beta tags. Select
    // a published release above, then pin its standard metadata/download feed.
    this.updater.setFeedURL({ ...FEED, url: `${REPOSITORY}/releases/download/${release.tag}/` });
    const result = await this.updater.checkForUpdates();
    if (!result) throw new Error('This installation cannot update itself');
    validateUpdate(result.updateInfo, release, this.target);
    this.change({ state: 'downloading', canInstall: true, percent: 0 });
    this.downloading = this.updater.downloadUpdate().then(() => {
      this.change({ state: 'ready', ready: true, percent: 100 });
    }).catch(e => this.fail(e)).finally(() => { this.downloading = null; });
  }
  async install(prepare) {
    if (!this.updater || !this.state.ready || this.installing) return false;
    this.installing = true;
    try {
      this.resume = await prepare();
      this.updater.quitAndInstall(false, true);
      if (this.state.state === 'error') return false;
      return true;
    } catch (e) { this.resume?.(); this.resume = null; this.installing = false; this.log(e); throw e; }
  }
}
module.exports = { Updates, REPOSITORY, RELEASES_API, FEED, updateTarget, selectRelease, assetNames, validateUpdate };
