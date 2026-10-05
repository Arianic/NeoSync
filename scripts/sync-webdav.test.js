'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { gzipSync } = require('node:zlib');
const { WebDAV } = require('../sync/webdav');

test('DAV downloads avoid compression-altered ETags without relaxing version checks', async t => {
  const content = Buffer.from('<p>A manuscript kept intact.</p>'.repeat(100));
  const version = '"file-version"';
  let responseVersion = version, status = 200;
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push(req.headers);
    const compressed = req.headers['accept-encoding'] !== 'identity';
    res.statusCode = status;
    if (responseVersion) res.setHeader('ETag', compressed ? 'W/' + responseVersion : responseVersion);
    if (compressed) res.setHeader('Content-Encoding', 'gzip');
    res.end(compressed ? gzipSync(content) : content);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const root = `http://127.0.0.1:${server.address().port}/`;
  // Confirm the fixture reproduces the original failure with default fetch.
  const original = await fetch(root + 'book-a/notes.html');
  assert.equal(original.headers.get('etag'), 'W/' + version);
  assert.deepEqual(Buffer.from(await original.arrayBuffer()), content);

  const remote = new WebDAV({ server: 'https://example.test/', folder: 'Books', loginName: 'dummy', appPassword: 'dummy' });
  remote.root = root; // local test transport only; production still requires HTTPS
  const result = await remote.get('book-a/notes.html', version);
  assert.deepEqual(result.data, content);
  assert.equal(result.etag, version);
  assert.equal(requests.at(-1)['accept-encoding'], 'identity');
  assert.equal(requests.at(-1)['if-match'], version);

  responseVersion = '"newer-version"';
  await assert.rejects(remote.get('book-a/notes.html', version), /ETag changed/);
  responseVersion = 'W/' + version;
  await assert.rejects(remote.get('book-a/notes.html', version), /ETag changed/);
  responseVersion = null;
  await assert.rejects(remote.get('book-a/notes.html', version), /ETag changed/);
  status = 412;
  await assert.rejects(remote.get('book-a/notes.html', version), err => err.status === 412);
});
