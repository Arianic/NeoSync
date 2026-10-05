'use strict';
// Desktop byte/hash implementation; the core itself imports no platform APIs.
const { createSyncEngine } = require('./engine-core');
const SyncEngine = createSyncEngine(require('./model'));
module.exports = { SyncEngine };
