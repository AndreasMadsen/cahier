/**
 * Copyright (c) 2012 Andreas Madsen
 * MIT License
 */

var vows = require('vows'),
    path = require('path'),
    fs = require('fs'),
    assert = require('assert'),
    common = require('../common.js'),
    leaflet = require(common.leaflet);

// create convert object
var convert = leaflet({
  read: common.fixture,
  write: common.temp,
  stat: common.stat
});

// ignore selected files
convert.ignore('.DS_store');
convert.ignore('/', 'ignore.js');

// simpel handlers, will add first and second exports properties
convert.handle('js', function (content, next) {
  next( content + "\n" + "exports.first = 'first';" );
});

convert.handle('js', function (content, next) {
  next( content + "\n" + "exports.second = 'second';" );
});

// remove temp content
common.reset();

vows.describe('testing leaflet compiler').addBatch({

  'compile fixture files': {
    topic: function () {
      var self = this;

      convert.compile(function (error) {
        self.callback(error, null);
      });
    },

    'check output directory': function (error, dum) {
      assert.ifError(error);

      assert.deepEqual(fs.readdirSync(path.resolve(common.temp)), ['change.js', 'sub', 'static.js']);
      assert.deepEqual(fs.readdirSync(path.resolve(common.temp, 'sub')), ['change.js', 'static.js']);
    },

    'check file content': function (error, dum) {
      assert.ifError(error);

      assert.equal(fs.readFileSync(path.resolve(common.temp, 'change.js')), '');
      assert.equal(fs.readFileSync(path.resolve(common.temp, 'sub/change.js')), '');

      assert.deepEqual(require(path.resolve(common.temp, 'static.js')), {
        zero: 'zero',
        position: 'root',
        first: 'first',
        second: 'second'
      });

      assert.deepEqual(require(path.resolve(common.temp, 'sub', 'static.js')), {
        zero: 'zero',
        position: 'sub',
        first: 'first',
        second: 'second'
      });
    }
  }

}).exportTo(module);
