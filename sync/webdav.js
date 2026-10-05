'use strict';
const { XMLParser, XMLValidator } = require('fast-xml-parser');
const { remotePath, segment } = require('./model');
const MAX_BYTES = 64 * 1024 * 1024;
class DavError extends Error {
  constructor(status) { super(status ? `WebDAV HTTP ${status}` : 'Network unavailable or request timed out'); this.status = status; }
}
function serverURL(value) {
  const u = new URL(value);
  if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash) throw new Error('Use an HTTPS Nextcloud installation URL');
  u.pathname = u.pathname.replace(/\/+$/, '') + '/';
  return u.href;
}
function sameServer(url, server) {
  const u = new URL(url), root = new URL(server);
  if (u.origin !== root.origin || !u.pathname.startsWith(root.pathname) || u.username || u.password || u.hash) throw new Error('Unexpected Nextcloud endpoint');
  return u.href;
}
async function request(fetcher, url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetcher(url, { ...options, redirect: 'error', signal: controller.signal });
    const chunks = [];
    let size = 0;
    if (Number(res.headers.get('content-length')) > MAX_BYTES) throw new Error('Transfer exceeds 64 MiB limit');
    for await (const chunk of res.body || []) {
      size += chunk.length;
      if (size > MAX_BYTES) { controller.abort(); throw new Error('Transfer exceeds 64 MiB limit'); }
      chunks.push(Buffer.from(chunk));
    }
    return { status: res.status, etag: res.headers.get('etag'), data: Buffer.concat(chunks) };
  } catch (err) {
    if (err.message === 'Transfer exceeds 64 MiB limit') throw err;
    throw new DavError(0); // never forward URLs, headers or credentials into logs / IPC
  } finally { clearTimeout(timer); }
}
const array = value => value == null ? [] : Array.isArray(value) ? value : [value];
function listing(xml, target, root) {
  const source = xml.toString();
  if (/<!DOCTYPE|<!ENTITY/i.test(source) || XMLValidator.validate(source) !== true) throw new Error('Invalid WebDAV listing');
  const tree = new XMLParser({ removeNSPrefix: true, parseTagValue: false, trimValues: true }).parse(source);
  const responses = array(tree.multistatus?.response);
  if (!responses.length) throw new Error('Incomplete WebDAV listing');
  const result = [];
  let self = false;
  const seen = new Set();
  for (const response of responses) {
    if (typeof response.href !== 'string') throw new Error('Invalid DAV href');
    const u = new URL(response.href, target), base = new URL(root);
    if (u.origin !== base.origin || u.search || u.hash || !u.pathname.startsWith(base.pathname)) throw new Error('DAV path escaped remote folder');
    const decoded = decodeURIComponent(u.pathname.slice(base.pathname.length)).replace(/\/$/, '');
    if (decoded && !decoded.split('/').every(segment)) throw new Error('Unsafe DAV path');
    const props = array(response.propstat);
    if (response.status && !/HTTP\/\S+ 2\d\d(?: |$)/.test(response.status)) throw new Error('Partial DAV listing');
    const good = props.filter(p => /HTTP\/\S+ 200(?: |$)/.test(p.status));
    const prop = Object.assign({}, ...good.map(p => p.prop));
    if (!Object.hasOwn(prop, 'resourcetype')) throw new Error('Partial DAV properties');
    const dir = typeof prop.resourcetype === 'object' && Object.hasOwn(prop.resourcetype, 'collection');
    const etag = prop.getetag;
    if (!dir && (typeof etag !== 'string' || !/^"[^\r\n]*"$/.test(etag))) throw new Error('Missing strong ETag');
    if (seen.has(decoded.toLowerCase())) throw new Error('Duplicate DAV path');
    seen.add(decoded.toLowerCase());
    if (u.pathname.replace(/\/$/, '') === new URL(target).pathname.replace(/\/$/, '')) self = dir;
    else {
      // Depth:1 must contain direct children only.
      const parent = u.pathname.replace(/\/$/, '').slice(0, u.pathname.replace(/\/$/, '').lastIndexOf('/') + 1);
      if (parent !== new URL(target).pathname) throw new Error('Unexpected DAV depth');
      result.push({ path: decoded, dir, etag });
    }
  }
  if (!self) throw new Error('Listing omitted requested collection');
  return result;
}
class WebDAV {
  constructor({ server, folder, loginName, appPassword, userId }, fetcher = fetch) {
    this.server = serverURL(server);
    if (typeof folder !== 'string' || !folder.split('/').every(segment) || folder.split('/').length > 8) throw new Error('Choose a relative remote folder');
    this.folder = folder;
    this.loginName = loginName;
    this.userId = userId;
    this.fetcher = fetcher;
    this.auth = 'Basic ' + Buffer.from(loginName + ':' + appPassword).toString('base64');
  }
  async call(url, method, headers = {}, body) {
    // Compression middleware can weaken/change the HTTP ETag while PROPFIND
    // reports the original file validator. Ask for that same representation;
    // never strip W/ or guess a strong validator for conditional writes.
    return request(this.fetcher, url, { method, headers: { Authorization: this.auth, 'User-Agent': 'NeoSync', 'Accept-Encoding': 'identity', ...headers }, body });
  }
  async discover() {
    const r = await this.call(this.server + 'ocs/v1.php/cloud/user?format=json', 'GET', { 'OCS-APIRequest': 'true', Accept: 'application/json' });
    if (r.status !== 200) throw new DavError(r.status);
    let value;
    try { value = JSON.parse(r.data); } catch { throw new Error('Invalid user discovery response'); }
    const id = value.ocs?.data?.id;
    if (![100, 200].includes(Number(value.ocs?.meta?.statuscode)) || !segment(id)) throw new Error('Could not discover DAV user ID');
    this.userId = id;
    this.home = this.server + 'remote.php/dav/files/' + encodeURIComponent(id) + '/';
    this.root = this.home + this.folder.split('/').map(encodeURIComponent).join('/') + '/';
    return id;
  }
  async initialize() {
    await this.discover();
    let url = this.home;
    for (const bit of this.folder.split('/')) {
      url += encodeURIComponent(bit) + '/';
      const r = await this.call(url, 'MKCOL');
      if (![201, 405].includes(r.status)) throw new DavError(r.status);
    }
  }
  url(p) { if (!remotePath(p)) throw new Error('Invalid remote path'); return this.root + p.split('/').map(encodeURIComponent).join('/'); }
  async list() {
    if (!this.root) await this.discover();
    const out = {};
    const visit = async (url, depth) => {
      if (depth > 3) throw new Error('Unexpected library depth');
      const r = await this.call(url, 'PROPFIND', { Depth: '1', 'Content-Type': 'application/xml' }, '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:getetag/><d:resourcetype/></d:prop></d:propfind>');
      if (r.status !== 207) throw new DavError(r.status);
      for (const item of listing(r.data, url, this.root)) {
        if (item.dir) {
          if (/^book-[^/]+(?:\/chapters)?$/.test(item.path) || /^\.neosync(?:\/deletions)?$/.test(item.path)) await visit(this.root + item.path.split('/').map(encodeURIComponent).join('/') + '/', depth + 1);
        } else if (remotePath(item.path)) out[item.path] = item.etag;
        if (Object.keys(out).length > 20000) throw new Error('Library exceeds 20000-file limit');
      }
    };
    await visit(this.root, 0);
    return out;
  }
  async get(p, etag) {
    const r = await this.call(this.url(p), 'GET', etag ? { 'If-Match': etag } : {});
    if (r.status !== 200) throw new DavError(r.status);
    if (!r.etag || (etag && r.etag !== etag)) throw new Error('ETag changed during download');
    return { data: r.data, etag: r.etag };
  }
  async put(p, data, etag) {
    const bits = p.split('/');
    let url = this.root;
    for (const bit of bits.slice(0, -1)) {
      url += encodeURIComponent(bit) + '/';
      const r = await this.call(url, 'MKCOL');
      if (![201, 405].includes(r.status)) throw new DavError(r.status);
    }
    const r = await this.call(this.url(p), 'PUT', etag ? { 'If-Match': etag } : { 'If-None-Match': '*' }, data);
    if (![200, 201, 204].includes(r.status)) throw new DavError(r.status);
    // A lost response / missing ETag must be recovered via GET, not a blind PUT.
    if (!r.etag) return (await this.get(p)).etag;
    return r.etag;
  }
}
module.exports = { WebDAV, DavError, listing, serverURL, sameServer, request };
