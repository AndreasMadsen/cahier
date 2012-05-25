/**
 * Copyright (c) 2012 Andreas Madsen
 * MIT License
 */

var path = require('path');
var fs = require('fs');
var async = require('async');
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

// Reset temp directory
exports.reset = function () {
  if (exports.existsSync(exports.temp)) {
    wrench.rmdirSyncRecursive(exports.temp);
  }

  fs.writeFileSync(path.resolve(exports.fixture, 'change.json'), JSON.stringify({
    'state': 1
  }));
};

// Modify /change.json
exports.modify = function (done) {
  var change = path.resolve(exports.fixture, 'change.json');

  async.waterfall([

    // read source
    fs.readFile.bind(fs, change, 'utf8'),

    // modify and save to source
    function (content, callback) {
      var obj = JSON.parse(content);
          obj.state += 1;

      fs.writeFile(change, JSON.stringify(obj), function (error) {
        callback(error, obj.state);
      });
    }
  ], done);
};

// Combine all options
exports.options = {
  source: exports.fixture,
  cache: exports.temp,
  state: path.resolve(exports.temp, 'state.json')
};
