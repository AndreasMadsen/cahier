/**
 * Copyright (c) 2012 Andreas Madsen
 * MIT License
 */

var path = require('path');
var fs = require('fs');
var wrench = require('wrench');

// node < 0.8 compatibility
exports.exists = fs.exists || path.exists;
exports.existsSync = fs.existsSync || path.existsSync;

// resolve main dirpaths
exports.test = path.dirname(module.filename);
exports.root = path.resolve(exports.test, '..');

// resolve filepath to main module
exports.leaflet = path.resolve(exports.root, 'leaflet.js');

// resolve test dirpaths
exports.fixture = path.resolve(exports.test, 'fixture');
exports.temp = path.resolve(exports.test, 'temp');

// Create temp directory if it don't exist
if (exports.existsSync(exports.temp) === false) {
  fs.mkdirSync(exports.temp);
}

// Reset temp directory
exports.reset = function () {
  wrench.rmdirSyncRecursive(exports.temp);
  fs.mkdirSync(exports.temp);
};

// Combine all options
exports.options = {
  read: exports.fixture,
  write: exports.temp,
  stat: path.resolve(exports.temp, 'stat.json')
};
